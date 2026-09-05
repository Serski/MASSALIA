import { createDb, ensureRegionMilitary, ensureTownMilitary } from "@massalia/db";
import { getActiveWorldId } from "./character.js";

// World 2 military pools — the boot seam. On every server start the active
// world's town_military / region_military rows are backfilled from content
// (ON CONFLICT DO NOTHING, so live pools are never overwritten). New worlds get
// the same rows from db:seed (packages/db/src/seed.ts). No action, combat or
// scouting logic lives here — infrastructure only.
const db = createDb();

export async function ensureMilitaryPools(): Promise<{ worldId: string | null; towns: number; regions: number }> {
  const worldId = await getActiveWorldId();
  if (!worldId) return { worldId: null, towns: 0, regions: 0 };
  const towns = await ensureTownMilitary(db, worldId);
  const regions = await ensureRegionMilitary(db, worldId);
  return { worldId, towns, regions };
}
