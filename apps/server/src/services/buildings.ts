import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { createDb, playerBuildings, playerCharacters, resources, worldTreasury, worlds } from "@massalia/db";
import {
  accruedUnits,
  buildingCost,
  buildingBuildDays,
  buildingUpkeep,
  buildingYield,
  buildMs,
  canBuild,
  classSectionLabel,
  coeffFor,
  goodCategoryFor,
  goodPerDay,
  isGuarded,
  MAX_TIER,
  parseBuildingsContent,
  productionMultiplier,
  ratePerSecond,
  seasonAt,
  vendorUnitPrice,
  wholeDaysBetween,
  type BuildingCategory,
  type BuildingsContent,
  type BuildingYieldDef,
  type ClassSection,
  type SeasonName,
  type VendorAction,
} from "@massalia/shared";
import { applyComposureDelta } from "./composure.js";

const db = createDb();
type DbTx = Parameters<Parameters<ReturnType<typeof createDb>["transaction"]>[0]>[0];
type Exec = DbTx | typeof db;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const buildingsFile = path.join(repoRoot, "content/buildings/buildings.json");

const MS_PER_DAY = 86_400_000;

let content: BuildingsContent | null = null;

// Validate the building catalog at boot (fail fast on a malformed file); memoized.
export async function loadBuildingsContent(): Promise<BuildingsContent> {
  content = parseBuildingsContent(JSON.parse(await fs.readFile(buildingsFile, "utf8")));
  return content;
}

export function getBuildingsContent(): BuildingsContent {
  if (!content) throw new Error("Building content not loaded. Call loadBuildingsContent() at boot.");
  return content;
}

// --- Normalized definition resolution --------------------------------------
// One accessor over the two content shapes (class line vs single-tier common),
// so the engine never branches on building kind during accrual.

type ResolvedDef = {
  id: string;
  isClass: boolean;
  category: BuildingCategory;
  maxTier: number;
  yields: BuildingYieldDef[];
  income: number; // drachmae/day at tier 1 (0 for goods/utility lines)
  composurePerDay: number;
  storageBonus: number;
  cost(tier: number): number;
  buildDays(tier: number): number;
  upkeep(tier: number): number;
};

// Resolve a building id (class or common) into the unified runtime shape. Class
// lines flow from the cost/build/upkeep curve; commons carry fixed cost/days and
// never upkeep (they are single-tier → upkeep(1) = 0).
export function resolveDef(buildingId: string): ResolvedDef | null {
  const c = getBuildingsContent();
  const cls = Object.values(c.classBuildings).find((b) => b.id === buildingId);
  if (cls) {
    return {
      id: cls.id,
      isClass: true,
      category: cls.category,
      maxTier: MAX_TIER,
      yields: cls.yields,
      income: cls.income ?? 0,
      composurePerDay: 0,
      storageBonus: 0,
      cost: (tier) => buildingCost(tier),
      buildDays: (tier) => buildingBuildDays(tier),
      upkeep: (tier) => buildingUpkeep(tier),
    };
  }
  const common = c.commonBuildings.find((b) => b.id === buildingId);
  if (common) {
    return {
      id: common.id,
      isClass: false,
      category: common.category,
      maxTier: 1,
      yields: common.yields,
      income: common.income ?? 0,
      composurePerDay: common.composurePerDay ?? 0,
      storageBonus: common.storageBonus ?? 0,
      cost: () => common.cost,
      buildDays: () => common.buildDays,
      upkeep: () => 0,
    };
  }
  return null;
}

// The class building id for a class, or null when no class line exists yet (only
// the landowner's Estate is wired in this build).
export function classBuildingIdFor(classId: string): string | null {
  return getBuildingsContent().classBuildings[classId]?.id ?? null;
}

export function incomeAtTier(def: ResolvedDef, tier: number): number {
  return def.income > 0 ? buildingYield(def.income, tier) : 0;
}

// --- World / acting context --------------------------------------------------

export type ActingContext = { playerId: string; worldId: string; worldStartedMs: number };

export async function buildingContext(playerId: string, worldId: string): Promise<ActingContext | null> {
  const rows = await db.select({ startedAt: worlds.startedAt }).from(worlds).where(eq(worlds.id, worldId)).limit(1);
  if (!rows[0]) return null;
  return { playerId, worldId, worldStartedMs: rows[0].startedAt.getTime() };
}

// --- Owned buildings ---------------------------------------------------------

type BuildingRow = typeof playerBuildings.$inferSelect;

async function ownedRows(exec: Exec, playerId: string): Promise<BuildingRow[]> {
  return exec.select().from(playerBuildings).where(eq(playerBuildings.ownerPlayerId, playerId));
}

export async function ownedBuildingIds(playerId: string): Promise<Set<string>> {
  const rows = await ownedRows(db, playerId);
  return new Set(rows.map((r) => r.buildingId));
}

// Lazy activation: any constructing building whose completesAt has passed flips
// to active (and its resource rates are set when goods are first banked). Pure
// status flip — accrual is gated by completesAt regardless, so this is cosmetic
// but keeps the client's status honest.
async function flipActivations(exec: Exec, rows: BuildingRow[], now: Date): Promise<BuildingRow[]> {
  const flipped: BuildingRow[] = [];
  for (const row of rows) {
    if (row.status === "constructing" && row.completesAt.getTime() <= now.getTime()) {
      await exec.update(playerBuildings).set({ status: "active" }).where(eq(playerBuildings.id, row.id));
      flipped.push({ ...row, status: "active" });
    } else {
      flipped.push(row);
    }
  }
  return flipped;
}

function isActive(row: BuildingRow, now: Date): boolean {
  return row.completesAt.getTime() <= now.getTime();
}

// --- Resource row helpers ----------------------------------------------------

type ResourceRow = typeof resources.$inferSelect;
const INCOME_TYPE = "building_income"; // wallet (income − upkeep) accrual marker
const SHRINE_TYPE = "building_shrine"; // shrine composure (whole-day) marker

async function resourceRows(exec: Exec, playerId: string): Promise<ResourceRow[]> {
  return exec.select().from(resources).where(and(eq(resources.scope, "player"), eq(resources.scopeId, playerId)));
}

async function getOrCreateResource(exec: Exec, playerId: string, type: string, now: Date): Promise<ResourceRow> {
  const existing = await exec
    .select()
    .from(resources)
    .where(and(eq(resources.scope, "player"), eq(resources.scopeId, playerId), eq(resources.type, type)))
    .limit(1);
  if (existing[0]) return existing[0];
  const inserted = await exec
    .insert(resources)
    .values({ scope: "player", scopeId: playerId, type, amount: "0", ratePerSecond: "0", lastUpdatedAt: now })
    .returning();
  return inserted[0]!;
}

// --- Goods accrual (banked on collect / vendor) ------------------------------
// Aggregate pending output per good across all active buildings (each against its
// own marker + completesAt + seasonal/guard), then write each good row once. The
// good row's lastUpdatedAt is the goods marker; ratePerSecond stores the summed
// base rate for display.

type GoodAccrual = { banked: number; baseRatePerSec: number };

function computeGoodsAccrual(
  rows: BuildingRow[],
  byType: Map<string, ResourceRow>,
  season: SeasonName,
  now: Date,
): Map<string, GoodAccrual> {
  const c = getBuildingsContent();
  const out = new Map<string, GoodAccrual>();
  for (const row of rows) {
    if (!isActive(row, now)) continue;
    const def = resolveDef(row.buildingId);
    if (!def) continue;
    const prodMult = productionMultiplier(c.seasonal, def.category, season, row.completesAt.getTime(), now.getTime());
    for (const y of def.yields) {
      const perDay = goodPerDay(y, row.tier);
      if (perDay <= 0) continue;
      const existing = byType.get(y.good);
      const lastMs = existing ? existing.lastUpdatedAt.getTime() : row.completesAt.getTime();
      const accrued = accruedUnits({
        perDay,
        lastMs,
        completesAtMs: row.completesAt.getTime(),
        nowMs: now.getTime(),
        productionMult: prodMult,
      });
      const prev = out.get(y.good) ?? { banked: 0, baseRatePerSec: 0 };
      out.set(y.good, { banked: prev.banked + accrued, baseRatePerSec: prev.baseRatePerSec + ratePerSecond(perDay) });
    }
  }
  return out;
}

// Bank all pending goods into their resource rows (advances the goods markers).
// Returns the per-good banked amount for the collect summary.
export async function settleGoods(exec: Exec, ctx: ActingContext, rows: BuildingRow[], now: Date): Promise<Record<string, number>> {
  const season = seasonAt(now.getTime(), ctx.worldStartedMs);
  const existing = await resourceRows(exec, ctx.playerId);
  const byType = new Map(existing.map((r) => [r.type, r]));
  const accrual = computeGoodsAccrual(rows, byType, season, now);
  const banked: Record<string, number> = {};
  for (const [good, { banked: amount, baseRatePerSec }] of accrual) {
    const rowRes = byType.get(good) ?? (await getOrCreateResource(exec, ctx.playerId, good, now));
    const next = Number(rowRes.amount) + amount;
    await exec
      .update(resources)
      .set({ amount: String(next), ratePerSecond: String(baseRatePerSec), lastUpdatedAt: now })
      .where(eq(resources.id, rowRes.id));
    if (amount > 0) banked[good] = amount;
  }
  return banked;
}

// Live (no-write) available balance of a good: banked amount + pending accrual.
export async function availableGood(ctx: ActingContext, goodType: string, now: Date): Promise<number> {
  const rows = await ownedRows(db, ctx.playerId);
  const season = seasonAt(now.getTime(), ctx.worldStartedMs);
  const existing = await resourceRows(db, ctx.playerId);
  const byType = new Map(existing.map((r) => [r.type, r]));
  const banked = Number(byType.get(goodType)?.amount ?? 0);
  const pending = computeGoodsAccrual(rows, byType, season, now).get(goodType)?.banked ?? 0;
  return banked + pending;
}

// --- World treasury (stub sink) ----------------------------------------------

export async function creditWorldTreasury(exec: Exec, worldId: string, amount: number): Promise<void> {
  if (amount === 0) return;
  const existing = await exec.select().from(worldTreasury).where(eq(worldTreasury.worldId, worldId)).limit(1);
  if (existing[0]) {
    await exec.update(worldTreasury).set({ balance: existing[0].balance + amount }).where(eq(worldTreasury.worldId, worldId));
  } else {
    await exec.insert(worldTreasury).values({ worldId, balance: amount }).onConflictDoNothing();
  }
}

// --- Wallet settle: income − upkeep (continuous), clamp at 0 -----------------
// Upkeep is continuous (per-second from the daily rate) so frequent collecting
// can't dodge it and no partial day leaks. Never pushes the wallet negative —
// the shortfall is reported as `owed` and forgiven (gentle: a tax, not a debt).

type WalletSettle = { income: number; upkeep: number; collected: number; owed: number };

function continuousUpkeep(rows: BuildingRow[], lastMs: number, now: Date): number {
  const elapsedSec = Math.max(0, (now.getTime() - lastMs) / 1000);
  return rows
    .filter((r) => isActive(r, now))
    .reduce((sum, r) => {
      const def = resolveDef(r.buildingId);
      return def ? sum + (def.upkeep(r.tier) / 86_400) * elapsedSec : sum;
    }, 0);
}

function pendingIncome(rows: BuildingRow[], lastMs: number, season: SeasonName, now: Date): number {
  const c = getBuildingsContent();
  const elapsedSec = Math.max(0, (now.getTime() - lastMs) / 1000);
  return rows
    .filter((r) => isActive(r, now))
    .reduce((sum, r) => {
      const def = resolveDef(r.buildingId);
      if (!def || def.income <= 0) return sum;
      const prodMult = productionMultiplier(c.seasonal, def.category, season, r.completesAt.getTime(), now.getTime());
      return sum + ratePerSecond(incomeAtTier(def, r.tier)) * elapsedSec * prodMult;
    }, 0);
}

async function settleWallet(exec: Exec, ctx: ActingContext, rows: BuildingRow[], now: Date): Promise<WalletSettle> {
  const incomeRow = await getOrCreateResource(exec, ctx.playerId, INCOME_TYPE, now);
  const lastMs = incomeRow.lastUpdatedAt.getTime();
  const season = seasonAt(now.getTime(), ctx.worldStartedMs);
  const income = Number(incomeRow.amount) + pendingIncome(rows, lastMs, season, now);
  const upkeep = continuousUpkeep(rows, lastMs, now);
  const net = income - upkeep;

  const charRows = await exec.select({ drachmae: playerCharacters.drachmae }).from(playerCharacters).where(eq(playerCharacters.playerId, ctx.playerId)).limit(1);
  const wallet = charRows[0]?.drachmae ?? 0;
  let owed = 0;
  let nextWallet = wallet + net;
  if (nextWallet < 0) {
    owed = -nextWallet;
    nextWallet = 0;
  }
  await exec.update(playerCharacters).set({ drachmae: Math.round(nextWallet) }).where(eq(playerCharacters.playerId, ctx.playerId));
  await exec.update(resources).set({ amount: "0", lastUpdatedAt: now }).where(eq(resources.id, incomeRow.id));
  return { income, upkeep, collected: Math.round(net), owed: Math.round(owed) };
}

// Shrine composure: +composurePerDay per WHOLE day, flat (never scales). Its own
// marker advances only by whole days, so the partial-day remainder carries.
async function settleShrine(exec: Exec, ctx: ActingContext, rows: BuildingRow[], now: Date): Promise<number> {
  const shrineRow = await getOrCreateResource(exec, ctx.playerId, SHRINE_TYPE, now);
  const lastMs = shrineRow.lastUpdatedAt.getTime();
  const days = wholeDaysBetween(lastMs, now.getTime());
  if (days <= 0) return 0;
  const perDay = rows
    .filter((r) => isActive(r, now))
    .reduce((sum, r) => sum + (resolveDef(r.buildingId)?.composurePerDay ?? 0), 0);
  const advancedMs = lastMs + days * MS_PER_DAY;
  await exec.update(resources).set({ lastUpdatedAt: new Date(advancedMs) }).where(eq(resources.id, shrineRow.id));
  return perDay * days;
}

// --- Catalog (GET /api/buildings) -------------------------------------------

export type CatalogTier = { tier: number; name?: string; rank?: string; cost: number; buildDays: number; upkeep: number; yields: { good: string; perDay: number }[]; income: number };
export type CatalogEntry = {
  id: string;
  kind: "class" | "common";
  name: string;
  icon?: string;
  category: BuildingCategory;
  blurb?: string;
  storageBonus?: number;
  composurePerDay?: number;
  tiers: CatalogTier[];
};

function catalogTiers(def: ResolvedDef, names: { tier: number; name?: string; rank?: string }[]): CatalogTier[] {
  const tiers: CatalogTier[] = [];
  for (let t = 1; t <= def.maxTier; t++) {
    const meta = names.find((n) => n.tier === t);
    tiers.push({
      tier: t,
      name: meta?.name,
      rank: meta?.rank,
      cost: def.cost(t),
      buildDays: def.buildDays(t),
      upkeep: def.upkeep(t),
      income: incomeAtTier(def, t),
      yields: def.yields.map((y) => ({ good: y.good, perDay: goodPerDay(y, t) })).filter((y) => y.perDay > 0),
    });
  }
  return tiers;
}

export type VendorPrice = { good: string; buy: number; sell: number };
export type CatalogView = {
  season: SeasonName;
  seasonMultiplier: { agricultural: number; yearround: number };
  classBuilding: CatalogEntry | null;
  commons: CatalogEntry[];
  classSectionLabel: string | null;
  // Seasonally-adjusted band: `buy` = what the player pays (ceiling), `sell` =
  // what the player receives (floor).
  vendor: VendorPrice[];
};

export function catalog(classId: string, ctx: ActingContext, now: Date): CatalogView {
  const c = getBuildingsContent();
  const season = seasonAt(now.getTime(), ctx.worldStartedMs);
  const classDef = c.classBuildings[classId];
  let classEntry: CatalogEntry | null = null;
  if (classDef) {
    const def = resolveDef(classDef.id)!;
    classEntry = {
      id: classDef.id,
      kind: "class",
      name: classDef.tiers[0]?.name ?? classDef.id,
      category: classDef.category,
      blurb: classDef.flavor,
      tiers: catalogTiers(def, classDef.tiers),
    };
  }
  const commons: CatalogEntry[] = c.commonBuildings.map((b) => {
    const def = resolveDef(b.id)!;
    return {
      id: b.id,
      kind: "common",
      name: b.name,
      icon: b.icon,
      category: b.category,
      blurb: b.blurb,
      storageBonus: b.storageBonus,
      composurePerDay: b.composurePerDay,
      tiers: catalogTiers(def, [{ tier: 1, name: b.name }]),
    };
  });
  const vendor: VendorPrice[] = Object.entries(c.vendor).map(([good, band]) => {
    const cat = goodCategoryFor(c.seasonal, good);
    return {
      good,
      buy: vendorUnitPrice(band, "buy", c.seasonal, cat, season),
      sell: vendorUnitPrice(band, "sell", c.seasonal, cat, season),
    };
  });
  return {
    season,
    seasonMultiplier: {
      agricultural: coeffFor(c.seasonal, "agricultural", season).production,
      yearround: coeffFor(c.seasonal, "yearround", season).production,
    },
    classBuilding: classEntry,
    commons,
    classSectionLabel: classSectionLabel(classId),
    vendor,
  };
}

// --- Mine (GET /api/buildings/mine) -----------------------------------------

export type OwnedBuilding = {
  id: string;
  kind: "class" | "common";
  name: string;
  icon?: string;
  tier: number;
  status: "constructing" | "active";
  completesAt: string | null;
  category: BuildingCategory;
  // Current seasonally-adjusted output (per day) + uncollected pending.
  yields: { good: string; perDay: number; pending: number }[];
  income: number; // drachmae/day at current tier+season
  pendingIncome: number;
  upkeepPerDay: number;
  // Next-tier preview for the upgrade CTA (null at max tier or for commons).
  upgrade: { tier: number; name?: string; cost: number; buildDays: number; newYields: { good: string; perDay: number }[] } | null;
};

export type MineView = {
  season: SeasonName;
  buildings: OwnedBuilding[];
  pendingIncomeTotal: number;
  upkeepOwed: number;
  pendingGoods: Record<string, number>;
  storageCap: number;
  classSection: ClassSection;
};

const BASE_STORAGE_CAP = 100;

export async function mine(classId: string, ctx: ActingContext, now: Date): Promise<MineView> {
  const c = getBuildingsContent();
  const season = seasonAt(now.getTime(), ctx.worldStartedMs);
  const rows = await flipActivations(db, await ownedRows(db, ctx.playerId), now);
  const existing = await resourceRows(db, ctx.playerId);
  const byType = new Map(existing.map((r) => [r.type, r]));
  const accrual = computeGoodsAccrual(rows, byType, season, now);

  const buildings: OwnedBuilding[] = rows.map((row) => {
    const def = resolveDef(row.buildingId)!;
    const active = isActive(row, now);
    const prodMult = active ? productionMultiplier(c.seasonal, def.category, season, row.completesAt.getTime(), now.getTime()) : 0;
    const classMeta = c.classBuildings[classId];
    const common = c.commonBuildings.find((b) => b.id === row.buildingId);
    const tierName = def.isClass ? classMeta?.tiers.find((t) => t.tier === row.tier)?.name : common?.name;
    const yields = def.yields
      .map((y) => ({ good: y.good, perDay: goodPerDay(y, row.tier) * prodMult, pending: 0 }))
      .filter((y) => goodPerDay(def.yields.find((d) => d.good === y.good)!, row.tier) > 0);
    // Distribute the aggregated pending back to this building's goods (1:1 in
    // practice — each good has a single source building).
    for (const y of yields) y.pending = accrual.get(y.good)?.banked ?? 0;

    let upgrade: OwnedBuilding["upgrade"] = null;
    if (def.isClass && row.tier < def.maxTier && active) {
      const next = row.tier + 1;
      upgrade = {
        tier: next,
        name: classMeta?.tiers.find((t) => t.tier === next)?.name,
        cost: def.cost(next),
        buildDays: def.buildDays(next),
        newYields: def.yields.map((y) => ({ good: y.good, perDay: goodPerDay(y, next) })).filter((y) => y.perDay > 0),
      };
    }
    return {
      id: row.buildingId,
      kind: def.isClass ? "class" : "common",
      name: tierName ?? row.buildingId,
      icon: common?.icon,
      tier: row.tier,
      status: row.status as "constructing" | "active",
      completesAt: active ? null : row.completesAt.toISOString(),
      category: def.category,
      yields,
      income: active ? ratePerSecond(incomeAtTier(def, row.tier)) * 86_400 * prodMult : 0,
      pendingIncome: 0,
      upkeepPerDay: def.upkeep(row.tier),
      upgrade,
    };
  });

  // Wallet pending (income − upkeep) is whole-account, not per building.
  const incomeRow = byType.get(INCOME_TYPE);
  const lastMs = incomeRow ? incomeRow.lastUpdatedAt.getTime() : now.getTime();
  const incomePending = pendingIncome(rows, lastMs, season, now) + Number(incomeRow?.amount ?? 0);
  const upkeep = continuousUpkeep(rows, lastMs, now);
  const charRows = await db.select({ drachmae: playerCharacters.drachmae }).from(playerCharacters).where(eq(playerCharacters.playerId, ctx.playerId)).limit(1);
  const wallet = charRows[0]?.drachmae ?? 0;
  const owed = Math.max(0, upkeep - incomePending - wallet);

  const pendingGoods: Record<string, number> = {};
  for (const [good, a] of accrual) if (a.banked > 0) pendingGoods[good] = a.banked;

  const storageCap = BASE_STORAGE_CAP + rows.filter((r) => isActive(r, now)).reduce((s, r) => s + (resolveDef(r.buildingId)?.storageBonus ?? 0), 0);

  return {
    season,
    buildings,
    pendingIncomeTotal: incomePending,
    upkeepOwed: owed,
    pendingGoods,
    storageCap,
    classSection: { label: classSectionLabel(classId), comingSoon: classSectionLabel(classId) !== null, flavor: c.classBuildings[classId]?.flavor, entries: [] },
  };
}

// --- Build / upgrade ---------------------------------------------------------

export type BuildResult = { ok: false; code: number; error: string } | { ok: true; buildingId: string; tier: number; completesAt: string; cost: number };

export async function build(classId: string, ctx: ActingContext, buildingId: string, now: Date): Promise<BuildResult> {
  if (!canBuild(classId)) return { ok: false, code: 403, error: "A slave owns no land — earn your freedom first." };
  const def = resolveDef(buildingId);
  if (!def) return { ok: false, code: 404, error: "No such building." };
  // Class buildings may only be raised by their own class.
  if (def.isClass && classBuildingIdFor(classId) !== buildingId) {
    return { ok: false, code: 403, error: "That estate is not your class's to build." };
  }
  const cost = def.cost(1);
  const completesAt = new Date(now.getTime() + buildMs(1));

  return db.transaction(async (tx) => {
    const existing = await tx.select().from(playerBuildings).where(and(eq(playerBuildings.ownerPlayerId, ctx.playerId), eq(playerBuildings.buildingId, buildingId))).limit(1);
    if (existing[0]) return { ok: false as const, code: 409, error: "You already hold that building." };
    const charRows = await tx.select({ drachmae: playerCharacters.drachmae }).from(playerCharacters).where(eq(playerCharacters.playerId, ctx.playerId)).limit(1);
    const wallet = charRows[0]?.drachmae ?? 0;
    if (wallet < cost) return { ok: false as const, code: 402, error: `You need ${cost} drachmae to build this.` };
    await tx.update(playerCharacters).set({ drachmae: wallet - cost }).where(eq(playerCharacters.playerId, ctx.playerId));
    await tx.insert(playerBuildings).values({ worldId: ctx.worldId, ownerPlayerId: ctx.playerId, buildingId, tier: 1, status: "constructing", completesAt });
    return { ok: true as const, buildingId, tier: 1, completesAt: completesAt.toISOString(), cost };
  });
}

export async function upgrade(ctx: ActingContext, buildingId: string, now: Date): Promise<BuildResult> {
  const def = resolveDef(buildingId);
  if (!def) return { ok: false, code: 404, error: "No such building." };
  if (!def.isClass) return { ok: false, code: 409, error: "That building has no further tiers." };

  return db.transaction(async (tx) => {
    const rows = await tx.select().from(playerBuildings).where(and(eq(playerBuildings.ownerPlayerId, ctx.playerId), eq(playerBuildings.buildingId, buildingId))).limit(1);
    const row = rows[0];
    if (!row) return { ok: false as const, code: 404, error: "You do not own that building." };
    if (row.status !== "active" && row.completesAt.getTime() > now.getTime()) return { ok: false as const, code: 409, error: "It is still under construction." };
    if (row.tier >= def.maxTier) return { ok: false as const, code: 409, error: "Already at the highest tier." };
    const nextTier = row.tier + 1;
    const cost = def.cost(nextTier);
    const charRows = await tx.select({ drachmae: playerCharacters.drachmae }).from(playerCharacters).where(eq(playerCharacters.playerId, ctx.playerId)).limit(1);
    const wallet = charRows[0]?.drachmae ?? 0;
    if (wallet < cost) return { ok: false as const, code: 402, error: `You need ${cost} drachmae to upgrade.` };
    const completesAt = new Date(now.getTime() + buildMs(nextTier));
    await tx.update(playerCharacters).set({ drachmae: wallet - cost }).where(eq(playerCharacters.playerId, ctx.playerId));
    await tx.update(playerBuildings).set({ tier: nextTier, status: "constructing", completesAt }).where(eq(playerBuildings.id, row.id));
    return { ok: true as const, buildingId, tier: nextTier, completesAt: completesAt.toISOString(), cost };
  });
}

// --- Collect (POST /api/buildings/collect) ----------------------------------
// Sweep all owned buildings: bank goods into inventory, settle income − upkeep
// into the wallet (clamped, owed-flagged), and apply the shrine's flat composure.

export type CollectResult = { banked: Record<string, number>; income: number; upkeep: number; collected: number; owed: number; composure: number };

export async function collect(ctx: ActingContext, now: Date): Promise<CollectResult> {
  const result = await db.transaction(async (tx) => {
    const rows = await flipActivations(tx, await ownedRows(tx, ctx.playerId), now);
    const banked = await settleGoods(tx, ctx, rows, now);
    const wallet = await settleWallet(tx, ctx, rows, now);
    const composureDays = await settleShrine(tx, ctx, rows, now);
    return { banked, wallet, composureDays };
  });
  // Composure goes through the break-aware service (clamps to the cap), after tx.
  let composure = 0;
  if (result.composureDays > 0) {
    await applyComposureDelta(await characterIdFor(ctx.playerId), result.composureDays, "building:shrine", now);
    composure = result.composureDays;
  }
  return { banked: result.banked, income: result.wallet.income, upkeep: result.wallet.upkeep, collected: result.wallet.collected, owed: result.wallet.owed, composure };
}

async function characterIdFor(playerId: string): Promise<string> {
  const rows = await db.select({ id: playerCharacters.id }).from(playerCharacters).where(eq(playerCharacters.playerId, playerId)).limit(1);
  return rows[0]!.id;
}

// --- Vendor (POST /api/buildings/vendor) ------------------------------------
// Atomic band trade. The vendor SELLS to the player at the seasonal ceiling and
// BUYS from the player at the seasonal floor. Goods are banked first so pending
// output is sellable.

export type VendorResult = { ok: false; code: number; error: string } | { ok: true; action: VendorAction; type: string; qty: number; unitPrice: number; total: number; wallet: number; balance: number };

export async function vendorTrade(ctx: ActingContext, action: VendorAction, type: string, qty: number, now: Date): Promise<VendorResult> {
  const c = getBuildingsContent();
  const band = c.vendor[type];
  if (!band) return { ok: false, code: 404, error: "The agora does not trade that good." };
  if (!Number.isInteger(qty) || qty <= 0) return { ok: false, code: 400, error: "Trade a whole, positive quantity." };
  const season = seasonAt(now.getTime(), ctx.worldStartedMs);
  const unitPrice = vendorUnitPrice(band, action, c.seasonal, goodCategoryFor(c.seasonal, type), season);
  const total = unitPrice * qty;

  return db.transaction(async (tx) => {
    const rows = await flipActivations(tx, await ownedRows(tx, ctx.playerId), now);
    await settleGoods(tx, ctx, rows, now); // bank pending so the sell sees fresh stock
    const goodRow = await getOrCreateResource(tx, ctx.playerId, type, now);
    const balance = Number(goodRow.amount);
    const charRows = await tx.select({ drachmae: playerCharacters.drachmae }).from(playerCharacters).where(eq(playerCharacters.playerId, ctx.playerId)).limit(1);
    const wallet = charRows[0]?.drachmae ?? 0;

    if (action === "buy") {
      if (wallet < total) return { ok: false as const, code: 402, error: `You need ${total} drachmae for that.` };
      await tx.update(playerCharacters).set({ drachmae: wallet - total }).where(eq(playerCharacters.playerId, ctx.playerId));
      await tx.update(resources).set({ amount: String(balance + qty) }).where(eq(resources.id, goodRow.id));
      return { ok: true as const, action, type, qty, unitPrice, total, wallet: wallet - total, balance: balance + qty };
    }
    // sell
    if (balance < qty) return { ok: false as const, code: 409, error: `You hold only ${Math.floor(balance)} ${type}.` };
    await tx.update(resources).set({ amount: String(balance - qty) }).where(eq(resources.id, goodRow.id));
    await tx.update(playerCharacters).set({ drachmae: wallet + total }).where(eq(playerCharacters.playerId, ctx.playerId));
    return { ok: true as const, action, type, qty, unitPrice, total, wallet: wallet + total, balance: balance - qty };
  });
}

// --- Routine consumption hook -----------------------------------------------
// Resolve a routine card's `requires` block in one transaction: a `waivedBy`
// building the player owns zeroes the cost; otherwise debit the good (banking
// pending first) and/or the fee (crediting the world-treasury stub). Returns the
// waiver state for the response copy.

export type ConsumeRequirement = { good?: { type: string; qty: number }; fee?: number; waivedBy?: string };
export type ConsumeResult = { ok: false; code: number; error: string } | { ok: true; waived: boolean };

export async function consumeRoutineRequirement(playerId: string, worldId: string, req: ConsumeRequirement, now: Date): Promise<ConsumeResult> {
  const ctx = await buildingContext(playerId, worldId);
  if (!ctx) return { ok: false, code: 503, error: "No active world." };
  const owned = await ownedBuildingIds(playerId);
  const waived = req.waivedBy ? owned.has(req.waivedBy) : false;
  if (waived) return { ok: true, waived: true };

  // Validate availability live (no writes) before committing anything.
  if (req.good) {
    const available = await availableGood(ctx, req.good.type, now);
    if (available < req.good.qty) {
      return { ok: false, code: 409, error: `You have no ${req.good.type} for this — the agora sells them.` };
    }
  }
  if (req.fee) {
    const charRows = await db.select({ drachmae: playerCharacters.drachmae }).from(playerCharacters).where(eq(playerCharacters.playerId, playerId)).limit(1);
    if ((charRows[0]?.drachmae ?? 0) < req.fee) return { ok: false, code: 402, error: `You cannot spare the ${req.fee}dr.` };
  }

  await db.transaction(async (tx) => {
    if (req.good) {
      const rows = await flipActivations(tx, await ownedRows(tx, playerId), now);
      await settleGoods(tx, ctx, rows, now);
      const goodRow = await getOrCreateResource(tx, playerId, req.good.type, now);
      await tx.update(resources).set({ amount: String(Number(goodRow.amount) - req.good.qty) }).where(eq(resources.id, goodRow.id));
    }
    if (req.fee) {
      const charRows = await tx.select({ drachmae: playerCharacters.drachmae }).from(playerCharacters).where(eq(playerCharacters.playerId, playerId)).limit(1);
      const wallet = charRows[0]?.drachmae ?? 0;
      await tx.update(playerCharacters).set({ drachmae: Math.max(0, wallet - req.fee) }).where(eq(playerCharacters.playerId, playerId));
      await creditWorldTreasury(tx, worldId, req.fee);
    }
  });
  return { ok: true, waived: false };
}
