import { and, eq } from "drizzle-orm";
import { createDb, loadRegionMilitaryContent, regionMilitary } from "@massalia/db";
import { getBattleContent } from "./barracks.js";

// Region warband pools (barracks prompt 3b). A townless region's warband is the
// live NPC defender: it is reduced by battle casualties and regenerates lazily
// toward its content value at regen.warbandPerDay per whole day since the row
// was last written — closed-form on read, no tick. Home-owned regions are never
// read through this path (they are never targets).

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
