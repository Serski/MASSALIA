import { and, eq } from "drizzle-orm";
import { createDb, loadRegionMilitaryContent, loadTownMilitaryContent, regionMilitary, townMilitary } from "@massalia/db";
import { getBattleContent } from "./barracks.js";

// Region warband and town garrison pools (barracks prompts 3b, 3c). A townless
// region's warband, or a town's garrison, is the live NPC defender: it is
// reduced by battle casualties and regenerates lazily toward its content value
// at regen.warbandPerDay / regen.garrisonPerDay per whole day since the row was
// last written — closed-form on read, no tick. A town's fleet is read as it
// stands (v1 sinks no ships). Home-owned places are never read through this
// path (they are never targets).

type Db = ReturnType<typeof createDb>;
type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Exec = DbTx | Db;

const MS_PER_DAY = 86_400_000;

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

// Read the region's warband with lazy regeneration applied and persisted:
// min(base, stored + floor(days since updated_at) × warbandPerDay) when the
// stored value is below base. A missing row (a world seeded before the region
// was listed) reads as the content value and is inserted.
export async function readRegionWarband(exec: Exec, worldId: string, regionId: string, now: Date): Promise<number> {
  const base = await regionBaseWarband(regionId);
  const row = (await exec.select().from(regionMilitary).where(and(eq(regionMilitary.worldId, worldId), eq(regionMilitary.regionId, regionId))).limit(1))[0];
  if (!row) {
    await exec.insert(regionMilitary).values({ worldId, regionId, warband: base, updatedAt: now }).onConflictDoNothing();
    return base;
  }
  if (row.warband >= base) return row.warband;
  const days = Math.floor(Math.max(0, now.getTime() - row.updatedAt.getTime()) / MS_PER_DAY);
  if (days <= 0) return row.warband;
  const regenerated = Math.min(base, row.warband + days * getBattleContent().regen.warbandPerDay);
  await exec.update(regionMilitary).set({ warband: regenerated, updatedAt: now }).where(and(eq(regionMilitary.worldId, worldId), eq(regionMilitary.regionId, regionId)));
  return regenerated;
}

export async function writeRegionWarband(exec: Exec, worldId: string, regionId: string, value: number, now: Date): Promise<void> {
  const v = Math.max(0, Math.floor(value));
  const updated = await exec
    .update(regionMilitary)
    .set({ warband: v, updatedAt: now })
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

// Read the town's garrison with lazy regeneration applied and persisted, the
// warband's way: min(base, stored + floor(days) × garrisonPerDay) below base.
export async function readTownGarrison(exec: Exec, worldId: string, townId: string, now: Date): Promise<number> {
  const base = await townBaseGarrison(townId);
  const row = await townRow(exec, worldId, townId, now);
  if (row.garrison >= base) return row.garrison;
  const days = Math.floor(Math.max(0, now.getTime() - row.updatedAt.getTime()) / MS_PER_DAY);
  if (days <= 0) return row.garrison;
  const regenerated = Math.min(base, row.garrison + days * getBattleContent().regen.garrisonPerDay);
  await exec.update(townMilitary).set({ garrison: regenerated, updatedAt: now }).where(and(eq(townMilitary.worldId, worldId), eq(townMilitary.townId, townId)));
  return regenerated;
}

export async function writeTownGarrison(exec: Exec, worldId: string, townId: string, value: number, now: Date): Promise<void> {
  const v = Math.max(0, Math.floor(value));
  await townRow(exec, worldId, townId, now);
  await exec.update(townMilitary).set({ garrison: v, updatedAt: now }).where(and(eq(townMilitary.worldId, worldId), eq(townMilitary.townId, townId)));
}

// The town's fleet as it stands (unchanged by battle in v1).
export async function readTownFleet(exec: Exec, worldId: string, townId: string, now: Date): Promise<{ pentekonters: number; triremes: number }> {
  const row = await townRow(exec, worldId, townId, now);
  return { pentekonters: row.pentekonters, triremes: row.triremes };
}
