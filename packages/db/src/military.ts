// World 2 military pools: the per-world town garrison/fleet and townless-region
// warband rows (migration 0049), seeded from the server-side content files
//   content/map/town-military.json    -> town_military   (105 towns)
//   content/map/region-military.json  -> region_military (49 townless regions)
// These files carry the SECRET numbers and must never be copied under
// apps/web/public (only population + walls are public). Both ensure-seeds are
// idempotent (ON CONFLICT DO NOTHING): existing pools are never overwritten, so a
// live world backfills its rows on the next boot without disturbing play.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DbHandle } from "./client.js";
import { regionMilitary, townMilitary } from "./schema.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const contentDir = path.join(repoRoot, "content/map");

export type TownMilitaryEntry = { owner: string; garrison: number; pentekonters: number; triremes: number };
export type RegionMilitaryEntry = { owner: string; warband: number };
export type TownMilitaryContent = { version: number; source: string; towns: Record<string, TownMilitaryEntry> };
export type RegionMilitaryContent = { version: number; source: string; regions: Record<string, RegionMilitaryEntry> };

function nonNegativeInt(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${where}: expected a non-negative integer, got ${String(value)}`);
  }
  return value;
}

export async function loadTownMilitaryContent(): Promise<TownMilitaryContent> {
  const raw = JSON.parse(await readFile(path.join(contentDir, "town-military.json"), "utf8")) as TownMilitaryContent;
  for (const [id, entry] of Object.entries(raw.towns)) {
    if (typeof entry.owner !== "string" || !entry.owner) throw new Error(`town-military.json ${id}: missing owner`);
    nonNegativeInt(entry.garrison, `town-military.json ${id}.garrison`);
    nonNegativeInt(entry.pentekonters, `town-military.json ${id}.pentekonters`);
    nonNegativeInt(entry.triremes, `town-military.json ${id}.triremes`);
  }
  return raw;
}

export async function loadRegionMilitaryContent(): Promise<RegionMilitaryContent> {
  const raw = JSON.parse(await readFile(path.join(contentDir, "region-military.json"), "utf8")) as RegionMilitaryContent;
  for (const [id, entry] of Object.entries(raw.regions)) {
    if (typeof entry.owner !== "string" || !entry.owner) throw new Error(`region-military.json ${id}: missing owner`);
    nonNegativeInt(entry.warband, `region-military.json ${id}.warband`);
  }
  return raw;
}

// Insert the world's town pools from content; rows already present are left
// untouched. Returns the number of towns in the content file (not rows inserted).
export async function ensureTownMilitary(db: DbHandle, worldId: string): Promise<number> {
  const content = await loadTownMilitaryContent();
  const values = Object.entries(content.towns).map(([townId, t]) => ({
    worldId,
    townId,
    garrison: t.garrison,
    pentekonters: t.pentekonters,
    triremes: t.triremes,
  }));
  if (values.length) await db.insert(townMilitary).values(values).onConflictDoNothing();
  return values.length;
}

// Same for the townless regions' warbands.
export async function ensureRegionMilitary(db: DbHandle, worldId: string): Promise<number> {
  const content = await loadRegionMilitaryContent();
  const values = Object.entries(content.regions).map(([regionId, r]) => ({ worldId, regionId, warband: r.warband }));
  if (values.length) await db.insert(regionMilitary).values(values).onConflictDoNothing();
  return values.length;
}
