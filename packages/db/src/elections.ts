import { and, asc, eq, isNull, ne } from "drizzle-orm";
import {
  currentElectionCycle,
  electionConfig,
  electionCycleFor,
  gameDate,
  npcBlocVotes,
  resolveElection,
  swayedVotes,
  REAL_MS_PER_SEASON,
  type BallotVote,
  type CalendarConfig,
  type ElectionCandidate,
  type ElectionNpcBloc,
  type ElectionOutcome,
  type LeagueOffice,
  type OfficeSide,
  type PoliticsConfig,
} from "@massalia/shared";
import { createDb } from "./client.js";
import {
  electionCandidates,
  elections,
  electionVotes,
  houses,
  officeHistory,
  offices,
  oligarchSeats,
  partyFavor,
  players,
  playerCharacters,
  worlds,
} from "./schema.js";

const db = createDb();

// ---------------------------------------------------------------------------
// The election lifecycle (DB level), shared by the worker sweep and the server
// lazy-on-read net — the festival/Olympiad/chamber pattern. The phase clock is
// the SEASON clock: declarations open in Spring, the vote is the following
// Winter, winners take office (resolution) the following Spring. Pure tally +
// tie-break + NPC/favor math live in @massalia/shared.
//
// NO-BACKLOG GUARANTEE: openElectionsIfDue only opens a row while `now` is
// inside the declaration window (currentElectionCycle reports it). advance/
// resolve only act on rows that already exist. So a worker that boots mid-cycle
// (or after a cycle's window passed) never retro-fires it — the cycle is simply
// skipped.
// ---------------------------------------------------------------------------

export const ELECTED_OFFICES: LeagueOffice[] = ["archon", "ephor"];
const SIDES: OfficeSide[] = ["palaioi", "dynatoi"];

type ElectionRow = typeof elections.$inferSelect;

async function activeWorld(): Promise<{ id: string; startedMs: number } | null> {
  const rows = await db.select({ id: worlds.id, startedAt: worlds.startedAt }).from(worlds).where(eq(worlds.status, "active")).limit(1);
  return rows[0] ? { id: rows[0].id, startedMs: rows[0].startedAt.getTime() } : null;
}

// The term-limit source: a character's prior ELECTED terms in an office
// (acquired_via='elected' only — ascended/appointed/interim do NOT count).
export async function electedTermCount(characterId: string, office: LeagueOffice): Promise<number> {
  const rows = await db
    .select({ id: officeHistory.id })
    .from(officeHistory)
    .where(and(eq(officeHistory.characterId, characterId), eq(officeHistory.office, office), eq(officeHistory.acquiredVia, "elected")));
  return rows.length;
}

// All non-resolved election rows for the active world (declaration or voting).
export async function openElections(): Promise<ElectionRow[]> {
  const world = await activeWorld();
  if (!world) return [];
  return db.select().from(elections).where(and(eq(elections.worldId, world.id), ne(elections.phase, "resolved")));
}

export async function getElection(office: LeagueOffice, gameYear: number): Promise<ElectionRow | null> {
  const world = await activeWorld();
  if (!world) return null;
  const rows = await db
    .select()
    .from(elections)
    .where(and(eq(elections.worldId, world.id), eq(elections.office, office), eq(elections.gameYear, gameYear)))
    .limit(1);
  return rows[0] ?? null;
}

// Open this cycle's declaration rows IF we are inside a declaration window (and
// not already opened). One row per elected office. Window ends tie to the season
// clock: declaration closes when voting opens; voting closes when office begins.
export async function openElectionsIfDue(calendarCfg: CalendarConfig, now: Date = new Date()): Promise<ElectionRow[]> {
  const world = await activeWorld();
  if (!world) return [];
  const ecfg = electionConfig(calendarCfg);
  const gd = gameDate(now.getTime(), world.startedMs);
  const live = currentElectionCycle(gd.seasonIndex, ecfg);
  if (!live || live.phase !== "declaration") return []; // only ever open during the declaration window

  const declarationEndsAt = new Date(world.startedMs + live.cycle.voteSeasonIndex * REAL_MS_PER_SEASON);
  const votingEndsAt = new Date(world.startedMs + live.cycle.officeSeasonIndex * REAL_MS_PER_SEASON);
  const opened: ElectionRow[] = [];
  for (const office of ELECTED_OFFICES) {
    const inserted = await db
      .insert(elections)
      .values({ worldId: world.id, office, gameYear: live.cycle.dueYear, phase: "declaration", declarationEndsAt, votingEndsAt })
      .onConflictDoNothing()
      .returning();
    if (inserted[0]) opened.push(inserted[0]);
  }
  return opened;
}

export interface ElectionResolution {
  office: LeagueOffice;
  gameYear: number;
  winners: Record<OfficeSide, string | null>;
  // TOTALS only (per-candidate) — never per-voter (secret ballot).
  totals: ElectionOutcome["totals"];
}

export interface AdvanceSummary {
  toVoting: LeagueOffice[]; // declaration → voting transitions
  resolved: ElectionResolution[]; // voting → resolved (offices written)
}

// Advance every existing, non-resolved election against the clock. Idempotent
// (each transition is guarded on the current phase). Only acts on rows that
// exist — so there is never a backlog dump.
export async function advanceElections(calendarCfg: CalendarConfig, politicsCfg: PoliticsConfig, now: Date = new Date()): Promise<AdvanceSummary> {
  const summary: AdvanceSummary = { toVoting: [], resolved: [] };
  const world = await activeWorld();
  if (!world) return summary;
  const rows = await db.select().from(elections).where(and(eq(elections.worldId, world.id), ne(elections.phase, "resolved")));

  for (const row of rows) {
    if (row.phase === "declaration" && now.getTime() >= row.declarationEndsAt.getTime()) {
      const updated = await db
        .update(elections)
        .set({ phase: "voting" })
        .where(and(eq(elections.id, row.id), eq(elections.phase, "declaration")))
        .returning({ id: elections.id });
      if (updated.length) {
        summary.toVoting.push(row.office as LeagueOffice);
        row.phase = "voting";
      }
    }
    if (row.phase === "voting" && now.getTime() >= row.votingEndsAt.getTime()) {
      const resolution = await resolveOne(world.id, world.startedMs, row, calendarCfg, politicsCfg);
      if (resolution) summary.resolved.push(resolution);
    }
  }
  return summary;
}

// Tally one office's election, write the winners into offices + office_history,
// then mark the row resolved. Guarded so a second sweep is a no-op.
async function resolveOne(
  worldId: string,
  startedMs: number,
  row: ElectionRow,
  calendarCfg: CalendarConfig,
  politicsCfg: PoliticsConfig,
): Promise<ElectionResolution | null> {
  const ecfg = electionConfig(calendarCfg);
  const cycle = electionCycleFor(row.gameYear, ecfg);
  const chamber = politicsCfg.chamber;

  const candRows = await db
    .select({
      characterId: electionCandidates.characterId,
      side: electionCandidates.side,
      declaredAt: electionCandidates.declaredAt,
      party: playerCharacters.party,
      prestige: playerCharacters.prestige,
    })
    .from(electionCandidates)
    .innerJoin(playerCharacters, eq(playerCharacters.id, electionCandidates.characterId))
    .where(eq(electionCandidates.electionId, row.id));

  const candidates: ElectionCandidate[] = candRows.map((c) => ({
    characterId: c.characterId,
    side: c.side as OfficeSide,
    party: c.party,
    prestige: c.prestige,
    declaredAt: c.declaredAt.getTime(),
  }));

  const voteRows = await db
    .select({ voterCharacterId: electionVotes.voterCharacterId, candidateCharacterId: electionVotes.candidateCharacterId })
    .from(electionVotes)
    .where(eq(electionVotes.electionId, row.id));
  const votes: BallotVote[] = voteRows.map((v) => ({ voterCharacterId: v.voterCharacterId, candidateCharacterId: v.candidateCharacterId }));

  // NPC blocs at live size; base = blocSize − swing. Swing is folded into sway.
  const npcRows = await db
    .select({ npcParty: oligarchSeats.npcParty })
    .from(oligarchSeats)
    .where(and(eq(oligarchSeats.worldId, worldId), eq(oligarchSeats.holderType, "npc")));
  const blocSizes = new Map<OfficeSide, number>();
  for (const r of npcRows) {
    if (r.npcParty === "palaioi" || r.npcParty === "dynatoi") blocSizes.set(r.npcParty, (blocSizes.get(r.npcParty) ?? 0) + 1);
  }
  const npcResults: ElectionNpcBloc[] = [];
  const swingBySide = new Map<OfficeSide, number>();
  for (const side of SIDES) {
    const size = blocSizes.get(side) ?? 0;
    const bloc = npcBlocVotes(size, chamber.npcSwingFraction, "yes", side);
    swingBySide.set(side, bloc.swingSize);
    npcResults.push({ party: side, base: bloc.blocSize - bloc.swingSize });
  }

  // Favor-sway: each candidate draws from their OWN party's swing pool by favor.
  const swayByCandidate: Record<string, number> = {};
  for (const cand of candidates) {
    if (cand.party !== "palaioi" && cand.party !== "dynatoi") continue;
    const favorRows = await db
      .select({ favor: partyFavor.favor })
      .from(partyFavor)
      .where(and(eq(partyFavor.characterId, cand.characterId), eq(partyFavor.party, cand.party)))
      .limit(1);
    const swayed = swayedVotes(favorRows[0]?.favor ?? 0, chamber.favorPerSwingVote, swingBySide.get(cand.party) ?? 0);
    if (swayed > 0) swayByCandidate[cand.characterId] = swayed;
  }

  const outcome = resolveElection(candidates, votes, npcResults, swayByCandidate);

  for (const side of SIDES) {
    await applyWinner(worldId, row.office as LeagueOffice, side, outcome.winners[side], candidates, cycle.officeYear, cycle.termEndsYear);
  }

  const updated = await db
    .update(elections)
    .set({ phase: "resolved" })
    .where(and(eq(elections.id, row.id), eq(elections.phase, "voting")))
    .returning({ id: elections.id });
  if (!updated.length) return null; // a concurrent sweep already resolved it

  return { office: row.office as LeagueOffice, gameYear: row.gameYear, winners: outcome.winners, totals: outcome.totals };
}

// Install the winner (or vacate) into the offices seat + office_history ledger.
async function applyWinner(
  worldId: string,
  office: LeagueOffice,
  side: OfficeSide,
  winnerId: string | null,
  candidates: ElectionCandidate[],
  officeYear: number,
  termEndsYear: number,
): Promise<void> {
  // Close whoever's term was open on this seat (its previous holder).
  await db
    .update(officeHistory)
    .set({ endedYear: officeYear })
    .where(and(eq(officeHistory.worldId, worldId), eq(officeHistory.office, office), eq(officeHistory.side, side), isNull(officeHistory.endedYear)));

  if (!winnerId) {
    // No candidate stood on this side — vacate the seat (term ended, no successor).
    await db
      .insert(offices)
      .values({ worldId, office, side, seatSlot: 0, holderCharacterId: null, independentHolder: false, acquiredVia: null, termStartedYear: null, termEndsYear: null })
      .onConflictDoUpdate({
        target: [offices.worldId, offices.office, offices.side, offices.seatSlot],
        set: { holderCharacterId: null, independentHolder: false, acquiredVia: null, termStartedYear: null, termEndsYear: null },
      });
    return;
  }

  const winner = candidates.find((c) => c.characterId === winnerId)!;
  const independent = winner.party === "none";
  await db
    .insert(offices)
    .values({ worldId, office, side, seatSlot: 0, holderCharacterId: winnerId, independentHolder: independent, termStartedYear: officeYear, termEndsYear, acquiredVia: "elected" })
    .onConflictDoUpdate({
      target: [offices.worldId, offices.office, offices.side, offices.seatSlot],
      set: { holderCharacterId: winnerId, independentHolder: independent, termStartedYear: officeYear, termEndsYear, acquiredVia: "elected" },
    });
  await db.insert(officeHistory).values({ worldId, characterId: winnerId, office, side, startedYear: officeYear, acquiredVia: "elected" });
}

// --- Candidate + vote DB ops (server validates eligibility first) -----------

export async function declareCandidacy(electionId: string, characterId: string, side: OfficeSide, now: Date = new Date()): Promise<boolean> {
  const inserted = await db
    .insert(electionCandidates)
    .values({ electionId, characterId, side, declaredAt: now })
    .onConflictDoNothing()
    .returning({ id: electionCandidates.id });
  return inserted.length > 0;
}

export async function castElectionVote(electionId: string, voterCharacterId: string, candidateCharacterId: string, now: Date = new Date()): Promise<void> {
  await db
    .insert(electionVotes)
    .values({ electionId, voterCharacterId, candidateCharacterId, castAt: now })
    .onConflictDoUpdate({ target: [electionVotes.electionId, electionVotes.voterCharacterId], set: { candidateCharacterId, castAt: now } });
}

export async function voterChoice(electionId: string, voterCharacterId: string): Promise<string | null> {
  const rows = await db
    .select({ candidateCharacterId: electionVotes.candidateCharacterId })
    .from(electionVotes)
    .where(and(eq(electionVotes.electionId, electionId), eq(electionVotes.voterCharacterId, voterCharacterId)))
    .limit(1);
  return rows[0]?.candidateCharacterId ?? null;
}

export interface BallotCandidateRow {
  characterId: string;
  side: OfficeSide;
  name: string;
  houseName: string;
  party: string;
  prestige: number;
  declaredAt: string;
}

// The ballot view: candidates with identity ONLY — no running tallies (secret).
export async function electionCandidateRows(electionId: string): Promise<BallotCandidateRow[]> {
  const rows = await db
    .select({
      characterId: electionCandidates.characterId,
      side: electionCandidates.side,
      declaredAt: electionCandidates.declaredAt,
      name: players.name,
      houseName: houses.name,
      party: playerCharacters.party,
      prestige: playerCharacters.prestige,
    })
    .from(electionCandidates)
    .innerJoin(playerCharacters, eq(playerCharacters.id, electionCandidates.characterId))
    .innerJoin(players, eq(players.id, playerCharacters.playerId))
    .innerJoin(houses, eq(houses.slug, players.houseSlug))
    .where(eq(electionCandidates.electionId, electionId))
    .orderBy(asc(electionCandidates.declaredAt));
  return rows.map((r) => ({
    characterId: r.characterId,
    side: r.side as OfficeSide,
    name: r.name,
    houseName: r.houseName,
    party: r.party,
    prestige: r.prestige,
    declaredAt: r.declaredAt.toISOString(),
  }));
}

export async function isCandidate(electionId: string, characterId: string): Promise<boolean> {
  const rows = await db
    .select({ id: electionCandidates.id })
    .from(electionCandidates)
    .where(and(eq(electionCandidates.electionId, electionId), eq(electionCandidates.characterId, characterId)))
    .limit(1);
  return rows.length > 0;
}

// --- Office holders + the public ledger -------------------------------------

export type OfficeRow = typeof offices.$inferSelect;

export async function officeRows(worldId: string): Promise<OfficeRow[]> {
  return db.select().from(offices).where(eq(offices.worldId, worldId));
}

export interface OfficeHistoryEntry {
  characterId: string;
  holderName: string;
  houseName: string;
  office: string;
  side: string | null;
  startedYear: number;
  endedYear: number | null;
  acquiredVia: string;
}

export async function officeHistoryRows(worldId: string): Promise<OfficeHistoryEntry[]> {
  const rows = await db
    .select({
      characterId: officeHistory.characterId,
      office: officeHistory.office,
      side: officeHistory.side,
      startedYear: officeHistory.startedYear,
      endedYear: officeHistory.endedYear,
      acquiredVia: officeHistory.acquiredVia,
      holderName: players.name,
      houseName: houses.name,
    })
    .from(officeHistory)
    .innerJoin(playerCharacters, eq(playerCharacters.id, officeHistory.characterId))
    .innerJoin(players, eq(players.id, playerCharacters.playerId))
    .innerJoin(houses, eq(houses.slug, players.houseSlug))
    .where(eq(officeHistory.worldId, worldId))
    .orderBy(asc(officeHistory.startedYear));
  return rows.map((r) => ({
    characterId: r.characterId,
    holderName: r.holderName,
    houseName: r.houseName,
    office: r.office,
    side: r.side,
    startedYear: r.startedYear,
    endedYear: r.endedYear,
    acquiredVia: r.acquiredVia,
  }));
}
