// ---------------------------------------------------------------------------
// The Olympiad (Prompt 8) — the type:"olympic" festival entry, on the existing
// season clock. The nominate→vote→tally→tie-break flow lives in the generic
// ballot module; the Olympic-specific bits (config shape, the compete roll) live
// here. The traits (olympic-delegate / olympionikes) are applied by the service.
// ---------------------------------------------------------------------------

import type { CalendarConfig } from "./festival.js";

// A synthetic festival id for the payoff (Games) delivery — distinct from the
// configured Olympiad id so the two deliveries never collide on the same row.
export const OLYMPIAD_GAMES_FESTIVAL_ID = "olympiad-games";

// The content trait ids (the events file references these too). The delegate
// trait is transient (granted at resolution, removed when the Games are run);
// the victor trait is permanent.
export const OLYMPIC_DELEGATE_TRAIT_ID = "olympic-delegate";
export const OLYMPIONIKES_TRAIT_ID = "olympionikes";

// The normalized type:"olympic" entry (the config keeps these as passthrough).
export interface OlympiadConfig {
  id: string;
  eventId: string; // the nomination event (olympic-nominate)
  season: number; // 1–4 (config); seasonOfYear is this - 1
  cadenceYears: number;
  seats: number;
  excludeClasses: string[];
  nominationRealDays: number;
  votingRealDays: number;
  payoffEventId: string; // the Games event (olympic-games)
  payoffPeriodsLater: number;
}

// The single Olympiad festival entry, normalized — or null if none configured.
export function olympiadConfig(cfg: CalendarConfig): OlympiadConfig | null {
  const entry = cfg.festivals.find((festival) => festival.type === "olympic") as Record<string, unknown> | undefined;
  if (!entry) return null;
  return {
    id: String(entry.id),
    eventId: String(entry.eventId),
    season: Number(entry.season),
    cadenceYears: Number(entry.cadenceYears),
    seats: Number(entry.seats ?? 2),
    excludeClasses: Array.isArray(entry.excludeClasses) ? (entry.excludeClasses as string[]) : [],
    nominationRealDays: Number(entry.nominationRealDays ?? 0),
    votingRealDays: Number(entry.votingRealDays ?? 0),
    payoffEventId: String(entry.payoffEventId ?? ""),
    payoffPeriodsLater: Number(entry.payoffPeriodsLater ?? 0),
  };
}

export function olympiadSeasonOfYear(olympiad: OlympiadConfig): number {
  return olympiad.season - 1;
}

// Whether an Olympiad opens at this point on the clock: its season, qualifying year.
export function olympiadFiringAt(olympiad: OlympiadConfig, seasonOfYear: number, yearInGame: number): boolean {
  return olympiadSeasonOfYear(olympiad) === seasonOfYear && yearInGame % olympiad.cadenceYears === 0;
}

// One real period (season) in ms, from the calendar config.
export function realMsPerPeriod(cfg: CalendarConfig): number {
  return Number(cfg.realMsPerPeriod);
}

// --- The Olympic compete roll (NOT in the ballot module) --------------------

export type CompeteMode = "all_out" | "measured";

export const OLYMPIC_VICTORY_THRESHOLD = 80;
export const OLYMPIC_VICTORY_PRESTIGE = 30;
export const OLYMPIC_HONORABLE_PRESTIGE = 10;

export interface CompeteOutcome {
  won: boolean;
  roll: number;
  prestigeAward: number;
}

// A delegate competes: (militia + prestige) + a mode-scaled swing vs a threshold.
// all_out — higher variance, higher ceiling (swing 0–80): the gamble for the
// olive crown. measured — a safer floor (swing 25–55): a solid showing, lower
// ceiling. rng injectable for tests.
export function competeRoll(militia: number, prestige: number, mode: CompeteMode, rng: () => number = Math.random): CompeteOutcome {
  const base = militia + prestige;
  const swing = mode === "all_out" ? Math.floor(rng() * 81) : 25 + Math.floor(rng() * 31);
  const roll = base + swing;
  const won = roll >= OLYMPIC_VICTORY_THRESHOLD;
  return { won, roll, prestigeAward: won ? OLYMPIC_VICTORY_PRESTIGE : OLYMPIC_HONORABLE_PRESTIGE };
}
