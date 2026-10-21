import { alertLine, HOME_POLITY_ID, onAlert } from "@massalia/shared";
import { getBattleContent } from "./barracks.js";
import { listWorldHoldings } from "./holdings.js";
import { getTopology } from "./mapGraph.js";
import { loadMilitaryOwners } from "./mapMilitary.js";
import { regionDisplayName, townDisplayName } from "./mapNames.js";
import { peekPool, peekPools, type Exec } from "./mapPools.js";

// ---------------------------------------------------------------------------
// The alert (Military 6a, ruling 2) as the server reads it: a town's garrison,
// or a townless region's warband, read as the battle would read it at that
// instant (regrowth applied) and written nowhere, against its full strength
// and battle.json's alert.share, through the one shared test (onAlert). A place on alert takes
// no raid, a house's, a koinon's or the League's, and one on the road turns
// back when it arrives. Callers check holdings first: a held place is never on
// alert, and a raid on one is refused, or turns back, for being held.
// ---------------------------------------------------------------------------

export type AlertPlace = { regionId: string; townId: string | null };

export async function placeOnAlert(exec: Exec, worldId: string, place: AlertPlace, at: Date): Promise<boolean> {
  const { pool, full } = await peekPool(exec, worldId, place, at);
  return onAlert(pool, full, getBattleContent().alert.share);
}

// The place's alert line, by its display name: a town's gates, a land's herds.
export async function placeAlertLine(place: AlertPlace): Promise<string> {
  return place.townId !== null ? alertLine(await townDisplayName(place.townId), "town") : alertLine(await regionDisplayName(place.regionId), "land");
}

// Every place on alert at `at`, for the map (GET /military's flags, the
// reach's lines and the koinon's target list), writing nothing: every town and
// townless region a raid could be ordered at whose pool, read as a raid's
// would be at that instant (peekPools), is on alert. Never Massalia's own
// places, a region that answers to its towns, or a holding of anyone's.
export async function placesOnAlert(exec: Exec, worldId: string, at: Date): Promise<{ towns: string[]; regions: string[] }> {
  const share = getBattleContent().alert.share;
  const topology = getTopology();
  const owners = await loadMilitaryOwners();
  const home = new Set([topology.massaliaRegion, ...Object.entries(owners.regions).filter(([, o]) => o === HOME_POLITY_ID).map(([id]) => id)]);
  for (const [town, o] of Object.entries(owners.towns)) if (o === HOME_POLITY_ID) home.add(topology.townRegion.get(town) ?? "");
  const withTowns = new Set(topology.townRegion.values());
  const held = new Set((await listWorldHoldings(exec, worldId)).map((h) => h.townId || h.regionId));
  const pools = await peekPools(exec, worldId, at);
  const towns = [...pools.towns].filter(([id, p]) => topology.townRegion.has(id) && !home.has(topology.townRegion.get(id)!) && owners.towns[id] !== HOME_POLITY_ID && !held.has(id) && onAlert(p.pool, p.full, share)).map(([id]) => id);
  const regions = [...pools.regions].filter(([id, p]) => topology.land.has(id) && !home.has(id) && !withTowns.has(id) && !held.has(id) && onAlert(p.pool, p.full, share)).map(([id]) => id);
  return { towns: towns.sort(), regions: regions.sort() };
}

// The same places with their lines, by town and by townless region: what the
// map greys Raid with.
export async function alertLinesAt(exec: Exec, worldId: string, at: Date): Promise<{ towns: Record<string, string>; regions: Record<string, string> }> {
  const { towns, regions } = await placesOnAlert(exec, worldId, at);
  const out: { towns: Record<string, string>; regions: Record<string, string> } = { towns: {}, regions: {} };
  for (const id of towns) out.towns[id] = await placeAlertLine({ regionId: getTopology().townRegion.get(id)!, townId: id });
  for (const id of regions) out.regions[id] = await placeAlertLine({ regionId: id, townId: null });
  return out;
}
