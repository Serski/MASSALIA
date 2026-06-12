import { z } from "zod";
import { SEASONS_PER_YEAR } from "./calendar.js";
import type { CalendarConfig } from "./festival.js";
import type { BallotVote } from "./ballot.js";
import type { OfficeSide } from "./oligarchy.js";

// ---------------------------------------------------------------------------
// Archon & Ephor elections (Politics Prompt 2) — the SECOND consumer of the
// reusable ballot module after the Olympiad. The constitution: 2 Archons + 2
// Ephors, each with one Palaioi-side and one Dynatoi-side seat (independents may
// stand on either side). Every office requires an oligarch seat (Prompt 1).
//
// CADENCE on the season clock: declarations open in Spring of an election year,
// the vote is in Winter (3 seasons later), winners take office the following
// Spring. All tuning lives in content/calendar/calendar-config.json (election
// block). Everything here is pure and unit-tested; the NPC-bloc + favor-sway
// math is shared with the chamber vote (oligarchy.ts).
// ---------------------------------------------------------------------------

export type LeagueOffice = "archon" | "ephor";
export type OfficeName = "archon" | "ephor" | "strategos" | "party_archon" | "party_ephor";
export type ElectionPhase = "declaration" | "voting" | "resolved";
export type AcquiredVia = "elected" | "ascended" | "appointed" | "interim";

export const ELECTION_SIDES: OfficeSide[] = ["palaioi", "dynatoi"];

// --- Config (the calendar-config.json election block) -----------------------

export interface ElectionConfig {
  termPeriods: number; // 24 periods = 6 game years (1 period = 1 season = 1 real day)
  cadenceYears: number; // an election year every N game years
  declareSeasonOffset: number; // seasons from the due-year's Winter to declaration (1 = Spring)
  voteSeasonOffset: number; // seasons from the due-year's Winter to the vote (4 = next Winter)
  officeSeasonOffset: number; // seasons from the due-year's Winter to taking office (5 = next Spring)
  maxTermsPerCharacter: number; // elected terms per character per office
}

export const electionConfigSchema = z
  .object({
    termPeriods: z.number().int().positive(),
    cadenceYears: z.number().int().positive(),
    declareSeasonOffset: z.number().int().nonnegative(),
    voteSeasonOffset: z.number().int().positive(),
    officeSeasonOffset: z.number().int().positive(),
    maxTermsPerCharacter: z.number().int().positive(),
  })
  .passthrough(); // campaignRealDays/votingRealDays/seats ride along (legacy)

export function electionConfig(cfg: CalendarConfig): ElectionConfig {
  return electionConfigSchema.parse((cfg as { election?: unknown }).election);
}

// --- The election calendar (pure, season-clock driven) ----------------------

export interface ElectionCycle {
  dueYear: number; // the game year the cycle's declaration opens
  declareSeasonIndex: number; // absolute season index when declaration opens (Spring)
  voteSeasonIndex: number; // when voting opens (Winter) — declaration closes here
  officeSeasonIndex: number; // when winners take office (following Spring) — voting closes here
  officeYear: number; // the game year winners take office
  termEndsYear: number; // the game year their term ends
}

// An election year is every cadenceYears, skipping year 0 (no one holds a seat
// at the opening Winter, so the first cycle is one cadence in).
export function isElectionYear(gameYear: number, cfg: ElectionConfig): boolean {
  return gameYear > 0 && gameYear % cfg.cadenceYears === 0;
}

export function electionCycleFor(dueYear: number, cfg: ElectionConfig): ElectionCycle {
  const base = dueYear * SEASONS_PER_YEAR;
  const officeSeasonIndex = base + cfg.officeSeasonOffset;
  const officeYear = Math.floor(officeSeasonIndex / SEASONS_PER_YEAR);
  return {
    dueYear,
    declareSeasonIndex: base + cfg.declareSeasonOffset,
    voteSeasonIndex: base + cfg.voteSeasonOffset,
    officeSeasonIndex,
    officeYear,
    termEndsYear: officeYear + Math.floor(cfg.termPeriods / SEASONS_PER_YEAR),
  };
}

// electionCalendar(gameYear, cfg): the declare/vote/office season indices for the
// election cycle keyed to a given year, plus whether that year is an election year.
export function electionCalendar(gameYear: number, cfg: ElectionConfig): { isDue: boolean; cycle: ElectionCycle } {
  return { isDue: isElectionYear(gameYear, cfg), cycle: electionCycleFor(gameYear, cfg) };
}

// The election cycle LIVE at a point on the season clock (declaration or voting),
// or null. CRITICAL for the sweep's no-backlog rule: this only reports a cycle
// whose live window [declare, office) actually contains `now`. A cycle whose
// window is already past is never reported, so the worker cannot retro-fire it.
export function currentElectionCycle(seasonIndex: number, cfg: ElectionConfig): { cycle: ElectionCycle; phase: "declaration" | "voting" } | null {
  const here = Math.floor(seasonIndex / SEASONS_PER_YEAR);
  for (const dueYear of [here - 1, here]) {
    if (!isElectionYear(dueYear, cfg)) continue;
    const cycle = electionCycleFor(dueYear, cfg);
    if (seasonIndex < cycle.declareSeasonIndex || seasonIndex >= cycle.officeSeasonIndex) continue;
    return { cycle, phase: seasonIndex < cycle.voteSeasonIndex ? "declaration" : "voting" };
  }
  return null;
}

// --- Candidacy eligibility (canDeclare) -------------------------------------

export interface DeclareInput {
  status: string; // must be "alive"
  isSeatHolder: boolean; // holds an oligarch seat (Prompt 1)
  isRegent: boolean; // regents are barred from elected office (reuse regentMayHoldOffice)
  party: string; // 'none' | 'palaioi' | 'dynatoi'
  side: OfficeSide; // the side they wish to stand on
  barredFromLeagueOffice: boolean; // party Archon/Ephor hook (Prompt 3) — false for now
  electedTermsInOffice: number; // prior acquired_via='elected' terms in THIS office (this character)
}

export type DeclareCheck = { ok: true } | { ok: false; reason: string };

export function canDeclare(input: DeclareInput, cfg: ElectionConfig): DeclareCheck {
  if (input.status !== "alive") return { ok: false, reason: "The dead cannot stand for office." };
  if (!input.isSeatHolder) return { ok: false, reason: "Only a seat-holder of the Three Hundred may stand." };
  if (input.isRegent) return { ok: false, reason: "A regent may not hold elected office while holding a seat in trust." };
  if (input.barredFromLeagueOffice) return { ok: false, reason: "A party leader may not stand for league office." };
  if (input.party !== "none" && input.party !== input.side) {
    return { ok: false, reason: "You may only stand on your own party's side." };
  }
  if (input.electedTermsInOffice >= cfg.maxTermsPerCharacter) {
    return { ok: false, reason: `You have already served the maximum ${cfg.maxTermsPerCharacter} terms in this office.` };
  }
  return { ok: true };
}

// --- Resolution (per-side plurality with NPC blocs + favor-sway) ------------

// A standing candidate as the tally sees it.
export interface ElectionCandidate {
  characterId: string;
  side: OfficeSide;
  party: string; // 'none' | 'palaioi' | 'dynatoi'
  prestige: number;
  declaredAt: number; // epoch ms — earliest-declaration tie-break
}

// The NON-swing (base) NPC votes of a party. The swing portion is folded into
// `swayByCandidate` by the caller (favor-sway, exactly as chamber votes).
export interface ElectionNpcBloc {
  party: OfficeSide;
  base: number;
}

export interface CandidateTotal {
  characterId: string;
  side: OfficeSide;
  total: number;
}

export interface ElectionOutcome {
  // The plurality winner per side (null when no candidate stood on that side).
  winners: Record<OfficeSide, string | null>;
  // Per-candidate totals (for a TOTALS-ONLY public result — never per-voter).
  totals: CandidateTotal[];
}

// Rank by votes desc → prestige desc → earliest declaration. Mirrors tallyBallot.
function byStanding(totals: Map<string, number>, a: ElectionCandidate, b: ElectionCandidate): number {
  return (totals.get(b.characterId) ?? 0) - (totals.get(a.characterId) ?? 0) || b.prestige - a.prestige || a.declaredAt - b.declaredAt;
}

// Resolve a single office's election: player ballots + favor-swayed NPC swing
// votes per candidate + each party's NPC base bloc rallying behind its strongest
// same-side candidate, then the per-side plurality winner. Player votes decide
// WHICH same-side candidate leads — so cross-party kingmaking works (Dynatoi
// voters can crown a Palaioi candidate for the Palaioi seat).
export function resolveElection(
  candidates: ElectionCandidate[],
  votes: BallotVote[],
  npcResults: ElectionNpcBloc[],
  swayByCandidate: Record<string, number>,
): ElectionOutcome {
  const totals = new Map<string, number>();
  for (const candidate of candidates) totals.set(candidate.characterId, 0);

  // Living players' ballots (one each); only votes for known candidates count.
  for (const vote of votes) {
    const current = totals.get(vote.candidateCharacterId);
    if (current !== undefined) totals.set(vote.candidateCharacterId, current + 1);
  }

  // Favor-swayed NPC swing votes toward specific candidates.
  for (const candidate of candidates) {
    const swayed = swayByCandidate[candidate.characterId];
    if (swayed && swayed > 0) totals.set(candidate.characterId, (totals.get(candidate.characterId) ?? 0) + swayed);
  }

  // Each party's NPC base bloc rallies behind its strongest same-side candidate
  // (its own party members first, then any candidate standing on its side).
  for (const bloc of npcResults) {
    if (bloc.base <= 0) continue;
    const sameSide = candidates.filter((candidate) => candidate.side === bloc.party);
    if (sameSide.length === 0) continue;
    const partyMembers = sameSide.filter((candidate) => candidate.party === bloc.party);
    const pool = partyMembers.length > 0 ? partyMembers : sameSide;
    const frontrunner = [...pool].sort((a, b) => byStanding(totals, a, b))[0]!;
    totals.set(frontrunner.characterId, (totals.get(frontrunner.characterId) ?? 0) + bloc.base);
  }

  const winners: Record<OfficeSide, string | null> = { palaioi: null, dynatoi: null };
  for (const side of ELECTION_SIDES) {
    const sideCandidates = candidates.filter((candidate) => candidate.side === side).sort((a, b) => byStanding(totals, a, b));
    winners[side] = sideCandidates[0]?.characterId ?? null;
  }

  return {
    winners,
    totals: candidates.map((candidate) => ({ characterId: candidate.characterId, side: candidate.side, total: totals.get(candidate.characterId) ?? 0 })),
  };
}

// Defection forfeit (stateless, so the lazy reconcile + worker sweep + the
// party hooks all agree). `independentHolder` is true when the holder took the
// seat as an independent (party 'none' at the time).
//   • A PARTY-member holder forfeits side S the moment their party != S — this
//     fires whether they left to 'none' (voluntary or censure-kick) or flipped
//     to the opposing party.
//   • An INDEPENDENT holder keeps the seat as 'none', and only forfeits if they
//     formally join the OPPOSING party (party != 'none' && party != S).
export function holderForfeitsOffice(party: string, side: OfficeSide, independentHolder: boolean): boolean {
  if (independentHolder) return party !== "none" && party !== side;
  return party !== side;
}
