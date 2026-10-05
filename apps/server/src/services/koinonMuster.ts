import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { createDb, effectLog, koinonMembers, koinonMusterHulls, koinonMusters, playerCharacters, players, playerUnits, resources, worlds, type UnitMission } from "@massalia/db";
import {
  bandDef,
  distancesFrom,
  fleetSpaceAt,
  fleetStats,
  forceStats,
  formatGameDate,
  gameDate,
  HOME_POLITY_ID,
  loadMusterHulls,
  musterLaunch,
  musterShares,
  REACH_REASON,
  renderMusterLine,
  renderMusterReportLine,
  resolveBattle,
  routeFor,
  splitByShares,
  stepsTo,
  unitDef,
  verdictsFor,
  type BattleRow,
  type MusterChronicle,
  type MusterHull,
  type ReachForceRow,
  type ReachSteps,
} from "@massalia/shared";
import { fleetInStock, getBandsContent, getBattleContent, getShipsContent, getUnitsContent, isActive, isPledged, type UnitRow } from "./barracks.js";
import { applyComposureDelta } from "./composure.js";
import { settleAll, type ActingContext } from "./buildings.js";
import { creditDrachmae, creditGood, listHoldings } from "./holdings.js";
import { getKoinonContent, inOwnKoinon, lockKoinon, memberRow, type KoinonError, type KoinonRole, type KoinonRow } from "./koinon.js";
import { lockPlayer } from "./lock.js";
import { describeForce, selectForce, splitRows } from "./mapActions.js";
import { getTopology } from "./mapGraph.js";
import { regionDisplayName, townDisplayName } from "./mapNames.js";
import { readRegionWarband, readTownFleet, readTownGarrison, townContentOwner, writeRegionWarband, writeTownGarrison } from "./mapPools.js";
import { forceRowOf, homePlaces, homeRegions } from "./mapReach.js";
import { townStats } from "./townStats.js";

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
//
// The resolve is lazy and lives here, not in the worker (which cannot reach the
// economy): resolveMuster computes everything as of the launch instant, and a
// preHandler hook runs it before any request that could see or change its
// inputs, so the result is the one a job at launch would have given.
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
export type LastMusterView = { id: string; targetName: string; gatherName: string; launchLabel: string; status: "resolved" | "stood_down" | "cancelled"; reason: string | null; report: MusterReport | null };

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
        report: (closed.report as MusterReport | null) ?? null,
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

// --- The resolve ------------------------------------------------------------------

// One member's part in a marched muster: the men he sent and lost, the hulls of
// his that sailed, the seats of them that were filled, his shares and his part
// of the plunder.
export type MusterPart = { playerId: string; name: string; men: number; lost: number; hulls: number; seats: number; shares: number; drachmae: number; grain: number };
// The report stored on the muster and shown to every member as the last muster.
export type MusterReport = {
  outcome: "won" | "driven_off" | "repulsed" | "stood_down";
  reason: string | null;
  line: string | null;
  regionId: string;
  regionName: string;
  townId: string | null;
  townName: string | null;
  gatherId: string;
  gatherName: string;
  launchAt: string;
  route: "land" | "sea" | null;
  steps: number | null;
  recoveryHours: number | null;
  arrivesAt: string | null;
  rounds: number;
  men: number;
  lost: number;
  killed: number;
  defender: { label: string; start: number; end: number } | null;
  fleet: { hulls: Record<string, number>; naval: number; space: number; filled: number; defender: { pentekonters: number; triremes: number; naval: number } | null; held: boolean } | null;
  plunder: { drachmae: number; grain: number } | null;
  parts: MusterPart[];
};

// "busy": another transaction is resolving this muster. "not_due": there is
// nothing to resolve (unknown, already closed, or not yet at its launch).
export type MusterResolved = { outcome: "busy" | "not_due" | "resolved" | "stood_down" };

const MS_PER_HOUR = 3_600_000;
// The muster's own advisory key, in the two-int keyspace so it can never meet a
// player lock (lock.ts uses the single-key form).
const musterLockKey = (musterId: string) => sql`hashtext('koinon_muster'), hashtext(${musterId}::text)`;
const ownsMusterRow = (musterId: string) => and(sql`${playerUnits.mission}->>'kind' = 'muster'`, sql`${playerUnits.mission}->>'musterId' = ${musterId}`);

// Everyone with a pledge to the muster, in ascending id order: owners of rows
// that carry its mission, and owners of hull pledges.
async function pledgingOwners(exec: Exec, musterId: string): Promise<string[]> {
  const men = await exec.selectDistinct({ id: playerUnits.ownerPlayerId }).from(playerUnits).where(ownsMusterRow(musterId));
  const hulls = await exec.selectDistinct({ id: koinonMusterHulls.ownerPlayerId }).from(koinonMusterHulls).where(eq(koinonMusterHulls.musterId, musterId));
  return [...new Set([...men, ...hulls].map((r) => r.id))].sort();
}

// Step 4 found a pledger whose lock this transaction does not hold: roll back
// and take the locks again.
class OwnersChanged extends Error {}

// The muster marches (rulings 4 and 5, P5 to P10). One transaction, and every
// clock in it is the muster's launch instant, never `now`: `now` only decides
// whether the muster is due. Resolved 30 minutes or 3 days after launch, the
// result is the same.
export async function resolveMuster(musterId: string, now: Date): Promise<MusterResolved> {
  const unitsC = getUnitsContent();
  const bandsC = getBandsContent();
  const battleC = getBattleContent();
  for (let attempt = 1; ; attempt++) {
    try {
      const done = await db.transaction(async (tx): Promise<MusterResolved & { launchAt?: Date; shrine?: { ctx: ActingContext; composureDays: number }[] }> => {
        // 0. A muster being resolved elsewhere is skipped, not waited on.
        const lock = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(${musterLockKey(musterId)}) AS granted`);
        if (!(lock.rows as { granted: boolean }[])[0]?.granted) return { outcome: "busy" };

        // 1. The muster and its pledging owners, unlocked.
        const due = (await tx.select().from(koinonMusters).where(eq(koinonMusters.id, musterId)).limit(1))[0];
        if (!due || due.status !== "open" || due.launchAt.getTime() > now.getTime()) return { outcome: "not_due" };
        const before = await pledgingOwners(tx, musterId);

        // 2. Every owner's player lock in ascending id order, then the koinon
        // lock: player locks first, the koinon lock last (the rule above lockKoinon).
        for (const id of before) await lockPlayer(tx, id);
        const k = await lockKoinon(tx, due.koinonId);

        // 3. Claim first. A lost claim applies nothing.
        const launchAt = due.launchAt;
        const muster = (
          await tx
            .update(koinonMusters)
            .set({ status: "resolved", closedAt: launchAt })
            .where(and(eq(koinonMusters.id, musterId), eq(koinonMusters.status, "open"), lte(koinonMusters.launchAt, now)))
            .returning()
        )[0];
        if (!muster) return { outcome: "not_due" };

        // 4. The owners again, under the locks. A pledge that landed between
        // step 1 and the koinon lock belongs to a player this transaction has
        // not locked: start again.
        const owners = await pledgingOwners(tx, musterId);
        if (owners.length !== before.length || owners.some((id, i) => id !== before[i])) throw new OwnersChanged();

        // 5. Only owners who are still members (P10). A dissolved koinon has none.
        const members = k ? await tx.select({ playerId: koinonMembers.playerId, name: players.name }).from(koinonMembers).innerJoin(players, eq(players.id, koinonMembers.playerId)).where(eq(koinonMembers.koinonId, k.id)) : [];
        const nameOf = new Map(members.map((m) => [m.playerId, m.name]));
        const world = (await tx.select({ startedAt: worlds.startedAt }).from(worlds).where(eq(worlds.id, muster.worldId)).limit(1))[0]!;
        const characterOf = new Map<string, string>();
        for (const id of owners) {
          const characterId = nameOf.has(id) ? await characterIdOf(tx, id) : null;
          if (characterId) characterOf.set(id, characterId);
        }
        const marching = owners.filter((id) => characterOf.has(id));

        // 6. Each owner's own settle at the launch instant: upkeep to that
        // instant is charged on the roster that stood, and men he can no longer
        // pay are gone before they fight.
        const shrine: { ctx: ActingContext; composureDays: number }[] = [];
        for (const id of marching) {
          const ctx: ActingContext = { playerId: id, worldId: muster.worldId, worldStartedMs: world.startedAt.getTime() };
          const settled = await settleAll(tx, ctx, launchAt);
          if (settled.composureDays > 0) shrine.push({ ctx, composureDays: settled.composureDays });
        }

        // 7. The army: every row still standing with this muster's mission at
        // the gathering place, active. The fleet: each hull pledge at the
        // smaller of the pledge and the owner's stock (P5).
        const state = await musterState(tx, muster, launchAt);
        // Owners in the koinon's standing order, each one's rows oldest first: the
        // order the battle sees is fixed by the data, not by who asked.
        const sides = state.owners.filter((o) => characterOf.has(o.playerId));
        const army = sides.flatMap((o) => o.rows);
        const hulls = sides.flatMap((o) => o.hulls);
        const force = forceStats(forceOf(army));

        const isTown = muster.townId !== null;
        const regionName = await regionDisplayName(muster.regionId);
        const townName = muster.townId !== null ? await townDisplayName(muster.townId) : null;
        const place = { regionId: muster.regionId, regionName, townId: muster.townId, townName };
        const blank = { ...place, gatherId: muster.gatherId, gatherName: await musterGatherName(muster), launchAt: launchAt.toISOString() };
        // Whatever still carries the muster's mission on a locked member is
        // freed here; rows of a player who left are his own settle's to free.
        const release = async () => {
          const locked = owners.filter((id) => nameOf.has(id));
          if (locked.length > 0) await tx.update(playerUnits).set({ mission: null }).where(and(ownsMusterRow(muster.id), inArray(playerUnits.ownerPlayerId, locked)));
        };
        const close = async (status: "resolved" | "stood_down", report: MusterReport) => {
          await tx.delete(koinonMusterHulls).where(eq(koinonMusterHulls.musterId, muster.id));
          await tx.update(koinonMusters).set({ status, report }).where(eq(koinonMusters.id, muster.id));
        };
        // P9: a muster that cannot march stands down. Rows are free at once, with no recovery.
        const standDown = async (reason: string): Promise<MusterResolved & { launchAt: Date; shrine: typeof shrine }> => {
          await release();
          await close("stood_down", { ...blank, outcome: "stood_down", reason, line: null, route: null, steps: null, recoveryHours: null, arrivesAt: null, rounds: 0, men: 0, lost: 0, killed: 0, defender: null, fleet: null, plunder: null, parts: [] });
          return { outcome: "stood_down", launchAt, shrine };
        };

        // 8. No men.
        if (army.length === 0 || force.men === 0) return standDown(REACH_REASON.noMen);

        // 9. Reach, once, from the gathering place with the pooled fleet.
        const outlook = musterOutlook(muster, { rows: army, hulls });
        if (!outlook.ok || outlook.route === null || outlook.steps === null) return standDown(outlook.reason ?? "Out of reach.");
        const { route, steps } = outlook;

        // 10. By sea: the hulls that sail (P6) and the seats loaded (P7).
        const load = route === "sea" ? loadMusterHulls(force.space, steps, hulls) : null;
        const recoveryHours = Math.max(1, steps) * battleC.recovery.hoursPerStep;
        const arrivesAt = new Date(launchAt.getTime() + recoveryHours * MS_PER_HOUR);
        const sum = (rows: { ownerPlayerId: string; count: number }[]) => rows.reduce<Record<string, number>>((out, r) => ({ ...out, [r.ownerPlayerId]: (out[r.ownerPlayerId] ?? 0) + r.count }), {});
        const menOf = sum(army);
        const hullsOf: Record<string, number> = {};
        const sailed: Record<string, number> = {};
        for (const h of load?.sailing ?? []) {
          hullsOf[h.ownerId] = (hullsOf[h.ownerId] ?? 0) + h.count;
          sailed[h.shipId] = (sailed[h.shipId] ?? 0) + h.count;
        }
        // Against a town, the pooled naval power must match its fleet.
        let fleet: MusterReport["fleet"] = null;
        if (load) {
          const townFleet = muster.townId !== null ? await readTownFleet(tx, muster.worldId, muster.townId, launchAt) : null;
          const defender = townFleet && townFleet.pentekonters + townFleet.triremes > 0 ? { ...townFleet, naval: townFleet.pentekonters * 1 + townFleet.triremes * 5 } : null;
          fleet = { hulls: sailed, naval: load.naval, space: load.space, filled: load.filled, defender, held: defender === null || load.naval >= defender.naval };
        }

        const shares = musterShares(menOf, load?.seats ?? {});
        const lostOf: Record<string, number> = {};
        let drachmaeOf: Record<string, number> = {};
        let grainOf: Record<string, number> = {};
        let outcome: "won" | "driven_off" | "repulsed";
        let killed = 0;
        let rounds = 0;
        let defender: MusterReport["defender"] = null;
        let plunder: MusterReport["plunder"] = null;
        let survivors: UnitRow[] = army;

        if (fleet && !fleet.held) {
          // Repulsed at sea: no battle, no losses, home with recovery.
          outcome = "repulsed";
        } else {
          // 11. The defender as it stood at the launch instant: the region's
          // warband, or the town's garrison behind its walls, as in `act`.
          const stats = muster.townId !== null ? await townStats(muster.townId) : null;
          const npc = isTown ? battleC.npc.garrison : battleC.npc.warband;
          const npcStats = { ...npc.stats, def: npc.stats.def + (stats ? Math.min(stats.walls, battleC.town.wallsDefCap) : 0) };
          const pool = muster.townId !== null ? await readTownGarrison(tx, muster.worldId, muster.townId, launchAt) : await readRegionWarband(tx, muster.worldId, muster.regionId, launchAt);

          // 12. One army: every pledged row is its own row in the battle.
          const seed = crypto.createHash("sha256").update([muster.worldId, muster.id, muster.townId ?? muster.regionId, launchAt.toISOString()].join("|")).digest("hex");
          const attacker: BattleRow[] = army.map((r) => {
            const def = r.source === "trained" ? unitDef(unitsC, r.unitId) : bandDef(bandsC, r.unitId);
            return { id: r.id, label: def?.label ?? r.unitId, count: r.count, stats: def!.stats };
          });
          const result = resolveBattle({ attacker, defender: [{ id: isTown ? "garrison" : "warband", label: npc.label, count: pool, stats: npcStats }], seed, config: battleC, mode: "raid" });

          // 13. Losses per row, on its owner: shrink or delete, one battle_loss
          // log each, as `act` writes them. The pool is written back.
          survivors = [];
          for (const r of army) {
            const side = result.attacker.rows.find((x) => x.id === r.id)!;
            const lost = side.start - side.end;
            if (lost > 0) {
              lostOf[r.ownerPlayerId] = (lostOf[r.ownerPlayerId] ?? 0) + lost;
              await tx.insert(effectLog).values({ characterId: characterOf.get(r.ownerPlayerId)!, kind: "battle_loss", detail: { rowId: r.id, unitId: r.unitId, source: r.source, lost, regionId: muster.regionId, townId: muster.townId, action: "raid", musterId: muster.id }, createdAt: launchAt });
            }
            if (side.end <= 0) await tx.delete(playerUnits).where(eq(playerUnits.id, r.id));
            else {
              if (lost > 0) await tx.update(playerUnits).set({ count: side.end }).where(eq(playerUnits.id, r.id));
              survivors.push({ ...r, count: side.end });
            }
          }
          killed = result.defender.losses;
          rounds = result.rounds.length;
          const remaining = Math.max(0, pool - killed);
          if (muster.townId !== null) await writeTownGarrison(tx, muster.worldId, muster.townId, remaining, launchAt);
          else await writeRegionWarband(tx, muster.worldId, muster.regionId, remaining, launchAt);
          defender = { label: npc.label, start: pool, end: remaining };
          outcome = result.winner === "attacker" ? "won" : "driven_off";

          // 14. On a win: the plunder by `act`'s formula, split by shares
          // (ruling 5, P7, P8) and credited to each owner.
          if (result.winner === "attacker") {
            const mult = isTown ? battleC.raid.townPlunderMultiplier : 1;
            plunder = { drachmae: Math.round(killed * battleC.raid.plunderPerKill * mult), grain: Math.round(killed * battleC.raid.grainPerKill * mult) };
            drachmaeOf = splitByShares(plunder.drachmae, shares);
            grainOf = splitByShares(plunder.grain, shares);
            for (const id of Object.keys(shares).sort()) {
              await creditDrachmae(tx, id, drachmaeOf[id] ?? 0);
              await creditGood(tx, id, "grain", grainOf[id] ?? 0, launchAt);
            }
          }
        }

        // 15. Recovery: every surviving row is bound for the gathering place,
        // counted from the launch instant.
        const mission: UnitMission = { kind: "raid", regionId: muster.regionId, ...(muster.townId !== null ? { townId: muster.townId } : {}), departedAt: launchAt.toISOString() };
        for (const r of survivors) await tx.update(playerUnits).set({ movingTo: muster.gatherId, arrivesAt, mission }).where(eq(playerUnits.id, r.id));
        await release();

        // 16. One line per participant, with his own part, and the report on the muster.
        const lost = Object.values(lostOf).reduce((n, v) => n + v, 0);
        const participants = sides.filter((o) => (menOf[o.playerId] ?? 0) > 0 || (hullsOf[o.playerId] ?? 0) > 0);
        for (const o of participants) {
          const chronicle: MusterChronicle = {
            koinonName: k?.name ?? "",
            regionId: muster.regionId,
            regionName,
            ...(muster.townId !== null ? { townId: muster.townId, townName: townName! } : {}),
            force: describeForce(o.rows),
            hulls: hullsOf[o.playerId] ?? 0,
            winner: outcome === "won" ? "attacker" : outcome === "repulsed" ? "repulsed" : "defender",
            killed,
            lost: lostOf[o.playerId] ?? 0,
            share: outcome === "won" ? { drachmae: drachmaeOf[o.playerId] ?? 0, grain: grainOf[o.playerId] ?? 0 } : null,
          };
          await tx.insert(effectLog).values({ characterId: characterOf.get(o.playerId)!, kind: "koinon_muster", detail: { chronicle, musterId: muster.id, line: renderMusterLine(chronicle), source: "koinon" }, createdAt: launchAt });
        }
        await close("resolved", {
          ...blank,
          outcome,
          reason: null,
          line: renderMusterReportLine({ ...place, outcome, men: force.men, killed, lost, plunder }),
          route,
          steps,
          recoveryHours,
          arrivesAt: arrivesAt.toISOString(),
          rounds,
          men: force.men,
          lost,
          killed,
          defender,
          fleet,
          plunder,
          parts: participants.map((o) => ({
            playerId: o.playerId,
            name: o.name,
            men: menOf[o.playerId] ?? 0,
            lost: lostOf[o.playerId] ?? 0,
            hulls: hullsOf[o.playerId] ?? 0,
            seats: load?.seats[o.playerId] ?? 0,
            shares: shares[o.playerId] ?? 0,
            drachmae: drachmaeOf[o.playerId] ?? 0,
            grain: grainOf[o.playerId] ?? 0,
          })),
        });
        return { outcome: "resolved", launchAt, shrine };
      });

      // Shrine composure banked by the owners' settles, after the commit, as `act` does.
      for (const s of done.shrine ?? []) await applyShrine(s.ctx, s.composureDays, done.launchAt!);
      return { outcome: done.outcome };
    } catch (err) {
      if (!(err instanceof OwnersChanged) || attempt >= 5) throw err;
    }
  }
}

// --- The hook: due musters resolve before any request ---------------------------------

const RESOLVE_BACKOFF_MS = 60_000;
// When a muster's resolve last threw, by muster id, in this process: it is not
// tried again for a minute, so a muster in trouble cannot slow every request.
const failedAt = new Map<string, number>();

export type MusterResolverDeps = {
  resolve?: (musterId: string, now: Date) => Promise<unknown>;
  onError?: (musterId: string, err: unknown) => void;
};

// Every open muster whose launch instant has passed, oldest first: one indexed
// query when nothing is due. A resolve that throws is reported once and left
// open for a later request; it never throws from here.
export async function resolveDueMusters(now: Date, deps: MusterResolverDeps = {}): Promise<void> {
  const due = await db.select({ id: koinonMusters.id }).from(koinonMusters).where(and(eq(koinonMusters.status, "open"), lte(koinonMusters.launchAt, now))).orderBy(asc(koinonMusters.launchAt), asc(koinonMusters.id));
  for (const { id } of due) {
    const failed = failedAt.get(id);
    if (failed !== undefined && now.getTime() - failed < RESOLVE_BACKOFF_MS) continue;
    try {
      await (deps.resolve ?? resolveMuster)(id, now);
      failedAt.delete(id);
    } catch (err) {
      failedAt.set(id, now.getTime());
      (deps.onError ?? ((musterId, error) => console.error(`[muster] resolve of ${musterId} failed`, error)))(id, err);
    }
  }
}

// Between a muster's launch and its resolve only time passes, because every
// write in the game happens inside a request. So the resolve runs before the
// handler of any request under /api, /me or /admin (never /health or static
// content), and the handler then sees the muster already marched. The hook
// never fails a request.
export function registerMusterResolver(app: FastifyInstance, deps: MusterResolverDeps & { now?: () => Date } = {}): void {
  app.addHook("preHandler", async (req) => {
    const path = req.url.split("?")[0]!;
    if (!path.startsWith("/api/") && path !== "/me" && !path.startsWith("/me/") && path !== "/admin" && !path.startsWith("/admin/")) return;
    try {
      await resolveDueMusters(deps.now ? deps.now() : new Date(), {
        resolve: deps.resolve,
        onError: deps.onError ?? ((musterId, err) => req.log.error({ err, musterId }, "muster resolve failed")),
      });
    } catch (err) {
      req.log.error({ err }, "muster resolver failed");
    }
  });
}
