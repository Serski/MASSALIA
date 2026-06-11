// ---------------------------------------------------------------------------
// A generic, reusable election ballot: nominate → vote → tally → tie-break.
// Parameterized by eligibility predicates + seats + windows. The Olympiad is the
// first consumer; the Archon/Ephor elections will be the second. NO domain
// specifics (Olympic traits, the compete roll) live here — keep them outside.
// ---------------------------------------------------------------------------

// The minimal view of a person the ballot reasons about.
export interface BallotActor {
  characterId: string;
  classId: string;
  status: string; // "alive" | "deceased" | …
}

// A standing candidate: prestige + nomination instant feed the tie-break.
export interface BallotCandidate {
  characterId: string;
  prestige: number;
  nominatedAt: number; // epoch ms — earliest-nomination tie-break
}

export interface BallotVote {
  voterCharacterId: string;
  candidateCharacterId: string;
}

// An election is fully described by its id, seat count, and the two eligibility
// predicates. The consumer supplies the predicates (e.g. Olympic excludeClasses).
export interface ElectionRules {
  electionId: string;
  seats: number;
  eligibleToStand: (actor: BallotActor) => boolean;
  eligibleToVote: (actor: BallotActor) => boolean;
}

export function canStand(rules: ElectionRules, actor: BallotActor): boolean {
  return rules.eligibleToStand(actor);
}

export function canVote(rules: ElectionRules, actor: BallotActor): boolean {
  return rules.eligibleToVote(actor);
}

// A common shape: only the living may stand unless their class is excluded; any
// living citizen may vote. (The Olympiad uses exactly this; elections can too.)
export function excludeClassRules(electionId: string, seats: number, excludeClasses: string[]): ElectionRules {
  const excluded = new Set(excludeClasses);
  return {
    electionId,
    seats,
    eligibleToStand: (actor) => actor.status === "alive" && !excluded.has(actor.classId),
    eligibleToVote: (actor) => actor.status === "alive",
  };
}

// --- Phase from the real-time windows ---------------------------------------

export type BallotPhase = "nomination" | "voting" | "closed";

export function ballotPhaseAt(now: number, windows: { nominationEndsAt: number; votingEndsAt: number }): BallotPhase {
  if (now < windows.nominationEndsAt) return "nomination";
  if (now < windows.votingEndsAt) return "voting";
  return "closed";
}

// --- Tally + tie-break ------------------------------------------------------

export interface BallotStanding {
  characterId: string;
  votes: number;
  prestige: number;
  nominatedAt: number;
}

export interface BallotResult {
  winners: string[];
  // Full ranked standings (caller may keep these HIDDEN until close).
  standings: BallotStanding[];
}

// Tally votes and take up to `seats` winners. Only votes for known candidates
// count; a voter's lone vote counts once. Ranking: votes desc, then prestige
// desc, then earliest nomination (nominatedAt asc). Fewer candidates than seats
// → every candidate wins (0, 1, or 2…).
export function tallyBallot(candidates: BallotCandidate[], votes: BallotVote[], seats: number): BallotResult {
  const counts = new Map<string, number>();
  for (const candidate of candidates) counts.set(candidate.characterId, 0);
  for (const vote of votes) {
    const current = counts.get(vote.candidateCharacterId);
    if (current !== undefined) counts.set(vote.candidateCharacterId, current + 1);
  }

  const standings: BallotStanding[] = candidates.map((candidate) => ({
    characterId: candidate.characterId,
    votes: counts.get(candidate.characterId) ?? 0,
    prestige: candidate.prestige,
    nominatedAt: candidate.nominatedAt,
  }));
  // votes desc → prestige desc → earliest nomination.
  standings.sort((a, b) => b.votes - a.votes || b.prestige - a.prestige || a.nominatedAt - b.nominatedAt);

  const winners = standings.slice(0, Math.max(0, seats)).map((standing) => standing.characterId);
  return { winners, standings };
}
