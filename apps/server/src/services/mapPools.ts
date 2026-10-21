import { and, eq, sql } from "drizzle-orm";
import { createDb, loadRegionMilitaryContent, loadTownMilitaryContent, regionMilitary, townMilitary } from "@massalia/db";
import { regrownPool } from "@massalia/shared";
import { getBattleContent } from "./barracks.js";

// Region warband and town garrison pools (barracks prompts 3b, 3c; raids
// prompt 3). A townless region's warband, or a town's garrison, is the live NPC
// defender: it is reduced by battle casualties and regrows toward its content
// value by regen.warbandShare / regen.garrisonShare of that value per whole
// season (one a day), rounded up (strikes prompt 1), on a steady clock —
// closed-form on read, no tick (regrownPool). `updated_at` is the regrowth marker: a
// read that adds whole days moves it by exactly those days, so the part of a
// day carries over; a write onto a pool below its content value leaves it where
// it is (a fight below the full count leaves the clock running); a write onto a
// full pool (at or above its content value) starts it at the write, which is
// what a full pool's first loss does. A town's fleet is read as it stands (v1
// sinks no ships). Home-owned places are never read through this path (they
// are never targets).

type Db = ReturnType<typeof createDb>;
type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Exec = DbTx | Db;

const MS_PER_DAY = 86_400_000;

// A pool as a read at `at` finds it: below its content value it regrows by
// regrownPool over the whole days since its marker, and `days` is how far the
// marker moves. Every read of a pool goes through here, the persisting reads
// below and the map's peek alike, so they agree at any instant (Military 6a).
function regrownAt(stored: number, markerMs: number, base: number, at: Date, share: number): { value: number; days: number } {
  if (stored >= base) return { value: stored, days: 0 };
  const days = Math.floor(Math.max(0, at.getTime() - markerMs) / MS_PER_DAY);
  if (days <= 0) return { value: stored, days: 0 };
  return { value: regrownPool(stored, base, days, share), days };
}

let baseCache: Record<string, number> | null = null;

// The content warband of a townless region (region-military.json); 0 for an id
// the content does not list.
export async function regionBaseWarband(regionId: string): Promise<number> {
  if (!baseCache) {
    const content = await loadRegionMilitaryContent();
    baseCache = Object.fromEntries(Object.entries(content.regions).map(([id, r]) => [id, r.warband]));
  }
  return baseCache[regionId] ?? 0;
}

// The content owner of a townless region, or null when unlisted.
export async function regionContentOwner(regionId: string): Promise<string | null> {
  const content = await loadRegionMilitaryContent();
  return content.regions[regionId]?.owner ?? null;
}

// Read the region's warband with the regrowth applied and persisted:
// regrownPool(stored, base, whole seasons since updated_at, warbandShare) when
// the stored value is below base, the marker moved by exactly those whole days so
// the remainder carries over. A missing row (a world seeded before the region
// was listed) reads as the content value and is inserted.
export async function readRegionWarband(exec: Exec, worldId: string, regionId: string, now: Date): Promise<number> {
  const base = await regionBaseWarband(regionId);
  const row = (await exec.select().from(regionMilitary).where(and(eq(regionMilitary.worldId, worldId), eq(regionMilitary.regionId, regionId))).limit(1))[0];
  if (!row) {
    await exec.insert(regionMilitary).values({ worldId, regionId, warband: base, updatedAt: now }).onConflictDoNothing();
    return base;
  }
  const { value: regenerated, days } = regrownAt(row.warband, row.updatedAt.getTime(), base, now, getBattleContent().regen.warbandShare);
  if (days <= 0) return regenerated;
  await exec.update(regionMilitary).set({ warband: regenerated, updatedAt: new Date(row.updatedAt.getTime() + days * MS_PER_DAY) }).where(and(eq(regionMilitary.worldId, worldId), eq(regionMilitary.regionId, regionId)));
  return regenerated;
}

// The marker moves only on a write onto a full pool (the old row's value, at
// or above its content value: a full pool's first loss starts the clock), and
// never backwards (GREATEST in SQL): a muster's army writes at its arrival
// instant, which may be earlier than the pool's last write. A write onto a pool
// below its content value leaves the marker where it is. A fresh row's clock
// starts at the write.
export async function writeRegionWarband(exec: Exec, worldId: string, regionId: string, value: number, now: Date): Promise<void> {
  const v = Math.max(0, Math.floor(value));
  const base = await regionBaseWarband(regionId);
  const updated = await exec
    .update(regionMilitary)
    .set({ warband: v, updatedAt: sql`CASE WHEN ${regionMilitary.warband} >= ${base} THEN GREATEST(${regionMilitary.updatedAt}, ${now.toISOString()}::timestamptz) ELSE ${regionMilitary.updatedAt} END` })
    .where(and(eq(regionMilitary.worldId, worldId), eq(regionMilitary.regionId, regionId)))
    .returning({ regionId: regionMilitary.regionId });
  if (!updated.length) await exec.insert(regionMilitary).values({ worldId, regionId, warband: v, updatedAt: now }).onConflictDoNothing();
}

// --- Towns (3c) ---------------------------------------------------------------

let townBaseCache: Record<string, { garrison: number; pentekonters: number; triremes: number }> | null = null;

async function townContent(townId: string): Promise<{ garrison: number; pentekonters: number; triremes: number }> {
  if (!townBaseCache) {
    const content = await loadTownMilitaryContent();
    townBaseCache = Object.fromEntries(Object.entries(content.towns).map(([id, t]) => [id, { garrison: t.garrison, pentekonters: t.pentekonters, triremes: t.triremes }]));
  }
  return townBaseCache[townId] ?? { garrison: 0, pentekonters: 0, triremes: 0 };
}

// The content garrison of a town; 0 for an id the content does not list.
export async function townBaseGarrison(townId: string): Promise<number> {
  return (await townContent(townId)).garrison;
}

// The content owner of a town, or null when unlisted.
export async function townContentOwner(townId: string): Promise<string | null> {
  const content = await loadTownMilitaryContent();
  return content.towns[townId]?.owner ?? null;
}

async function townRow(exec: Exec, worldId: string, townId: string, now: Date) {
  const row = (await exec.select().from(townMilitary).where(and(eq(townMilitary.worldId, worldId), eq(townMilitary.townId, townId))).limit(1))[0];
  if (row) return row;
  const base = await townContent(townId);
  await exec.insert(townMilitary).values({ worldId, townId, ...base, updatedAt: now }).onConflictDoNothing();
  return { worldId, townId, ...base, updatedAt: now };
}

// Read the town's garrison with the regrowth applied and persisted, the
// warband's way: regrownPool(stored, base, whole seasons, garrisonShare) below
// base, the marker moved by those whole seasons.
export async function readTownGarrison(exec: Exec, worldId: string, townId: string, now: Date): Promise<number> {
  const base = await townBaseGarrison(townId);
  const row = await townRow(exec, worldId, townId, now);
  const { value: regenerated, days } = regrownAt(row.garrison, row.updatedAt.getTime(), base, now, getBattleContent().regen.garrisonShare);
  if (days <= 0) return regenerated;
  await exec.update(townMilitary).set({ garrison: regenerated, updatedAt: new Date(row.updatedAt.getTime() + days * MS_PER_DAY) }).where(and(eq(townMilitary.worldId, worldId), eq(townMilitary.townId, townId)));
  return regenerated;
}

export async function writeTownGarrison(exec: Exec, worldId: string, townId: string, value: number, now: Date): Promise<void> {
  const v = Math.max(0, Math.floor(value));
  const base = await townBaseGarrison(townId);
  // The content row is inserted first, so a first write on a fresh town also
  // starts the clock at the write; then the marker moves only on a write onto
  // a full pool and never backwards, as writeRegionWarband.
  await townRow(exec, worldId, townId, now);
  await exec
    .update(townMilitary)
    .set({ garrison: v, updatedAt: sql`CASE WHEN ${townMilitary.garrison} >= ${base} THEN GREATEST(${townMilitary.updatedAt}, ${now.toISOString()}::timestamptz) ELSE ${townMilitary.updatedAt} END` })
    .where(and(eq(townMilitary.worldId, worldId), eq(townMilitary.townId, townId)));
}

// The town's fleet as it stands (unchanged by battle in v1).
export async function readTownFleet(exec: Exec, worldId: string, townId: string, now: Date): Promise<{ pentekonters: number; triremes: number }> {
  const row = await townRow(exec, worldId, townId, now);
  return { pentekonters: row.pentekonters, triremes: row.triremes };
}

// Every pool row of the world as a read at `at` would find it, with its full
// strength, writing nothing (the map's alert, Military 6a): towns by town id,
// townless regions by region id. A place with no row is at its content value.
export type PeekedPool = { pool: number; full: number };
export async function peekPools(exec: Exec, worldId: string, at: Date): Promise<{ towns: Map<string, PeekedPool>; regions: Map<string, PeekedPool> }> {
  const regen = getBattleContent().regen;
  const towns = new Map<string, PeekedPool>();
  for (const row of await exec.select().from(townMilitary).where(eq(townMilitary.worldId, worldId))) {
    const full = await townBaseGarrison(row.townId);
    towns.set(row.townId, { pool: regrownAt(row.garrison, row.updatedAt.getTime(), full, at, regen.garrisonShare).value, full });
  }
  const regions = new Map<string, PeekedPool>();
  for (const row of await exec.select().from(regionMilitary).where(eq(regionMilitary.worldId, worldId))) {
    const full = await regionBaseWarband(row.regionId);
    regions.set(row.regionId, { pool: regrownAt(row.warband, row.updatedAt.getTime(), full, at, regen.warbandShare).value, full });
  }
  return { towns, regions };
}

// One place's pool as a read at `at` would find it, with its full strength,
// writing nothing: the alert's test of a single place (Military 6a). Beside it
// the pool's own clock as stored (its value, its marker, its regrowth share),
// which a raids march waiting out an alert counts from. A place with no row is
// at its content value, its clock not started (markerMs null).
export type PeekedClock = PeekedPool & { stored: number; markerMs: number | null; regenShare: number };
export async function peekPool(exec: Exec, worldId: string, place: { regionId: string; townId: string | null }, at: Date): Promise<PeekedClock> {
  const regen = getBattleContent().regen;
  if (place.townId !== null) {
    const full = await townBaseGarrison(place.townId);
    const row = (await exec.select().from(townMilitary).where(and(eq(townMilitary.worldId, worldId), eq(townMilitary.townId, place.townId))).limit(1))[0];
    if (!row) return { pool: full, full, stored: full, markerMs: null, regenShare: regen.garrisonShare };
    return { pool: regrownAt(row.garrison, row.updatedAt.getTime(), full, at, regen.garrisonShare).value, full, stored: row.garrison, markerMs: row.updatedAt.getTime(), regenShare: regen.garrisonShare };
  }
  const full = await regionBaseWarband(place.regionId);
  const row = (await exec.select().from(regionMilitary).where(and(eq(regionMilitary.worldId, worldId), eq(regionMilitary.regionId, place.regionId))).limit(1))[0];
  if (!row) return { pool: full, full, stored: full, markerMs: null, regenShare: regen.warbandShare };
  return { pool: regrownAt(row.warband, row.updatedAt.getTime(), full, at, regen.warbandShare).value, full, stored: row.warband, markerMs: row.updatedAt.getTime(), regenShare: regen.warbandShare };
}
