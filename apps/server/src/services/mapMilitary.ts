import { createDb, ensureRegionMilitary, ensureTownMilitary, loadRegionMilitaryContent, loadTownMilitaryContent } from "@massalia/db";
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

// The content owner of every town and townless region (polity ids from the
// military content files, themselves derived from politics2.json). Used by the
// read route's home rule. Loaded once and cached; content is static per deploy.
export type MilitaryOwners = { towns: Record<string, string>; regions: Record<string, string> };
let _owners: MilitaryOwners | null = null;
export async function loadMilitaryOwners(): Promise<MilitaryOwners> {
  if (_owners) return _owners;
  const [towns, regions] = await Promise.all([loadTownMilitaryContent(), loadRegionMilitaryContent()]);
  _owners = {
    towns: Object.fromEntries(Object.entries(towns.towns).map(([id, t]) => [id, t.owner])),
    regions: Object.fromEntries(Object.entries(regions.regions).map(([id, r]) => [id, r.owner])),
  };
  return _owners;
}
