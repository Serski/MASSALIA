import { z } from "zod";
import { REAL_MS_PER_SEASON } from "./calendar.js";

// ---------------------------------------------------------------------------
// The hoplite's home army — RANKS + SALARY (Hoplite Step 1 of 5).
//
// A four-rank promotion ladder, threshold-gated on militia + prestige, that pays
// a daily drachmae salary plus a small daily militia trickle. Promotion is an
// APPLICATION (gate-checked), NOT an election — distinct from the Strategos office.
//
// Salary accrues LAZILY on the SAME clock the rest of the economy runs on: one
// real day = one in-game season (calendar.REAL_MS_PER_SEASON), the unit building
// income accrues on and the base of age.ts's realMsPerGameYear (= 4 × this). No
// new clock. "per day" = per in-game day (= one real day).
//
// TODO (later hoplite steps — DO NOT build here): mercenary contracts + hiring
// board, abroad pools, lethality/injury, death/succession hooks, re-class, and
// veteran Strategos eligibility. Step 1 is home rank + salary only.
// ---------------------------------------------------------------------------

// One in-game day for salary accrual (1 real day = 1 in-game season).
export const MS_PER_GAME_DAY = REAL_MS_PER_SEASON;

export type RankGate = { militia: number; prestige: number };

export type RankDef = {
  id: string;
  name: string;
  rank?: string;
  gate: RankGate;
  salaryPerDay: number;
  militiaPerDay: number;
};

export type RanksContent = { ranks: RankDef[] };

// The full promotion order, lowest to highest. "none" is the pre-enlist state.
export type ArmyRank = "none" | "recruit" | "veteran" | "lochagos" | "archilochagos";
export const RANK_ORDER: ArmyRank[] = ["none", "recruit", "veteran", "lochagos", "archilochagos"];

const rankSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    rank: z.string().optional(),
    gate: z.object({ militia: z.number(), prestige: z.number() }).strict(),
    salaryPerDay: z.number().nonnegative(),
    militiaPerDay: z.number().nonnegative(),
  })
  .strict();

export const ranksContentSchema = z.object({ ranks: z.array(rankSchema) }).strict();

export function parseRanksContent(data: unknown): RanksContent {
  const parsed = ranksContentSchema.parse(data) as RanksContent;
  // The content ids must be exactly the four ladder ranks, in order.
  const ids = parsed.ranks.map((r) => r.id);
  const expected = RANK_ORDER.slice(1);
  if (ids.length !== expected.length || ids.some((id, i) => id !== expected[i])) {
    throw new Error(`ranks.json must define exactly ${expected.join(", ")} in order, got ${ids.join(", ")}`);
  }
  return parsed;
}

export function rankDef(content: RanksContent, rankId: string): RankDef | null {
  return content.ranks.find((r) => r.id === rankId) ?? null;
}

// The rank immediately above `current` (the one a none/recruit/… applies for), or
// null at the top of the ladder.
export function nextRankId(current: string): ArmyRank | null {
  const idx = RANK_ORDER.indexOf(current as ArmyRank);
  if (idx < 0 || idx >= RANK_ORDER.length - 1) return null;
  return RANK_ORDER[idx + 1]!;
}

// Does the player clear a rank's gate? (militia AND prestige thresholds.)
export function meetsGate(gate: RankGate, militia: number, prestige: number): boolean {
  return militia >= gate.militia && prestige >= gate.prestige;
}

// How far short of a gate the player is (0 where already met), for the UI copy.
export function gateShortfall(gate: RankGate, militia: number, prestige: number): RankGate {
  return { militia: Math.max(0, gate.militia - militia), prestige: Math.max(0, gate.prestige - prestige) };
}

// --- Lazy salary + militia accrual ------------------------------------------
// Pay whole drachmae + whole militia for the time the SLOWER reward has fully
// earned, and advance the anchor only by that consumed time — so sub-unit
// remainders carry across reads (the same anchor discipline age decay uses, which
// keeps collect-spam from silently dropping fractional progress). Salary is always
// active (salaryPerDay > 0); the militia trickle is optional (0 at recruit) and
// never gates the salary when it is zero.

export type ServiceAccrual = { drachmae: number; militia: number; consumedMs: number };

export function accrueService(rank: RankDef, anchorMs: number, nowMs: number): ServiceAccrual {
  const none: ServiceAccrual = { drachmae: 0, militia: 0, consumedMs: 0 };
  const elapsedDays = (nowMs - anchorMs) / MS_PER_GAME_DAY;
  if (elapsedDays <= 0) return none;

  const drachmaeDue = Math.floor(rank.salaryPerDay * elapsedDays);
  const militiaDue = Math.floor(rank.militiaPerDay * elapsedDays);
  // In-game days each reward has *fully* earned (a 0-rate reward never gates).
  const salaryDays = rank.salaryPerDay > 0 ? drachmaeDue / rank.salaryPerDay : Infinity;
  const militiaDays = rank.militiaPerDay > 0 ? militiaDue / rank.militiaPerDay : Infinity;
  const consumedDays = Math.min(salaryDays, militiaDays);
  if (!Number.isFinite(consumedDays) || consumedDays <= 0) return none;

  return {
    drachmae: Math.floor(rank.salaryPerDay * consumedDays),
    militia: Math.floor(rank.militiaPerDay * consumedDays),
    consumedMs: consumedDays * MS_PER_GAME_DAY,
  };
}

// ---------------------------------------------------------------------------
// Mercenary contracts — STATE + go/return lifecycle (Hoplite Step 2 of 5).
//
// A contract pauses home rank salary and pays FOREIGN income (dailyDrachmae per
// season, HIGHER than home — the wealth path) for `termSeasons`, then completes
// SAFELY and returns home. Gates rise on the same militia + prestige as ranks.
// Duration is counted in SEASONS on the existing clock (REAL_MS_PER_SEASON; 1 real
// day = 1 season). The 50 abroad cards + pool routing are Step 3 — `poolKey` is the
// pool a contract will swap in then; this step only carries it.
//
// TODO (Step 4 — NOT here): a death/injury roll at completion, age>30 lethality
// scaling, succession / "died gloriously abroad". Step 2 contracts always complete.
// ---------------------------------------------------------------------------

export type ContractDef = {
  id: string;
  name: string;
  gate: RankGate;
  dailyDrachmae: number; // foreign income per season (per real day) — the payout
  termSeasons: number; // full term length in seasons
  minCancelSeasons: number; // seasons that must elapse before early return is allowed
  poolKey: string; // the abroad daily-decision card pool (Step 3)
  completionTraits: string[]; // reputation/class traits awarded on SAFE completion (Step 3)
};

export type ContractsContent = { contracts: ContractDef[] };

const contractSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    gate: z.object({ militia: z.number(), prestige: z.number() }).strict(),
    dailyDrachmae: z.number().positive(),
    termSeasons: z.number().int().positive(),
    minCancelSeasons: z.number().int().nonnegative(),
    poolKey: z.string(),
    completionTraits: z.array(z.string()),
  })
  .strict();

export const contractsContentSchema = z.object({ contracts: z.array(contractSchema) }).strict();

export function parseContractsContent(data: unknown): ContractsContent {
  const parsed = contractsContentSchema.parse(data) as ContractsContent;
  if (parsed.contracts.length === 0) throw new Error("contracts.json must define at least one contract");
  for (const c of parsed.contracts) {
    if (c.minCancelSeasons > c.termSeasons) {
      throw new Error(`contract ${c.id}: minCancelSeasons (${c.minCancelSeasons}) cannot exceed termSeasons (${c.termSeasons})`);
    }
  }
  return parsed;
}

export function contractDef(content: ContractsContent, id: string): ContractDef | null {
  return content.contracts.find((c) => c.id === id) ?? null;
}

// Whole seasons elapsed since the contract's (immutable) start anchor — the
// lifecycle clock that drives completion + the cancel gate.
export function seasonsElapsed(startedMs: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - startedMs) / REAL_MS_PER_SEASON));
}

export type ForeignAccrual = { drachmae: number; consumedMs: number };

// Foreign income accrued between the collection anchor and now, CAPPED at the
// contract's term end (income never accrues past the term). Whole drachmae only,
// advancing the anchor solely by the consumed whole-drachma time so sub-coin
// remainders carry — the same anchor discipline as the home salary.
export function foreignIncomeAccrual(dailyDrachmae: number, anchorMs: number, nowMs: number, termEndMs: number): ForeignAccrual {
  const windowEnd = Math.min(nowMs, termEndMs);
  const elapsedSeasons = (windowEnd - anchorMs) / REAL_MS_PER_SEASON;
  if (elapsedSeasons <= 0 || dailyDrachmae <= 0) return { drachmae: 0, consumedMs: 0 };
  const drachmae = Math.floor(dailyDrachmae * elapsedSeasons);
  const consumedSeasons = drachmae / dailyDrachmae;
  return { drachmae, consumedMs: consumedSeasons * REAL_MS_PER_SEASON };
}
