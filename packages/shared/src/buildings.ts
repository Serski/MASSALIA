import { z } from "zod";
import { SEASON_NAMES } from "./calendar.js";
import type { CharacterStats } from "./character.js";

// ---------------------------------------------------------------------------
// The Ledger / player economy — the universal building engine (Economy Build 1).
//
// Every number flows from ONE curve (constants below), never hand-typed rows:
//   cost(t)      = round(BASE_COST × COST_GROWTH^(t-1))   → 100 / 250 / 600 / 1500
//   yield(base,t)= base × YIELD_GROWTH^(t-1)
//   buildDays(t) = BUILD_DAYS[t-1]                          → 1 / 2 / 4 / 7
//   upkeep(t)    = UPKEEP[t-1]                              → 0 / 1 / 3 / 6  (dr/day)
//
// Accrual is closed-form (rate × elapsed × seasonal), computed lazily on read —
// NO cron. Seasonal coefficients scale BOTH vendor prices and production rates,
// keyed by season and per building/good category (agricultural swings hardest;
// year-round trades barely move). A NEW-PLAYER GUARD runs a building at full
// output for its first few days regardless of season, so winter joiners aren't
// punished. The whole engine is pure: pass the clock + world start in, no Date.now().
// ---------------------------------------------------------------------------

export const BASE_COST = 100;
export const COST_GROWTH = 2.5;
export const YIELD_GROWTH = 1.8;
// Real days (= in-game seasons) to build each tier; index 0 is tier 1.
export const BUILD_DAYS = [1, 2, 4, 7] as const;
// Flat upkeep in drachmae/day per tier; gentle (a tax, not a treadmill).
export const UPKEEP = [0, 1, 3, 6] as const;
export const MAX_TIER = 4;

// One real day per in-game season (mirrors calendar.REAL_MS_PER_SEASON).
const MS_PER_DAY = 86_400_000;
const SECONDS_PER_DAY = 86_400;

// --- The curve --------------------------------------------------------------

export function buildingCost(tier: number): number {
  return Math.round(BASE_COST * COST_GROWTH ** (tier - 1));
}

export function buildingYield(base: number, tier: number): number {
  return base * YIELD_GROWTH ** (tier - 1);
}

export function buildingBuildDays(tier: number): number {
  // ≥1 season floor; clamp out-of-range tiers to the last defined entry.
  return BUILD_DAYS[Math.min(BUILD_DAYS.length, Math.max(1, tier)) - 1] ?? BUILD_DAYS[BUILD_DAYS.length - 1]!;
}

export function buildingUpkeep(tier: number): number {
  return UPKEEP[Math.min(UPKEEP.length, Math.max(1, tier)) - 1] ?? UPKEEP[UPKEEP.length - 1]!;
}

export function buildMs(tier: number): number {
  return buildingBuildDays(tier) * MS_PER_DAY;
}

// --- Seasonal coefficients --------------------------------------------------
// SHALLOW by design (winter ≈ 0.65 for crops, not punishing). Production scales
// the building's output rate; price scales the vendor band. Winter raises stored
// crop/wine prices while lowering output — the speculation squeeze.

export type SeasonName = (typeof SEASON_NAMES)[number]; // "Winter" | "Spring" | "Summer" | "Autumn"
export type BuildingCategory = "agricultural" | "yearround";

export type SeasonalCoeff = { production: number; price: number };

export type BuildingsContent = {
  classBuildings: Record<string, ClassBuildingDef>;
  commonBuildings: CommonBuildingDef[];
  vendor: Record<string, VendorBand>;
  seasonal: SeasonalConfig;
};

export type ClassBuildingTier = { tier: number; name: string; rank?: string };
export type BuildingYieldDef = { good: string; base: number; fromTier?: number };

export type ClassBuildingDef = {
  id: string;
  category: BuildingCategory;
  tiers: ClassBuildingTier[];
  yields: BuildingYieldDef[];
  income?: number; // drachmae/day at tier 1 (scales with yield curve); 0/absent for goods lines
  flavor?: string;
};

export type CommonBuildingDef = {
  id: string;
  name: string;
  icon: string;
  category: BuildingCategory;
  cost: number;
  buildDays: number;
  yields: BuildingYieldDef[];
  income?: number; // drachmae/day (e.g. future trade buildings); 0/absent here
  composurePerDay?: number; // flat, never scales (Household Shrine)
  storageBonus?: number; // capacity contribution (Harbor Warehouse); light enforcement
  blurb: string;
};

export type VendorBand = { sell: number; buy: number };

export type SeasonalConfig = {
  newPlayerGuardDays: number;
  // good -> category, for pricing the vendor band (buildings carry their own
  // `category` field, so only goods need a lookup here).
  goodCategory: Record<string, BuildingCategory>;
  coefficients: Record<BuildingCategory, Record<SeasonName, SeasonalCoeff>>;
};

// --- Content schema (zod) ---------------------------------------------------

const seasonName = z.enum(SEASON_NAMES);
const buildingCategory = z.enum(["agricultural", "yearround"]);
const yieldDefSchema = z.object({ good: z.string(), base: z.number(), fromTier: z.number().int().positive().optional() }).strict();
const seasonalCoeffSchema = z.object({ production: z.number(), price: z.number() }).strict();

const classBuildingSchema = z
  .object({
    id: z.string(),
    category: buildingCategory,
    tiers: z.array(z.object({ tier: z.number().int().positive(), name: z.string(), rank: z.string().optional() }).strict()).length(MAX_TIER),
    yields: z.array(yieldDefSchema),
    income: z.number().optional(),
    flavor: z.string().optional(),
  })
  .strict();

const commonBuildingSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    icon: z.string(),
    category: buildingCategory,
    cost: z.number().int().positive(),
    buildDays: z.number().int().positive(),
    yields: z.array(yieldDefSchema),
    income: z.number().optional(),
    composurePerDay: z.number().optional(),
    storageBonus: z.number().optional(),
    blurb: z.string(),
  })
  .strict();

export const buildingsContentSchema = z
  .object({
    classBuildings: z.record(z.string(), classBuildingSchema),
    commonBuildings: z.array(commonBuildingSchema),
    vendor: z.record(z.string(), z.object({ sell: z.number().positive(), buy: z.number().positive() }).strict()),
    seasonal: z
      .object({
        newPlayerGuardDays: z.number(),
        goodCategory: z.record(z.string(), buildingCategory),
        coefficients: z.record(buildingCategory, z.record(seasonName, seasonalCoeffSchema)),
      })
      .strict(),
  })
  .strict();

export function parseBuildingsContent(data: unknown): BuildingsContent {
  return buildingsContentSchema.parse(data) as BuildingsContent;
}

// --- Season helpers (pure) --------------------------------------------------

// Which season a wall-clock instant falls in (mirrors calendar.gameDate without
// importing it, so this module stays dependency-light).
export function seasonAt(nowMs: number, worldStartedMs: number): SeasonName {
  const seasonIndex = Math.max(0, Math.floor((nowMs - worldStartedMs) / MS_PER_DAY));
  return SEASON_NAMES[seasonIndex % SEASON_NAMES.length]!;
}

export function coeffFor(seasonal: SeasonalConfig, category: BuildingCategory, season: SeasonName): SeasonalCoeff {
  return seasonal.coefficients[category][season];
}

// Is a building still inside its new-player guard window? Measured from the
// instant it became active (completesAt). Inside the window it runs at full
// output (production multiplier 1.0) regardless of season.
export function isGuarded(seasonal: SeasonalConfig, completesAtMs: number, nowMs: number): boolean {
  return nowMs - completesAtMs < seasonal.newPlayerGuardDays * MS_PER_DAY;
}

// Effective production multiplier for a building: 1.0 inside the guard window,
// else the season/category production coefficient.
export function productionMultiplier(
  seasonal: SeasonalConfig,
  category: BuildingCategory,
  season: SeasonName,
  completesAtMs: number,
  nowMs: number,
): number {
  if (isGuarded(seasonal, completesAtMs, nowMs)) return 1;
  return coeffFor(seasonal, category, season).production;
}

// --- Vendor band ------------------------------------------------------------
// The vendor SELLS to the player at the ceiling (`sell`) and BUYS from the player
// at the ~50% floor (`buy`). Seasonal price coefficient scales both, so the
// future player market always has room to live inside the band. Prices are
// rounded to whole drachmae (min 1) — atomic integer cash.

export type VendorAction = "buy" | "sell";

export function vendorUnitPrice(
  band: VendorBand,
  action: VendorAction,
  seasonal: SeasonalConfig,
  goodCategory: BuildingCategory,
  season: SeasonName,
): number {
  const base = action === "buy" ? band.sell : band.buy; // player BUYS at ceiling, SELLS at floor
  const mult = coeffFor(seasonal, goodCategory, season).price;
  return Math.max(1, Math.round(base * mult));
}

export function goodCategoryFor(seasonal: SeasonalConfig, good: string): BuildingCategory {
  return seasonal.goodCategory[good] ?? "agricultural";
}

// --- Per-good production (pure) ---------------------------------------------

// A building's per-good output rate (units/day) at a given tier. Class lines
// scale on the yield curve; a yield with `fromTier` is dormant below that tier.
export function goodPerDay(def: BuildingYieldDef, tier: number): number {
  if (def.fromTier && tier < def.fromTier) return 0;
  // A `fromTier` yield scales from the tier it first appears at (its own base).
  const effectiveTier = def.fromTier ? tier - def.fromTier + 1 : tier;
  return buildingYield(def.base, effectiveTier);
}

export function ratePerSecond(perDay: number): number {
  return perDay / SECONDS_PER_DAY;
}

// Closed-form accrued units for a good between two markers, gated so nothing
// accrues during construction (before completesAt) and scaled by the seasonal
// production multiplier (or 1.0 inside the new-player guard). The whole window
// uses the CURRENT season's coefficient — a deliberate simplification that keeps
// accrual O(1) and cron-free; documented as such.
export function accruedUnits(args: {
  perDay: number;
  lastMs: number;
  completesAtMs: number;
  nowMs: number;
  productionMult: number;
}): number {
  const start = Math.max(args.lastMs, args.completesAtMs);
  const elapsedSeconds = Math.max(0, Math.floor((args.nowMs - start) / 1000));
  return ratePerSecond(args.perDay) * elapsedSeconds * args.productionMult;
}

// Flat upkeep owed (drachmae) for a tier over an elapsed window. No seasonal
// scaling — upkeep is a steady tax. Whole drachmae, floored to whole days so the
// player is never nickel-and-dimed mid-day.
export function upkeepOwed(tier: number, lastMs: number, nowMs: number): number {
  const wholeDays = Math.floor(Math.max(0, nowMs - lastMs) / MS_PER_DAY);
  return buildingUpkeep(tier) * wholeDays;
}

// Whole days elapsed in a window (for flat per-day perks like the shrine).
export function wholeDaysBetween(lastMs: number, nowMs: number): number {
  return Math.floor(Math.max(0, nowMs - lastMs) / MS_PER_DAY);
}

// --- ROI (for tuning + tests) -----------------------------------------------
// Realizable daily income = sum of each good's units/day valued at the vendor
// BUY floor (what the player actually banks selling output), divided by the
// build cost of that tier. The class line is intended to out-return the commons
// at the owner's entry tier; commons sit at ~55–60% of the class line. At the
// top tier the class building's *marginal* ROI dips below the cheap flat commons
// by design — it becomes a prestige/scale sink (the multi-week T1→T4 grind).

export function dailyFloorValue(yields: BuildingYieldDef[], tier: number, vendor: Record<string, VendorBand>): number {
  return yields.reduce((sum, def) => {
    const band = vendor[def.good];
    if (!band) return sum;
    return sum + goodPerDay(def, tier) * band.buy;
  }, 0);
}

export function classBuildingRoi(def: ClassBuildingDef, tier: number, vendor: Record<string, VendorBand>): number {
  return dailyFloorValue(def.yields, tier, vendor) / buildingCost(tier);
}

export function commonBuildingRoi(def: CommonBuildingDef, vendor: Record<string, VendorBand>): number {
  return dailyFloorValue(def.yields, 1, vendor) / def.cost;
}

// --- The class-section SLOT (built for the hard shape, empty for now) -------
// A generic, stateful, time-bound, stat-gated "class actions" list — designed to
// hold the hoplite's future contracts/ranks. EMPTY for the landowner (the land is
// the business) and EMPTY for every other class in this build; the labelled slot
// is rendered with a "coming soon" sub. One label per class.

export type ClassActionEntry = {
  id: string;
  title: string;
  detail: string;
  status: "available" | "active" | "locked" | "complete";
  // Time-bound (ISO strings on the wire).
  startedAt?: string | null;
  expiresAt?: string | null;
  // Stat-/rank-gated.
  requiresStat?: { stat: keyof CharacterStats; min: number };
  requiresRank?: string;
  rewards?: { label: string }[];
  costs?: { label: string }[];
};

export type ClassSection = {
  label: string | null; // null = no class section (landowner / slave)
  comingSoon: boolean;
  flavor?: string;
  entries: ClassActionEntry[];
};

// The label a class's section carries. null classes (landowner, slave) render no
// section. Built for the hardest case (hoplite "Commissions"); the rest are
// empty labelled slots awaiting their own builds.
const CLASS_SECTION_LABELS: Record<string, string | null> = {
  landowner: null,
  slave: null,
  hoplite: "Commissions",
  trader: "Ventures",
  philosopher: "Pupils",
  priest: "Rites",
  hetaira: "Clientele",
  shipbuilder: "Service",
};

export function classSectionLabel(classId: string): string | null {
  return classId in CLASS_SECTION_LABELS ? CLASS_SECTION_LABELS[classId]! : null;
}

// Slaves cannot own player buildings (hard mode begins with nothing).
export function canBuild(classId: string): boolean {
  return classId !== "slave";
}
