import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { bandOffers, createDb, effectLog, playerCharacters, playerLevy, playerUnits, resources } from "@massalia/db";
import {
  bandDef,
  goodCategoryFor,
  parseBandsContent,
  parseShipsContent,
  parseUnitsContent,
  seasonAt,
  seasonIndexAt,
  seededRoll,
  unitDef,
  vendorUnitPrice,
  wholeDaysBetween,
  type BandsContent,
  type ShipsContent,
  type UnitsContent,
} from "@massalia/shared";
import { getBuildingsContent, settleAll, type ActingContext } from "./buildings.js";
import { applyComposureDelta } from "./composure.js";
import { lockPlayer } from "./lock.js";
import { getTopology } from "./mapGraph.js";

// ---------------------------------------------------------------------------
// Barracks — the player's army: trained UNITS raised from the levy and hired
// BANDS on seasonal contracts. Content lives in content/military/units.json and
// bands.json and reaches the client only through /api/barracks; nothing here is
// copied under apps/web/public.
//
// Unrelated to merc.ts (the Hoplite's personal contracts), which is untouched.
//
// Clock: one season = one real day; `season` is seasonIndexAt(now, worldStart).
// Every mutation (recruit / hire / disband) runs in one transaction that takes
// lockPlayer FIRST and settles the whole economy (settleAll, which includes
// settleBarracks) BEFORE changing the roster, so upkeep to now is charged at the
// roster that actually stood. Every stock, wallet and levy write is relative and
// guarded, with the affected row count checked — the buildings.ts discipline.
// Every roll goes through seededRoll; Math.random is not used in this system.
// ---------------------------------------------------------------------------

const db = createDb();
type DbTx = Parameters<Parameters<ReturnType<typeof createDb>["transaction"]>[0]>[0];
type Exec = DbTx | typeof db;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const unitsFile = path.join(repoRoot, "content/military/units.json");
const bandsFile = path.join(repoRoot, "content/military/bands.json");
const shipsFile = path.join(repoRoot, "content/military/ships.json");

const MS_PER_DAY = 86_400_000;
// The whole-day upkeep marker (a `resources` row carrying only lastUpdatedAt),
// the same mechanics as buildings.ts's STAFF_TYPE marker.
const UPKEEP_TYPE = "barracks_upkeep";
// Insolvency removal order for trained rows: most expensive to raise first.
const TRAINED_REMOVAL_ORDER = ["hippeis", "hoplite", "ekdromos", "peltast"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let units: UnitsContent | null = null;
let bands: BandsContent | null = null;
let ships: ShipsContent | null = null;

// --- Content -----------------------------------------------------------------

// Validate the three catalogues at boot (fail fast on a malformed file);
// memoized. Gear, upkeep and ship ids are checked against the buildings.json
// vendor list, so loadBuildingsContent() must have run first.
export async function loadBarracksContent(): Promise<{ units: UnitsContent; bands: BandsContent; ships: ShipsContent }> {
  const goods = Object.keys(getBuildingsContent().vendor);
  units = parseUnitsContent(JSON.parse(await fs.readFile(unitsFile, "utf8")), goods);
  bands = parseBandsContent(JSON.parse(await fs.readFile(bandsFile, "utf8")), goods);
  ships = parseShipsContent(JSON.parse(await fs.readFile(shipsFile, "utf8")), goods);
  return { units, bands, ships };
}

export function getUnitsContent(): UnitsContent {
  if (!units) throw new Error("Units content not loaded. Call loadBarracksContent() at boot.");
  return units;
}

export function getBandsContent(): BandsContent {
  if (!bands) throw new Error("Bands content not loaded. Call loadBarracksContent() at boot.");
  return bands;
}

export function getShipsContent(): ShipsContent {
  if (!ships) throw new Error("Ships content not loaded. Call loadBarracksContent() at boot.");
  return ships;
}

// Where recruits and hires stand: the Massalia region, from the topology.
function massaliaRegionId(): string {
  return getTopology().massaliaRegion;
}

// --- Helpers (3a) ------------------------------------------------------------

export type UnitRow = typeof playerUnits.$inferSelect;
export type LevyRow = typeof playerLevy.$inferSelect;

// Trained rows are active once training completes (ready_at reached); band rows
// are always active. Timers are durations from the action, not season boundaries.
export function isActive(row: Pick<UnitRow, "source" | "readyAt">, now: Date): boolean {
  if (row.source === "band") return true;
  return row.readyAt !== null && now.getTime() >= row.readyAt.getTime();
}

// A wait, for refusal messages: "22h 14m", "45m", or "less than a minute".
function remainingText(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 1) return "less than a minute";
  const h = Math.floor(minutes / 60);
  const mm = minutes % 60;
  return h > 0 ? `${h}h ${mm}m` : `${mm}m`;
}

export function seasonFor(ctx: ActingContext, now: Date): number {
  return seasonIndexAt(now.getTime(), ctx.worldStartedMs);
}

function renewChance(bandId: string): number {
  return bandDef(getBandsContent(), bandId)?.renew ?? getBandsContent().contract.renewDefault;
}

async function ownedUnitRows(exec: Exec, ctx: ActingContext): Promise<UnitRow[]> {
  return exec
    .select()
    .from(playerUnits)
    .where(and(eq(playerUnits.worldId, ctx.worldId), eq(playerUnits.ownerPlayerId, ctx.playerId)))
    .orderBy(asc(playerUnits.createdAt), asc(playerUnits.id));
}

async function characterIdFor(exec: Exec, playerId: string): Promise<string> {
  const rows = await exec.select({ id: playerCharacters.id }).from(playerCharacters).where(eq(playerCharacters.playerId, playerId)).limit(1);
  if (!rows[0]) throw new Error("barracks: player has no character");
  return rows[0].id;
}

async function readWallet(exec: Exec, playerId: string): Promise<number> {
  const rows = await exec.select({ drachmae: playerCharacters.drachmae }).from(playerCharacters).where(eq(playerCharacters.playerId, playerId)).limit(1);
  return rows[0]?.drachmae ?? 0;
}

type ResourceRow = typeof resources.$inferSelect;

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

// Guarded relative stock debit; false when the stock is short (nothing written).
async function debitResource(exec: Exec, rowId: string, qty: number): Promise<boolean> {
  const rows = await exec
    .update(resources)
    .set({ amount: sql`${resources.amount} - ${String(qty)}::numeric` })
    .where(and(eq(resources.id, rowId), gte(resources.amount, String(qty))))
    .returning({ id: resources.id });
  return rows.length > 0;
}

async function logEffect(exec: Exec, characterId: string, kind: string, detail: Record<string, unknown>): Promise<void> {
  await exec.insert(effectLog).values({ characterId, kind, detail });
}

// The militia gate, read from player_characters.militia.
export type GateView = { stat: "militia"; required: number; current: number; met: boolean };

export async function gateFor(exec: Exec, ctx: ActingContext): Promise<GateView> {
  const required = getUnitsContent().gate.militia;
  const rows = await exec.select({ militia: playerCharacters.militia }).from(playerCharacters).where(eq(playerCharacters.playerId, ctx.playerId)).limit(1);
  const current = rows[0]?.militia ?? 0;
  return { stat: "militia", required, current, met: current >= required };
}

// --- Levy (3b) ---------------------------------------------------------------
// The player's own manpower pool. Growth accrues from world start whether or not
// the tab was ever opened, applied closed-form: +growthPerYear every
// seasonsPerYear seasons, anchored on last_growth_season (always a year boundary).

export async function ensureLevy(exec: Exec, ctx: ActingContext, season: number): Promise<LevyRow> {
  const { levy } = getUnitsContent();
  const where = and(eq(playerLevy.worldId, ctx.worldId), eq(playerLevy.ownerPlayerId, ctx.playerId));
  const existing = (await exec.select().from(playerLevy).where(where).limit(1))[0];
  if (!existing) {
    const years = Math.floor(season / levy.seasonsPerYear);
    const inserted = await exec
      .insert(playerLevy)
      .values({ worldId: ctx.worldId, ownerPlayerId: ctx.playerId, men: levy.startMen + levy.growthPerYear * years, lastGrowthSeason: years * levy.seasonsPerYear })
      .onConflictDoNothing()
      .returning();
    if (inserted[0]) return inserted[0];
    return (await exec.select().from(playerLevy).where(where).limit(1))[0]!;
  }
  const years = Math.floor((season - existing.lastGrowthSeason) / levy.seasonsPerYear);
  if (years <= 0) return existing;
  const grown = await exec
    .update(playerLevy)
    .set({
      men: sql`${playerLevy.men} + ${years * levy.growthPerYear}`,
      lastGrowthSeason: sql`${playerLevy.lastGrowthSeason} + ${years * levy.seasonsPerYear}`,
    })
    .where(where)
    .returning();
  return grown[0]!;
}

// Relative credit (disband / insolvency return men to the pool).
async function levyReturn(exec: Exec, ctx: ActingContext, men: number): Promise<void> {
  await exec
    .update(playerLevy)
    .set({ men: sql`${playerLevy.men} + ${men}` })
    .where(and(eq(playerLevy.worldId, ctx.worldId), eq(playerLevy.ownerPlayerId, ctx.playerId)));
}

// Guarded relative draw; false when the pool is short (nothing written).
async function levyDraw(exec: Exec, ctx: ActingContext, men: number): Promise<boolean> {
  const rows = await exec
    .update(playerLevy)
    .set({ men: sql`${playerLevy.men} - ${men}` })
    .where(and(eq(playerLevy.worldId, ctx.worldId), eq(playerLevy.ownerPlayerId, ctx.playerId), gte(playerLevy.men, men)))
    .returning({ men: playerLevy.men });
  return rows.length > 0;
}

// --- Offers (3f) -------------------------------------------------------------
// The per-player, per-season market. Rolled once: if any band_offers row exists
// for (world, player, season) nothing happens. Otherwise pick offersPerSeason ids
// from the sorted catalogue minus the bands the player currently holds, drawing
// seededRoll([worldId, playerId, season, i]) over the remaining list each time —
// the same inputs always give the same three, so a re-login never rerolls.

export async function rollOffers(exec: Exec, ctx: ActingContext, season: number): Promise<void> {
  const c = getBandsContent();
  const existing = await exec
    .select({ bandId: bandOffers.bandId })
    .from(bandOffers)
    .where(and(eq(bandOffers.worldId, ctx.worldId), eq(bandOffers.ownerPlayerId, ctx.playerId), eq(bandOffers.seasonIndex, season)))
    .limit(1);
  if (existing.length) return;
  const held = new Set((await ownedUnitRows(exec, ctx)).filter((r) => r.source === "band").map((r) => r.unitId));
  const remaining = Object.keys(c.bands)
    .filter((id) => !held.has(id))
    .sort();
  const picks: string[] = [];
  for (let i = 0; i < c.market.offersPerSeason && remaining.length > 0; i++) {
    const idx = Math.floor(seededRoll([ctx.worldId, ctx.playerId, String(season), String(i)]) * remaining.length);
    picks.push(remaining.splice(idx, 1)[0]!);
  }
  if (picks.length === 0) return;
  await exec
    .insert(bandOffers)
    .values(picks.map((bandId) => ({ worldId: ctx.worldId, ownerPlayerId: ctx.playerId, seasonIndex: season, bandId })))
    .onConflictDoNothing();
}

export type OfferRow = typeof bandOffers.$inferSelect;

export async function offersFor(exec: Exec, ctx: ActingContext, season: number): Promise<OfferRow[]> {
  return exec
    .select()
    .from(bandOffers)
    .where(and(eq(bandOffers.worldId, ctx.worldId), eq(bandOffers.ownerPlayerId, ctx.playerId), eq(bandOffers.seasonIndex, season)))
    .orderBy(asc(bandOffers.bandId));
}

// --- Settle (3g) -------------------------------------------------------------
// Whole-day upkeep on its own marker, run from settleAll right after the
// household (settleStaffing). Per whole day, every row owes its upkeep for the
// days it stood ready: a band from hire, a trained row only for whole days after
// ready_at (rowDays below). Trained rows pay per man (× count), bands per band.
// Goods come from stock first; the shortfall is auto-bought at the seasonal
// vendor price like pop food. Bands additionally cost drachmae directly. If the
// gap's total exceeds the wallet, rows are disbanded until it fits (bands by
// drachmae desc, then trained by hippeis > hoplite > ekdromos > peltast; trained
// men return to the levy). Then band contracts whose contract_end_at has passed
// roll for renewal.

export type BarracksDisband = { rowId: string; unitId: string; source: "trained" | "band"; count: number };
export type BarracksSettle = {
  days: number;
  drachmaeDirect: number; // band pay over the gap
  purchases: number; // drachmae spent auto-buying short goods
  cost: number; // drachmaeDirect + purchases, rounded — what the wallet was asked for
  owed: number; // the clamped shortfall (forgiven), 0 unless every row was already gone
  drawn: Record<string, number>; // goods taken from stock
  bought: Record<string, number>; // goods auto-bought
  insolvent: BarracksDisband[]; // rows removed for insolvency, in removal order
  renewed: string[]; // band row ids whose contract extended
  departed: BarracksDisband[]; // band rows whose contract ended without renewal
  arrived: BarracksDisband[]; // rows whose relocation completed (now based at moving_to)
};

const emptySettle = (): BarracksSettle => ({ days: 0, drachmaeDirect: 0, purchases: 0, cost: 0, owed: 0, drawn: {}, bought: {}, insolvent: [], renewed: [], departed: [], arrived: [] });

type UpkeepPlan = { drachmaeDirect: number; purchases: number; cost: number; draws: Record<string, number>; buys: Record<string, number> };

// Removal order under insolvency, among the rows that owe anything this gap
// (`chargeable`): bands by drachmae/day descending (ties by id), then trained
// rows in TRAINED_REMOVAL_ORDER (ties by age, oldest first).
function nextInsolvencyVictim(live: UnitRow[], chargeable: (r: UnitRow) => boolean): UnitRow | null {
  const active = live.filter(chargeable);
  const bandsC = getBandsContent();
  const bandRows = active
    .filter((r) => r.source === "band")
    .sort((a, b) => {
      const pay = (r: UnitRow) => bandDef(bandsC, r.unitId)?.upkeepPerDay.drachmae ?? 0;
      return pay(b) - pay(a) || a.unitId.localeCompare(b.unitId) || a.id.localeCompare(b.id);
    });
  if (bandRows[0]) return bandRows[0];
  const rank = (r: UnitRow) => {
    const i = TRAINED_REMOVAL_ORDER.indexOf(r.unitId);
    return i < 0 ? TRAINED_REMOVAL_ORDER.length : i;
  };
  const trained = active.filter((r) => r.source === "trained").sort((a, b) => rank(a) - rank(b) || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  return trained[0] ?? null;
}

export async function settleBarracks(exec: Exec, ctx: ActingContext, now: Date): Promise<BarracksSettle> {
  const unitsC = getUnitsContent();
  const bandsC = getBandsContent();
  const c = getBuildingsContent();
  const season = seasonFor(ctx, now);
  const out = emptySettle();

  // 1. Levy growth owed since the last year boundary.
  await ensureLevy(exec, ctx, season);

  let rows = await ownedUnitRows(exec, ctx);
  const marker = (
    await exec.select().from(resources).where(and(eq(resources.scope, "player"), eq(resources.scopeId, ctx.playerId), eq(resources.type, UPKEEP_TYPE))).limit(1)
  )[0];
  // First-settle anchor: the earliest row the player ever raised (created_at is
  // stamped with the request clock on recruit/hire, so the anchor and the settle
  // run on one clock). No rows and no marker means no army has ever stood —
  // nothing to do, and no clock is started.
  if (!marker && rows.length === 0) return out;
  const lastMs = marker ? marker.lastUpdatedAt.getTime() : Math.min(...rows.map((r) => r.createdAt.getTime()));

  // 2. Whole days owed; a partial day carries on the marker.
  const days = wholeDaysBetween(lastMs, now.getTime());
  out.days = days;
  const characterId = await characterIdFor(exec, ctx.playerId);

  if (days > 0) {
    const seasonName = seasonAt(now.getTime(), ctx.worldStartedMs);
    const buyPrice = (good: string): number => {
      const band = c.vendor[good];
      return band ? vendorUnitPrice(band, "buy", c.seasonal, goodCategoryFor(c.seasonal, good), seasonName) : 0;
    };
    // Stock snapshot for every good any row could ask for (read under the caller's lock).
    const goods = new Set<string>();
    for (const r of rows) {
      const def = r.source === "trained" ? unitDef(unitsC, r.unitId) : bandDef(bandsC, r.unitId);
      for (const g of Object.keys(def?.upkeepPerDay ?? {})) if (g !== "drachmae") goods.add(g);
    }
    const stock = new Map<string, { rowId: string; amount: number }>();
    for (const g of goods) {
      const row = await getOrCreateResource(exec, ctx.playerId, g, now);
      stock.set(g, { rowId: row.id, amount: Number(row.amount) });
    }

    // 3. Per-row chargeable days within this gap. A band owes every day; a trained
    // row owes only the whole days after ready_at (0 while still training). The
    // gap is [lastMs, now): days since max(lastMs, readyAt), capped at `days`.
    const nowMs = now.getTime();
    const rowDays = (r: UnitRow): number => {
      if (r.source === "band") return days;
      if (r.readyAt === null) return 0;
      const readyMs = r.readyAt.getTime();
      if (readyMs > nowMs) return 0;
      return Math.min(days, wholeDaysBetween(Math.max(lastMs, readyMs), nowMs));
    };
    const chargeable = (r: UnitRow) => rowDays(r) > 0;

    // 4. Demand across the rows, each × its own rowDays, then how much of each
    // good stock covers and what the shortfall costs at the vendor. Pure — it is
    // re-run after each insolvency removal and only applied once at the end.
    const plan = (live: UnitRow[]): UpkeepPlan => {
      let drachmaeDirect = 0;
      const demand: Record<string, number> = {};
      for (const r of live) {
        const d = rowDays(r);
        if (d <= 0) continue;
        if (r.source === "trained") {
          const def = unitDef(unitsC, r.unitId);
          if (!def) continue;
          for (const [g, q] of Object.entries(def.upkeepPerDay)) demand[g] = (demand[g] ?? 0) + q * r.count * d;
        } else {
          const def = bandDef(bandsC, r.unitId);
          if (!def) continue;
          for (const [g, q] of Object.entries(def.upkeepPerDay)) {
            if (g === "drachmae") drachmaeDirect += q * d;
            else demand[g] = (demand[g] ?? 0) + q * d; // per band, not × count
          }
        }
      }
      const draws: Record<string, number> = {};
      const buys: Record<string, number> = {};
      let purchases = 0;
      for (const [g, need] of Object.entries(demand)) {
        const drawn = Math.min(stock.get(g)?.amount ?? 0, need);
        if (drawn > 0) draws[g] = drawn;
        const short = need - drawn;
        if (short > 0) {
          buys[g] = short;
          purchases += short * buyPrice(g);
        }
      }
      return { drachmaeDirect, purchases, cost: drachmaeDirect + purchases, draws, buys };
    };

    // 5. Insolvency: while the gap's total exceeds the wallet, disband and re-plan.
    // A removed row's whole gap is dropped from the bill even though its men
    // served the days before they walked — the accepted v1 approximation (the
    // kept rows are charged for the full gap; the removed ones for none of it).
    let live = rows;
    let p = plan(live);
    const wallet = await readWallet(exec, ctx.playerId);
    while (Math.round(p.cost) > wallet) {
      const victim = nextInsolvencyVictim(live, chargeable);
      if (!victim) break;
      live = live.filter((r) => r.id !== victim.id);
      await exec.delete(playerUnits).where(eq(playerUnits.id, victim.id));
      if (victim.source === "trained") await levyReturn(exec, ctx, victim.count);
      await logEffect(exec, characterId, "barracks_disband", { unitId: victim.unitId, count: victim.count, source: "insolvency" });
      out.insolvent.push({ rowId: victim.id, unitId: victim.unitId, source: victim.source, count: victim.count });
      p = plan(live);
    }
    rows = live;

    // Apply the surviving plan: guarded stock draws, then the wallet — relative and
    // clamped at 0 as settleStaffing does; `owed` reports the forgiven remainder.
    for (const [g, drawn] of Object.entries(p.draws)) {
      if (!(await debitResource(exec, stock.get(g)!.rowId, drawn))) throw new Error(`barracks: stock draw of ${drawn} ${g} failed under lock`);
    }
    const cost = Math.round(p.cost);
    if (cost > 0) {
      out.owed = Math.max(0, cost - wallet);
      await exec
        .update(playerCharacters)
        .set({ drachmae: sql`GREATEST(0, ${playerCharacters.drachmae} - ${cost})` })
        .where(eq(playerCharacters.playerId, ctx.playerId));
    }
    out.drachmaeDirect = p.drachmaeDirect;
    out.purchases = Math.round(p.purchases);
    out.cost = cost;
    out.drawn = p.draws;
    out.bought = p.buys;
  }

  // 6. Contract ends. A band whose contract_end_at has passed rolls
  // seededRoll([rowId, endMs]) against its renew chance: under it the contract
  // extends by termSeasons days (and rolls again if that end has also passed — a
  // long absence resolves every term in turn, each on its own seed); otherwise
  // the band leaves.
  const termMs = bandsC.contract.termSeasons * MS_PER_DAY;
  for (const r of rows) {
    if (r.source !== "band" || r.contractEndAt === null) continue;
    const startMs = r.contractEndAt.getTime();
    let end = startMs;
    let stays = true;
    while (stays && end <= now.getTime()) {
      if (seededRoll([r.id, String(end)]) < renewChance(r.unitId)) {
        end += termMs;
        await logEffect(exec, characterId, "barracks_renew", { bandId: r.unitId, count: r.count, contractEndAt: new Date(end).toISOString(), source: "barracks" });
      } else {
        stays = false;
      }
    }
    if (!stays) {
      await exec.delete(playerUnits).where(eq(playerUnits.id, r.id));
      await logEffect(exec, characterId, "barracks_disband", { unitId: r.unitId, count: r.count, source: "contract_end" });
      out.departed.push({ rowId: r.id, unitId: r.unitId, source: "band", count: r.count });
    } else if (end !== startMs) {
      await exec.update(playerUnits).set({ contractEndAt: new Date(end) }).where(eq(playerUnits.id, r.id));
      out.renewed.push(r.id);
    }
  }

  // 6b. Arrivals. A row mid-relocation whose arrives_at has passed now stands at
  // its destination. Nothing starts a move yet; the resolution is here so the
  // relocation prompt only adds the start.
  for (const r of rows) {
    if (r.movingTo === null || r.arrivesAt === null || r.arrivesAt.getTime() > now.getTime()) continue;
    await exec.update(playerUnits).set({ basedAt: r.movingTo, movingTo: null, arrivesAt: null }).where(eq(playerUnits.id, r.id));
    await logEffect(exec, characterId, "barracks_arrive", { unitId: r.unitId, count: r.count, from: r.basedAt, to: r.movingTo, source: "barracks" });
    out.arrived.push({ rowId: r.id, unitId: r.unitId, source: r.source, count: r.count });
  }

  // 7. Advance the marker by the whole days consumed (or create it at the anchor
  // advanced the same way) so the partial-day remainder carries.
  const advancedMs = lastMs + days * MS_PER_DAY;
  if (marker) await exec.update(resources).set({ lastUpdatedAt: new Date(advancedMs) }).where(eq(resources.id, marker.id));
  else await exec.insert(resources).values({ scope: "player", scopeId: ctx.playerId, type: UPKEEP_TYPE, amount: "0", ratePerSecond: "0", lastUpdatedAt: new Date(advancedMs) });
  return out;
}

// --- Mutations (3c, 3d, 3e) --------------------------------------------------
// One locked transaction each: lock → settleAll (history banks at the roster that
// stood) → checks → guarded writes → effect_log. Banked shrine composure from the
// settle is applied AFTER the transaction, break-aware, exactly as hirePops does.

type Failure = { ok: false; code: number; error: string };
type Outcome<T> = { composureDays: number; result: T | Failure };

async function mutate<T>(ctx: ActingContext, now: Date, fn: (tx: DbTx, composureDays: number) => Promise<Outcome<T>>): Promise<T | Failure> {
  const outcome = await db.transaction(async (tx) => {
    await lockPlayer(tx, ctx.playerId);
    const settled = await settleAll(tx, ctx, now);
    return fn(tx, settled.composureDays);
  });
  if (outcome.composureDays > 0) await applyComposureDelta(await characterIdFor(db, ctx.playerId), outcome.composureDays, "building:shrine", now);
  return outcome.result;
}

export type RecruitResult = Failure | { ok: true; rowId: string; unitId: string; count: number; readyAt: string; levy: number };

export async function recruitUnits(ctx: ActingContext, unitId: string, count: number, now: Date): Promise<RecruitResult> {
  const def = unitDef(getUnitsContent(), unitId);
  if (!def) return { ok: false, code: 404, error: "The barracks trains no such unit." };
  if (!Number.isInteger(count) || count <= 0) return { ok: false, code: 400, error: "Recruit a whole, positive number of men." };
  return mutate<RecruitResult>(ctx, now, async (tx, composureDays) => {
    const fail = (code: number, error: string): Outcome<RecruitResult> => ({ composureDays, result: { ok: false, code, error } });
    const gate = await gateFor(tx, ctx);
    if (!gate.met) return fail(403, `Militia ${gate.required} required.`);
    const season = seasonFor(ctx, now);
    const levy = await ensureLevy(tx, ctx, season);
    if (levy.men < count) return fail(409, `The levy can spare ${levy.men} men; you asked for ${count}.`);
    // Materials: read every stock row first; a single shortfall rejects the whole
    // order with nothing debited. Then guarded debits — a failure here (impossible
    // under the lock) throws and rolls the transaction back.
    const needs = Object.entries(def.gear).map(([good, qty]) => ({ good, qty: qty * count }));
    const stock = new Map<string, ResourceRow>();
    const short: string[] = [];
    for (const n of needs) {
      const row = await getOrCreateResource(tx, ctx.playerId, n.good, now);
      stock.set(n.good, row);
      const have = Number(row.amount);
      if (have < n.qty) short.push(`${n.qty - have} ${n.good}`);
    }
    if (short.length) return fail(409, `Short of ${short.join(", ")}.`);
    for (const n of needs) {
      if (!(await debitResource(tx, stock.get(n.good)!.id, n.qty))) throw new Error(`barracks: gear debit of ${n.qty} ${n.good} failed under lock`);
    }
    // Training is a duration from this instant: ready_at = now + trainSeasons days.
    const readyAt = new Date(now.getTime() + def.trainSeasons * MS_PER_DAY);
    const inserted = (
      await tx
        .insert(playerUnits)
        .values({ worldId: ctx.worldId, ownerPlayerId: ctx.playerId, source: "trained", unitId, count, startCount: count, recruitedSeason: season, readyAt, contractEndAt: null, basedAt: massaliaRegionId(), createdAt: now })
        .returning()
    )[0]!;
    if (!(await levyDraw(tx, ctx, count))) throw new Error("barracks: levy draw failed under lock");
    await logEffect(tx, await characterIdFor(tx, ctx.playerId), "barracks_recruit", { unitId, count, readyAt: readyAt.toISOString(), source: "barracks" });
    return { composureDays, result: { ok: true, rowId: inserted.id, unitId, count, readyAt: readyAt.toISOString(), levy: levy.men - count } };
  });
}

export type HireResult = Failure | { ok: true; rowId: string; bandId: string; men: number; contractEndAt: string };

export async function hireBand(ctx: ActingContext, bandId: string, now: Date): Promise<HireResult> {
  const bandsC = getBandsContent();
  const def = bandDef(bandsC, bandId);
  if (!def) return { ok: false, code: 404, error: "No such band." };
  return mutate<HireResult>(ctx, now, async (tx, composureDays) => {
    const fail = (code: number, error: string): Outcome<HireResult> => ({ composureDays, result: { ok: false, code, error } });
    const season = seasonFor(ctx, now);
    await rollOffers(tx, ctx, season);
    const gate = await gateFor(tx, ctx);
    if (!gate.met) return fail(403, `Militia ${gate.required} required.`);
    const offer = (await offersFor(tx, ctx, season)).find((o) => o.bandId === bandId);
    if (!offer || offer.hired) return fail(404, "That band is not on offer this season.");
    const active = (await ownedUnitRows(tx, ctx)).filter((r) => r.source === "band").length;
    if (active >= bandsC.market.maxActiveBands) return fail(409, `You may keep ${bandsC.market.maxActiveBands} bands under contract at once.`);
    // Claim the offer first (conditional on hired = false, row count checked); a
    // lost claim applies nothing.
    const claimed = await tx
      .update(bandOffers)
      .set({ hired: true })
      .where(and(eq(bandOffers.worldId, ctx.worldId), eq(bandOffers.ownerPlayerId, ctx.playerId), eq(bandOffers.seasonIndex, season), eq(bandOffers.bandId, bandId), eq(bandOffers.hired, false)))
      .returning({ bandId: bandOffers.bandId });
    if (!claimed.length) return fail(409, "That band has already been taken.");
    // The contract is a duration from this instant: contract_end_at = now + termSeasons days.
    const contractEndAt = new Date(now.getTime() + bandsC.contract.termSeasons * MS_PER_DAY);
    const inserted = (
      await tx
        .insert(playerUnits)
        .values({ worldId: ctx.worldId, ownerPlayerId: ctx.playerId, source: "band", unitId: bandId, count: def.men, startCount: def.men, recruitedSeason: season, readyAt: null, contractEndAt, basedAt: massaliaRegionId(), createdAt: now })
        .returning()
    )[0]!;
    await logEffect(tx, await characterIdFor(tx, ctx.playerId), "barracks_hire", { bandId, men: def.men, contractEndAt: contractEndAt.toISOString(), source: "barracks" });
    return { composureDays, result: { ok: true, rowId: inserted.id, bandId, men: def.men, contractEndAt: contractEndAt.toISOString() } };
  });
}

// The instant a row may be released: created_at + minServiceSeasons days (trained)
// or + termSeasons days (band). Shared by disbandRow and the view's canDisband.
function releaseAtMs(row: Pick<UnitRow, "source" | "createdAt">, unitsC: UnitsContent, bandsC: BandsContent): number {
  const seasons = row.source === "trained" ? unitsC.minServiceSeasons : bandsC.contract.termSeasons;
  return row.createdAt.getTime() + seasons * MS_PER_DAY;
}

export type DisbandResult = Failure | { ok: true; rowId: string; unitId: string; source: "trained" | "band"; count: number; returnedToLevy: number };

export async function disbandRow(ctx: ActingContext, rowId: string, now: Date): Promise<DisbandResult> {
  if (!UUID_RE.test(rowId)) return { ok: false, code: 404, error: "No such unit." };
  const unitsC = getUnitsContent();
  const bandsC = getBandsContent();
  return mutate<DisbandResult>(ctx, now, async (tx, composureDays) => {
    const fail = (code: number, error: string): Outcome<DisbandResult> => ({ composureDays, result: { ok: false, code, error } });
    const row = (await ownedUnitRows(tx, ctx)).find((r) => r.id === rowId);
    if (!row) return fail(404, "No such unit.");
    // Service gates are elapsed time from the row's creation (the recruit / hire
    // instant): minServiceSeasons days for trained men, the first termSeasons days
    // for a band (the original contract_end_at, before any renewal).
    const earliestMs = releaseAtMs(row, unitsC, bandsC);
    if (now.getTime() < earliestMs) {
      const wait = remainingText(earliestMs - now.getTime());
      return row.source === "trained"
        ? fail(409, `Trained men serve at least ${unitsC.minServiceSeasons} seasons; ${wait} to go.`)
        : fail(409, `The band's first term has ${wait} to run.`);
    }
    const returnedToLevy = row.source === "trained" ? row.count : 0;
    if (returnedToLevy > 0) await levyReturn(tx, ctx, returnedToLevy);
    await tx.delete(playerUnits).where(eq(playerUnits.id, row.id));
    await logEffect(tx, await characterIdFor(tx, ctx.playerId), "barracks_disband", { unitId: row.unitId, count: row.count, source: "player" });
    return { composureDays, result: { ok: true, rowId: row.id, unitId: row.unitId, source: row.source, count: row.count, returnedToLevy } };
  });
}

// --- View (GET /api/barracks and every POST's success payload) ----------------
// One locked settle (settleAll, so the household and the barracks are both
// current), this season's offers rolled, then the read model. Below the gate the
// catalogue, roster and offers are still returned — the tab shows them behind
// the lock — and only the POSTs refuse.

export type UnitView = { id: string; label: string; icon: string; role: string; trainSeasons: number; gear: Record<string, number>; upkeepPerDay: Record<string, number>; stats: Record<string, number> };
export type RosterView = {
  id: string;
  source: "trained" | "band";
  unitId: string;
  label: string;
  icon: string;
  count: number;
  startCount: number;
  recruitedSeason: number;
  readyAt: string | null; // ISO; trained only
  contractEndAt: string | null; // ISO; band only
  basedAt: string; // region id the row stands in
  movingTo: string | null; // region id of a relocation in flight
  arrivesAt: string | null; // ISO; when that relocation completes
  active: boolean;
  canDisband: boolean;
};
export type OfferView = { id: string; label: string; icon: string; role: string; men: number; upkeepPerDay: Record<string, number>; stats: Record<string, number>; hired: boolean };
export type BarracksView = {
  gate: GateView;
  season: number;
  now: string; // server time (ISO) — countdowns anchor to this, not the device clock
  levy: { men: number };
  config: { minServiceSeasons: number; maxActiveBands: number; termSeasons: number };
  units: UnitView[];
  roster: RosterView[];
  offers: OfferView[];
  activeBands: number;
};

export async function barracksView(ctx: ActingContext, now: Date): Promise<BarracksView> {
  const unitsC = getUnitsContent();
  const bandsC = getBandsContent();
  const season = seasonFor(ctx, now);
  const view = await mutate<BarracksView>(ctx, now, async (tx, composureDays) => {
    await rollOffers(tx, ctx, season);
    const gate = await gateFor(tx, ctx);
    const levy = await ensureLevy(tx, ctx, season);
    const rows = await ownedUnitRows(tx, ctx);
    const offers = await offersFor(tx, ctx, season);
    const roster: RosterView[] = rows.map((r) => {
      const def = r.source === "trained" ? unitDef(unitsC, r.unitId) : bandDef(bandsC, r.unitId);
      return {
        id: r.id,
        source: r.source,
        unitId: r.unitId,
        label: def?.label ?? r.unitId,
        icon: def?.icon ?? "",
        count: r.count,
        startCount: r.startCount,
        recruitedSeason: r.recruitedSeason,
        readyAt: r.readyAt?.toISOString() ?? null,
        contractEndAt: r.contractEndAt?.toISOString() ?? null,
        basedAt: r.basedAt,
        movingTo: r.movingTo,
        arrivesAt: r.arrivesAt?.toISOString() ?? null,
        active: isActive(r, now),
        canDisband: gate.met && now.getTime() >= releaseAtMs(r, unitsC, bandsC),
      };
    });
    const result: BarracksView = {
      gate,
      season,
      now: now.toISOString(),
      levy: { men: levy.men },
      config: { minServiceSeasons: unitsC.minServiceSeasons, maxActiveBands: bandsC.market.maxActiveBands, termSeasons: bandsC.contract.termSeasons },
      units: Object.entries(unitsC.units).map(([id, u]) => ({ id, label: u.label, icon: u.icon, role: u.role, trainSeasons: u.trainSeasons, gear: u.gear, upkeepPerDay: u.upkeepPerDay, stats: u.stats })),
      roster,
      offers: offers.flatMap((o) => {
        const b = bandDef(bandsC, o.bandId);
        return b ? [{ id: o.bandId, label: b.label, icon: b.icon, role: b.role, men: b.men, upkeepPerDay: b.upkeepPerDay, stats: b.stats, hired: o.hired }] : [];
      }),
      activeBands: rows.filter((r) => r.source === "band").length,
    };
    return { composureDays, result };
  });
  if ("code" in view && "error" in view) throw new Error("unreachable: barracksView never fails");
  return view;
}
