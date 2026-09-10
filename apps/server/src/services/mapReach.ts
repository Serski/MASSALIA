import { and, eq, inArray } from "drizzle-orm";
import { createDb, playerUnits, resources } from "@massalia/db";
import { bandDef, campaignSeason, computeReach, fleetStats, forceStats, HOME_POLITY_ID, unitDef, type ReachEntry, type ReachForceRow, type ReachShip, type Topology } from "@massalia/shared";
import { getBandsContent, getShipsContent, getUnitsContent, isActive, type UnitRow } from "./barracks.js";
import type { ActingContext } from "./buildings.js";
import { listHoldings } from "./holdings.js";
import { getTopology } from "./mapGraph.js";
import { loadMilitaryOwners } from "./mapMilitary.js";

// Reach assembly shared by GET /api/map/reach and the map actions: the player's
// bases (the Massalia region plus holdings), the force from active rows standing
// at a base (training or mid-move excluded — or exactly the rows a caller
// selects), the fleet from the ship goods in stock, the home set from the
// military content, and the pure computeReach over them. Callers run it under
// the player lock after settleAll.

type Db = ReturnType<typeof createDb>;
type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Exec = DbTx | Db;

export type BaseView = { regionId: string; kind: "massalia" | "colony" | "conquest" };
export type CampaignView = { season: string; open: boolean; opensAt: string | null };
export type ReachView = {
  /** server time (ISO) — countdowns anchor to this, not the device clock */
  now: string;
  /** the campaign calendar: closed in Winter, with the instant the passes reopen */
  campaign: CampaignView;
  bases: BaseView[];
  force: { men: number; space: number; fast: boolean };
  fleet: { ships: Record<string, number>; range: number; space: number };
  reach: Record<string, ReachEntry>;
};

// Regions Massalia owns per the military content: townless regions by owner and
// towns by owner, resolved to their region through the graph. Cached.
let homeCache: Set<string> | null = null;
export async function homeRegions(topology: Topology): Promise<Set<string>> {
  if (homeCache) return homeCache;
  const owners = await loadMilitaryOwners();
  const out = new Set<string>();
  for (const [id, o] of Object.entries(owners.regions)) if (o === HOME_POLITY_ID) out.add(id);
  for (const [town, o] of Object.entries(owners.towns)) {
    if (o !== HOME_POLITY_ID) continue;
    const region = topology.townRegion.get(town);
    if (region) out.add(region);
  }
  homeCache = out;
  return out;
}

export function forceRowOf(row: Pick<UnitRow, "source" | "unitId" | "count">): ReachForceRow | null {
  const def = row.source === "trained" ? unitDef(getUnitsContent(), row.unitId) : bandDef(getBandsContent(), row.unitId);
  return def ? { spd: def.stats.spd, space: def.stats.space, count: row.count } : null;
}

// The player's ship goods in stock as reach ships (whole hulls only).
export async function fleetInStock(exec: Exec, ctx: ActingContext): Promise<{ counts: Record<string, number>; fleet: ReachShip[] }> {
  const shipsC = getShipsContent();
  const shipIds = Object.keys(shipsC.ships);
  const stock = await exec
    .select({ type: resources.type, amount: resources.amount })
    .from(resources)
    .where(and(eq(resources.scope, "player"), eq(resources.scopeId, ctx.playerId), inArray(resources.type, shipIds)));
  const counts: Record<string, number> = Object.fromEntries(shipIds.map((id) => [id, 0]));
  for (const s of stock) counts[s.type] = Math.max(0, Math.floor(Number(s.amount)));
  const fleet = shipIds.map((id) => ({ shipId: id, count: counts[id]!, range: shipsC.ships[id]!.range, troopSpace: shipsC.ships[id]!.troopSpace }));
  return { counts, fleet };
}

export async function basesOf(exec: Exec, ctx: ActingContext): Promise<BaseView[]> {
  const topology = getTopology();
  const holdings = await listHoldings(exec, ctx);
  return [{ regionId: topology.massaliaRegion, kind: "massalia" }, ...holdings.map((h) => ({ regionId: h.regionId, kind: h.kind }))];
}

// The reach payload. With `rows` given, the force is exactly those rows and the
// bases exactly `bases` (an action's route check); otherwise the force is every
// active, non-moving row standing at one of the player's bases.
export async function reachView(exec: Exec, ctx: ActingContext, now: Date, opts: { rows?: UnitRow[]; bases?: string[] } = {}): Promise<ReachView> {
  const topology = getTopology();
  const bases = await basesOf(exec, ctx);
  const baseIds = new Set(bases.map((b) => b.regionId));
  let rows = opts.rows;
  if (!rows) {
    const all = await exec.select().from(playerUnits).where(and(eq(playerUnits.worldId, ctx.worldId), eq(playerUnits.ownerPlayerId, ctx.playerId)));
    rows = all.filter((r) => isActive(r, now) && r.movingTo === null && baseIds.has(r.basedAt));
  }
  const force: ReachForceRow[] = [];
  for (const r of rows) {
    const f = forceRowOf(r);
    if (f) force.push(f);
  }
  const { counts, fleet } = await fleetInStock(exec, ctx);
  const home = await homeRegions(topology);
  const reach = computeReach({ topology, bases: opts.bases ?? [...baseIds], force, fleet, homeRegions: home });
  const cs = campaignSeason(now.getTime(), ctx.worldStartedMs);
  const campaign: CampaignView = { season: cs.season, open: cs.open, opensAt: cs.opensAtMs === null ? null : new Date(cs.opensAtMs).toISOString() };
  return { now: now.toISOString(), campaign, bases, force: forceStats(force), fleet: { ships: counts, ...fleetStats(fleet) }, reach };
}
