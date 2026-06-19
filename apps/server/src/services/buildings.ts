import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { createDb, playerBuildings, playerCharacters, playerPops, resources, worldTreasury, worlds } from "@massalia/db";
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
  materialCostForTier,
  MAX_TIER,
  parseBuildingsContent,
  parsePopsContent,
  productionMultiplier,
  ratePerSecond,
  seasonAt,
  staffCountForTier,
  staffDailyCost,
  vendorUnitPrice,
  wholeDaysBetween,
  type BuildingCategory,
  type BuildingsContent,
  type BuildingYieldDef,
  type ClassSection,
  type PopsContent,
  type PopType,
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
const popsFile = path.join(repoRoot, "content/people/pops.json");

const MS_PER_DAY = 86_400_000;

let content: BuildingsContent | null = null;
let pops: PopsContent | null = null;

// Validate the building catalog at boot (fail fast on a malformed file); memoized.
export async function loadBuildingsContent(): Promise<BuildingsContent> {
  content = parseBuildingsContent(JSON.parse(await fs.readFile(buildingsFile, "utf8")));
  return content;
}

export function getBuildingsContent(): BuildingsContent {
  if (!content) throw new Error("Building content not loaded. Call loadBuildingsContent() at boot.");
  return content;
}

// The pops catalog (hireCost / upkeep / food per pop type) drives staffing costs.
export async function loadPopsContent(): Promise<PopsContent> {
  pops = parsePopsContent(JSON.parse(await fs.readFile(popsFile, "utf8")));
  return pops;
}

export function getPopsContent(): PopsContent {
  if (!pops) throw new Error("Pops content not loaded. Call loadPopsContent() at boot.");
  return pops;
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
  staffing?: Partial<Record<PopType, number>>; // T1 pop requirement (scales via staffCountForTier)
  buildCost?: { materials: Record<string, number> }; // T1 material bill (scales via materialCostForTier)
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
      staffing: cls.staffing,
      buildCost: cls.buildCost,
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
      staffing: common.staffing,
      buildCost: common.buildCost,
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
const STAFF_TYPE = "building_staff"; // staff upkeep + food (whole-day) marker

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

// --- Staffing (Phase 2): shared-pool allocation + under-staffing -------------
// Pops the player owns (player_pops) are a SHARED POOL across all their active
// buildings. Each active building needs staffCountForTier(base, tier) of each pop
// type (content-driven). When the pool can't cover everything, we keep the
// highest NET-VALUE buildings staffed and idle the rest:
//   net daily value = gross (income + Σ goods × vendor floor)
//                     − costs (building upkeep + staff upkeep + food × wheat floor),
// at the building's tier and the current season. Ranked descending; the pool is
// allocated greedily top-down (ties broken by buildingId for determinism). A
// building that can't be fully staffed from the remaining pool is IDLED — it
// produces nothing this read (no goods, no income) but STILL owes building upkeep.

async function popCountsFor(exec: Exec, playerId: string): Promise<Record<string, number>> {
  const rows = await exec.select().from(playerPops).where(eq(playerPops.ownerPlayerId, playerId));
  const out: Record<string, number> = {};
  for (const r of rows) out[r.popType] = r.count;
  return out;
}

// Per-type staff a building needs at a tier (empty when it has no staffing).
function staffNeed(def: ResolvedDef, tier: number): Partial<Record<PopType, number>> {
  const need: Partial<Record<PopType, number>> = {};
  if (!def.staffing) return need;
  for (const [type, base] of Object.entries(def.staffing) as [PopType, number][]) {
    need[type] = staffCountForTier(base, tier);
  }
  return need;
}

// Gross-minus-cost daily value used only to RANK buildings for the shared pool
// (season-adjusted, guard ignored — ranking, not accrual).
function netDailyValue(def: ResolvedDef, tier: number, season: SeasonName): number {
  const c = getBuildingsContent();
  const prodMult = coeffFor(c.seasonal, def.category, season).production;
  let gross = incomeAtTier(def, tier) * prodMult;
  for (const y of def.yields) gross += goodPerDay(y, tier) * prodMult * (c.vendor[y.good]?.buy ?? 0);
  const staff = staffDailyCost(def.staffing, tier, getPopsContent());
  const wheatFloor = c.vendor[getPopsContent().foodGood]?.buy ?? 0;
  return gross - (def.upkeep(tier) + staff.upkeep + staff.food * wheatFloor);
}

// The ids of active buildings that idle this read because the shared pop pool
// can't staff them (highest net-value buildings keep the pops).
function idledBuildingIds(activeRows: BuildingRow[], owned: Record<string, number>, season: SeasonName): Set<string> {
  const pool: Record<string, number> = { ...owned };
  const idled = new Set<string>();
  const ranked = [...activeRows].sort((a, b) => {
    const diff = netDailyValue(resolveDef(b.buildingId)!, b.tier, season) - netDailyValue(resolveDef(a.buildingId)!, a.tier, season);
    return diff !== 0 ? diff : a.buildingId.localeCompare(b.buildingId);
  });
  for (const row of ranked) {
    const need = staffNeed(resolveDef(row.buildingId)!, row.tier);
    const canStaff = (Object.entries(need) as [PopType, number][]).every(([type, n]) => (pool[type] ?? 0) >= n);
    if (canStaff) for (const [type, n] of Object.entries(need) as [PopType, number][]) pool[type] = (pool[type] ?? 0) - n;
    else idled.add(row.id);
  }
  return idled;
}

// Resolve the idle set for a player at `now` (reads the shared pool once).
async function staffingFor(exec: Exec, ctx: ActingContext, rows: BuildingRow[], now: Date): Promise<Set<string>> {
  const active = rows.filter((r) => isActive(r, now));
  if (active.length === 0) return new Set();
  const owned = await popCountsFor(exec, ctx.playerId);
  return idledBuildingIds(active, owned, seasonAt(now.getTime(), ctx.worldStartedMs));
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
  idled: Set<string> = new Set(),
): Map<string, GoodAccrual> {
  const c = getBuildingsContent();
  const out = new Map<string, GoodAccrual>();
  for (const row of rows) {
    if (!isActive(row, now) || idled.has(row.id)) continue; // under-staffed → produces nothing
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
export async function settleGoods(exec: Exec, ctx: ActingContext, rows: BuildingRow[], now: Date, idled?: Set<string>): Promise<Record<string, number>> {
  const season = seasonAt(now.getTime(), ctx.worldStartedMs);
  const idledIds = idled ?? (await staffingFor(exec, ctx, rows, now));
  const existing = await resourceRows(exec, ctx.playerId);
  const byType = new Map(existing.map((r) => [r.type, r]));
  const accrual = computeGoodsAccrual(rows, byType, season, now, idledIds);
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
  const idled = await staffingFor(db, ctx, rows, now);
  const existing = await resourceRows(db, ctx.playerId);
  const byType = new Map(existing.map((r) => [r.type, r]));
  const banked = Number(byType.get(goodType)?.amount ?? 0);
  const pending = computeGoodsAccrual(rows, byType, season, now, idled).get(goodType)?.banked ?? 0;
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

// Both upkeep and income accrue per-building from max(marker, completesAt) — the
// same backdating the goods path uses (accruedUnits). When the wallet marker is
// absent (never collected → lastMs 0) each building starts at its own completesAt,
// so a building's first collect is never silently dropped.
function continuousUpkeep(rows: BuildingRow[], lastMs: number, now: Date): number {
  return rows
    .filter((r) => isActive(r, now))
    .reduce((sum, r) => {
      const def = resolveDef(r.buildingId);
      if (!def) return sum;
      const start = Math.max(lastMs, r.completesAt.getTime());
      const elapsedSec = Math.max(0, (now.getTime() - start) / 1000);
      return sum + (def.upkeep(r.tier) / 86_400) * elapsedSec;
    }, 0);
}

function pendingIncome(rows: BuildingRow[], lastMs: number, season: SeasonName, now: Date, idled: Set<string> = new Set()): number {
  const c = getBuildingsContent();
  return rows
    .filter((r) => isActive(r, now) && !idled.has(r.id)) // under-staffed → no income
    .reduce((sum, r) => {
      const def = resolveDef(r.buildingId);
      if (!def || def.income <= 0) return sum;
      const start = Math.max(lastMs, r.completesAt.getTime());
      const elapsedSec = Math.max(0, (now.getTime() - start) / 1000);
      const prodMult = productionMultiplier(c.seasonal, def.category, season, r.completesAt.getTime(), now.getTime());
      return sum + ratePerSecond(incomeAtTier(def, r.tier)) * elapsedSec * prodMult;
    }, 0);
}

async function settleWallet(exec: Exec, ctx: ActingContext, rows: BuildingRow[], now: Date, idled: Set<string>): Promise<WalletSettle> {
  // Read the marker WITHOUT creating it: a fresh player has no row, so lastMs 0
  // lets each building backdate to its own completesAt (no lost first collect).
  const existing = (
    await exec
      .select()
      .from(resources)
      .where(and(eq(resources.scope, "player"), eq(resources.scopeId, ctx.playerId), eq(resources.type, INCOME_TYPE)))
      .limit(1)
  )[0];
  const lastMs = existing ? existing.lastUpdatedAt.getTime() : 0;
  const season = seasonAt(now.getTime(), ctx.worldStartedMs);
  // Income only from STAFFED buildings; building upkeep is owed by every active
  // building (staffed or idled) — the gentle flat tax doesn't pause when idle.
  const income = Number(existing?.amount ?? 0) + pendingIncome(rows, lastMs, season, now, idled);
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
  if (existing) {
    await exec.update(resources).set({ amount: "0", lastUpdatedAt: now }).where(eq(resources.id, existing.id));
  } else {
    await exec.insert(resources).values({ scope: "player", scopeId: ctx.playerId, type: INCOME_TYPE, amount: "0", ratePerSecond: "0", lastUpdatedAt: now });
  }
  return { income, upkeep, collected: Math.round(net), owed: Math.round(owed) };
}

// --- Staff upkeep + food settle (Phase 2; v2.2 — charged on OWNED pops) --------
// Staff costs accrue per WHOLE in-game day on their own marker (mirrors the shrine,
// so the partial-day remainder carries and frequent collecting can't dodge them).
// Wages + food are charged on EVERY pop the player OWNS (player_pops), working or
// not — hiring someone means paying their wage and feeding them regardless of
// whether they staff a building. (This is DECOUPLED from the staffing PREREQUISITE,
// which stays required-based for build/upgrade.) FOOD v1 RULE: each day's food is
// drawn from the player's wheat (foodGood) stock first; any shortfall is auto-bought
// from the NPC at the wheat ceiling and the wallet debited — bought food is consumed
// at once, not added to stock. Staff drachmae + food-buy clamp the wallet at 0; the
// forgiven shortfall is reported as `owed` (a tax, not a debt).

type StaffSettle = { staffUpkeep: number; foodNeeded: number; foodDrawn: number; foodBought: number; foodCost: number; owed: number };

async function settleStaffing(exec: Exec, ctx: ActingContext, rows: BuildingRow[], now: Date): Promise<StaffSettle> {
  const c = getBuildingsContent();
  const popsC = getPopsContent();
  // Sum wages + food over OWNED pops (player_pops), not the staffing requirement.
  const popRows = await exec.select().from(playerPops).where(eq(playerPops.ownerPlayerId, ctx.playerId));
  const staffUpkeepPerDay = popRows.reduce((s, r) => s + r.count * (popsC.pops[r.popType as PopType]?.upkeepPerDay ?? 0), 0);
  const foodPerDay = popRows.reduce((s, r) => s + r.count * (popsC.pops[r.popType as PopType]?.foodPerDay ?? 0), 0);

  const existing = (
    await exec.select().from(resources).where(and(eq(resources.scope, "player"), eq(resources.scopeId, ctx.playerId), eq(resources.type, STAFF_TYPE))).limit(1)
  )[0];
  // First-settle anchor (no marker yet): the earliest standing liability — the
  // earliest of ANY active building's completion OR when a pop was first hired
  // (player_pops.createdAt). So owning pops starts the upkeep clock even with no (or
  // only idle) buildings; thereafter this one marker carries it closed-form. Falls
  // back to `now` when the player has neither.
  const active = rows.filter((r) => isActive(r, now));
  let anchor = now.getTime();
  if (!existing) {
    const starts = [...active.map((r) => r.completesAt.getTime()), ...popRows.filter((r) => r.count > 0).map((r) => r.createdAt.getTime())];
    if (starts.length) anchor = Math.min(...starts);
  }
  const lastMs = existing ? existing.lastUpdatedAt.getTime() : anchor;
  const days = wholeDaysBetween(lastMs, now.getTime());

  let staffUpkeep = 0;
  let foodNeeded = 0;
  let foodDrawn = 0;
  let foodBought = 0;
  let foodCost = 0;
  let owed = 0;
  if (days > 0) {
    staffUpkeep = staffUpkeepPerDay * days;
    foodNeeded = foodPerDay * days;
    if (foodNeeded > 0) {
      const wheatRow = await getOrCreateResource(exec, ctx.playerId, popsC.foodGood, now);
      const wheat = Number(wheatRow.amount);
      foodDrawn = Math.min(wheat, foodNeeded);
      if (foodDrawn > 0) await exec.update(resources).set({ amount: String(wheat - foodDrawn) }).where(eq(resources.id, wheatRow.id));
      foodBought = foodNeeded - foodDrawn;
      const band = c.vendor[popsC.foodGood];
      if (foodBought > 0 && band) {
        const season = seasonAt(now.getTime(), ctx.worldStartedMs);
        foodCost = foodBought * vendorUnitPrice(band, "buy", c.seasonal, goodCategoryFor(c.seasonal, popsC.foodGood), season);
      }
    }
    const cost = staffUpkeep + foodCost;
    if (cost > 0) {
      const charRows = await exec.select({ drachmae: playerCharacters.drachmae }).from(playerCharacters).where(eq(playerCharacters.playerId, ctx.playerId)).limit(1);
      const wallet = charRows[0]?.drachmae ?? 0;
      let next = wallet - cost;
      if (next < 0) {
        owed = -next;
        next = 0;
      }
      await exec.update(playerCharacters).set({ drachmae: Math.round(next) }).where(eq(playerCharacters.playerId, ctx.playerId));
    }
  }
  const advancedMs = lastMs + days * MS_PER_DAY;
  if (existing) await exec.update(resources).set({ lastUpdatedAt: new Date(advancedMs) }).where(eq(resources.id, existing.id));
  else await exec.insert(resources).values({ scope: "player", scopeId: ctx.playerId, type: STAFF_TYPE, amount: "0", ratePerSecond: "0", lastUpdatedAt: new Date(advancedMs) });
  return { staffUpkeep: Math.round(staffUpkeep), foodNeeded, foodDrawn, foodBought, foodCost: Math.round(foodCost), owed: Math.round(owed) };
}

// Shrine composure: +composurePerDay per WHOLE day, flat (never scales). Its own
// marker advances only by whole days, so the partial-day remainder carries.
async function settleShrine(exec: Exec, ctx: ActingContext, rows: BuildingRow[], idled: Set<string>, now: Date): Promise<number> {
  const shrineRow = await getOrCreateResource(exec, ctx.playerId, SHRINE_TYPE, now);
  const lastMs = shrineRow.lastUpdatedAt.getTime();
  const days = wholeDaysBetween(lastMs, now.getTime());
  if (days <= 0) return 0;
  const perDay = rows
    .filter((r) => isActive(r, now) && !idled.has(r.id))
    .reduce((sum, r) => sum + (resolveDef(r.buildingId)?.composurePerDay ?? 0), 0);
  const advancedMs = lastMs + days * MS_PER_DAY;
  await exec.update(resources).set({ lastUpdatedAt: new Date(advancedMs) }).where(eq(resources.id, shrineRow.id));
  return perDay * days;
}

// --- Catalog (GET /api/buildings) -------------------------------------------

export type CatalogTier = {
  tier: number;
  name?: string;
  rank?: string;
  cost: number;
  buildDays: number;
  upkeep: number;
  yields: { good: string; perDay: number }[];
  income: number;
  materials: Record<string, number>; // build/upgrade material bill at this tier (materialCostForTier)
  staffing: Partial<Record<PopType, number>>; // pops required at this tier (staffCountForTier)
};
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
      materials: materialsForTier(def, t),
      staffing: staffNeed(def, t),
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
  goodLabels: Record<string, string>; // display names for every good (IDs stay stable)
  craft: Record<string, { building: string; tier: number; recipe: Record<string, number> }>; // content.craft
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
    goodLabels: c.goodLabels ?? {},
    craft: c.craft ?? {},
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
  income: number; // drachmae/day at current tier+season (0 while idled)
  pendingIncome: number;
  upkeepPerDay: number;
  idle: boolean; // under-staffed: produces nothing this read, still owes building upkeep
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
  pops: Record<string, number>; // pops the player owns (the shared staffing pool)
};

const BASE_STORAGE_CAP = 100;

export async function mine(classId: string, ctx: ActingContext, now: Date): Promise<MineView> {
  const c = getBuildingsContent();
  const season = seasonAt(now.getTime(), ctx.worldStartedMs);
  const rows = await flipActivations(db, await ownedRows(db, ctx.playerId), now);
  const idled = await staffingFor(db, ctx, rows, now);
  const existing = await resourceRows(db, ctx.playerId);
  const byType = new Map(existing.map((r) => [r.type, r]));
  const accrual = computeGoodsAccrual(rows, byType, season, now, idled);

  const buildings: OwnedBuilding[] = rows.map((row) => {
    const def = resolveDef(row.buildingId)!;
    const active = isActive(row, now);
    const idle = active && idled.has(row.id); // under-staffed → produces nothing
    const prodMult = active && !idle ? productionMultiplier(c.seasonal, def.category, season, row.completesAt.getTime(), now.getTime()) : 0;
    const classMeta = c.classBuildings[classId];
    const common = c.commonBuildings.find((b) => b.id === row.buildingId);
    const tierName = def.isClass ? classMeta?.tiers.find((t) => t.tier === row.tier)?.name : common?.name;
    const yields = idle
      ? []
      : def.yields
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
      income: active && !idle ? ratePerSecond(incomeAtTier(def, row.tier)) * 86_400 * prodMult : 0,
      pendingIncome: 0,
      upkeepPerDay: def.upkeep(row.tier),
      idle,
      upgrade,
    };
  });

  // Wallet pending (income − upkeep) is whole-account, not per building.
  const incomeRow = byType.get(INCOME_TYPE);
  // No marker yet → backdate per-building to completesAt (lastMs 0), so pending
  // offering income shows in the Ledger before the first collect, like goods do.
  const lastMs = incomeRow ? incomeRow.lastUpdatedAt.getTime() : 0;
  const incomePending = pendingIncome(rows, lastMs, season, now, idled) + Number(incomeRow?.amount ?? 0);
  const upkeep = continuousUpkeep(rows, lastMs, now);
  const charRows = await db.select({ drachmae: playerCharacters.drachmae }).from(playerCharacters).where(eq(playerCharacters.playerId, ctx.playerId)).limit(1);
  const wallet = charRows[0]?.drachmae ?? 0;

  // Project pending staff upkeep + food (whole days on the staff marker) so the
  // Ledger's "owed" reflects the OWNED-pop counterweight, not just building upkeep
  // (mirrors settleStaffing — wages/food on every owned pop, anchored to the earliest
  // active-building completion OR first pop hire).
  const popsC = getPopsContent();
  const popRows = await db.select().from(playerPops).where(eq(playerPops.ownerPlayerId, ctx.playerId));
  const ownedPops: Record<string, number> = Object.fromEntries(popRows.map((r) => [r.popType, r.count]));
  const staffMarker = byType.get(STAFF_TYPE);
  const staffAnchors = [...rows.filter((r) => isActive(r, now)).map((r) => r.completesAt.getTime()), ...popRows.filter((r) => r.count > 0).map((r) => r.createdAt.getTime())];
  const staffEarliest = staffAnchors.length ? Math.min(...staffAnchors) : now.getTime();
  const staffDays = wholeDaysBetween(staffMarker ? staffMarker.lastUpdatedAt.getTime() : staffEarliest, now.getTime());
  const staffUpkeepPending = popRows.reduce((s, r) => s + r.count * (popsC.pops[r.popType as PopType]?.upkeepPerDay ?? 0), 0) * staffDays;
  const foodPending = popRows.reduce((s, r) => s + r.count * (popsC.pops[r.popType as PopType]?.foodPerDay ?? 0), 0) * staffDays;
  const wheatAvail = Number(byType.get(popsC.foodGood)?.amount ?? 0) + (accrual.get(popsC.foodGood)?.banked ?? 0);
  const foodBand = c.vendor[popsC.foodGood];
  const foodBuyCost = foodBand ? Math.max(0, foodPending - wheatAvail) * vendorUnitPrice(foodBand, "buy", c.seasonal, goodCategoryFor(c.seasonal, popsC.foodGood), season) : 0;
  const owed = Math.max(0, upkeep + staffUpkeepPending + foodBuyCost - incomePending - wallet);

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
    pops: ownedPops,
  };
}

// --- Construction spend (Phase 3) --------------------------------------------
// Building/upgrading to a tier costs drachmae (the buildingCost curve, UNCHANGED)
// AND materials (def.buildCost.materials scaled by materialCostForTier), and
// requires the player to already OWN the staff (staffCountForTier per type) — pops
// are a prerequisite, never spent. Everything is validated BEFORE any debit, so a
// rejection mutates nothing; the debit runs inside the caller's transaction, so an
// unexpected mid-debit failure rolls the whole build back (no half-charged builds).

// Material bill (good -> qty) for a building at a tier, scaled on the curve.
function materialsForTier(def: ResolvedDef, tier: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [good, base] of Object.entries(def.buildCost?.materials ?? {})) out[good] = materialCostForTier(base, tier);
  return out;
}

type SpendError = { ok: false; code: number; error: string };

// Within a tx: validate wallet + materials + the owned-staff prerequisite, then
// debit drachmae + materials (pops untouched). Returns a SpendError to abort with
// nothing mutated, or null after a successful atomic debit. `goods` is the player's
// resource balances captured for the material checks; `owned` their pop counts.
async function chargeConstruction(
  tx: Exec,
  ctx: ActingContext,
  def: ResolvedDef,
  tier: number,
  drachmaeCost: number,
  now: Date,
): Promise<SpendError | null> {
  const charRows = await tx.select({ drachmae: playerCharacters.drachmae }).from(playerCharacters).where(eq(playerCharacters.playerId, ctx.playerId)).limit(1);
  const wallet = charRows[0]?.drachmae ?? 0;
  if (wallet < drachmaeCost) return { ok: false, code: 402, error: `You need ${drachmaeCost} drachmae for this — you have ${wallet}.` };

  const need = materialsForTier(def, tier);
  const balByType = new Map((await resourceRows(tx, ctx.playerId)).map((r) => [r.type, Number(r.amount)]));
  for (const [good, qty] of Object.entries(need)) {
    const have = balByType.get(good) ?? 0;
    if (have < qty) return { ok: false, code: 402, error: `You need ${qty} ${good} for this — you have ${Math.floor(have)} (short ${Math.ceil(qty - have)}).` };
  }

  const owned = await popCountsFor(tx, ctx.playerId);
  for (const [type, qty] of Object.entries(staffNeed(def, tier)) as [PopType, number][]) {
    const have = owned[type] ?? 0;
    if (have < qty) return { ok: false, code: 409, error: `You must own ${qty} ${type} to staff this — you have ${have}. Hire more first.` };
  }

  // All checks passed → debit drachmae + every material (pops are NOT consumed).
  await tx.update(playerCharacters).set({ drachmae: wallet - drachmaeCost }).where(eq(playerCharacters.playerId, ctx.playerId));
  for (const [good, qty] of Object.entries(need)) {
    if (qty <= 0) continue;
    const row = await getOrCreateResource(tx, ctx.playerId, good, now);
    await tx.update(resources).set({ amount: String(Number(row.amount) - qty) }).where(eq(resources.id, row.id));
  }
  return null;
}

// --- Build / upgrade ---------------------------------------------------------

export type BuildResult = { ok: false; code: number; error: string } | { ok: true; buildingId: string; tier: number; completesAt: string; cost: number; materials: Record<string, number> };

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
    // Validate + atomically debit drachmae + materials + assert the staff prereq.
    const spend = await chargeConstruction(tx, ctx, def, 1, cost, now);
    if (spend) return spend;
    await tx.insert(playerBuildings).values({ worldId: ctx.worldId, ownerPlayerId: ctx.playerId, buildingId, tier: 1, status: "constructing", completesAt });
    return { ok: true as const, buildingId, tier: 1, completesAt: completesAt.toISOString(), cost, materials: materialsForTier(def, 1) };
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
    // Scaled material bill + the HIGHER staff requirement for the next tier.
    const spend = await chargeConstruction(tx, ctx, def, nextTier, cost, now);
    if (spend) return spend;
    const completesAt = new Date(now.getTime() + buildMs(nextTier));
    await tx.update(playerBuildings).set({ tier: nextTier, status: "constructing", completesAt }).where(eq(playerBuildings.id, row.id));
    return { ok: true as const, buildingId, tier: nextTier, completesAt: completesAt.toISOString(), cost, materials: materialsForTier(def, nextTier) };
  });
}

// --- Hiring (POST /api/buildings/hire) ---------------------------------------
// Hire N pops of a type: debit hireCost × N (from pops.json) and increment the
// player_pops count. Atomic; rejects if the wallet is short. Pops are owned, not
// consumed — staffing/upkeep read this count. No sell-back/release in this phase.

export type HireResult =
  | { ok: false; code: number; error: string }
  | { ok: true; popType: string; hired: number; unitCost: number; total: number; wallet: number; owned: number };

export async function hirePops(ctx: ActingContext, popType: string, count: number, _now: Date): Promise<HireResult> {
  if (!Number.isInteger(count) || count <= 0) return { ok: false, code: 400, error: "Hire a whole, positive number of people." };
  const popsC = getPopsContent();
  const def = popsC.pops[popType as PopType];
  if (!def) return { ok: false, code: 404, error: "The agora hires no such people." };
  const total = def.hireCost * count;

  return db.transaction(async (tx) => {
    const charRows = await tx.select({ drachmae: playerCharacters.drachmae }).from(playerCharacters).where(eq(playerCharacters.playerId, ctx.playerId)).limit(1);
    const wallet = charRows[0]?.drachmae ?? 0;
    if (wallet < total) return { ok: false as const, code: 402, error: `Hiring ${count} ${popType} costs ${total} drachmae — you have ${wallet}.` };
    await tx.update(playerCharacters).set({ drachmae: wallet - total }).where(eq(playerCharacters.playerId, ctx.playerId));
    const existing = await tx
      .select()
      .from(playerPops)
      .where(and(eq(playerPops.worldId, ctx.worldId), eq(playerPops.ownerPlayerId, ctx.playerId), eq(playerPops.popType, popType)))
      .limit(1);
    let owned: number;
    if (existing[0]) {
      owned = existing[0].count + count;
      await tx.update(playerPops).set({ count: owned }).where(eq(playerPops.id, existing[0].id));
    } else {
      owned = count;
      await tx.insert(playerPops).values({ worldId: ctx.worldId, ownerPlayerId: ctx.playerId, popType, count });
    }
    return { ok: true as const, popType, hired: count, unitCost: def.hireCost, total, wallet: wallet - total, owned };
  });
}

// --- People market (GET /api/buildings/people) -------------------------------
// Read-only listing of the hireable pop types straight from content/people/pops.json
// (the hire action itself is POST /api/buildings/hire). No DB read.

export type PeopleView = {
  foodGood: string;
  pops: { type: string; label: string; hireCost: number; upkeepPerDay: number; foodPerDay: number; civic: boolean }[];
};

export function listPops(): PeopleView {
  const p = getPopsContent();
  return {
    foodGood: p.foodGood,
    pops: Object.entries(p.pops).map(([type, d]) => ({ type, label: d.label, hireCost: d.hireCost, upkeepPerDay: d.upkeepPerDay, foodPerDay: d.foodPerDay, civic: d.civic })),
  };
}

// --- Craft (POST /api/buildings/craft) ---------------------------------------
// Craft one of content.craft (trade-ship / galley): gate on the player owning the
// recipe's building at tier >= the recipe tier, then consume the recipe materials
// ATOMICALLY (validate-before-write, same as construction spend) and credit one
// crafted good to the ledger. Recipes come from content.craft only.

export type CraftResult =
  | { ok: false; code: number; error: string }
  | { ok: true; good: string; consumed: Record<string, number>; balance: number };

export async function craft(ctx: ActingContext, good: string, now: Date): Promise<CraftResult> {
  const c = getBuildingsContent();
  const recipe = c.craft?.[good];
  if (!recipe) return { ok: false, code: 404, error: "The yards craft no such thing." };

  return db.transaction(async (tx) => {
    // Gate: own the recipe's building at a high enough tier.
    const row = (await tx.select().from(playerBuildings).where(and(eq(playerBuildings.ownerPlayerId, ctx.playerId), eq(playerBuildings.buildingId, recipe.building))).limit(1))[0];
    if (!row) return { ok: false as const, code: 403, error: `You need a ${recipe.building} to craft a ${good}.` };
    if (row.tier < recipe.tier) return { ok: false as const, code: 409, error: `Crafting a ${good} needs your ${recipe.building} at tier ${recipe.tier} — yours is tier ${row.tier}.` };

    // Validate the whole recipe BEFORE consuming anything.
    const balByType = new Map((await resourceRows(tx, ctx.playerId)).map((r) => [r.type, Number(r.amount)]));
    for (const [g, qty] of Object.entries(recipe.recipe)) {
      const have = balByType.get(g) ?? 0;
      if (have < qty) return { ok: false as const, code: 402, error: `Crafting a ${good} needs ${qty} ${g} — you have ${Math.floor(have)} (short ${Math.ceil(qty - have)}).` };
    }

    // Consume the recipe, credit one crafted good.
    for (const [g, qty] of Object.entries(recipe.recipe)) {
      const r = await getOrCreateResource(tx, ctx.playerId, g, now);
      await tx.update(resources).set({ amount: String(Number(r.amount) - qty) }).where(eq(resources.id, r.id));
    }
    const out = await getOrCreateResource(tx, ctx.playerId, good, now);
    const balance = Number(out.amount) + 1;
    await tx.update(resources).set({ amount: String(balance) }).where(eq(resources.id, out.id));
    return { ok: true as const, good, consumed: recipe.recipe, balance };
  });
}

// --- Collect (POST /api/buildings/collect) ----------------------------------
// Sweep all owned buildings: bank goods into inventory, settle income − upkeep
// into the wallet (clamped, owed-flagged), and apply the shrine's flat composure.

export type CollectResult = {
  banked: Record<string, number>;
  income: number;
  upkeep: number; // building upkeep (drachmae)
  staffUpkeep: number; // pop wages (drachmae)
  foodDrawn: number; // food units pulled from wheat stock
  foodBought: number; // food units auto-bought from the NPC on shortfall
  foodCost: number; // drachmae paid for the auto-bought food
  collected: number; // net banked to the wallet from income − building upkeep (staff/food debited separately)
  owed: number; // total forgiven shortfall (building + staff + food)
  composure: number;
  idled: string[]; // building ids that idled this collect (under-staffed)
};

export async function collect(ctx: ActingContext, now: Date): Promise<CollectResult> {
  const result = await db.transaction(async (tx) => {
    const rows = await flipActivations(tx, await ownedRows(tx, ctx.playerId), now);
    // Resolve the shared-pool staffing ONCE, then drive every settle from it:
    // goods + income come only from staffed buildings; building upkeep from all.
    const idled = await staffingFor(tx, ctx, rows, now);
    const banked = await settleGoods(tx, ctx, rows, now, idled);
    const wallet = await settleWallet(tx, ctx, rows, now, idled);
    const staff = await settleStaffing(tx, ctx, rows, now); // owned-pop wages + food; after income is banked
    const composureDays = await settleShrine(tx, ctx, rows, idled, now);
    // Report idled buildings by their content id (not the row uuid) for consumers.
    const idledBuildings = rows.filter((r) => idled.has(r.id)).map((r) => r.buildingId);
    return { banked, wallet, staff, composureDays, idled: idledBuildings };
  });
  // Composure goes through the break-aware service (clamps to the cap), after tx.
  let composure = 0;
  if (result.composureDays > 0) {
    await applyComposureDelta(await characterIdFor(ctx.playerId), result.composureDays, "building:shrine", now);
    composure = result.composureDays;
  }
  return {
    banked: result.banked,
    income: result.wallet.income,
    upkeep: result.wallet.upkeep,
    staffUpkeep: result.staff.staffUpkeep,
    foodDrawn: result.staff.foodDrawn,
    foodBought: result.staff.foodBought,
    foodCost: result.staff.foodCost,
    collected: result.wallet.collected,
    owed: result.wallet.owed + result.staff.owed,
    composure,
    idled: result.idled,
  };
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
