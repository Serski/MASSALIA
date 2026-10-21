import { alertLine, onAlert } from "@massalia/shared";
import { getBattleContent } from "./barracks.js";
import { regionDisplayName, townDisplayName } from "./mapNames.js";
import { readRegionWarband, readTownGarrison, regionBaseWarband, townBaseGarrison, type Exec } from "./mapPools.js";

// ---------------------------------------------------------------------------
// The alert (Military 6a, ruling 2) as the server reads it: a town's garrison,
// or a townless region's warband, read as the battle would read it at that
// instant (regrowth applied), against its full strength and battle.json's
// alert.share, through the one shared test (onAlert). A place on alert takes
// no raid, a house's, a koinon's or the League's, and one on the road turns
// back when it arrives. Callers check holdings first: a held place is never on
// alert, and a raid on one is refused, or turns back, for being held.
// ---------------------------------------------------------------------------

export type AlertPlace = { regionId: string; townId: string | null };

export async function placeOnAlert(exec: Exec, worldId: string, place: AlertPlace, at: Date): Promise<boolean> {
  const share = getBattleContent().alert.share;
  if (place.townId !== null) return onAlert(await readTownGarrison(exec, worldId, place.townId, at), await townBaseGarrison(place.townId), share);
  return onAlert(await readRegionWarband(exec, worldId, place.regionId, at), await regionBaseWarband(place.regionId), share);
}

// The place's alert line, by its display name: a town's gates, a land's herds.
export async function placeAlertLine(place: AlertPlace): Promise<string> {
  return place.townId !== null ? alertLine(await townDisplayName(place.townId), "town") : alertLine(await regionDisplayName(place.regionId), "land");
}
