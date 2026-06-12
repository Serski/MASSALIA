import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  chamberBallots,
  chamberVotes,
  closedChamberVotes,
  closeDueChamberVotes,
  createDb,
  effectLog,
  oligarchSeats,
  openChamberVote,
  openChamberVoteIfDue,
  players,
  playerCharacters,
} from "@massalia/db";
import { parsePoliticsConfig, type ChamberChoice, type NpcParty, type PoliticsConfig } from "@massalia/shared";
import type { CharacterRow } from "./character.js";
import { broadcastState } from "./worldState.js";

const db = createDb();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const configFile = path.join(repoRoot, "content/politics/politics-config.json");

let config: PoliticsConfig | null = null;

export async function loadPoliticsConfig(): Promise<PoliticsConfig> {
  const raw = JSON.parse(await fs.readFile(configFile, "utf8"));
  config = parsePoliticsConfig(raw);
  return config;
}

export function getPoliticsConfig(): PoliticsConfig {
  if (!config) throw new Error("Politics config not loaded — call loadPoliticsConfig() at boot.");
  return config;
}

// The seat a character('s dynasty) holds, if any. The slot row is reused across
// successions, so the seat follows the dynasty without any transfer step.
export async function seatOf(characterId: string) {
  const rows = await db.select().from(oligarchSeats).where(eq(oligarchSeats.characterId, characterId)).limit(1);
  return rows[0] ?? null;
}

// Defensive cleanup for the fresh-succession path (a slave's death leaves
// nothing behind): release any seat the slot row might hold so the seats table
// can never disagree with is_councilor = false.
export async function releaseSeatOf(characterId: string): Promise<void> {
  await db
    .update(oligarchSeats)
    .set({ holderType: "empty", characterId: null, acquiredAt: null })
    .where(eq(oligarchSeats.characterId, characterId));
}

// Lazy net mirroring the festival/Olympiad pattern: settle any overdue close,
// then open this year's vote if due. Broadcasts when anything changed.
export async function syncChamberVotes(now: Date = new Date()): Promise<void> {
  const cfg = getPoliticsConfig();
  const closed = await closeDueChamberVotes(cfg, now);
  const opened = await openChamberVoteIfDue(cfg, now);
  if (closed.length || opened) await broadcastState();
}

// --- Buying a seat -----------------------------------------------------------

export type BuySeatResult = { ok: false; code: number; error: string } | { ok: true; seatIndex: number; price: number };

// POST /api/oligarchy/buy-seat: a living, non-slave character without a seat
// pays the seat price and takes the LOWEST-index empty seat. Atomic: the
// deduction, the seat claim, and is_councilor all commit together (is_councilor
// wakes the existing cou-* council events in the daily draw). The seat is
// dynastic — it rides the slot row through successions (alwaysInherited).
export async function buySeat(row: CharacterRow, now: Date = new Date()): Promise<BuySeatResult> {
  const price = getPoliticsConfig().chamber.seatPrice;
  if (row.status !== "alive") return { ok: false, code: 409, error: "The dead hold no seats." };
  if (row.classId === "slave") return { ok: false, code: 409, error: "The unfree may not sit among the Three Hundred." };
  if (await seatOf(row.id)) return { ok: false, code: 409, error: "Your dynasty already holds a seat in the chamber." };
  if (row.drachmae < price) return { ok: false, code: 409, error: `A seat costs ${price} drachmae — you cannot afford it.` };

  let seatIndex: number;
  try {
    seatIndex = await db.transaction(async (tx) => {
      // Conditional deduction: re-checks the balance inside the transaction.
      const paid = await tx
        .update(playerCharacters)
        .set({ drachmae: sql`${playerCharacters.drachmae} - ${price}` })
        .where(and(eq(playerCharacters.id, row.id), gte(playerCharacters.drachmae, price), eq(playerCharacters.status, "alive")))
        .returning({ id: playerCharacters.id });
      if (!paid.length) throw new Error("cannot_afford");

      // Claim the lowest-index empty seat. FOR UPDATE SKIP LOCKED makes two
      // concurrent buyers take two different seats instead of colliding; the
      // unique partial index on character_id blocks a double-buy race.
      const claimed = await tx.execute(sql`
        UPDATE oligarch_seats
        SET holder_type = 'player', character_id = ${row.id}, acquired_at = ${now}
        WHERE id = (
          SELECT id FROM oligarch_seats
          WHERE world_id = ${row.worldId} AND holder_type = 'empty'
          ORDER BY seat_index
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING seat_index
      `);
      const seat = (claimed.rows as { seat_index: number }[])[0];
      if (!seat) throw new Error("chamber_full");

      await tx.update(playerCharacters).set({ isCouncilor: true }).where(eq(playerCharacters.id, row.id));
      await tx.insert(effectLog).values({ characterId: row.id, kind: "oligarch_seat", detail: { seatIndex: seat.seat_index, price } });
      return seat.seat_index;
    });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "chamber_full") return { ok: false, code: 409, error: "No empty seats remain in the chamber." };
    if (message === "cannot_afford") return { ok: false, code: 409, error: `A seat costs ${price} drachmae — you cannot afford it.` };
    // The unique partial index fired (a concurrent double-buy).
    return { ok: false, code: 409, error: "Your dynasty already holds a seat in the chamber." };
  }

  await broadcastState();
  return { ok: true, seatIndex, price };
}

// --- The chamber view (the hemicycle) -----------------------------------------

export type SeatParty = NpcParty;

export interface ChamberSeatView {
  seatIndex: number;
  holderType: "npc" | "player" | "empty";
  // Display color: NPC seats by npc_party; player seats by the holder's CURRENT
  // party (independent-grey when party is 'none'); null for empty seats.
  party: SeatParty | null;
  holderName: string | null;
}

export interface ChamberView {
  capacity: number;
  seatPrice: number;
  seats: ChamberSeatView[];
  composition: {
    npc: Record<SeatParty, number>;
    players: Record<SeatParty, number>;
    playersTotal: number;
    empty: number;
  };
  you: {
    holdsSeat: boolean;
    seatIndex: number | null;
    canBuy: boolean;
    reason: string | null;
  };
}

function playerSeatParty(party: string | null): SeatParty {
  return party === "palaioi" || party === "dynatoi" ? party : "independent";
}

// GET /api/oligarchy/chamber: all 300 seats + composition counts + your status.
export async function chamberView(row: CharacterRow): Promise<ChamberView> {
  const chamber = getPoliticsConfig().chamber;
  const rows = await db
    .select({
      seatIndex: oligarchSeats.seatIndex,
      holderType: oligarchSeats.holderType,
      npcParty: oligarchSeats.npcParty,
      characterId: oligarchSeats.characterId,
      holderParty: playerCharacters.party,
      holderName: players.name,
    })
    .from(oligarchSeats)
    .leftJoin(playerCharacters, eq(playerCharacters.id, oligarchSeats.characterId))
    .leftJoin(players, eq(players.id, playerCharacters.playerId))
    .where(eq(oligarchSeats.worldId, row.worldId))
    .orderBy(asc(oligarchSeats.seatIndex));

  const composition = {
    npc: { palaioi: 0, dynatoi: 0, independent: 0 } as Record<SeatParty, number>,
    players: { palaioi: 0, dynatoi: 0, independent: 0 } as Record<SeatParty, number>,
    playersTotal: 0,
    empty: 0,
  };
  let yourSeat: number | null = null;

  const seats: ChamberSeatView[] = rows.map((seat) => {
    if (seat.holderType === "npc") {
      const party = (seat.npcParty ?? "independent") as SeatParty;
      composition.npc[party]++;
      return { seatIndex: seat.seatIndex, holderType: "npc", party, holderName: null };
    }
    if (seat.holderType === "player") {
      const party = playerSeatParty(seat.holderParty);
      composition.players[party]++;
      composition.playersTotal++;
      if (seat.characterId === row.id) yourSeat = seat.seatIndex;
      return { seatIndex: seat.seatIndex, holderType: "player", party, holderName: seat.holderName };
    }
    composition.empty++;
    return { seatIndex: seat.seatIndex, holderType: "empty", party: null, holderName: null };
  });

  let reason: string | null = null;
  if (yourSeat !== null) reason = "Your dynasty already holds a seat.";
  else if (row.classId === "slave") reason = "The unfree may not sit among the Three Hundred.";
  else if (row.status !== "alive") reason = "The dead hold no seats.";
  else if (composition.empty === 0) reason = "No empty seats remain.";
  else if (row.drachmae < chamber.seatPrice) reason = `A seat costs ${chamber.seatPrice} drachmae.`;

  return {
    capacity: chamber.capacity,
    seatPrice: chamber.seatPrice,
    seats,
    composition,
    you: { holdsSeat: yourSeat !== null, seatIndex: yourSeat, canBuy: reason === null, reason },
  };
}

// --- Voting -------------------------------------------------------------------

export type CastBallotResult = { ok: false; code: number; error: string } | { ok: true; choice: ChamberChoice };

// POST /api/oligarchy/vote: seat-holders cast yes/no on the open vote — one
// ballot per voter, changeable while open (upsert), 409 after close.
export async function castChamberBallot(row: CharacterRow, choice: ChamberChoice, now: Date = new Date()): Promise<CastBallotResult> {
  if (!(await seatOf(row.id))) return { ok: false, code: 403, error: "Only seat-holders vote in the chamber." };

  await syncChamberVotes(now);
  const vote = await openChamberVote();
  if (!vote || vote.closesAt.getTime() <= now.getTime()) {
    return { ok: false, code: 409, error: "No chamber vote is open." };
  }

  await db
    .insert(chamberBallots)
    .values({ voteId: vote.id, voterCharacterId: row.id, choice, castAt: now })
    .onConflictDoUpdate({
      target: [chamberBallots.voteId, chamberBallots.voterCharacterId],
      set: { choice, castAt: now },
    });
  await broadcastState();
  return { ok: true, choice };
}

export interface PublicBallot {
  voterName: string;
  party: SeatParty;
  choice: ChamberChoice;
  castAt: string;
}

export interface ChamberVoteView {
  id: string;
  gameYear: number;
  title: string;
  description: string;
  opensAt: string;
  closesAt: string;
  status: "open" | "passed" | "failed";
  yesCount: number | null;
  noCount: number | null;
  // PUBLIC by design — the political ledger starts here.
  ballots: PublicBallot[];
}

export interface ChamberVotesView {
  open: (ChamberVoteView & { yourBallot: ChamberChoice | null; youMayVote: boolean }) | null;
  past: ChamberVoteView[];
}

async function publicBallots(voteIds: string[]): Promise<Map<string, PublicBallot[]>> {
  const map = new Map<string, PublicBallot[]>();
  if (!voteIds.length) return map;
  const rows = await db
    .select({
      voteId: chamberBallots.voteId,
      choice: chamberBallots.choice,
      castAt: chamberBallots.castAt,
      party: playerCharacters.party,
      voterName: players.name,
    })
    .from(chamberBallots)
    .innerJoin(playerCharacters, eq(playerCharacters.id, chamberBallots.voterCharacterId))
    .innerJoin(players, eq(players.id, playerCharacters.playerId))
    .where(inArray(chamberBallots.voteId, voteIds))
    .orderBy(asc(chamberBallots.castAt));
  for (const row of rows) {
    const list = map.get(row.voteId) ?? [];
    list.push({
      voterName: row.voterName,
      party: playerSeatParty(row.party),
      choice: row.choice as ChamberChoice,
      castAt: row.castAt.toISOString(),
    });
    map.set(row.voteId, list);
  }
  return map;
}

function toVoteView(vote: typeof chamberVotes.$inferSelect, ballots: PublicBallot[]): ChamberVoteView {
  return {
    id: vote.id,
    gameYear: vote.gameYear,
    title: vote.title,
    description: vote.description,
    opensAt: vote.opensAt.toISOString(),
    closesAt: vote.closesAt.toISOString(),
    status: vote.status as ChamberVoteView["status"],
    yesCount: vote.yesCount,
    noCount: vote.noCount,
    ballots,
  };
}

// GET /api/oligarchy/votes: the open vote (with your changeable ballot) plus
// past results — every ballot named, the public record of the chamber.
export async function chamberVotesView(row: CharacterRow, now: Date = new Date()): Promise<ChamberVotesView> {
  await syncChamberVotes(now);
  const open = await openChamberVote();
  const past = await closedChamberVotes();
  const ballotMap = await publicBallots([...(open ? [open.id] : []), ...past.map((vote) => vote.id)]);

  let openView: ChamberVotesView["open"] = null;
  if (open) {
    const ballots = ballotMap.get(open.id) ?? [];
    const yours = await db
      .select({ choice: chamberBallots.choice })
      .from(chamberBallots)
      .where(and(eq(chamberBallots.voteId, open.id), eq(chamberBallots.voterCharacterId, row.id)))
      .limit(1);
    openView = {
      ...toVoteView(open, ballots),
      yourBallot: (yours[0]?.choice as ChamberChoice | undefined) ?? null,
      youMayVote: (await seatOf(row.id)) !== null,
    };
  }

  return { open: openView, past: past.map((vote) => toVoteView(vote, ballotMap.get(vote.id) ?? [])) };
}
