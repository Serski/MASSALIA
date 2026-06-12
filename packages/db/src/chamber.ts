import { and, asc, eq, lte } from "drizzle-orm";
import {
  chamberVoteDueAt,
  gameDate,
  nextSeasonBoundaryMs,
  npcBlocVotes,
  questionForYear,
  swayedVotes,
  tallyChamber,
  NPC_PARTIES,
  type ChamberChoice,
  type ChamberConfig,
  type NpcBlocResult,
  type NpcParty,
  type PoliticsConfig,
  type SwayTotals,
} from "@massalia/shared";
import { createDb } from "./client.js";
import { chamberBallots, chamberVotes, oligarchSeats, partyFavor, playerCharacters, worlds } from "./schema.js";

const db = createDb();

// ---------------------------------------------------------------------------
// The Oligarchy Chamber lifecycle (DB level), shared by the server (lazy-on-
// read) and the BullMQ worker (scheduled sweep) — the festival/Olympiad
// pattern. One chamber vote opens per game year (the rotating config question)
// and auto-closes at the next season boundary, where player ballots + favor-
// sway + the NPC base blocs are tallied. The pure math lives in
// @massalia/shared (oligarchy.ts).
// ---------------------------------------------------------------------------

type ChamberVoteRow = typeof chamberVotes.$inferSelect;

async function activeWorld(): Promise<{ id: string; startedMs: number } | null> {
  const rows = await db.select({ id: worlds.id, startedAt: worlds.startedAt }).from(worlds).where(eq(worlds.status, "active")).limit(1);
  return rows[0] ? { id: rows[0].id, startedMs: rows[0].startedAt.getTime() } : null;
}

// Seed a world's chamber from the config (idempotent — used for NEW worlds; the
// 0021 migration seeded the worlds that existed before it). NPC blocs occupy
// the low seat indexes in NPC_PARTIES order; the rest start empty.
export async function ensureChamberSeats(worldId: string, chamber: ChamberConfig): Promise<void> {
  const values: (typeof oligarchSeats.$inferInsert)[] = [];
  let index = 0;
  for (const party of NPC_PARTIES) {
    for (let i = 0; i < chamber.npcSeats[party]; i++) {
      values.push({ worldId, seatIndex: index++, holderType: "npc", npcParty: party });
    }
  }
  while (index < chamber.capacity) {
    values.push({ worldId, seatIndex: index++, holderType: "empty" });
  }
  await db.insert(oligarchSeats).values(values).onConflictDoNothing();
}

// The open chamber vote of the active world, if any (regardless of closes_at —
// callers run closeDueChamberVotes first to settle an overdue one).
export async function openChamberVote(): Promise<ChamberVoteRow | null> {
  const world = await activeWorld();
  if (!world) return null;
  const rows = await db
    .select()
    .from(chamberVotes)
    .where(and(eq(chamberVotes.worldId, world.id), eq(chamberVotes.status, "open")))
    .limit(1);
  return rows[0] ?? null;
}

// Open this game year's chamber vote if it is due and not yet opened (idempotent
// via UNIQUE (world_id, game_year)). Open for one season: closes_at is the next
// season boundary on the world clock. Returns the opened row, or null.
export async function openChamberVoteIfDue(cfg: PoliticsConfig, now: Date = new Date()): Promise<ChamberVoteRow | null> {
  const world = await activeWorld();
  if (!world) return null;
  const gd = gameDate(now.getTime(), world.startedMs);
  if (!chamberVoteDueAt(cfg.chamber, gd.yearInGame)) return null;

  const question = questionForYear(cfg.chamber, gd.yearInGame);
  const inserted = await db
    .insert(chamberVotes)
    .values({
      worldId: world.id,
      gameYear: gd.yearInGame,
      title: question.title,
      description: question.description,
      opensAt: now,
      closesAt: new Date(nextSeasonBoundaryMs(now.getTime(), world.startedMs)),
      status: "open",
    })
    .onConflictDoNothing()
    .returning();
  return inserted[0] ?? null;
}

export interface ChamberClose {
  voteId: string;
  gameYear: number;
  title: string;
  yes: number;
  no: number;
  passed: boolean;
}

// Close every open vote whose closes_at has passed: tally player ballots, each
// voting player's favor-sway on their own party's swing NPCs, and the NPC base
// blocs voting their configured lean. Records counts + status. Idempotent (the
// status guard); returns a summary per closed vote so callers can raise SSE.
export async function closeDueChamberVotes(cfg: PoliticsConfig, now: Date = new Date()): Promise<ChamberClose[]> {
  const world = await activeWorld();
  if (!world) return [];
  const due = await db
    .select()
    .from(chamberVotes)
    .where(and(eq(chamberVotes.worldId, world.id), eq(chamberVotes.status, "open"), lte(chamberVotes.closesAt, now)));

  const closes: ChamberClose[] = [];
  for (const vote of due) {
    const tally = await tallyChamberVote(world.id, vote, cfg);
    const updated = await db
      .update(chamberVotes)
      .set({ status: tally.passed ? "passed" : "failed", yesCount: tally.yes, noCount: tally.no })
      .where(and(eq(chamberVotes.id, vote.id), eq(chamberVotes.status, "open")))
      .returning({ id: chamberVotes.id });
    if (updated.length) {
      closes.push({ voteId: vote.id, gameYear: vote.gameYear, title: vote.title, yes: tally.yes, no: tally.no, passed: tally.passed });
    }
  }
  return closes;
}

// The tally of one vote: NPC blocs sized from the live seats table, the leans
// from the question that opened the vote, ballots + favor-sway from the DB.
async function tallyChamberVote(worldId: string, vote: ChamberVoteRow, cfg: PoliticsConfig) {
  const question = questionForYear(cfg.chamber, vote.gameYear);

  // NPC blocs at their live size (stable 50/50/10 unless content changes).
  const npcRows = await db
    .select({ npcParty: oligarchSeats.npcParty })
    .from(oligarchSeats)
    .where(and(eq(oligarchSeats.worldId, worldId), eq(oligarchSeats.holderType, "npc")));
  const blocSizes = new Map<NpcParty, number>();
  for (const row of npcRows) {
    const party = row.npcParty as NpcParty | null;
    if (party) blocSizes.set(party, (blocSizes.get(party) ?? 0) + 1);
  }
  const blocs: NpcBlocResult[] = NPC_PARTIES.filter((party) => blocSizes.has(party)).map((party) =>
    npcBlocVotes(blocSizes.get(party)!, cfg.chamber.npcSwingFraction, question.leans[party], party),
  );
  const swingSizeByParty = new Map(blocs.map((bloc) => [bloc.party, bloc.swingSize]));

  // Player ballots, with each voter's CURRENT party (a defector sways nobody on
  // the old side) and their favor with that party.
  const ballotRows = await db
    .select({ choice: chamberBallots.choice, voterId: chamberBallots.voterCharacterId, party: playerCharacters.party })
    .from(chamberBallots)
    .innerJoin(playerCharacters, eq(playerCharacters.id, chamberBallots.voterCharacterId))
    .where(eq(chamberBallots.voteId, vote.id));

  const swayedTotals: Partial<Record<NpcParty, SwayTotals>> = {};
  for (const ballot of ballotRows) {
    const party = ballot.party as NpcParty;
    const maxSwing = swingSizeByParty.get(party);
    if (maxSwing === undefined) continue; // 'none' (or partyless) players sway no bloc
    const favorRows = await db
      .select({ favor: partyFavor.favor })
      .from(partyFavor)
      .where(and(eq(partyFavor.characterId, ballot.voterId), eq(partyFavor.party, party)))
      .limit(1);
    const swayed = swayedVotes(favorRows[0]?.favor ?? 0, cfg.chamber.favorPerSwingVote, maxSwing);
    if (swayed === 0) continue;
    const totals = (swayedTotals[party] ??= { yes: 0, no: 0 });
    totals[ballot.choice as ChamberChoice] += swayed;
  }

  return tallyChamber(blocs, ballotRows.map((ballot) => ballot.choice as ChamberChoice), swayedTotals);
}

// The public ledger: past (closed) votes, newest first.
export async function closedChamberVotes(limit = 12): Promise<ChamberVoteRow[]> {
  const world = await activeWorld();
  if (!world) return [];
  const rows = await db
    .select()
    .from(chamberVotes)
    .where(and(eq(chamberVotes.worldId, world.id)))
    .orderBy(asc(chamberVotes.gameYear));
  return rows.filter((row) => row.status !== "open").slice(-limit).reverse();
}
