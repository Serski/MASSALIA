import { and, eq } from "drizzle-orm";
import { createDb, playerUnits } from "@massalia/db";
import {
  bandDef,
  campaignSeason,
  computeReach,
  distancesFrom,
  fleetStats,
  forceStats,
  HOME_POLITY_ID,
  stepsTo,
  unitDef,
  type ReachEntry,
  type ReachForceRow,
  type ReachSteps,
  type Topology,
} from "@massalia/shared";
import { fleetInStock, getBandsContent, getBattleContent, getShipsContent, getUnitsContent, isActive, isPledged, type FleetStripView, type RosterView, type UnitRow } from "./barracks.js";
export { fleetInStock };
import type { ActingContext } from "./buildings.js";
import { garrisonCount, holdingBaseId, listHoldings, listWorldHoldings, tributeRateOf } from "./holdings.js";
import { isLeague, leagueBalance, leagueGateMap, leagueHomeTowns, leagueSightings, marketPrice, type LeagueContext, type LeagueSightings } from "./leagueOrders.js";
import { getTopology } from "./mapGraph.js";
import { loadMilitaryOwners } from "./mapMilitary.js";
import { regionDisplayName, townDisplayName } from "./mapNames.js";

// Reach assembly shared by GET /api/map/reach and the map actions: the player's
// bases (the Massalia region, every holding — a region or a town — and any home
// region or home town where the player has men standing), the force from
// active rows standing at a base (training or mid-move excluded — or exactly
// the rows a caller selects), the fleet from the ship goods in stock, the home
// set from the military content, and the pure computeReach over them. Callers
// run it under the player lock after settleAll.
//
// The League's army (government prompt 5b) reads through the same code with a
// League context: its bases are the ten home towns its men were raised in (the
// Massalia town among them, never the Massalia region) and its holdings, its
// move targets the same places, and its naval supplies what the treasury can
// buy that season. leagueMapView is the whole of its map payload.

type Db = ReturnType<typeof createDb>;
type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Exec = DbTx | Db;

// A base: `id` is what rows are based at (a region id, or a town slug for a
// town holding or a home town); `regionId` is the region it stands in; `name`
// the display name the client shows. A holding carries what it pays: the men
// standing there against the minimum its tribute needs, the tribute a day,
// and the levy it adds a year (regions only). A "guest" base is another
// house's holding where this house's men stand (holdings prompt 3): a base like
// a home place, with nothing of the holding's (its holding is null).
export type BaseKind = "massalia" | "colony" | "conquest" | "home" | "guest";
export type HoldingView = { garrison: number; minGarrison: number; perDay: { drachmae: number; grain: number; timber: number }; levyPerYear: number };
export type BaseView = { id: string; regionId: string; townId: string | null; kind: BaseKind; name: string; holding: HoldingView | null };
export type CampaignView = { season: string; open: boolean; opensAt: string | null };
// A place the player may move men to, with the steps from each base.
export type MoveTargetView = { id: string; regionId: string; townId: string | null; kind: BaseKind; name: string; byBase: Record<string, ReachSteps> };
export type ReachView = {
  /** server time (ISO) — countdowns anchor to this, not the device clock */
  now: string;
  /** the campaign calendar: closed in Winter, with the instant the passes reopen */
  campaign: CampaignView;
  bases: BaseView[];
  force: { men: number; space: number };
  /** ship counts by id with their display names (ships.json), the farthest range and the troop space aboard, and each hull type in stock with its facts */
  // `supplies`: the naval supplies in store (barracks prompt 4); each hull carries its suppliesPerTrip.
  fleet: { ships: Record<string, number>; labels: Record<string, string>; range: number; space: number; tiers?: { range: number; space: number }[]; hulls: FleetStripView["ships"]; supplies: number };
  reach: Record<string, ReachEntry>;
  moveTargets: MoveTargetView[];
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

// Massalia's own places (ruling 10): every home townless region and home town,
// the Massalia town itself excluded (its region is the base). Cached.
let homePlacesCache: { id: string; regionId: string; townId: string | null }[] | null = null;
export async function homePlaces(topology: Topology): Promise<{ id: string; regionId: string; townId: string | null }[]> {
  if (homePlacesCache) return homePlacesCache;
  const owners = await loadMilitaryOwners();
  const out: { id: string; regionId: string; townId: string | null }[] = [];
  for (const [id, o] of Object.entries(owners.regions)) if (o === HOME_POLITY_ID && topology.land.has(id) && id !== topology.massaliaRegion) out.push({ id, regionId: id, townId: null });
  for (const [town, o] of Object.entries(owners.towns)) {
    if (o !== HOME_POLITY_ID) continue;
    const region = topology.townRegion.get(town);
    if (!region || region === topology.massaliaRegion) continue;
    out.push({ id: town, regionId: region, townId: town });
  }
  homePlacesCache = out;
  return out;
}

export function forceRowOf(row: Pick<UnitRow, "source" | "unitId" | "count">): ReachForceRow | null {
  const def = row.source === "trained" ? unitDef(getUnitsContent(), row.unitId) : bandDef(getBandsContent(), row.unitId);
  return def ? { spd: def.stats.spd, space: def.stats.space, count: row.count } : null;
}

async function ownedRows(exec: Exec, ctx: ActingContext): Promise<UnitRow[]> {
  return exec.select().from(playerUnits).where(and(eq(playerUnits.worldId, ctx.worldId), eq(playerUnits.ownerPlayerId, ctx.playerId)));
}

// The player's bases (ruling 11): the Massalia region always, every holding,
// and every home place where at least one active, non-moving row stands.
const placeName = (id: string, townId: string | null) => (townId ? townDisplayName(townId) : regionDisplayName(id));

// The League's home towns as places, in the content's order.
async function leagueHomePlaces(topology: Topology): Promise<{ id: string; regionId: string; townId: string }[]> {
  const out: { id: string; regionId: string; townId: string }[] = [];
  for (const town of await leagueHomeTowns()) {
    const regionId = topology.townRegion.get(town);
    if (regionId) out.push({ id: town, regionId, townId: town });
  }
  return out;
}

export async function basesOf(exec: Exec, ctx: ActingContext, now: Date, rows?: UnitRow[]): Promise<BaseView[]> {
  const topology = getTopology();
  const holdings = await listHoldings(exec, ctx);
  const league = isLeague(ctx);
  // A house always has the Massalia region. The League has its ten home towns,
  // with or without men standing there, and no levy from a held region.
  const out: BaseView[] = [];
  if (league) for (const p of await leagueHomePlaces(topology)) out.push({ ...p, kind: "home", name: await placeName(p.id, p.townId), holding: null });
  else out.push({ id: topology.massaliaRegion, regionId: topology.massaliaRegion, townId: null, kind: "massalia", name: await regionDisplayName(topology.massaliaRegion), holding: null });
  const levyPerYear = league ? 0 : getBattleContent().regionTribute.levyPerYear;
  for (const h of holdings) {
    const id = holdingBaseId(h);
    const rate = await tributeRateOf(h);
    const holding: HoldingView = { garrison: await garrisonCount(exec, ctx, id, now), minGarrison: rate.minGarrison, perDay: { drachmae: rate.drachmae, grain: rate.grain, timber: rate.timber }, levyPerYear: h.townId ? 0 : levyPerYear };
    out.push({ id, regionId: h.regionId, townId: h.townId || null, kind: h.kind, name: await placeName(id, h.townId || null), holding });
  }
  if (league) return out;
  const standing = new Set((rows ?? (await ownedRows(exec, ctx))).filter((r) => isActive(r, now) && r.movingTo === null).map((r) => r.basedAt));
  // Another house's holding where this house's men stand (holdings prompt 3):
  // a base, after its own holdings, and nothing of the holding's is shown.
  for (const g of await guestPlaces(exec, ctx)) if (standing.has(g.id)) out.push({ ...g, kind: "guest", name: await placeName(g.id, g.townId), holding: null });
  for (const p of await homePlaces(topology)) if (standing.has(p.id)) out.push({ ...p, kind: "home", name: await placeName(p.id, p.townId), holding: null });
  return out;
}

// Every other house's holding (holdings prompt 3): a holding is Massalia's land,
// and any house may stand in it. Never the League's (its holdings are its army's
// alone), and never this house's own, which it holds.
export async function guestPlaces(exec: Exec, ctx: ActingContext): Promise<{ id: string; regionId: string; townId: string | null }[]> {
  return (await listWorldHoldings(exec, ctx.worldId))
    .filter((h) => !h.league && h.playerId !== ctx.playerId)
    .map((h) => ({ id: h.townId || h.regionId, regionId: h.regionId, townId: h.townId || null }));
}

// The places a house may move its men to, and so the places they may stand
// in: the Massalia region, every home place, its own holdings and every other
// house's. The settle turns home any of its men standing anywhere else, or
// arriving there (holdings prompt 3, rule 4).
export async function housePlaces(exec: Exec, ctx: ActingContext): Promise<{ id: string; regionId: string; townId: string | null; kind: BaseKind }[]> {
  const topology = getTopology();
  const places: { id: string; regionId: string; townId: string | null; kind: BaseKind }[] = [{ id: topology.massaliaRegion, regionId: topology.massaliaRegion, townId: null, kind: "massalia" }];
  for (const p of await homePlaces(topology)) places.push({ ...p, kind: "home" });
  for (const h of await listHoldings(exec, ctx)) places.push({ id: holdingBaseId(h), regionId: h.regionId, townId: h.townId || null, kind: h.kind });
  for (const g of await guestPlaces(exec, ctx)) places.push({ ...g, kind: "guest" });
  return places;
}

// The steps from every base to a place, keyed by base id (bases in one region
// share the region's distances).
function stepsByBase(topology: Topology, bases: BaseView[], regionId: string): Record<string, ReachSteps> {
  const byRegion = new Map<string, ReturnType<typeof distancesFrom>>();
  const out: Record<string, ReachSteps> = {};
  for (const b of bases) {
    let d = byRegion.get(b.regionId);
    if (!d) {
      d = distancesFrom(topology, b.regionId);
      byRegion.set(b.regionId, d);
    }
    out[b.id] = stepsTo(topology, d, regionId);
  }
  return out;
}

// Every place the player may move men to (ruling 10): the Massalia region,
// every home place, and every holding — each with its steps from every base.
export async function moveTargetsOf(topology: Topology, bases: BaseView[], ctx: ActingContext, exec: Exec): Promise<MoveTargetView[]> {
  // A house: housePlaces (the Massalia region, every home place, its own
  // holdings and every other house's, holdings prompt 3). The League: its ten
  // home towns and its own holdings, never a house's.
  const places: { id: string; regionId: string; townId: string | null; kind: BaseKind }[] = [];
  if (isLeague(ctx)) {
    for (const p of await leagueHomePlaces(topology)) places.push({ ...p, kind: "home" });
    for (const h of await listHoldings(exec, ctx)) places.push({ id: holdingBaseId(h), regionId: h.regionId, townId: h.townId || null, kind: h.kind });
  } else places.push(...(await housePlaces(exec, ctx)));
  const out: MoveTargetView[] = [];
  for (const p of places) out.push({ ...p, name: await placeName(p.id, p.townId), byBase: stepsByBase(topology, bases, p.regionId) });
  return out;
}

// The reach payload. With `rows` given, the force is exactly those rows and the
// bases exactly `bases` (an action's route check, by base id); otherwise the
// force is every active, non-moving row standing at one of the player's bases.
export async function reachView(exec: Exec, ctx: ActingContext, now: Date, opts: { rows?: UnitRow[]; bases?: string[] } = {}): Promise<ReachView> {
  const topology = getTopology();
  const all = await ownedRows(exec, ctx);
  const allBases = await basesOf(exec, ctx, now, all);
  const bases = opts.bases ? allBases.filter((b) => opts.bases!.includes(b.id)) : allBases;
  const baseIds = new Set(bases.map((b) => b.id));
  // Men pledged to a koinon's muster are not the player's to send, so they are not in his force.
  const rows = opts.rows ?? all.filter((r) => isActive(r, now) && r.movingTo === null && !isPledged(r) && baseIds.has(r.basedAt));
  const force: ReachForceRow[] = [];
  for (const r of rows) {
    const f = forceRowOf(r);
    if (f) force.push(f);
  }
  const inStock = await fleetInStock(exec, ctx);
  const { counts, fleet, strip } = inStock;
  // A house's supplies are its stock. The League keeps none: it has what the
  // treasury can buy at what the market asks this season.
  const supplies = isLeague(ctx) ? leagueSuppliesAfford(await leagueBalance(exec, ctx.worldId), leagueSupplyPrice(now, ctx.worldStartedMs)) : inStock.supplies;
  const home = await homeRegions(topology);
  // Region holdings are never targets; the region of a held town or of home
  // ground with men stays a target for its other towns (home ground is already
  // excluded by the home set).
  const excluded = new Set(bases.filter((b) => b.townId === null && b.kind !== "home").map((b) => b.regionId));
  const reach = computeReach({ topology, bases: [...new Set(bases.map((b) => b.regionId))], force, fleet, homeRegions: home, excluded });
  // byBase by base id: a town base reads its region's distances.
  for (const entry of Object.values(reach)) {
    const byBase: Record<string, ReachSteps> = {};
    for (const b of bases) byBase[b.id] = entry.byBase[b.regionId]!;
    entry.byBase = byBase;
  }
  const cs = campaignSeason(now.getTime(), ctx.worldStartedMs);
  const campaign: CampaignView = { season: cs.season, open: cs.open, opensAt: cs.opensAtMs === null ? null : new Date(cs.opensAtMs).toISOString() };
  const moveTargets = await moveTargetsOf(topology, allBases, ctx, exec);
  const labels = Object.fromEntries(Object.entries(getShipsContent().ships).map(([id, d]) => [id, d.label]));
  return { now: now.toISOString(), campaign, bases, force: forceStats(force), fleet: { ships: counts, labels, ...fleetStats(fleet), hulls: strip.ships, supplies }, reach, moveTargets };
}

// --- The League's map view (government prompt 5b) -----------------------------

// What a unit of naval supplies costs the treasury at an instant.
export function leagueSupplyPrice(at: Date, worldStartedMs: number): number {
  return marketPrice(getShipsContent().supplyGood, "buy", at, worldStartedMs);
}
function leagueSuppliesAfford(balance: number, price: number): number {
  return price > 0 ? Math.max(0, Math.floor(balance / price)) : 0;
}

// The League's rows as the force picker reads a roster: no row of the League's
// is disbanded from the map.
function leagueRoster(rows: UnitRow[], now: Date): RosterView[] {
  const unitsC = getUnitsContent();
  const bandsC = getBandsContent();
  return rows.map((r) => {
    const def = r.source === "trained" ? unitDef(unitsC, r.unitId) : bandDef(bandsC, r.unitId);
    return {
      id: r.id,
      source: r.source,
      unitId: r.unitId,
      label: def?.label ?? r.unitId,
      plural: r.source === "trained" ? (unitDef(unitsC, r.unitId)?.plural ?? `${def?.label ?? r.unitId}s`) : (def?.label ?? r.unitId),
      icon: def?.icon ?? "",
      count: r.count,
      startCount: r.startCount,
      recruitedSeason: r.recruitedSeason,
      readyAt: r.readyAt?.toISOString() ?? null,
      contractEndAt: r.contractEndAt?.toISOString() ?? null,
      basedAt: r.basedAt,
      movingTo: r.movingTo,
      arrivesAt: r.arrivesAt?.toISOString() ?? null,
      mission: r.mission ?? null,
      createdAt: r.createdAt.toISOString(),
      stats: def?.stats ?? {},
      active: isActive(r, now),
      canDisband: false,
    };
  });
}

// Everything the map needs to give the League's army an order, in one payload:
// the reach of its men from its places, its rows, the treasury that pays for a
// voyage with what a unit of naval supplies costs it now, and the war gate (the
// refusal a raid or an attack would meet, by town and by townless region). The
// gate is its own field, never a reach verdict: Scout reads the raid verdict,
// and the League's scouts go where a house's may. `sightings` is what the
// League's own parties last saw of each place, with the game date: the map's
// panels show it in the League's mode, in the place of the viewer's own intel.
export type LeagueMapView = ReachView & {
  roster: RosterView[];
  treasury: { balance: number };
  supplyPrice: number;
  gate: { towns: Record<string, string>; regions: Record<string, string> };
  sightings: LeagueSightings;
  // The official reading the map, as the order sheet names him: "Ordered by <name>, <seat>".
  orderedBy: { name: string; office: "archon" | "strategos"; side: string | null } | null;
};
export async function leagueMapView(exec: Exec, ctx: LeagueContext, now: Date): Promise<LeagueMapView> {
  const reach = await reachView(exec, ctx, now);
  return {
    ...reach,
    roster: leagueRoster(await ownedRows(exec, ctx), now),
    treasury: { balance: await leagueBalance(exec, ctx.worldId) },
    supplyPrice: leagueSupplyPrice(now, ctx.worldStartedMs),
    gate: await leagueGateMap(exec, ctx.worldId, now),
    sightings: await leagueSightings(exec, ctx),
    orderedBy: ctx.league.orderer ? { name: ctx.league.orderer.name, office: ctx.league.orderer.office, side: ctx.league.orderer.side } : null,
  };
}
