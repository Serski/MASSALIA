import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { createDb, koinonMembers, koinonMusterHulls, koinonMusters, playerCharacters, players, playerUnits, resources, type UnitMission } from "@massalia/db";
import {
  bandDef,
  distancesFrom,
  fleetSpaceAt,
  fleetStats,
  forceStats,
  formatGameDate,
  gameDate,
  HOME_POLITY_ID,
  musterLaunch,
  routeFor,
  stepsTo,
  unitDef,
  verdictsFor,
  type MusterHull,
  type ReachForceRow,
  type ReachSteps,
} from "@massalia/shared";
import { fleetInStock, getBandsContent, getShipsContent, getUnitsContent, isActive, isPledged, type UnitRow } from "./barracks.js";
import { applyComposureDelta } from "./composure.js";
import { settleAll, type ActingContext } from "./buildings.js";
import { listHoldings } from "./holdings.js";
import { getKoinonContent, inOwnKoinon, memberRow, type KoinonError, type KoinonRole, type KoinonRow } from "./koinon.js";
import { lockPlayer } from "./lock.js";
import { selectForce, splitRows } from "./mapActions.js";
import { getTopology } from "./mapGraph.js";
import { regionDisplayName, townDisplayName } from "./mapNames.js";
import { townContentOwner } from "./mapPools.js";
import { forceRowOf, homePlaces, homeRegions } from "./mapReach.js";

// ---------------------------------------------------------------------------
// The koinon's Raid muster (koinon prompt 3). Any member opens one: a target, a
// gathering place on Massalia's own ground, a launch instant. Members move men
// to the gathering place with the ordinary Move and pledge them, or pledge
// hulls, or both. At the launch instant every pledged row fights as one army.
//
// Pledged men have no table: they are the player's own player_units rows with
// a "muster" mission (barracks.ts: isPledged), locked against every other use.
// Pledged hulls are counts in koinon_muster_hulls; ships are never moved.
//
// Locks. Every write that changes a muster runs under the koinon lock, through
// inOwnKoinon. A write that touches the caller's own rows takes his player
// lock first and settles him. The order is the one koinon.ts sets: a player
// lock before the koinon lock, never after. Calling a muster off writes no
// one's rows: each owner's own settle releases them (barracks.ts).
// ---------------------------------------------------------------------------

const db = createDb();
type DbTx = Parameters<Parameters<ReturnType<typeof createDb>["transaction"]>[0]>[0];
type Exec = DbTx | typeof db;

export type MusterRow = typeof koinonMusters.$inferSelect;
type Ok = KoinonError | { ok: true };

const fail = (code: number, error: string): KoinonError => ({ ok: false, code, error });
const NO_MUSTER = fail(409, "The koinon has no muster open.");
const MARCHED = fail(409, "The muster has already marched.");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// --- Places ------------------------------------------------------------------

export type MusterPlace = { id: string; regionId: string; townId: string | null };

// A gathering place: the Massalia region or one of Massalia's own places, where
// anyone's men may stand. null for anything else.
export async function gatherPlace(gatherId: unknown): Promise<MusterPlace | null> {
  if (typeof gatherId !== "string") return null;
  const topology = getTopology();
  if (gatherId === topology.massaliaRegion) return { id: gatherId, regionId: gatherId, townId: null };
  return (await homePlaces(topology)).find((p) => p.id === gatherId) ?? null;
}

export async function gatherPlaces(): Promise<(MusterPlace & { name: string })[]> {
  const topology = getTopology();
  const places: MusterPlace[] = [{ id: topology.massaliaRegion, regionId: topology.massaliaRegion, townId: null }, ...(await homePlaces(topology))];
  const named = await Promise.all(places.map(async (p) => ({ ...p, name: await placeName(p.id, p.townId) })));
  // Massalia first, then the rest by name.
  return named.sort((a, b) => Number(b.id === topology.massaliaRegion) - Number(a.id === topology.massaliaRegion) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

const placeName = (id: string, townId: string | null) => (townId ? townDisplayName(townId) : regionDisplayName(id));
export const musterTargetName = (m: Pick<MusterRow, "regionId" | "townId">) => placeName(m.regionId, m.townId);
export const musterGatherName = (m: Pick<MusterRow, "gatherId" | "gatherRegionId">) => placeName(m.gatherId, m.gatherId === m.gatherRegionId ? null : m.gatherId);

// The target rules are `act`'s, with its sentences: a town, or a townless land
// region; never fog, never Massalia's own.
async function musterTarget(input: { regionId?: unknown; townId?: unknown }): Promise<KoinonError | { regionId: string; townId: string | null }> {
  const topology = getTopology();
  const home = await homeRegions(topology);
  if (input.townId !== undefined && input.townId !== null) {
    const regionId = typeof input.townId === "string" ? topology.townRegion.get(input.townId) : undefined;
    if (!regionId) return fail(404, "No such town.");
    const townId = input.townId as string;
    if (regionId === topology.massaliaRegion || (await townContentOwner(townId)) === HOME_POLITY_ID || home.has(regionId)) return fail(409, "Massalia does not act against her own.");
    return { regionId, townId };
  }
  if (typeof input.regionId !== "string" || !topology.land.has(input.regionId)) return fail(404, "No such region.");
  const regionId = input.regionId;
  if (regionId === topology.massaliaRegion || home.has(regionId)) return fail(409, "Massalia does not act against her own.");
  if ([...topology.townRegion.values()].some((r) => r === regionId)) return fail(409, "This land answers to its towns: choose one.");
  return { regionId, townId: null };
}

// P2: reachable in principle from the gathering place: one land step, or a sea
// route no longer than the longest hull range in ships.json. Whether the
// pledged force and fleet actually reach it is decided once, at launch.
export function longestHullRange(): number {
  return Math.max(0, ...Object.values(getShipsContent().ships).map((s) => s.range));
}
export function reachableInPrinciple(steps: ReachSteps): boolean {
  if (steps.landSteps !== null && steps.landSteps <= 1) return true;
  return steps.seaSteps !== null && steps.seaSteps <= longestHullRange();
}
export function musterSteps(gatherRegionId: string, targetRegionId: string): ReachSteps {
  const topology = getTopology();
  return stepsTo(topology, distancesFrom(topology, gatherRegionId), targetRegionId);
}

export async function openMusterOf(exec: Exec, koinonId: string): Promise<MusterRow | null> {
  return (await exec.select().from(koinonMusters).where(and(eq(koinonMusters.koinonId, koinonId), eq(koinonMusters.status, "open"))).limit(1))[0] ?? null;
}

// The rows pledged to a muster, standing at the gathering place.
export async function pledgedRows(exec: Exec, musterId: string, ownerPlayerId?: string): Promise<UnitRow[]> {
  return exec
    .select()
    .from(playerUnits)
    .where(and(sql`${playerUnits.mission}->>'musterId' = ${musterId}`, sql`${playerUnits.mission}->>'kind' = 'muster'`, isNull(playerUnits.movingTo), ...(ownerPlayerId ? [eq(playerUnits.ownerPlayerId, ownerPlayerId)] : [])))
    .orderBy(playerUnits.createdAt, playerUnits.id);
}

async function characterIdOf(exec: Exec, playerId: string): Promise<string | null> {
  return (await exec.select({ id: playerCharacters.id }).from(playerCharacters).where(eq(playerCharacters.playerId, playerId)).limit(1))[0]?.id ?? null;
}

// --- Opening -------------------------------------------------------------------

export type OpenMusterInput = { regionId?: unknown; townId?: unknown; gatherId?: unknown; leadMinutes?: unknown };
export type OpenMusterResult = KoinonError | { ok: true; musterId: string; launchAt: string };

// POST /api/koinon/muster/open — ruling 1: any member, one open muster per
// koinon. The launch instant is the server's clock plus the chosen lead (P1).
export async function openMuster(ctx: ActingContext, input: OpenMusterInput, now: Date): Promise<OpenMusterResult> {
  const c = getKoinonContent();
  const gather = await gatherPlace(input.gatherId);
  if (!gather) return fail(400, "Choose a gathering place on Massalia's own ground.");
  const target = await musterTarget(input);
  if ("ok" in target) return target;
  const launch = musterLaunch(now.getTime(), input.leadMinutes, ctx.worldStartedMs, c);
  if (!launch.ok) {
    return launch.reason === "winter"
      ? fail(409, "The passes are closed in winter: choose a launch in another season.")
      : fail(400, `Set the launch from ${c.muster.minLeadMinutes} minutes to ${c.muster.maxLeadHours} hours ahead.`);
  }
  if (!reachableInPrinciple(musterSteps(gather.regionId, target.regionId))) return fail(409, "That place cannot be reached from the gathering place.");

  return db.transaction((tx) =>
    inOwnKoinon(tx, ctx, now, async (tx, k) => {
      const already = fail(409, "The koinon already has a muster open.");
      if (await openMusterOf(tx, k.id)) return already;
      // Two members opening at once: the partial unique index lets one row in.
      const opened = (
        await tx
          .insert(koinonMusters)
          .values({ worldId: ctx.worldId, koinonId: k.id, openerPlayerId: ctx.playerId, kind: "raid", regionId: target.regionId, townId: target.townId, gatherId: gather.id, gatherRegionId: gather.regionId, openedAt: now, launchAt: new Date(launch.launchAtMs) })
          .onConflictDoNothing()
          .returning()
      )[0];
      if (!opened) return already;
      return { ok: true as const, musterId: opened.id, launchAt: opened.launchAt.toISOString() };
    }),
  );
}

// --- Pledging ------------------------------------------------------------------

export type PledgeInput = { rows?: unknown; ships?: unknown };

// POST /api/koinon/muster/pledge — ruling 3. The caller's player lock and his
// settle first, then the koinon lock. Rows: his own, active, standing at the
// gathering place, not moving, not already pledged; part of a trained row
// splits off, a band goes whole. Ships: whole numbers within stock; the given
// counts replace his hull pledge, and 0 removes one. Every check runs before
// anything is written, so a refusal never leaves a row divided.
export async function pledge(ctx: ActingContext, input: PledgeInput, now: Date): Promise<Ok> {
  const shipsC = getShipsContent();
  // Shape first: a list of { rowId, count } and a map of ship id to count.
  const rows: { rowId: string; count: number }[] = [];
  if (input.rows !== undefined) {
    if (!Array.isArray(input.rows)) return fail(400, "Pledge men, hulls, or both.");
    for (const r of input.rows as { rowId?: unknown; count?: unknown }[]) {
      if (typeof r?.rowId !== "string" || !UUID_RE.test(r.rowId) || typeof r.count !== "number") return fail(400, "Pledge men, hulls, or both.");
      rows.push({ rowId: r.rowId, count: r.count });
    }
  }
  const ships: [string, number][] = [];
  if (input.ships !== undefined && input.ships !== null) {
    if (typeof input.ships !== "object" || Array.isArray(input.ships)) return fail(400, "Pledge men, hulls, or both.");
    for (const [id, n] of Object.entries(input.ships as Record<string, unknown>)) {
      if (!shipsC.ships[id]) return fail(400, "No such ship.");
      if (typeof n !== "number" || !Number.isInteger(n) || n < 0) return fail(400, "Send a whole number of ships.");
      ships.push([id, n]);
    }
  }
  if (rows.length === 0 && ships.length === 0) return fail(400, "Pledge men, hulls, or both.");

  const outcome = await db.transaction(async (tx) => {
    await lockPlayer(tx, ctx.playerId);
    const settled = await settleAll(tx, ctx, now);
    const result = await inOwnKoinon<{ ok: true }>(tx, ctx, now, async (tx, k) => {
      const muster = await openMusterOf(tx, k.id);
      if (!muster) return NO_MUSTER;
      if (now.getTime() >= muster.launchAt.getTime()) return MARCHED;
      // P11: a member who holds the target cannot pledge, as `act` refuses him.
      const holdings = await listHoldings(tx, ctx);
      if (muster.townId !== null && holdings.some((h) => h.townId === muster.townId)) return fail(409, "You hold this town.");
      if (muster.townId === null && holdings.some((h) => h.regionId === muster.regionId && h.townId === "")) return fail(409, "You hold this land.");

      const selected = rows.length > 0 ? await selectForce(tx, ctx, rows, now) : null;
      if (selected && !selected.ok) return fail(selected.code, selected.error);
      if (selected && selected.ok && selected.base !== muster.gatherId) return fail(409, `Only men standing at ${await musterGatherName(muster)} can be pledged.`);
      if (ships.length > 0) {
        const { counts } = await fleetInStock(tx, ctx);
        for (const [id, n] of ships) {
          const have = counts[id] ?? 0;
          const label = shipsC.ships[id]!.label.toLowerCase();
          if (n > have) return fail(409, `Only ${have} ${label}${have === 1 ? "" : "s"} in port.`);
        }
      }

      // Nothing can refuse now: split, then set the mission and the hull counts.
      if (selected && selected.ok) {
        const characterId = await characterIdOf(tx, ctx.playerId);
        if (!characterId) return fail(404, "No active character found.");
        await splitRows(tx, characterId, selected, now);
        const mission: UnitMission = { kind: "muster", musterId: muster.id, regionId: muster.regionId, ...(muster.townId ? { townId: muster.townId } : {}), departedAt: now.toISOString() };
        await tx.update(playerUnits).set({ mission }).where(inArray(playerUnits.id, selected.rows.map((r) => r.id)));
      }
      for (const [id, n] of ships) {
        const key = and(eq(koinonMusterHulls.musterId, muster.id), eq(koinonMusterHulls.ownerPlayerId, ctx.playerId), eq(koinonMusterHulls.shipId, id));
        if (n === 0) await tx.delete(koinonMusterHulls).where(key);
        else {
          // A pledge keeps its first instant: raising or lowering the count does not lose its place in the loading order.
          await tx
            .insert(koinonMusterHulls)
            .values({ musterId: muster.id, ownerPlayerId: ctx.playerId, shipId: id, count: n, pledgedAt: now })
            .onConflictDoUpdate({ target: [koinonMusterHulls.musterId, koinonMusterHulls.ownerPlayerId, koinonMusterHulls.shipId], set: { count: n } });
        }
      }
      return { ok: true as const };
    });
    return { composureDays: settled.composureDays, result };
  });
  await applyShrine(ctx, outcome.composureDays, now);
  return outcome.result;
}

// Shrine composure banked by a settle is applied after the transaction,
// break-aware, as `act` and collect do.
async function applyShrine(ctx: ActingContext, composureDays: number, now: Date): Promise<void> {
  if (composureDays <= 0) return;
  const characterId = await characterIdOf(db, ctx.playerId);
  if (characterId) await applyComposureDelta(characterId, composureDays, "building:shrine", now);
}

// POST /api/koinon/muster/withdraw — P4: a member takes back his whole pledge
// before launch. His rows are freed (the next settle folds them back) and his
// hull pledges go. Nobody else's are touched.
export async function withdrawPledge(ctx: ActingContext, now: Date): Promise<Ok> {
  return db.transaction(async (tx) => {
    await lockPlayer(tx, ctx.playerId);
    return inOwnKoinon<{ ok: true }>(tx, ctx, now, async (tx, k) => {
      const muster = await openMusterOf(tx, k.id);
      if (!muster) return NO_MUSTER;
      if (now.getTime() >= muster.launchAt.getTime()) return MARCHED;
      const mine = await pledgedRows(tx, muster.id, ctx.playerId);
      if (mine.length > 0) await tx.update(playerUnits).set({ mission: null }).where(inArray(playerUnits.id, mine.map((r) => r.id)));
      await tx.delete(koinonMusterHulls).where(and(eq(koinonMusterHulls.musterId, muster.id), eq(koinonMusterHulls.ownerPlayerId, ctx.playerId)));
      return { ok: true as const };
    });
  });
}

// POST /api/koinon/muster/cancel — P3: the opener or the leader calls it off
// before launch. Pledges fall with it: the hull pledges go here, and each
// owner's own settle releases his men. This writes no one's rows.
export async function cancelMuster(ctx: ActingContext, now: Date): Promise<Ok> {
  return db.transaction((tx) =>
    inOwnKoinon<{ ok: true }>(tx, ctx, now, async (tx, k, role) => {
      const muster = await openMusterOf(tx, k.id);
      if (!muster) return NO_MUSTER;
      if (role !== "leader" && muster.openerPlayerId !== ctx.playerId) return fail(403, "Only the one who called the muster, or the leader, may call it off.");
      if (now.getTime() >= muster.launchAt.getTime()) return MARCHED;
      await tx.delete(koinonMusterHulls).where(eq(koinonMusterHulls.musterId, muster.id));
      await tx.update(koinonMusters).set({ status: "cancelled", closedAt: now }).where(and(eq(koinonMusters.id, muster.id), eq(koinonMusters.status, "open")));
      return { ok: true as const };
    }),
  );
}

// --- Reads ---------------------------------------------------------------------

export type MusterTargetView = { regionId: string; townId: string | null; name: string; kind: "town" | "region"; route: "land" | "sea"; steps: number };
export type MusterTargetsView = { gathers: { id: string; name: string }[]; gatherId: string; targets: MusterTargetView[] };

// GET /api/koinon/muster/targets?gather= — every legal target reachable in
// principle from that gathering place, by name. No garrison, warband or fleet
// numbers: only where it is and how far.
export async function musterTargets(ctx: ActingContext, gatherId: unknown): Promise<KoinonError | MusterTargetsView> {
  if (!(await memberRow(db, ctx.playerId, ctx.worldId))) return fail(403, "You are not in a koinon.");
  const gathers = await gatherPlaces();
  const gather = gatherId === undefined ? gathers[0]! : await gatherPlace(gatherId);
  if (!gather) return fail(400, "Choose a gathering place on Massalia's own ground.");
  const topology = getTopology();
  const home = await homeRegions(topology);
  const from = distancesFrom(topology, gather.regionId);
  const targets: MusterTargetView[] = [];
  const consider = async (regionId: string, townId: string | null) => {
    const steps = stepsTo(topology, from, regionId);
    if (!reachableInPrinciple(steps)) return;
    const route = routeFor("raid", steps);
    if (!route) return;
    targets.push({ regionId, townId, name: await placeName(regionId, townId), kind: townId ? "town" : "region", route: route.route, steps: route.steps });
  };
  const withTowns = new Set(topology.townRegion.values());
  for (const [townId, regionId] of topology.townRegion) {
    if (regionId === topology.massaliaRegion || home.has(regionId) || (await townContentOwner(townId)) === HOME_POLITY_ID) continue;
    await consider(regionId, townId);
  }
  for (const regionId of topology.land.keys()) {
    if (regionId === topology.massaliaRegion || home.has(regionId) || withTowns.has(regionId)) continue;
    await consider(regionId, null);
  }
  targets.sort((a, b) => a.name.localeCompare(b.name) || (a.townId ?? a.regionId).localeCompare(b.townId ?? b.regionId));
  return { gathers: gathers.map((g) => ({ id: g.id, name: g.name })), gatherId: gather.id, targets };
}

export type MyPledgeView = {
  now: string;
  gather: { id: string; name: string };
  rows: { rowId: string; unitId: string; label: string; plural: string; icon: string; source: "trained" | "band"; count: number; pledged: boolean }[];
  ships: { id: string; label: string; inStock: number; pledged: number; range: number; troopSpace: number }[];
};

// GET /api/koinon/muster/mine — the caller's own side of the open muster. It
// settles him under his lock, as GET /api/barracks does, so the row ids are the
// ones a pledge will find: his rows standing at the gathering place (pledged or
// free) and each hull type in stock beside his pledge.
export async function myMusterPledge(ctx: ActingContext, now: Date): Promise<KoinonError | MyPledgeView> {
  const mine = await memberRow(db, ctx.playerId, ctx.worldId);
  if (!mine) return fail(403, "You are not in a koinon.");
  const unitsC = getUnitsContent();
  const bandsC = getBandsContent();
  const shipsC = getShipsContent();
  const outcome = await db.transaction(async (tx) => {
    await lockPlayer(tx, ctx.playerId);
    const settled = await settleAll(tx, ctx, now);
    const muster = await openMusterOf(tx, mine.koinonId);
    if (!muster) return { composureDays: settled.composureDays, view: NO_MUSTER as KoinonError | MyPledgeView };
    const standing = (await tx.select().from(playerUnits).where(and(eq(playerUnits.worldId, ctx.worldId), eq(playerUnits.ownerPlayerId, ctx.playerId), eq(playerUnits.basedAt, muster.gatherId), isNull(playerUnits.movingTo))).orderBy(playerUnits.createdAt, playerUnits.id)).filter(
      (r) => isActive(r, now) && (!isPledged(r) || r.mission?.musterId === muster.id),
    );
    const { counts } = await fleetInStock(tx, ctx);
    const hulls = await tx.select().from(koinonMusterHulls).where(and(eq(koinonMusterHulls.musterId, muster.id), eq(koinonMusterHulls.ownerPlayerId, ctx.playerId)));
    const view: MyPledgeView = {
      now: now.toISOString(),
      gather: { id: muster.gatherId, name: await musterGatherName(muster) },
      rows: standing.map((r) => {
        const def = r.source === "trained" ? unitDef(unitsC, r.unitId) : bandDef(bandsC, r.unitId);
        const label = def?.label ?? r.unitId;
        return { rowId: r.id, unitId: r.unitId, label, plural: r.source === "trained" ? (unitDef(unitsC, r.unitId)?.plural ?? `${label}s`) : label, icon: def?.icon ?? "", source: r.source, count: r.count, pledged: isPledged(r) };
      }),
      ships: Object.entries(shipsC.ships).map(([id, d]) => ({ id, label: d.label, inStock: counts[id] ?? 0, pledged: hulls.find((h) => h.shipId === id)?.count ?? 0, range: d.range, troopSpace: d.troopSpace })),
    };
    return { composureDays: settled.composureDays, view: view as KoinonError | MyPledgeView };
  });
  await applyShrine(ctx, outcome.composureDays, now);
  return outcome.view;
}

// --- The muster as it stands ---------------------------------------------------
// Who has pledged what, read from the rows and the hull counts. Only current
// members count (P10), a row counts while it stands ready at the gathering
// place, and a hull pledge counts as the smaller of the pledge and the owner's
// stock (P5). The read-only page and the locked resolve both start from this.

export type MusterOwner = { playerId: string; name: string; rows: UnitRow[]; hulls: MusterHull[] };
export type MusterState = { owners: MusterOwner[]; rows: UnitRow[]; hulls: MusterHull[] };

export async function musterState(exec: Exec, muster: Pick<MusterRow, "id" | "koinonId" | "gatherId">, now: Date): Promise<MusterState> {
  const shipsC = getShipsContent();
  const members = await exec
    .select({ playerId: koinonMembers.playerId, name: players.name })
    .from(koinonMembers)
    .innerJoin(players, eq(players.id, koinonMembers.playerId))
    .where(eq(koinonMembers.koinonId, muster.koinonId))
    .orderBy(asc(koinonMembers.joinedAt), asc(koinonMembers.playerId));
  const memberIds = new Set(members.map((m) => m.playerId));
  const rows = (await pledgedRows(exec, muster.id)).filter((r) => memberIds.has(r.ownerPlayerId) && r.basedAt === muster.gatherId && isActive(r, now) && r.count > 0);
  const pledges = (await exec.select().from(koinonMusterHulls).where(eq(koinonMusterHulls.musterId, muster.id))).filter((h) => memberIds.has(h.ownerPlayerId));
  const owners = [...new Set(pledges.map((h) => h.ownerPlayerId))];
  const stock =
    owners.length === 0
      ? []
      : await exec
          .select({ scopeId: resources.scopeId, type: resources.type, amount: resources.amount })
          .from(resources)
          .where(and(eq(resources.scope, "player"), inArray(resources.scopeId, owners), inArray(resources.type, Object.keys(shipsC.ships))));
  const inStock = (ownerId: string, shipId: string) => Math.max(0, Math.floor(Number(stock.find((s) => s.scopeId === ownerId && s.type === shipId)?.amount ?? 0)));
  const hulls: MusterHull[] = [];
  for (const h of pledges) {
    const def = shipsC.ships[h.shipId];
    const count = Math.min(h.count, inStock(h.ownerPlayerId, h.shipId));
    if (def && count > 0) hulls.push({ ownerId: h.ownerPlayerId, shipId: h.shipId, count, range: def.range, troopSpace: def.troopSpace, naval: def.naval, pledgedAtMs: h.pledgedAt.getTime() });
  }
  return {
    owners: members
      .map((m) => ({ playerId: m.playerId, name: m.name, rows: rows.filter((r) => r.ownerPlayerId === m.playerId), hulls: hulls.filter((h) => h.ownerId === m.playerId) }))
      .filter((o) => o.rows.length > 0 || o.hulls.length > 0),
    rows,
    hulls,
  };
}

const forceOf = (rows: UnitRow[]): ReachForceRow[] => rows.map((r) => forceRowOf(r)).filter((f): f is ReachForceRow => f !== null);

// The launch verdict for a force and a fleet, from the gathering place: the
// same pure rules `act` uses, computed once at launch and shown on the page as
// the pledges stand. `space` is the room the men need, `hullSpace` the seats on
// the hulls that can make the crossing (0 by land).
export type MusterOutlook = { route: "land" | "sea" | null; steps: number | null; ok: boolean; reason: string | null; space: number; hullSpace: number };
export function musterOutlook(muster: Pick<MusterRow, "gatherRegionId" | "regionId">, state: Pick<MusterState, "rows" | "hulls">): MusterOutlook {
  const steps = musterSteps(muster.gatherRegionId, muster.regionId);
  const force = forceStats(forceOf(state.rows));
  const fleet = fleetStats(state.hulls.map((h) => ({ shipId: h.shipId, count: h.count, range: h.range, troopSpace: h.troopSpace })));
  const verdict = verdictsFor(steps, force, fleet).raid;
  const route = routeFor("raid", steps);
  return { route: route?.route ?? null, steps: route?.steps ?? null, ok: verdict.ok, reason: verdict.reason ?? null, space: force.space, hullSpace: route?.route === "sea" ? fleetSpaceAt(fleet, route.steps) : 0 };
}

// --- The muster on the koinon page (read-only) -----------------------------------

export type MusterView = {
  id: string;
  kind: "raid";
  openerName: string;
  canCancel: boolean;
  target: { regionId: string; townId: string | null; name: string };
  gather: { id: string; name: string };
  openedLabel: string;
  launchAt: string;
  pledges: { playerId: string; name: string; men: number; space: number; pentekonters: number; triremes: number }[];
  outlook: MusterOutlook;
};
export type LastMusterView = { id: string; targetName: string; gatherName: string; launchLabel: string; status: "resolved" | "stood_down" | "cancelled"; reason: string | null; report: Record<string, unknown> | null };

const gameLabel = (at: Date, ctx: ActingContext) => formatGameDate(gameDate(at.getTime(), ctx.worldStartedMs));

// The open muster and the most recent closed one, for a member. It writes
// nothing: the outlook is derived from the pledges as they stand.
export async function musterBlocks(exec: Exec, k: KoinonRow, role: KoinonRole, ctx: ActingContext, now: Date): Promise<{ muster: MusterView | null; lastMuster: LastMusterView | null }> {
  const open = await openMusterOf(exec, k.id);
  let muster: MusterView | null = null;
  if (open) {
    const state = await musterState(exec, open, now);
    const opener = (await exec.select({ name: players.name }).from(players).where(eq(players.id, open.openerPlayerId)).limit(1))[0];
    const hullCount = (o: MusterOwner, shipId: string) => o.hulls.filter((h) => h.shipId === shipId).reduce((n, h) => n + h.count, 0);
    muster = {
      id: open.id,
      kind: open.kind,
      openerName: opener?.name ?? "—",
      canCancel: role === "leader" || open.openerPlayerId === ctx.playerId,
      target: { regionId: open.regionId, townId: open.townId, name: await musterTargetName(open) },
      gather: { id: open.gatherId, name: await musterGatherName(open) },
      openedLabel: gameLabel(open.openedAt, ctx),
      launchAt: open.launchAt.toISOString(),
      pledges: state.owners.map((o) => {
        const force = forceStats(forceOf(o.rows));
        return { playerId: o.playerId, name: o.name, men: force.men, space: force.space, pentekonters: hullCount(o, "trade-ship"), triremes: hullCount(o, "galley") };
      }),
      outlook: musterOutlook(open, state),
    };
  }
  const closed = (await exec.select().from(koinonMusters).where(and(eq(koinonMusters.koinonId, k.id), ne(koinonMusters.status, "open"))).orderBy(desc(koinonMusters.closedAt), desc(koinonMusters.openedAt)).limit(1))[0];
  const lastMuster: LastMusterView | null = closed
    ? {
        id: closed.id,
        targetName: await musterTargetName(closed),
        gatherName: await musterGatherName(closed),
        launchLabel: gameLabel(closed.launchAt, ctx),
        status: closed.status as LastMusterView["status"],
        reason: typeof closed.report?.reason === "string" ? closed.report.reason : null,
        report: closed.report ?? null,
      }
    : null;
  return { muster, lastMuster };
}

// P12: an open muster the member has not seen (opened after his last read, and
// not by him). One lean count, beside the posts' unread count.
export async function unseenMuster(exec: Exec, playerId: string, worldId: string): Promise<number> {
  const rows = await exec
    .select({ n: sql<number>`count(*)::int` })
    .from(koinonMusters)
    .innerJoin(koinonMembers, eq(koinonMembers.koinonId, koinonMusters.koinonId))
    .where(and(eq(koinonMembers.worldId, worldId), eq(koinonMembers.playerId, playerId), eq(koinonMusters.status, "open"), ne(koinonMusters.openerPlayerId, playerId), sql`${koinonMusters.openedAt} > ${koinonMembers.lastReadAt}`));
  return Number(rows[0]?.n ?? 0);
}
