// The war-system SEAM for map conquest. Everything the real war/diplomacy system
// will own lives behind these two functions and NOTHING else references the rules
// directly — swap the bodies, keep the signatures, and the conquest endpoint is
// done. Both are deliberately permissive placeholders with loud TODOs so neither
// can quietly reach production.
import { sql } from "drizzle-orm";

type Db = ReturnType<typeof import("@massalia/db").createDb>;

// PLACEHOLDER — actor authorization. requireAuth proves a *user*, but nothing yet
// maps that user to the polity they may act as, so any logged-in player can
// currently conquer as ANY polity. This is the obvious home for the real
// player<->polity binding.
//
// TODO(war-system): resolve the user's owned/controlled polity (via the character
// -> house/faction -> polity chain) and return false unless polityId is one they
// are entitled to command. DO NOT ship the map conquest endpoint with this stub.
export function canActAs(userId: string, polityId: string): boolean {
  void userId;
  void polityId;
  return true;
}

// PLACEHOLDER — conquest legality. The real war system replaces this with supply
// lines, army presence, war state, fortification, etc. For now the single rule:
// the acting polity must CONTROL at least one province adjacent to the target
// (adjacency graph = map_province_adjacency, stored one-direction so we match
// either column). This keeps conquest spatially contiguous and nothing more.
//
// TODO(war-system): replace with the real war-resolution check (army/siege/war
// declaration). Keep this signature so routes/map.ts needs no change.
export async function canConquer(db: Db, worldId: string, provinceId: string, polityId: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT 1
    FROM map_province_adjacency a
    JOIN map_province_state s
      ON s.province_id = CASE WHEN a.province_a = ${provinceId} THEN a.province_b ELSE a.province_a END
     AND s.world_id = ${worldId}
    WHERE (a.province_a = ${provinceId} OR a.province_b = ${provinceId})
      AND s.controller_polity_id = ${polityId}
    LIMIT 1
  `);
  return result.rows.length > 0;
}
