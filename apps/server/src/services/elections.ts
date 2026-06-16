import { and, eq, isNull, sql } from "drizzle-orm";
import {
  advanceElections,
  castElectionVote,
  createDb,
  declareCandidacy as dbDeclareCandidacy,
  electedTermCount,
  electionCandidateRows,
  houses,
  isCandidate,
  officeHistoryRows,
  officeHistory,
  officeRows,
  offices,
  oligarchSeats,
  openElections,
  openElectionsIfDue,
  partyFavor,
  players,
  playerCharacters,
  voterChoice,
  worlds,
} from "@massalia/db";
import {
  canDeclare,
  electionConfig,
  gameDate,
  holderForfeitsOffice,
  type ElectionConfig,
  type LeagueOffice,
  type OfficeSide,
} from "@massalia/shared";
import type { CharacterRow } from "./character.js";
import { getCalendarConfig } from "./festival.js";
import { getPoliticsConfig } from "./oligarchy.js";
import { seatOf } from "./oligarchy.js";
import { regentMayHoldOffice } from "./succession.js";
import { broadcastState } from "./worldState.js";

const db = createDb();

// ---------------------------------------------------------------------------
// Archon & Ephor elections (Politics Prompt 2), the server orchestration:
// declaration → campaign → vote → resolve → take office, plus the death cascade,
// defection forfeit, Strategoi appointment, and the campaign-routine gate. The
// sweep lifecycle + tally live in @massalia/db; the constitution's offices come
// from politics-config.json; the cadence from calendar-config.json.
// ---------------------------------------------------------------------------

const ELECTED: LeagueOffice[] = ["archon", "ephor"];

function ecfg(): ElectionConfig {
  return electionConfig(getCalendarConfig());
}

async function activeWorld(): Promise<{ id: string; startedMs: number } | null> {
  const rows = await db.select({ id: worlds.id, startedAt: worlds.startedAt }).from(worlds).where(eq(worlds.status, "active")).limit(1);
  return rows[0] ? { id: rows[0].id, startedMs: rows[0].startedAt.getTime() } : null;
}

async function currentGameYear(now: Date): Promise<number> {
  const world = await activeWorld();
  return world ? gameDate(now.getTime(), world.startedMs).yearInGame : 0;
}

// Prompt 3: a for-life party leader (party_archon / party_ephor) may NOT stand for
// league office — the career fork between machine boss and magistrate. canDeclare
// reads this flag and rejects them.
async function barredFromLeagueOffice(characterId: string): Promise<boolean> {
  const rows = await db
    .select({ office: offices.office })
    .from(offices)
    .where(eq(offices.holderCharacterId, characterId));
  return rows.some((r) => r.office === "party_archon" || r.office === "party_ephor");
}

// --- The lazy-on-read net + worker delegator --------------------------------

// Open due declarations + advance phases + reconcile vacancies. Idempotent and
// season-correct (no boot backlog — see db/elections.ts). Broadcasts on change.
export async function syncElections(now: Date = new Date()): Promise<void> {
  const calendar = getCalendarConfig();
  const politics = getPoliticsConfig();
  const opened = await openElectionsIfDue(calendar, now);
  const advanced = await advanceElections(calendar, politics, now);
  const reconciled = await reconcileOffices(now);
  if (opened.length || advanced.toVoting.length || advanced.resolved.length || reconciled) {
    await broadcastState();
  }
}

// --- Candidacy (declaration) ------------------------------------------------

export type DeclareResult = { ok: false; code: number; error: string } | { ok: true; office: LeagueOffice; side: OfficeSide };

function sideForDeclaration(party: string, requestedSide?: string): OfficeSide | null {
  // Honour an explicit side (canDeclare then rejects a party member on the wrong
  // side); otherwise a party member defaults to their own side.
  if (requestedSide === "palaioi" || requestedSide === "dynatoi") return requestedSide;
  if (party === "palaioi" || party === "dynatoi") return party;
  return null; // an independent with no side chosen
}

export async function declareCandidacy(row: CharacterRow, office: LeagueOffice, requestedSide: string | undefined, now: Date = new Date()): Promise<DeclareResult> {
  await syncElections(now);
  if (!ELECTED.includes(office)) return { ok: false, code: 400, error: "Unknown office." };

  const side = sideForDeclaration(row.party, requestedSide);
  if (!side) return { ok: false, code: 400, error: "As an independent you must choose a side to stand on." };

  const election = (await openElections()).find((e) => e.office === office && e.phase === "declaration");
  if (!election) return { ok: false, code: 409, error: "Declarations for this office are not open." };

  const check = canDeclare(
    {
      status: row.status,
      isSeatHolder: (await seatOf(row.id)) !== null,
      isRegent: !regentMayHoldOffice(row, office),
      party: row.party,
      side,
      barredFromLeagueOffice: await barredFromLeagueOffice(row.id),
      electedTermsInOffice: await electedTermCount(row.id, office),
    },
    ecfg(),
  );
  if (!check.ok) return { ok: false, code: 409, error: check.reason };

  const declared = await dbDeclareCandidacy(election.id, row.id, side, now);
  if (!declared) return { ok: false, code: 409, error: "You have already declared for this office." };
  await broadcastState();
  return { ok: true, office, side };
}

// --- Voting (secret) --------------------------------------------------------

export type VoteResult = { ok: false; code: number; error: string } | { ok: true; office: LeagueOffice; candidateCharacterId: string };

// Every LIVING player may vote (seat or no seat), one per office, changeable
// until close. Secret — only the voter sees their own choice.
export async function castVote(row: CharacterRow, office: LeagueOffice, candidateCharacterId: string, now: Date = new Date()): Promise<VoteResult> {
  await syncElections(now);
  if (row.status !== "alive") return { ok: false, code: 409, error: "The dead do not vote." };

  const election = (await openElections()).find((e) => e.office === office && e.phase === "voting");
  if (!election) return { ok: false, code: 409, error: "Voting for this office is not open." };

  if (!(await isCandidate(election.id, candidateCharacterId))) {
    return { ok: false, code: 409, error: "That candidate is not standing for this office." };
  }
  await castElectionVote(election.id, row.id, candidateCharacterId, now);
  await broadcastState();
  return { ok: true, office, candidateCharacterId };
}

// --- The ballot / election status view --------------------------------------

export interface BallotCandidateView {
  characterId: string;
  side: OfficeSide;
  name: string;
  houseName: string;
  party: string;
  prestige: number;
}

export interface ElectionOfficeView {
  office: LeagueOffice;
  phase: "declaration" | "voting" | "resolved";
  declarationEndsAt: string;
  votingEndsAt: string;
  candidates: BallotCandidateView[];
  yourVote: string | null; // the voter's OWN choice (visible only to them)
  // Per-side declaration eligibility for the acting player.
  youMayDeclare: { palaioi: boolean; dynatoi: boolean };
  youAreCandidate: boolean;
}

export interface ElectionsView {
  hasOpenElection: boolean;
  offices: ElectionOfficeView[];
  // The next election year (for the "no election now" hint).
  nextElectionYear: number | null;
}

export async function electionsView(row: CharacterRow, now: Date = new Date()): Promise<ElectionsView> {
  await syncElections(now);
  const open = await openElections();
  const cfg = ecfg();
  const isSeat = (await seatOf(row.id)) !== null;
  const isRegentBarred = (office: LeagueOffice) => !regentMayHoldOffice(row, office);

  const officeViews: ElectionOfficeView[] = [];
  for (const election of open.sort((a, b) => a.office.localeCompare(b.office))) {
    const candRows = await electionCandidateRows(election.id);
    const yourVote = await voterChoice(election.id, row.id);
    const terms = await electedTermCount(row.id, election.office as LeagueOffice);
    const eligibleSide = async (side: OfficeSide) =>
      canDeclare(
        {
          status: row.status,
          isSeatHolder: isSeat,
          isRegent: isRegentBarred(election.office as LeagueOffice),
          party: row.party,
          side,
          barredFromLeagueOffice: await barredFromLeagueOffice(row.id),
          electedTermsInOffice: terms,
        },
        cfg,
      ).ok;
    officeViews.push({
      office: election.office as LeagueOffice,
      phase: election.phase as ElectionOfficeView["phase"],
      declarationEndsAt: election.declarationEndsAt.toISOString(),
      votingEndsAt: election.votingEndsAt.toISOString(),
      candidates: candRows.map((c) => ({ characterId: c.characterId, side: c.side, name: c.name, houseName: c.houseName, party: c.party, prestige: c.prestige })),
      yourVote,
      youMayDeclare: { palaioi: election.phase === "declaration" && (await eligibleSide("palaioi")), dynatoi: election.phase === "declaration" && (await eligibleSide("dynatoi")) },
      youAreCandidate: await isCandidate(election.id, row.id),
    });
  }

  // Next election year (for the quiet "no election in session" hint).
  let nextElectionYear: number | null = null;
  const year = await currentGameYear(now);
  for (let y = year; y <= year + cfg.cadenceYears; y++) {
    if (y > 0 && y % cfg.cadenceYears === 0) {
      nextElectionYear = y;
      break;
    }
  }

  return { hasOpenElection: officeViews.length > 0, offices: officeViews, nextElectionYear };
}

// --- Offices view + ledger --------------------------------------------------

export interface OfficeSeatView {
  office: LeagueOffice | "strategos";
  side: OfficeSide | null;
  seatSlot: number;
  holder: { characterId: string; name: string; houseName: string; party: string } | null;
  acquiredVia: string | null;
  termEndsYear: number | null;
  // When vacant: the acting player may appoint to this seat (cascade/strategos).
  youMayAppoint: boolean;
}

export interface OfficeLedgerEntry {
  holderName: string;
  houseName: string;
  office: string;
  side: string | null;
  startedYear: number;
  endedYear: number | null;
  acquiredVia: string;
}

export interface OfficesView {
  seats: OfficeSeatView[];
  // The dynasty-spanning history, newest first.
  ledger: OfficeLedgerEntry[];
  // House tallies ("House Leonidas: 3 Archonships") from elected/ascended terms.
  houseTallies: { houseName: string; archonships: number; ephorships: number }[];
}

async function holderInfo(characterId: string | null): Promise<OfficeSeatView["holder"]> {
  if (!characterId) return null;
  const rows = await db
    .select({ name: players.name, houseName: houses.name, party: playerCharacters.party })
    .from(playerCharacters)
    .innerJoin(players, eq(players.id, playerCharacters.playerId))
    .innerJoin(houses, eq(houses.slug, players.houseSlug))
    .where(eq(playerCharacters.id, characterId))
    .limit(1);
  return rows[0] ? { characterId, name: rows[0].name, houseName: rows[0].houseName, party: rows[0].party } : null;
}

export async function officesView(row: CharacterRow, now: Date = new Date()): Promise<OfficesView> {
  await syncElections(now);
  const world = await activeWorld();
  if (!world) return { seats: [], ledger: [], houseTallies: [] };
  const politics = getPoliticsConfig();
  const rows = await officeRows(world.id);
  const rowFor = (office: string, side: OfficeSide | null, slot: number) =>
    rows.find((r) => r.office === office && (r.side ?? null) === side && r.seatSlot === slot) ?? null;

  const seats: OfficeSeatView[] = [];

  // Elected seats: archon/ephor × side.
  for (const def of politics.offices.elected) {
    for (const side of def.sides) {
      const seatRow = rowFor(def.office, side, 0);
      const holder = await holderInfo(seatRow?.holderCharacterId ?? null);
      seats.push({
        office: def.office,
        side,
        seatSlot: 0,
        holder,
        acquiredVia: seatRow?.acquiredVia ?? null,
        termEndsYear: seatRow?.termEndsYear ?? null,
        // A vacant Ephor seat may be filled by the sitting same-side Archon.
        youMayAppoint: !holder && def.office === "ephor" && (await isSittingArchon(world.id, row.id, side)),
      });
    }
  }

  // Strategoi: title-only appointed slots.
  for (let slot = 0; slot < politics.offices.strategoi.count; slot++) {
    const seatRow = rowFor("strategos", null, slot);
    const holder = await holderInfo(seatRow?.holderCharacterId ?? null);
    seats.push({
      office: "strategos",
      side: null,
      seatSlot: slot,
      holder,
      acquiredVia: seatRow?.acquiredVia ?? null,
      termEndsYear: seatRow?.termEndsYear ?? null,
      youMayAppoint: !holder && (await isSittingOfficial(world.id, row.id)),
    });
  }

  const history = await officeHistoryRows(world.id);
  const ledger: OfficeLedgerEntry[] = history
    .map((h) => ({ holderName: h.holderName, houseName: h.houseName, office: h.office, side: h.side, startedYear: h.startedYear, endedYear: h.endedYear, acquiredVia: h.acquiredVia }))
    .reverse();

  // House tallies from the ledger (Archonships / Ephorships per house).
  const tally = new Map<string, { archonships: number; ephorships: number }>();
  for (const h of history) {
    const t = tally.get(h.houseName) ?? { archonships: 0, ephorships: 0 };
    if (h.office === "archon") t.archonships++;
    if (h.office === "ephor") t.ephorships++;
    tally.set(h.houseName, t);
  }
  const houseTallies = [...tally.entries()]
    .map(([houseName, t]) => ({ houseName, ...t }))
    .filter((t) => t.archonships + t.ephorships > 0)
    .sort((a, b) => b.archonships - a.archonships || b.ephorships - a.ephorships);

  return { seats, ledger, houseTallies };
}

async function isSittingArchon(worldId: string, characterId: string, side: OfficeSide): Promise<boolean> {
  const rows = await db
    .select({ id: offices.id })
    .from(offices)
    .where(and(eq(offices.worldId, worldId), eq(offices.office, "archon"), eq(offices.side, side), eq(offices.holderCharacterId, characterId)))
    .limit(1);
  return rows.length > 0;
}

async function isSittingOfficial(worldId: string, characterId: string): Promise<boolean> {
  const rows = await db
    .select({ office: offices.office })
    .from(offices)
    .where(and(eq(offices.worldId, worldId), eq(offices.holderCharacterId, characterId)));
  return rows.some((r) => r.office === "archon" || r.office === "ephor");
}

// --- Death cascade + defection forfeit (the reconcile) ----------------------

// End the open office_history term for a seat (its current holder).
async function endOpenHistory(worldId: string, office: string, side: OfficeSide | null, year: number): Promise<void> {
  const conds = [eq(officeHistory.worldId, worldId), eq(officeHistory.office, office), isNull(officeHistory.endedYear)];
  if (side) conds.push(eq(officeHistory.side, side));
  await db.update(officeHistory).set({ endedYear: year }).where(and(...conds));
}

async function vacateSeat(worldId: string, office: string, side: OfficeSide | null, slot: number): Promise<void> {
  const conds = [eq(offices.worldId, worldId), eq(offices.office, office), eq(offices.seatSlot, slot)];
  if (side) conds.push(eq(offices.side, side));
  else conds.push(isNull(offices.side));
  await db.update(offices).set({ holderCharacterId: null, independentHolder: false, acquiredVia: null, termStartedYear: null, termEndsYear: null }).where(and(...conds));
}

// Reconcile every constitutional seat against its holder's living/party state.
// Idempotent: loads each seat's CURRENT holder from the DB, so an ascension done
// earlier in the pass is seen by later iterations. Archons before Ephors so an
// Archon's death can pull up the (still-seated) same-side Ephor.
export async function reconcileOffices(now: Date = new Date()): Promise<boolean> {
  const world = await activeWorld();
  if (!world) return false;
  const politics = getPoliticsConfig();
  const year = gameDate(now.getTime(), world.startedMs).yearInGame;
  let changed = false;

  const electedSeats: { office: LeagueOffice; side: OfficeSide }[] = [];
  for (const def of politics.offices.elected) for (const side of def.sides) electedSeats.push({ office: def.office, side });
  electedSeats.sort((a, b) => (a.office === b.office ? 0 : a.office === "archon" ? -1 : 1));

  for (const seat of electedSeats) {
    const current = (await officeRows(world.id)).find((r) => r.office === seat.office && r.side === seat.side && r.seatSlot === 0);
    if (!current?.holderCharacterId) continue;
    const holder = (await db.select().from(playerCharacters).where(eq(playerCharacters.id, current.holderCharacterId)).limit(1))[0];
    if (!holder) continue;
    const dead = holder.status !== "alive";
    const forfeit = holderForfeitsOffice(holder.party, seat.side, current.independentHolder);
    if (!dead && !forfeit) continue;

    await endOpenHistory(world.id, seat.office, seat.side, year);

    if (seat.office === "archon") {
      // Ascend the same-side Ephor, if one is seated, alive, and still valid.
      const ephor = (await officeRows(world.id)).find((r) => r.office === "ephor" && r.side === seat.side && r.seatSlot === 0);
      const ephorHolder = ephor?.holderCharacterId ? (await db.select().from(playerCharacters).where(eq(playerCharacters.id, ephor.holderCharacterId)).limit(1))[0] : null;
      if (ephor?.holderCharacterId && ephorHolder && ephorHolder.status === "alive" && !holderForfeitsOffice(ephorHolder.party, seat.side, ephor.independentHolder)) {
        await endOpenHistory(world.id, "ephor", seat.side, year);
        await db
          .update(offices)
          .set({ holderCharacterId: ephor.holderCharacterId, independentHolder: ephor.independentHolder, acquiredVia: "ascended", termStartedYear: current.termStartedYear, termEndsYear: current.termEndsYear })
          .where(and(eq(offices.worldId, world.id), eq(offices.office, "archon"), eq(offices.side, seat.side), eq(offices.seatSlot, 0)));
        await db.insert(officeHistory).values({ worldId: world.id, characterId: ephor.holderCharacterId, office: "archon", side: seat.side, startedYear: year, acquiredVia: "ascended" });
        // The vacated Ephor seat awaits appointment by the new Archon.
        await vacateSeat(world.id, "ephor", seat.side, 0);
      } else {
        await vacateSeat(world.id, "archon", seat.side, 0);
      }
    } else {
      // Ephor: vacate; the same-side Archon may appoint a replacement.
      await vacateSeat(world.id, "ephor", seat.side, 0);
    }
    changed = true;
  }

  // Strategoi vacate on death only (title-only, no side to forfeit).
  for (let slot = 0; slot < politics.offices.strategoi.count; slot++) {
    const current = (await officeRows(world.id)).find((r) => r.office === "strategos" && r.seatSlot === slot);
    if (!current?.holderCharacterId) continue;
    const holder = (await db.select({ status: playerCharacters.status }).from(playerCharacters).where(eq(playerCharacters.id, current.holderCharacterId)).limit(1))[0];
    if (holder && holder.status !== "alive") {
      await endOpenHistory(world.id, "strategos", null, year);
      await vacateSeat(world.id, "strategos", null, slot);
      changed = true;
    }
  }

  return changed;
}

// --- Appointments (Ephor replacement + Strategoi) ---------------------------

export type AppointResult = { ok: false; code: number; error: string } | { ok: true; office: string; side: OfficeSide | null };

async function appointEligible(worldId: string, characterId: string, side: OfficeSide | null): Promise<{ ok: true; row: CharacterRow } | { ok: false; reason: string }> {
  const rows = await db.select().from(playerCharacters).where(eq(playerCharacters.id, characterId)).limit(1);
  const candidate = rows[0];
  if (!candidate) return { ok: false, reason: "No such citizen." };
  if (candidate.status !== "alive") return { ok: false, reason: "The dead cannot take office." };
  if ((await seatOf(characterId)) === null) return { ok: false, reason: "The appointee must hold an oligarch seat." };
  if (candidate.isRegent) return { ok: false, reason: "A regent may not hold elected office." };
  if (side && candidate.party !== "none" && candidate.party !== side) return { ok: false, reason: "The appointee's party does not match the side." };
  return { ok: true, row: candidate };
}

// The sitting same-side Archon appoints a replacement Ephor of that side.
export async function appointEphor(actor: CharacterRow, side: OfficeSide, candidateCharacterId: string, now: Date = new Date()): Promise<AppointResult> {
  await syncElections(now);
  const world = await activeWorld();
  if (!world) return { ok: false, code: 503, error: "No active world." };
  if (!(await isSittingArchon(world.id, actor.id, side))) return { ok: false, code: 403, error: "Only the sitting Archon of this side may appoint its Ephor." };

  const ephorSeat = (await officeRows(world.id)).find((r) => r.office === "ephor" && r.side === side && r.seatSlot === 0);
  if (ephorSeat?.holderCharacterId) return { ok: false, code: 409, error: "That Ephor seat is not vacant." };

  const eligible = await appointEligible(world.id, candidateCharacterId, side);
  if (!eligible.ok) return { ok: false, code: 409, error: eligible.reason };

  const year = gameDate(now.getTime(), world.startedMs).yearInGame;
  const archonSeat = (await officeRows(world.id)).find((r) => r.office === "archon" && r.side === side && r.seatSlot === 0);
  const independent = eligible.row.party === "none";
  await db
    .insert(offices)
    .values({ worldId: world.id, office: "ephor", side, seatSlot: 0, holderCharacterId: candidateCharacterId, independentHolder: independent, acquiredVia: "appointed", termStartedYear: year, termEndsYear: archonSeat?.termEndsYear ?? null })
    .onConflictDoUpdate({
      target: [offices.worldId, offices.office, offices.side, offices.seatSlot],
      set: { holderCharacterId: candidateCharacterId, independentHolder: independent, acquiredVia: "appointed", termStartedYear: year, termEndsYear: archonSeat?.termEndsYear ?? null },
    });
  await db.insert(officeHistory).values({ worldId: world.id, characterId: candidateCharacterId, office: "ephor", side, startedYear: year, acquiredVia: "appointed" });
  await broadcastState();
  return { ok: true, office: "ephor", side };
}

// Any sitting elected official appoints a Strategos to an empty slot. Title-only;
// cross-party balance enforced (the two Strategoi must not share a party).
export async function appointStrategos(actor: CharacterRow, candidateCharacterId: string, now: Date = new Date()): Promise<AppointResult> {
  await syncElections(now);
  const world = await activeWorld();
  if (!world) return { ok: false, code: 503, error: "No active world." };
  if (!(await isSittingOfficial(world.id, actor.id))) return { ok: false, code: 403, error: "Only the four sitting Archons and Ephors appoint the Strategoi." };

  const politics = getPoliticsConfig();
  const strategoiRows = (await officeRows(world.id)).filter((r) => r.office === "strategos");
  const filled = strategoiRows.filter((r) => r.holderCharacterId);
  if (filled.length >= politics.offices.strategoi.count) return { ok: false, code: 409, error: "Both Strategos seats are filled." };

  const eligible = await appointEligible(world.id, candidateCharacterId, null);
  if (!eligible.ok) return { ok: false, code: 409, error: eligible.reason };

  // Hoplite Step 5: the Strategos commands soldiers — restricted to a current or
  // FORMER hoplite (the was-hoplite signal, preserved through re-class). A
  // never-soldier is not eligible. (The shared appointEligible — also used for Ephor
  // appointments — is intentionally NOT gated on class; only the Strategos is.)
  if (!eligible.row.wasHoplite) return { ok: false, code: 409, error: "The Strategos must be a soldier or a veteran of the phalanx." };

  // Cross-party balance: the two Strategoi must not share a party.
  if (politics.offices.strategoi.crossPartyBalance && eligible.row.party !== "none") {
    for (const filledSeat of filled) {
      const other = await holderInfo(filledSeat.holderCharacterId);
      if (other && other.party === eligible.row.party) {
        return { ok: false, code: 409, error: "The Strategoi must balance the parties — the other seat already holds this party." };
      }
    }
  }

  const takenSlots = new Set(strategoiRows.map((r) => r.seatSlot));
  let slot = 0;
  while (takenSlots.has(slot) && strategoiRows.find((r) => r.seatSlot === slot)?.holderCharacterId) slot++;
  const year = gameDate(now.getTime(), world.startedMs).yearInGame;
  await db
    .insert(offices)
    .values({ worldId: world.id, office: "strategos", side: null, seatSlot: slot, holderCharacterId: candidateCharacterId, independentHolder: eligible.row.party === "none", acquiredVia: "appointed", termStartedYear: year, termEndsYear: null })
    .onConflictDoUpdate({
      target: [offices.worldId, offices.office, offices.side, offices.seatSlot],
      set: { holderCharacterId: candidateCharacterId, independentHolder: eligible.row.party === "none", acquiredVia: "appointed", termStartedYear: year, termEndsYear: null },
    });
  await db.insert(officeHistory).values({ worldId: world.id, characterId: candidateCharacterId, office: "strategos", side: null, startedYear: year, acquiredVia: "appointed" });
  await broadcastState();
  return { ok: true, office: "strategos", side: null };
}

// Eligible appointees for a side (living seat-holders, side-compatible, not
// regents, not already an office-holder) — for the appointment picker.
export async function eligibleAppointees(side: OfficeSide | null): Promise<{ characterId: string; name: string; houseName: string; party: string }[]> {
  const world = await activeWorld();
  if (!world) return [];
  const seatHolders = await db
    .select({ characterId: oligarchSeats.characterId, party: playerCharacters.party, status: playerCharacters.status, isRegent: playerCharacters.isRegent, name: players.name, houseName: houses.name })
    .from(oligarchSeats)
    .innerJoin(playerCharacters, eq(playerCharacters.id, oligarchSeats.characterId))
    .innerJoin(players, eq(players.id, playerCharacters.playerId))
    .innerJoin(houses, eq(houses.slug, players.houseSlug))
    .where(and(eq(oligarchSeats.worldId, world.id), eq(oligarchSeats.holderType, "player")));
  const officeHolders = new Set((await officeRows(world.id)).filter((r) => r.holderCharacterId).map((r) => r.holderCharacterId!));
  return seatHolders
    .filter((h) => h.characterId && h.status === "alive" && !h.isRegent && !officeHolders.has(h.characterId))
    .filter((h) => !side || h.party === "none" || h.party === side)
    .map((h) => ({ characterId: h.characterId!, name: h.name, houseName: h.houseName, party: h.party }));
}

// --- Campaign routine gate + favor grant ------------------------------------

// A character is eligible for the campaign routine while they are a declared
// candidate in an active (non-resolved) election — the declaration→vote window.
export async function eligibleForCampaign(characterId: string): Promise<boolean> {
  const open = await openElections();
  for (const election of open) {
    if (await isCandidate(election.id, characterId)) return true;
  }
  return false;
}

// The campaign's visibility gain: +favor with the candidate's own party (this
// feeds NPC favor-sway at the close tally). Independents have no party to court,
// so they gain nothing here — only the routine card's own effects apply.
export async function grantCampaignFavor(characterId: string): Promise<void> {
  const rows = await db.select({ party: playerCharacters.party }).from(playerCharacters).where(eq(playerCharacters.id, characterId)).limit(1);
  const party = rows[0]?.party;
  if (party !== "palaioi" && party !== "dynatoi") return;
  const gain = getPoliticsConfig().offices.campaign.favorGain;
  if (gain <= 0) return;
  await db
    .insert(partyFavor)
    .values({ characterId, party, favor: gain })
    .onConflictDoUpdate({ target: [partyFavor.characterId, partyFavor.party], set: { favor: sql`${partyFavor.favor} + ${gain}` } });
}
