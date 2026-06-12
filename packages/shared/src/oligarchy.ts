import { z } from "zod";
import { REAL_MS_PER_SEASON } from "./calendar.js";

// ---------------------------------------------------------------------------
// The Oligarchy Chamber (Politics Prompt 1). 300 seats: NPC blocs (Palaioi /
// Dynatoi / independents) plus player-bought dynastic seats. Once a game year
// the chamber votes a civic question: player ballots + the NPC base blocs, with
// a swayable fringe of each bloc that party favor can pull. All tuning lives in
// content/politics/politics-config.json (Zod-validated at boot); everything in
// this module is pure. Archon/Ephor elections and real agenda items are later
// prompts — the questions here are flavor-only.
// ---------------------------------------------------------------------------

export type ChamberChoice = "yes" | "no";
export type NpcParty = "palaioi" | "dynatoi" | "independent";

const chamberChoiceSchema = z.enum(["yes", "no"]);

export const chamberQuestionSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  // Which side each party's NPC base leans on this question.
  leans: z.object({
    palaioi: chamberChoiceSchema,
    dynatoi: chamberChoiceSchema,
    independent: chamberChoiceSchema,
  }),
});

export type ChamberQuestion = z.infer<typeof chamberQuestionSchema>;

export const politicsConfigSchema = z
  .object({
    chamber: z
      .object({
        capacity: z.number().int().positive(),
        seatPrice: z.number().int().positive(),
        npcSeats: z.object({
          palaioi: z.number().int().nonnegative(),
          dynatoi: z.number().int().nonnegative(),
          independent: z.number().int().nonnegative(),
        }),
        // The share of each NPC bloc that is swayable on a vote.
        npcSwingFraction: z.number().min(0).max(1),
        // Each N party favor a voting player holds sways one of their own
        // party's swing NPCs toward the side the player voted.
        favorPerSwingVote: z.number().int().positive(),
        chamberVoteCadenceGameYears: z.number().int().positive(),
        questions: z.array(chamberQuestionSchema).min(1),
      })
      .refine(
        (chamber) => chamber.npcSeats.palaioi + chamber.npcSeats.dynatoi + chamber.npcSeats.independent <= chamber.capacity,
        { message: "npcSeats must not exceed the chamber capacity" },
      ),
  })
  .passthrough(); // later politics packs (agenda, elections) ride along

export type PoliticsConfig = z.infer<typeof politicsConfigSchema>;
export type ChamberConfig = PoliticsConfig["chamber"];

export function parsePoliticsConfig(data: unknown): PoliticsConfig {
  return politicsConfigSchema.parse(data);
}

// --- NPC bloc + favor-sway math (pure) ---------------------------------------

export interface NpcBlocResult {
  party: NpcParty;
  blocSize: number;
  lean: ChamberChoice;
  // floor(blocSize × swingFraction) members are swayable; the rest are the base.
  swingSize: number;
  // The unswayed outcome: the whole bloc votes its lean.
  yes: number;
  no: number;
}

// An NPC bloc votes its base lean, with floor(blocSize × swingFraction)
// swayable members (the cap tallyChamber enforces on favor-sway).
export function npcBlocVotes(blocSize: number, swingFraction: number, baseLean: ChamberChoice, party: NpcParty = "independent"): NpcBlocResult {
  const size = Math.max(0, Math.floor(blocSize));
  const swingSize = Math.floor(size * swingFraction);
  return {
    party,
    blocSize: size,
    lean: baseLean,
    swingSize,
    yes: baseLean === "yes" ? size : 0,
    no: baseLean === "no" ? size : 0,
  };
}

// Favor converts to swung NPC votes for the side the player voted: one swing
// member per favorPerSwingVote favor, never more than maxSwing (the bloc's
// swing size). Negative favor sways nobody.
export function swayedVotes(playerFavor: number, favorPerSwingVote: number, maxSwing: number): number {
  if (playerFavor <= 0 || favorPerSwingVote <= 0) return 0;
  return Math.min(Math.floor(playerFavor / favorPerSwingVote), Math.max(0, maxSwing));
}

export interface SwayTotals {
  yes: number;
  no: number;
}

export interface ChamberTally {
  yes: number;
  no: number;
  passed: boolean;
}

// The full tally: player ballots count one each; each NPC bloc votes its lean,
// except that net favor-sway AGAINST the lean flips swing members (capped at
// the bloc's swing size). Sway toward the lean anchors the swing — it cancels
// opposing sway, it never adds votes beyond the bloc.
export function tallyChamber(
  npcResults: NpcBlocResult[],
  playerBallots: ChamberChoice[],
  swayedTotals: Partial<Record<NpcParty, SwayTotals>>,
): ChamberTally {
  let yes = playerBallots.filter((choice) => choice === "yes").length;
  let no = playerBallots.length - yes;

  for (const bloc of npcResults) {
    const sway = swayedTotals[bloc.party] ?? { yes: 0, no: 0 };
    const opposite: ChamberChoice = bloc.lean === "yes" ? "no" : "yes";
    const flipped = Math.max(0, Math.min(bloc.swingSize, sway[opposite] - sway[bloc.lean]));
    if (bloc.lean === "yes") {
      yes += bloc.blocSize - flipped;
      no += flipped;
    } else {
      no += bloc.blocSize - flipped;
      yes += flipped;
    }
  }

  return { yes, no, passed: yes > no };
}

// --- The yearly vote on the season clock (pure) -------------------------------

// The rotating question pool: one question per chamber vote, by game year.
export function questionForYear(chamber: ChamberConfig, gameYear: number): ChamberQuestion {
  const pool = chamber.questions;
  return pool[Math.floor(gameYear / chamber.chamberVoteCadenceGameYears) % pool.length]!;
}

// Whether the yearly chamber vote is due to open this game year.
export function chamberVoteDueAt(chamber: ChamberConfig, yearInGame: number): boolean {
  return yearInGame % chamber.chamberVoteCadenceGameYears === 0;
}

// The wall-clock instant the current season ends (the vote's auto-close).
export function nextSeasonBoundaryMs(nowMs: number, startedMs: number): number {
  const seasonIndex = Math.max(0, Math.floor((nowMs - startedMs) / REAL_MS_PER_SEASON));
  return startedMs + (seasonIndex + 1) * REAL_MS_PER_SEASON;
}

// The NPC parties, in seat_index order (palaioi 0.., dynatoi .., independent ..).
export const NPC_PARTIES: NpcParty[] = ["palaioi", "dynatoi", "independent"];
