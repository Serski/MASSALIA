import { and, eq, inArray } from "drizzle-orm";
import {
  gameDate,
  olympiadConfig,
  olympiadFiringAt,
  realMsPerPeriod,
  tallyBallot,
  OLYMPIAD_GAMES_FESTIVAL_ID,
  OLYMPIC_DELEGATE_TRAIT_ID,
  type BallotCandidate,
  type BallotVote,
  type CalendarConfig,
  type OlympiadConfig,
} from "@massalia/shared";
import { createDb } from "./client.js";
import {
  characterTraits,
  festivalEvents,
  houses,
  olympiads,
  olympicCandidates,
  olympicVotes,
  players,
  playerCharacters,
  worlds,
} from "./schema.js";

const db = createDb();

// ---------------------------------------------------------------------------
// The Olympiad lifecycle (DB level), shared by the server (lazy-on-read) and the
// BullMQ worker (scheduled sweep) — the same pattern as the festival lifecycle.
// The reusable ballot tally lives in @massalia/shared; the Olympic-specific bits
// (the delegate trait grant, delivery via festival_events) live here.
// ---------------------------------------------------------------------------

type OlympiadRow = typeof olympiads.$inferSelect;

async function activeWorld(): Promise<{ id: string; startedMs: number } | null> {
  const rows = await db.select({ id: worlds.id, startedAt: worlds.startedAt }).from(worlds).where(eq(worlds.status, "active")).limit(1);
  return rows[0] ? { id: rows[0].id, startedMs: rows[0].startedAt.getTime() } : null;
}

// The most recent Olympiad row for the active world (for status + announcements).
export async function latestOlympiad(): Promise<OlympiadRow | null> {
  const world = await activeWorld();
  if (!world) return null;
  const rows = await db.select().from(olympiads).where(eq(olympiads.worldId, world.id)).orderBy(olympiads.gameYear).limit(50);
  return rows.length ? rows[rows.length - 1]! : null;
}

export async function getOlympiadByYear(gameYear: number): Promise<OlympiadRow | null> {
  const world = await activeWorld();
  if (!world) return null;
  const rows = await db
    .select()
    .from(olympiads)
    .where(and(eq(olympiads.worldId, world.id), eq(olympiads.gameYear, gameYear)))
    .limit(1);
  return rows[0] ?? null;
}

// Create the Olympiad row when the clock enters the Olympiad summer of a
// qualifying year (idempotent — one row per world+year). Returns the row or null.
export async function ensureOlympiad(cfg: CalendarConfig, now: Date = new Date()): Promise<OlympiadRow | null> {
  const olympiad = olympiadConfig(cfg);
  if (!olympiad) return null;
  const world = await activeWorld();
  if (!world) return null;
  const gd = gameDate(now.getTime(), world.startedMs);
  if (!olympiadFiringAt(olympiad, gd.seasonOfYear, gd.yearInGame)) {
    return getOlympiadByYear(gd.yearInGame);
  }
  const existing = await getOlympiadByYear(gd.yearInGame);
  if (existing) return existing;

  const period = realMsPerPeriod(cfg);
  const inserted = await db
    .insert(olympiads)
    .values({
      worldId: world.id,
      gameYear: gd.yearInGame,
      phase: "nomination",
      nominationEndsAt: new Date(now.getTime() + olympiad.nominationRealDays * period),
    })
    .onConflictDoNothing()
    .returning();
  return inserted[0] ?? (await getOlympiadByYear(gd.yearInGame));
}

// Deliver the nominate event (as a free, festival-style card) to one living,
// non-excluded character — the lazy-on-read net mirroring fireFestivalsForCharacter.
export async function deliverOlympicNominationForCharacterId(characterId: string, cfg: CalendarConfig, now: Date = new Date()): Promise<void> {
  const olympiad = olympiadConfig(cfg);
  if (!olympiad) return;
  const cycle = await ensureOlympiad(cfg, now);
  if (!cycle || cycle.phase !== "nomination") return;

  const rows = await db.select({ status: playerCharacters.status, classId: playerCharacters.classId }).from(playerCharacters).where(eq(playerCharacters.id, characterId)).limit(1);
  const character = rows[0];
  if (!character || character.status !== "alive" || olympiad.excludeClasses.includes(character.classId)) return;

  await db
    .insert(festivalEvents)
    .values({ characterId, festivalId: olympiad.id, eventId: olympiad.eventId, gameYear: cycle.gameYear, resolved: false })
    .onConflictDoNothing();
}

// The global sweep delivery: ensure the cycle, then deliver the nominate event to
// EVERY living, non-excluded character. Returns the number delivered.
export async function deliverOlympicNominationToAll(cfg: CalendarConfig, now: Date = new Date()): Promise<number> {
  const olympiad = olympiadConfig(cfg);
  if (!olympiad) return 0;
  const cycle = await ensureOlympiad(cfg, now);
  if (!cycle || cycle.phase !== "nomination") return 0;

  const living = await db
    .select({ id: playerCharacters.id, classId: playerCharacters.classId })
    .from(playerCharacters)
    .innerJoin(players, eq(players.id, playerCharacters.playerId))
    .where(and(eq(playerCharacters.status, "alive"), eq(players.isActive, true)));

  let delivered = 0;
  for (const row of living) {
    if (olympiad.excludeClasses.includes(row.classId)) continue;
    await db
      .insert(festivalEvents)
      .values({ characterId: row.id, festivalId: olympiad.id, eventId: olympiad.eventId, gameYear: cycle.gameYear, resolved: false })
      .onConflictDoNothing();
    delivered++;
  }
  return delivered;
}

// --- Ballot DB ops ----------------------------------------------------------

// Register the actor as a candidate (the olympic_nominate effect). Only while the
// cycle is in nomination. Idempotent (unique on year+character).
export async function nominateForOlympiad(characterId: string, gameYear: number): Promise<boolean> {
  const world = await activeWorld();
  if (!world) return false;
  const cycle = await getOlympiadByYear(gameYear);
  if (!cycle || cycle.phase !== "nomination") return false;
  await db
    .insert(olympicCandidates)
    .values({ worldId: world.id, olympiadGameYear: gameYear, characterId })
    .onConflictDoNothing();
  return true;
}

export interface BallotEntry {
  characterId: string;
  name: string;
  houseSlug: string;
  houseName: string;
  classId: string;
  prestige: number;
  nominatedAt: string;
}

// The candidates of an Olympiad (name/house/class/prestige) — standings are NOT
// included here; the caller keeps live tallies hidden until close.
export async function getOlympiadBallot(gameYear: number): Promise<BallotEntry[]> {
  const rows = await db
    .select({
      characterId: olympicCandidates.characterId,
      nominatedAt: olympicCandidates.nominatedAt,
      name: players.name,
      houseSlug: players.houseSlug,
      houseName: houses.name,
      classId: playerCharacters.classId,
      prestige: playerCharacters.prestige,
    })
    .from(olympicCandidates)
    .innerJoin(playerCharacters, eq(playerCharacters.id, olympicCandidates.characterId))
    .innerJoin(players, eq(players.id, playerCharacters.playerId))
    .innerJoin(houses, eq(houses.slug, players.houseSlug))
    .where(eq(olympicCandidates.olympiadGameYear, gameYear));

  return rows.map((row) => ({
    characterId: row.characterId,
    name: row.name,
    houseSlug: row.houseSlug ?? "",
    houseName: row.houseName,
    classId: row.classId,
    prestige: row.prestige,
    nominatedAt: row.nominatedAt.toISOString(),
  }));
}

// Cast a vote — ONE per voter per Olympiad, then LOCKED (unlike the changeable
// chamber votes, the Olympiad is one-and-done). Only while voting is open, the
// candidate is real, and the voter is living. A second attempt is REJECTED
// ("already_voted") and never changes or duplicates the existing vote.
export type VoteOutcome = "ok" | "not_voting" | "unknown_candidate" | "voter_dead" | "already_voted";

export async function castOlympiadVote(voterCharacterId: string, candidateCharacterId: string, gameYear: number, now: Date = new Date()): Promise<VoteOutcome> {
  const world = await activeWorld();
  if (!world) return "not_voting";
  const cycle = await getOlympiadByYear(gameYear);
  if (!cycle || cycle.phase !== "voting") return "not_voting";

  const voter = (await db.select({ status: playerCharacters.status }).from(playerCharacters).where(eq(playerCharacters.id, voterCharacterId)).limit(1))[0];
  if (!voter || voter.status !== "alive") return "voter_dead";

  const candidate = (
    await db
      .select({ id: olympicCandidates.id })
      .from(olympicCandidates)
      .where(and(eq(olympicCandidates.olympiadGameYear, gameYear), eq(olympicCandidates.characterId, candidateCharacterId)))
      .limit(1)
  )[0];
  if (!candidate) return "unknown_candidate";

  // Already voted this Olympiad? The vote is final — reject, do NOT update.
  const existing = (
    await db
      .select({ id: olympicVotes.id })
      .from(olympicVotes)
      .where(and(eq(olympicVotes.olympiadGameYear, gameYear), eq(olympicVotes.voterCharacterId, voterCharacterId)))
      .limit(1)
  )[0];
  if (existing) return "already_voted";

  // First and only vote. onConflictDoNothing guards the unique key against a race
  // (two simultaneous casts) — the loser changes nothing, matching the lock.
  await db
    .insert(olympicVotes)
    .values({ worldId: world.id, olympiadGameYear: gameYear, voterCharacterId, candidateCharacterId, castAt: now })
    .onConflictDoNothing({ target: [olympicVotes.olympiadGameYear, olympicVotes.voterCharacterId] });
  return "ok";
}

export async function getVoterChoice(voterCharacterId: string, gameYear: number): Promise<string | null> {
  const rows = await db
    .select({ candidateCharacterId: olympicVotes.candidateCharacterId })
    .from(olympicVotes)
    .where(and(eq(olympicVotes.olympiadGameYear, gameYear), eq(olympicVotes.voterCharacterId, voterCharacterId)))
    .limit(1);
  return rows[0]?.candidateCharacterId ?? null;
}

// The current delegates of an Olympiad: this year's candidates who hold the
// delegate trait (scoped so a stale grant elsewhere never leaks in).
export async function olympiadDelegates(gameYear: number): Promise<{ characterId: string; status: string }[]> {
  const candidates = await db
    .select({ characterId: olympicCandidates.characterId, status: playerCharacters.status })
    .from(olympicCandidates)
    .innerJoin(playerCharacters, eq(playerCharacters.id, olympicCandidates.characterId))
    .where(eq(olympicCandidates.olympiadGameYear, gameYear));
  if (candidates.length === 0) return [];

  const delegateRows = await db
    .select({ characterId: characterTraits.characterId })
    .from(characterTraits)
    .where(and(eq(characterTraits.traitId, OLYMPIC_DELEGATE_TRAIT_ID), inArray(characterTraits.characterId, candidates.map((c) => c.characterId))));
  const delegateIds = new Set(delegateRows.map((r) => r.characterId));
  return candidates.filter((c) => delegateIds.has(c.characterId));
}

// --- Phase advance (the worker sweep + lazy net) ----------------------------

export interface OlympiadAdvance {
  gameYear: number;
  transitions: string[]; // e.g. ["nomination→voting", "voting→resolved"]
  delegatesChosen: string[]; // characterIds granted the delegate trait at resolution
  gamesDelivered: string[]; // living delegates handed the Games event
  deadSkipped: string[]; // delegates who died before the Games
}

// Advance every non-completed Olympiad through its phases against the real clock.
// Idempotent: each transition is guarded on the current phase. Returns a summary
// per cycle so the caller can raise SSE notices.
export async function advanceOlympiads(cfg: CalendarConfig, now: Date = new Date()): Promise<OlympiadAdvance[]> {
  const olympiad = olympiadConfig(cfg);
  const world = await activeWorld();
  if (!olympiad || !world) return [];
  const period = realMsPerPeriod(cfg);

  const cycles = await db
    .select()
    .from(olympiads)
    .where(and(eq(olympiads.worldId, world.id)));

  const summaries: OlympiadAdvance[] = [];
  for (const cycle of cycles) {
    if (cycle.phase === "completed") continue;
    const summary: OlympiadAdvance = { gameYear: cycle.gameYear, transitions: [], delegatesChosen: [], gamesDelivered: [], deadSkipped: [] };

    // nomination → voting
    if (cycle.phase === "nomination" && cycle.nominationEndsAt && now.getTime() >= cycle.nominationEndsAt.getTime()) {
      await db.update(olympiads).set({ phase: "voting", votingEndsAt: new Date(now.getTime() + olympiad.votingRealDays * period) }).where(and(eq(olympiads.id, cycle.id), eq(olympiads.phase, "nomination")));
      // The nominate window has shut — stop surfacing the (unresolved) card.
      await db
        .update(festivalEvents)
        .set({ resolved: true, resolvedChoiceId: "expired" })
        .where(and(eq(festivalEvents.festivalId, olympiad.id), eq(festivalEvents.gameYear, cycle.gameYear), eq(festivalEvents.resolved, false)));
      cycle.phase = "voting";
      cycle.votingEndsAt = new Date(now.getTime() + olympiad.votingRealDays * period);
      summary.transitions.push("nomination→voting");
    }

    // voting → resolved (tally, crown delegates)
    if (cycle.phase === "voting" && cycle.votingEndsAt && now.getTime() >= cycle.votingEndsAt.getTime()) {
      const winners = await resolveBallot(cycle.gameYear, olympiad);
      await db.update(olympiads).set({ phase: "resolved", payoffAt: new Date(now.getTime() + olympiad.payoffPeriodsLater * period) }).where(and(eq(olympiads.id, cycle.id), eq(olympiads.phase, "voting")));
      cycle.phase = "resolved";
      cycle.payoffAt = new Date(now.getTime() + olympiad.payoffPeriodsLater * period);
      summary.transitions.push("voting→resolved");
      summary.delegatesChosen = winners;
    }

    // resolved → completed (deliver the Games to living delegates)
    if (cycle.phase === "resolved" && cycle.payoffAt && now.getTime() >= cycle.payoffAt.getTime()) {
      const { delivered, deadSkipped } = await deliverGames(cycle.gameYear, olympiad);
      await db.update(olympiads).set({ phase: "completed" }).where(and(eq(olympiads.id, cycle.id), eq(olympiads.phase, "resolved")));
      summary.transitions.push("resolved→completed");
      summary.gamesDelivered = delivered;
      summary.deadSkipped = deadSkipped;
    }

    if (summary.transitions.length) summaries.push(summary);
  }
  return summaries;
}

// Tally + crown: grant the delegate trait to the top `seats` (tie-breaks in the
// shared module). Returns the winners' character ids.
async function resolveBallot(gameYear: number, olympiad: OlympiadConfig): Promise<string[]> {
  const candidateRows = await db
    .select({ characterId: olympicCandidates.characterId, prestige: playerCharacters.prestige, nominatedAt: olympicCandidates.nominatedAt })
    .from(olympicCandidates)
    .innerJoin(playerCharacters, eq(playerCharacters.id, olympicCandidates.characterId))
    .where(eq(olympicCandidates.olympiadGameYear, gameYear));
  const voteRows = await db
    .select({ voterCharacterId: olympicVotes.voterCharacterId, candidateCharacterId: olympicVotes.candidateCharacterId })
    .from(olympicVotes)
    .where(eq(olympicVotes.olympiadGameYear, gameYear));

  const candidates: BallotCandidate[] = candidateRows.map((row) => ({ characterId: row.characterId, prestige: row.prestige, nominatedAt: row.nominatedAt.getTime() }));
  const votes: BallotVote[] = voteRows.map((row) => ({ voterCharacterId: row.voterCharacterId, candidateCharacterId: row.candidateCharacterId }));
  const { winners } = tallyBallot(candidates, votes, olympiad.seats);

  for (const winner of winners) {
    await db.insert(characterTraits).values({ characterId: winner, traitId: OLYMPIC_DELEGATE_TRAIT_ID }).onConflictDoNothing();
  }
  return winners;
}

// Deliver the Games to LIVING delegates; a delegate who died before the Games is
// skipped (death is real now) and the lingering delegate trait is cleared.
async function deliverGames(gameYear: number, olympiad: OlympiadConfig): Promise<{ delivered: string[]; deadSkipped: string[] }> {
  const delegates = await olympiadDelegates(gameYear);
  const delivered: string[] = [];
  const deadSkipped: string[] = [];
  for (const delegate of delegates) {
    if (delegate.status !== "alive") {
      deadSkipped.push(delegate.characterId);
      await db.delete(characterTraits).where(and(eq(characterTraits.characterId, delegate.characterId), eq(characterTraits.traitId, OLYMPIC_DELEGATE_TRAIT_ID)));
      continue;
    }
    await db
      .insert(festivalEvents)
      .values({ characterId: delegate.characterId, festivalId: OLYMPIAD_GAMES_FESTIVAL_ID, eventId: olympiad.payoffEventId, gameYear, resolved: false })
      .onConflictDoNothing();
    delivered.push(delegate.characterId);
  }
  return { delivered, deadSkipped };
}
