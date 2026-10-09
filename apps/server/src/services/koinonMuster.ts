import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, inArray, isNull, lte, ne, notInArray, sql } from "drizzle-orm";
import { createDb, effectLog, koinonMembers, koinonMusterHulls, koinonMusters, playerCharacters, playerMarches, players, playerUnits, resources, worlds, type UnitMission } from "@massalia/db";
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
  marchMinutes,
  musterLaunch,
  musterShares,
  musterWinter,
  raidPlunder,
  raidTurnout,
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
  type PlunderPayload,
  type ReachForceRow,
  type ReachSteps,
} from "@massalia/shared";
import { altarBonusFor, fleetInStock, getBandsContent, getBattleContent, getShipsContent, getUnitsContent, isActive, isPledged, sailHulls, type UnitRow } from "./barracks.js";
import { applyComposureDelta } from "./composure.js";
import { settleAll, type ActingContext } from "./buildings.js";
import { creditDrachmae, creditGood, holderOf, listHoldings } from "./holdings.js";
import { getKoinonContent, inOwnKoinon, lockKoinon, memberRow, type KoinonError, type KoinonRole, type KoinonRow } from "./koinon.js";
import { lockPlayer } from "./lock.js";
import { describeForce, resolveMarch, selectForce, spoilLabel, splitRows, writeIntel } from "./mapActions.js";
import { getTopology } from "./mapGraph.js";
import { regionDisplayName, townDisplayName } from "./mapNames.js";
import { raidOpinion, type RaidOpinion } from "./factionOpinion.js";
import { readRegionWarband, readTownFleet, readTownGarrison, regionContentOwner, townContentOwner, writeRegionWarband, writeTownGarrison } from "./mapPools.js";
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
// Pledged hulls are counts in koinon_muster_hulls; the hulls that sail leave
// their owners' stock from the launch until the army is home (sailHulls, raids
// prompt 3), and pledged hulls that do not sail never leave.
//
// Locks. Every write that changes a muster runs under the koinon lock, through
// inOwnKoinon. A write that touches the caller's own rows takes his player
// lock first and settles him. The order is the one koinon.ts sets: a player
// lock before the koinon lock, never after. Calling a muster off writes no
// one's rows: each owner's own settle releases them (barracks.ts).
//
// The march (raids prompt 5). At the launch instant everything is decided as
// before (the members who still count, each owner's settle, the pledged men
// and hulls, the stand-downs, the hulls that sail and the seats they fill), and
// an army that marches sets out: its rows on the road to the target on the
// march clock, its hulls at sea for the round trip, the muster 'marching' with
// what it took on the road (`march`). The battle is fought when the army
// arrives, against the place as it stands then, every clock in it the arrival;
// the survivors take the same road home. An army that finds the place held by
// one of its own houses turns back; one whose men all left on the road breaks
// up. One muster at a time: a koinon cannot call another while its army marches.
//
// The resolve is lazy and lives here, not in the worker (which cannot reach the
// economy): resolveMuster computes everything as of the launch or the arrival
// instant, and a preHandler hook runs it before any request that could see or
// change its inputs, so the result is the one a job at that instant would have
// given. The same hook resolves a party's march at its arrival (resolveMarch,
// raids prompt 4): launches and both kinds of arrival in the order they fall.
// ---------------------------------------------------------------------------

const db = createDb();
type DbTx = Parameters<Parameters<ReturnType<typeof createDb>["transaction"]>[0]>[0];
type Exec = DbTx | typeof db;

export type MusterRow = typeof koinonMusters.$inferSelect;
type Ok = KoinonError | { ok: true };

const fail = (code: number, error: string): KoinonError => ({ ok: false, code, error });
const NO_MUSTER = fail(409, "The koinon has no muster open.");
const MARCHED = fail(409, "The muster has already marched.");
const ON_THE_MARCH = fail(409, "The koinon's army is still on the march.");
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
// The koinon's army on the march (raids prompt 5): launched, not yet arrived.
export async function marchingMusterOf(exec: Exec, koinonId: string): Promise<MusterRow | null> {
  return (await exec.select().from(koinonMusters).where(and(eq(koinonMusters.koinonId, koinonId), eq(koinonMusters.status, "marching"))).limit(1))[0] ?? null;
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

// The character's dynasty, whose intel a fight updates; null without one.
async function dynastyIdOf(exec: Exec, playerId: string): Promise<string | null> {
  return (await exec.select({ dynastyId: playerCharacters.dynastyId }).from(playerCharacters).where(eq(playerCharacters.playerId, playerId)).limit(1))[0]?.dynastyId ?? null;
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
      // One muster at a time (raids prompt 5): none while the army marches.
      if (await marchingMusterOf(tx, k.id)) return ON_THE_MARCH;
      // Two members opening at once: the partial unique index (open or marching) lets one row in.
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
// `winter` is the Winter a launch chosen now could land in (server clock), so
// the launch picker can grey out the leads that fall inside it.
export type MusterTargetsView = { now: string; winter: { from: string; until: string } | null; gathers: { id: string; name: string }[]; gatherId: string; targets: MusterTargetView[] };

// GET /api/koinon/muster/targets?gather= — every legal target reachable in
// principle from that gathering place, by name. No garrison, warband or fleet
// numbers: only where it is and how far.
export async function musterTargets(ctx: ActingContext, gatherId: unknown, now: Date): Promise<KoinonError | MusterTargetsView> {
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
  const winter = musterWinter(now.getTime(), ctx.worldStartedMs, getKoinonContent());
  return {
    now: now.toISOString(),
    winter: winter ? { from: new Date(winter.fromMs).toISOString(), until: new Date(winter.untilMs).toISOString() } : null,
    gathers: gathers.map((g) => ({ id: g.id, name: g.name })),
    gatherId: gather.id,
    targets,
  };
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
// The koinon's army on the march (raids prompt 5): where it is bound, when it
// arrives, and who sent what, with each member's current name.
export type MarchingMusterView = {
  id: string;
  target: { regionId: string; townId: string | null; name: string };
  gather: { id: string; name: string };
  launchAt: string;
  arrivesAt: string;
  route: "land" | "sea";
  steps: number;
  men: number;
  hulls: number;
  parts: { playerId: string; name: string; men: number; hulls: number }[];
};

const gameLabel = (at: Date, ctx: ActingContext) => formatGameDate(gameDate(at.getTime(), ctx.worldStartedMs));

// The open muster, the army on the march and the most recent closed one, for
// a member. It writes nothing: the outlook is derived from the pledges as they stand.
export async function musterBlocks(exec: Exec, k: KoinonRow, role: KoinonRole, ctx: ActingContext, now: Date): Promise<{ muster: MusterView | null; marching: MarchingMusterView | null; lastMuster: LastMusterView | null }> {
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
  const onTheMarch = await marchingMusterOf(exec, k.id);
  let marching: MarchingMusterView | null = null;
  if (onTheMarch && onTheMarch.arrivesAt && onTheMarch.march) {
    const snapshot = onTheMarch.march as unknown as MusterMarch;
    const ids = snapshot.parts.map((p) => p.playerId);
    const names = ids.length ? await exec.select({ id: players.id, name: players.name }).from(players).where(inArray(players.id, ids)) : [];
    const nameOf = new Map(names.map((n) => [n.id, n.name]));
    const parts = snapshot.parts.map((p) => ({ playerId: p.playerId, name: nameOf.get(p.playerId) ?? "—", men: p.men, hulls: p.hulls }));
    marching = {
      id: onTheMarch.id,
      target: { regionId: onTheMarch.regionId, townId: onTheMarch.townId, name: await musterTargetName(onTheMarch) },
      gather: { id: onTheMarch.gatherId, name: await musterGatherName(onTheMarch) },
      launchAt: onTheMarch.launchAt.toISOString(),
      arrivesAt: onTheMarch.arrivesAt.toISOString(),
      route: snapshot.route,
      steps: snapshot.steps,
      men: parts.reduce((n, p) => n + p.men, 0),
      hulls: parts.reduce((n, p) => n + p.hulls, 0),
      parts,
    };
  }
  // A marching row has no closedAt, and DESC puts NULLs first: it is left out with the open one.
  const closed = (await exec.select().from(koinonMusters).where(and(eq(koinonMusters.koinonId, k.id), notInArray(koinonMusters.status, ["open", "marching"]))).orderBy(desc(koinonMusters.closedAt), desc(koinonMusters.openedAt)).limit(1))[0];
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
  return { muster, marching, lastMuster };
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
// of the plunder (`spoil` is his part of the third good; the good itself is on
// the report's plunder).
export type MusterPart = { playerId: string; name: string; men: number; lost: number; hulls: number; seats: number; shares: number; drachmae: number; grain: number; spoil: number };
// The report stored on the muster and shown to every member as the last muster.
export type MusterReport = {
  // "turned_back": the army found the place held by one of its own houses when
  // it arrived; "dispersed": its men all left the roster on the road (raids prompt 5).
  outcome: "won" | "driven_off" | "repulsed" | "stood_down" | "turned_back" | "dispersed";
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
  // The road's minutes each way (raids prompt 4), the instant the army reached
  // the place and when the survivors are home (raids prompt 5): all null on a
  // stand-down; `homeAt` also null on a break-up and when no one comes home.
  minutes: number | null;
  arrivedAt: string | null;
  homeAt: string | null;
  rounds: number;
  men: number;
  lost: number;
  killed: number;
  // The pool before and after, and `turnout`, the men who met the raid: half to
  // all of the army's men, between the floor and the cap of the pool.
  defender: { label: string; start: number; end: number; turnout: number } | null;
  fleet: { hulls: Record<string, number>; naval: number; space: number; filled: number; defender: { pentekonters: number; triremes: number; naval: number } | null; held: boolean } | null;
  plunder: PlunderPayload | null;
  // The nation whose land it was and whose opinion the raid lowered (one roll
  // for the whole army); null when repulsed, stood down, or the roll missed.
  opinion: RaidOpinion | null;
  parts: MusterPart[];
};

// "busy": another transaction is resolving this muster. "not_due": there is
// nothing to resolve (unknown, already closed, or not yet at its launch or its
// arrival). "marched": the launch sent the army out; "resolved": the army
// arrived and the report is stored; "stood_down": it could not march.
export type MusterResolved = { outcome: "busy" | "not_due" | "marched" | "resolved" | "stood_down" };

// What the army took on the road (raids prompt 5), written at the launch and
// read at the arrival: `party` the army's row ids in the order the battle sees
// them; `parts` each member who sent men or had a hull sail, in the koinon's
// standing order, with his men at the launch, his hulls that sailed and the
// seats on them that his and the others' men filled; `fleet` the hulls that
// sailed (null by land).
export type MusterMarch = {
  koinonName: string;
  route: "land" | "sea";
  steps: number;
  minutes: number;
  party: string[];
  parts: { playerId: string; men: number; hulls: number; seats: number }[];
  fleet: { hulls: Record<string, number>; naval: number; space: number; filled: number } | null;
};

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

// The muster's launch, or its army's arrival (rulings 4 and 5, P5 to P10;
// raids prompt 5). One transaction each, and every clock in it is that instant,
// never `now`: `now` only decides whether the muster is due. An open muster
// whose launch has passed launches; a marching one whose arrival has passed
// arrives; anything else is not due. Resolved a minute or three days after
// the instant, the result is the same.
export async function resolveMuster(musterId: string, now: Date): Promise<MusterResolved> {
  for (let attempt = 1; ; attempt++) {
    try {
      const done = await db.transaction(async (tx): Promise<Resolved> => {
        // 0. A muster being resolved elsewhere is skipped, not waited on.
        const lock = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(${musterLockKey(musterId)}) AS granted`);
        if (!(lock.rows as { granted: boolean }[])[0]?.granted) return { outcome: "busy" };
        const due = (await tx.select().from(koinonMusters).where(eq(koinonMusters.id, musterId)).limit(1))[0];
        if (!due) return { outcome: "not_due" };
        if (due.status === "open" && due.launchAt.getTime() <= now.getTime()) return launchMuster(tx, due, now);
        if (due.status === "marching" && due.arrivesAt && due.arrivesAt.getTime() <= now.getTime()) return arriveMuster(tx, due, now);
        return { outcome: "not_due" };
      });
      // Shrine composure banked by the owners' settles, after the commit, as `act` does.
      for (const s of done.shrine ?? []) await applyShrine(s.ctx, s.composureDays, done.at!);
      return { outcome: done.outcome };
    } catch (err) {
      if (!(err instanceof OwnersChanged) || attempt >= 5) throw err;
      // Logged every time: this path has no test, so a retry must be visible.
      console.warn(`[muster] resolve of ${musterId}: attempt ${attempt} of 5 found the pledging owners changed under the locks; retrying`);
    }
  }
}

type Shrine = { ctx: ActingContext; composureDays: number }[];
type Resolved = MusterResolved & { at?: Date; shrine?: Shrine };

// The launch: everything decided as of the launch instant, and the army sent
// out. Nothing is fought here: no pool read, no battle, no intel, no Chronicle
// line, no report.
async function launchMuster(tx: DbTx, due: MusterRow, now: Date): Promise<Resolved> {
  const battleC = getBattleContent();
  const musterId = due.id;
  // 1. The pledging owners, unlocked; then every owner's player lock in
  // ascending id order, then the koinon lock: player locks first, the koinon
  // lock last (the rule above lockKoinon).
  const before = await pledgingOwners(tx, musterId);
  for (const id of before) await lockPlayer(tx, id);
  const k = await lockKoinon(tx, due.koinonId);

  // 2. Claim first: the muster marches. A lost claim applies nothing. Not
  // closed: the army is on the road.
  const launchAt = due.launchAt;
  const muster = (
    await tx
      .update(koinonMusters)
      .set({ status: "marching" })
      .where(and(eq(koinonMusters.id, musterId), eq(koinonMusters.status, "open"), lte(koinonMusters.launchAt, now)))
      .returning()
  )[0];
  if (!muster) return { outcome: "not_due" };

  // 3. The owners again, under the locks. A pledge that landed between step 1
  // and the koinon lock belongs to a player this transaction has not locked:
  // start again.
  const owners = await pledgingOwners(tx, musterId);
  if (owners.length !== before.length || owners.some((id, i) => id !== before[i])) throw new OwnersChanged();

  // 4. Only owners who are still members (P10). A dissolved koinon has none.
  const members = k ? await tx.select({ playerId: koinonMembers.playerId, name: players.name }).from(koinonMembers).innerJoin(players, eq(players.id, koinonMembers.playerId)).where(eq(koinonMembers.koinonId, k.id)) : [];
  const nameOf = new Map(members.map((m) => [m.playerId, m.name]));
  const world = (await tx.select({ startedAt: worlds.startedAt }).from(worlds).where(eq(worlds.id, muster.worldId)).limit(1))[0]!;
  const characterOf = new Map<string, string>();
  for (const id of owners) {
    const characterId = nameOf.has(id) ? await characterIdOf(tx, id) : null;
    if (characterId) characterOf.set(id, characterId);
  }
  const marching = owners.filter((id) => characterOf.has(id));

  // 5. Each owner's own settle at the launch instant: upkeep to that instant
  // is charged on the roster that stood, and men he can no longer pay are gone
  // before they march. The muster is already 'marching', so the settle keeps
  // the rows it is about to send.
  const shrine: Shrine = [];
  for (const id of marching) {
    const ctx: ActingContext = { playerId: id, worldId: muster.worldId, worldStartedMs: world.startedAt.getTime() };
    const settled = await settleAll(tx, ctx, launchAt);
    if (settled.composureDays > 0) shrine.push({ ctx, composureDays: settled.composureDays });
  }

  // 6. The army: every row still standing with this muster's mission at the
  // gathering place, active. The fleet: each hull pledge at the smaller of the
  // pledge and the owner's stock (P5).
  const state = await musterState(tx, muster, launchAt);
  // Owners in the koinon's standing order, each one's rows oldest first: the
  // order the battle sees is fixed by the data, not by who asked.
  const sides = state.owners.filter((o) => characterOf.has(o.playerId));
  const army = sides.flatMap((o) => o.rows);
  const hulls = sides.flatMap((o) => o.hulls);
  const force = forceStats(forceOf(army));

  const regionName = await regionDisplayName(muster.regionId);
  const townName = muster.townId !== null ? await townDisplayName(muster.townId) : null;
  const place = { regionId: muster.regionId, regionName, townId: muster.townId, townName };
  const blank = { ...place, gatherId: muster.gatherId, gatherName: await musterGatherName(muster), launchAt: launchAt.toISOString() };
  // Whatever still carries the muster's mission on a locked member is freed
  // here; rows of a player who left are his own settle's to free.
  const release = async () => {
    const locked = owners.filter((id) => nameOf.has(id));
    if (locked.length > 0) await tx.update(playerUnits).set({ mission: null }).where(and(ownsMusterRow(muster.id), inArray(playerUnits.ownerPlayerId, locked)));
  };
  // P9: a muster that cannot march stands down at its launch. Rows are free at
  // once, nothing sails, and no report reaches the Barracks.
  const standDown = async (reason: string): Promise<Resolved> => {
    await release();
    await tx.delete(koinonMusterHulls).where(eq(koinonMusterHulls.musterId, muster.id));
    const report: MusterReport = { ...blank, outcome: "stood_down", reason, line: null, route: null, steps: null, minutes: null, arrivedAt: null, homeAt: null, rounds: 0, men: 0, lost: 0, killed: 0, defender: null, fleet: null, plunder: null, opinion: null, parts: [] };
    await tx.update(koinonMusters).set({ status: "stood_down", closedAt: launchAt, report }).where(eq(koinonMusters.id, muster.id));
    return { outcome: "stood_down", at: launchAt, shrine };
  };

  // 7. No men.
  if (army.length === 0 || force.men === 0) return standDown(REACH_REASON.noMen);

  // 8. Reach, once, from the gathering place with the pooled fleet.
  const outlook = musterOutlook(muster, { rows: army, hulls });
  if (!outlook.ok || outlook.route === null || outlook.steps === null) return standDown(outlook.reason ?? "Out of reach.");
  const { route, steps } = outlook;

  // 9. By sea: the hulls that sail (P6) and the seats loaded (P7). The road:
  // the army arrives the march's minutes after the launch.
  const load = route === "sea" ? loadMusterHulls(force.space, steps, hulls) : null;
  const minutes = marchMinutes(battleC.march, { route, steps });
  const arrivesAt = new Date(launchAt.getTime() + minutes * 60_000);
  const sum = (rows: { ownerPlayerId: string; count: number }[]) => rows.reduce<Record<string, number>>((out, r) => ({ ...out, [r.ownerPlayerId]: (out[r.ownerPlayerId] ?? 0) + r.count }), {});
  const menOf = sum(army);
  const hullsOf: Record<string, number> = {};
  const sailed: Record<string, number> = {};
  for (const h of load?.sailing ?? []) {
    hullsOf[h.ownerId] = (hullsOf[h.ownerId] ?? 0) + h.count;
    sailed[h.shipId] = (sailed[h.shipId] ?? 0) + h.count;
  }
  // 9b. The hulls that sail leave their owners' stock for the round trip, the
  // launch plus twice the road (raids prompt 3), as `act` sails a party's. Every
  // owner here is locked (step 3) and was settled at the launch instant (step
  // 5), so ships of his that were home by then are in stock. A stand-down and
  // a muster by land sail nothing.
  if (load) {
    const byOwner = new Map<string, Record<string, number>>();
    for (const h of load.sailing) {
      const counts = byOwner.get(h.ownerId) ?? {};
      counts[h.shipId] = (counts[h.shipId] ?? 0) + h.count;
      byOwner.set(h.ownerId, counts);
    }
    for (const ownerId of [...byOwner.keys()].sort()) {
      await sailHulls(tx, { playerId: ownerId, worldId: muster.worldId }, byOwner.get(ownerId)!, { kind: "raid", musterId: muster.id, regionId: muster.regionId, townId: muster.townId, sailedAt: launchAt, returnsAt: new Date(launchAt.getTime() + 2 * minutes * 60_000) });
    }
  }

  // 10. The army sets out: every row of the army, in its order, bound for the
  // target on a "raid" mission that carries the muster's id until it arrives,
  // as `act` sets a party out. Then whatever still carries the pledge is
  // freed, and the hull pledges are gone.
  const mission: UnitMission = { kind: "raid", regionId: muster.regionId, ...(muster.townId !== null ? { townId: muster.townId } : {}), departedAt: launchAt.toISOString(), musterId: muster.id };
  for (const r of army) await tx.update(playerUnits).set({ movingTo: muster.townId ?? muster.regionId, arrivesAt, mission }).where(eq(playerUnits.id, r.id));
  await release();
  await tx.delete(koinonMusterHulls).where(eq(koinonMusterHulls.musterId, muster.id));

  // 11. What the army took on the road, on the row.
  const participants = sides.filter((o) => (menOf[o.playerId] ?? 0) > 0 || (hullsOf[o.playerId] ?? 0) > 0);
  const march: MusterMarch = {
    koinonName: k?.name ?? "",
    route,
    steps,
    minutes,
    party: army.map((r) => r.id),
    parts: participants.map((o) => ({ playerId: o.playerId, men: menOf[o.playerId] ?? 0, hulls: hullsOf[o.playerId] ?? 0, seats: load?.seats[o.playerId] ?? 0 })),
    fleet: load ? { hulls: sailed, naval: load.naval, space: load.space, filled: load.filled } : null,
  };
  await tx.update(koinonMusters).set({ arrivesAt, march }).where(eq(koinonMusters.id, muster.id));
  return { outcome: "marched", at: launchAt, shrine };
}

// The arrival: the army fights the place as it stands at the arrival instant,
// every clock in it that instant.
async function arriveMuster(tx: DbTx, due: MusterRow, now: Date): Promise<Resolved> {
  const unitsC = getUnitsContent();
  const bandsC = getBandsContent();
  const battleC = getBattleContent();
  const snapshot = due.march as unknown as MusterMarch;
  // 1. The snapshot's parts are the participants: each one's player lock in
  // ascending id order, then the koinon lock (null for a koinon dissolved on
  // the march; nothing below needs it).
  const participantIds = [...new Set(snapshot.parts.map((p) => p.playerId))].sort();
  for (const id of participantIds) await lockPlayer(tx, id);
  await lockKoinon(tx, due.koinonId);

  // 2. Claim first. A lost claim applies nothing.
  const at = due.arrivesAt!;
  const muster = (
    await tx
      .update(koinonMusters)
      .set({ status: "resolved", closedAt: at })
      .where(and(eq(koinonMusters.id, due.id), eq(koinonMusters.status, "marching"), lte(koinonMusters.arrivesAt, now)))
      .returning()
  )[0];
  if (!muster) return { outcome: "not_due" };

  // 3. Each participant with a character is settled at the arrival. One with
  // no character is not settled and takes no part: no fight, no share, no line.
  const world = (await tx.select({ startedAt: worlds.startedAt }).from(worlds).where(eq(worlds.id, muster.worldId)).limit(1))[0]!;
  const characterOf = new Map<string, string>();
  const shrine: Shrine = [];
  for (const id of participantIds) {
    const characterId = await characterIdOf(tx, id);
    if (!characterId) continue;
    characterOf.set(id, characterId);
    const ctx: ActingContext = { playerId: id, worldId: muster.worldId, worldStartedMs: world.startedAt.getTime() };
    const settled = await settleAll(tx, ctx, at);
    if (settled.composureDays > 0) shrine.push({ ctx, composureDays: settled.composureDays });
  }
  const names = participantIds.length ? await tx.select({ id: players.id, name: players.name }).from(players).where(inArray(players.id, participantIds)) : [];
  const nameOf = new Map(names.map((n) => [n.id, n.name]));

  // 4. The rows on the road: those whose mission carries this muster's id with
  // kind "raid", in the snapshot's order (rows that left on the road are
  // missing). The army is those whose owner has a character; a member who left
  // the koinon on the march still fights.
  const onRoad = await tx
    .select()
    .from(playerUnits)
    .where(and(sql`${playerUnits.mission}->>'kind' = 'raid'`, sql`${playerUnits.mission}->>'musterId' = ${muster.id}`));
  const rows: UnitRow[] = snapshot.party.map((id) => onRoad.find((r) => r.id === id)).filter((r): r is UnitRow => r !== undefined);
  const army = rows.filter((r) => characterOf.has(r.ownerPlayerId));
  const force = forceStats(forceOf(army));
  const sum = (list: { ownerPlayerId: string; count: number }[]) => list.reduce<Record<string, number>>((out, r) => ({ ...out, [r.ownerPlayerId]: (out[r.ownerPlayerId] ?? 0) + r.count }), {});
  const menOf = sum(army);
  const hullsOf = Object.fromEntries(snapshot.parts.map((p) => [p.playerId, p.hulls]));
  const seatsOf = Object.fromEntries(snapshot.parts.map((p) => [p.playerId, p.seats]));
  // The participants with men in the army or hulls that sailed, in the
  // snapshot's order, each with his rows as they arrived.
  const sides = snapshot.parts
    .filter((p) => characterOf.has(p.playerId) && ((menOf[p.playerId] ?? 0) > 0 || p.hulls > 0))
    .map((p) => ({ playerId: p.playerId, name: nameOf.get(p.playerId) ?? "—", rows: army.filter((r) => r.ownerPlayerId === p.playerId) }));

  const isTown = muster.townId !== null;
  const regionName = await regionDisplayName(muster.regionId);
  const townName = muster.townId !== null ? await townDisplayName(muster.townId) : null;
  const place = { regionId: muster.regionId, regionName, townId: muster.townId, townName };
  const blank = { ...place, gatherId: muster.gatherId, gatherName: await musterGatherName(muster), launchAt: muster.launchAt.toISOString(), route: snapshot.route, steps: snapshot.steps, minutes: snapshot.minutes, arrivedAt: at.toISOString() };
  const homeAt = new Date(at.getTime() + snapshot.minutes * 60_000);
  const shares = musterShares(menOf, seatsOf);
  const lostOf: Record<string, number> = {};
  let drachmaeOf: Record<string, number> = {};
  let grainOf: Record<string, number> = {};
  let spoilOf: Record<string, number> = {};
  let outcome: MusterReport["outcome"];
  let killed = 0;
  let rounds = 0;
  let defender: MusterReport["defender"] = null;
  let fleet: MusterReport["fleet"] = null;
  let plunder: MusterReport["plunder"] = null;
  let opinion: MusterReport["opinion"] = null;
  // What the army saw, for every participant's intel: the pool as the fight
  // left it and a town's ships. A repulse at sea, a turn-back and a break-up saw nothing.
  let seen: { pool: number; fleet: { pentekonters: number; triremes: number } | null } | null = null;
  let survivors: UnitRow[] = rows;

  const holder = await holderOf(tx, muster.worldId, muster.regionId, muster.townId ?? "");
  if (army.length === 0) {
    // 5. No army left: it broke up on the road. No fight, nobody comes home.
    outcome = "dispersed";
    survivors = rows;
  } else if (holder !== null && participantIds.includes(holder)) {
    // 6. The place is one of our own houses' now: the army turns back whole.
    outcome = "turned_back";
  } else {
    // 7. By sea against a town: the pooled naval power must match its fleet as
    // it stands at the arrival (ruling 3); with less, the landing is repulsed.
    if (snapshot.fleet) {
      const townFleet = muster.townId !== null ? await readTownFleet(tx, muster.worldId, muster.townId, at) : null;
      const navalDefender = townFleet && townFleet.pentekonters + townFleet.triremes > 0 ? { ...townFleet, naval: townFleet.pentekonters * 1 + townFleet.triremes * 5 } : null;
      fleet = { ...snapshot.fleet, defender: navalDefender, held: navalDefender === null || snapshot.fleet.naval >= navalDefender.naval };
    }
    if (fleet && !fleet.held) {
      // Repulsed at sea: no battle, no losses, home by the march.
      outcome = "repulsed";
    } else {
      // 8. The defender as it stands at the arrival: the region's warband, or
      // the town's garrison behind its walls, as in `act`.
      const stats = muster.townId !== null ? await townStats(muster.townId) : null;
      const npc = isTown ? battleC.npc.garrison : battleC.npc.warband;
      const npcStats = { ...npc.stats, def: npc.stats.def + (stats ? Math.min(stats.walls, battleC.town.wallsDefCap) : 0) };
      const pool = muster.townId !== null ? await readTownGarrison(tx, muster.worldId, muster.townId, at) : await readRegionWarband(tx, muster.worldId, muster.regionId, at);

      // One army: every row is its own row in the battle, seeded on the arrival.
      const seed = crypto.createHash("sha256").update([muster.worldId, muster.id, muster.townId ?? muster.regionId, at.toISOString()].join("|")).digest("hex");
      // The altar: each participant's blessing, as lit at the arrival, raises
      // his own rows' morale on a copy of the content stats. No clamp.
      const altar = await altarBonusFor(tx, sides.map((o) => o.playerId), at);
      const attacker: BattleRow[] = army.map((r) => {
        const def = r.source === "trained" ? unitDef(unitsC, r.unitId) : bandDef(bandsC, r.unitId);
        const bonus = altar.get(r.ownerPlayerId) ?? 0;
        return { id: r.id, label: def?.label ?? r.unitId, count: r.count, stats: bonus ? { ...def!.stats, mor: def!.stats.mor + bonus } : def!.stats };
      });
      // A raid meets half to all of the army's men, between the floor and the
      // cap of the pool, as `act` does; the kills come off the whole.
      const met = raidTurnout(battleC.raid, force.men, pool, seed);
      const result = resolveBattle({ attacker, defender: [{ id: isTown ? "garrison" : "warband", label: npc.label, count: met, stats: npcStats }], seed, config: battleC, mode: "raid" });

      // 9. Losses per row, on its owner: shrink or delete, one battle_loss log
      // each, as `act` writes them. The pool is written back.
      const fell = new Set<string>();
      for (const r of army) {
        const side = result.attacker.rows.find((x) => x.id === r.id)!;
        const lost = side.start - side.end;
        if (lost > 0) {
          lostOf[r.ownerPlayerId] = (lostOf[r.ownerPlayerId] ?? 0) + lost;
          await tx.insert(effectLog).values({ characterId: characterOf.get(r.ownerPlayerId)!, kind: "battle_loss", detail: { rowId: r.id, unitId: r.unitId, source: r.source, lost, regionId: muster.regionId, townId: muster.townId, action: "raid", musterId: muster.id }, createdAt: at });
        }
        if (side.end <= 0) {
          await tx.delete(playerUnits).where(eq(playerUnits.id, r.id));
          fell.add(r.id);
        } else {
          if (lost > 0) await tx.update(playerUnits).set({ count: side.end }).where(eq(playerUnits.id, r.id));
          r.count = side.end;
        }
      }
      survivors = rows.filter((r) => !fell.has(r.id));
      killed = result.defender.losses;
      rounds = result.rounds.length;
      const remaining = Math.max(0, pool - killed);
      if (muster.townId !== null) await writeTownGarrison(tx, muster.worldId, muster.townId, remaining, at);
      else await writeRegionWarband(tx, muster.worldId, muster.regionId, remaining, at);
      defender = { label: npc.label, start: pool, end: remaining, turnout: met };
      seen = { pool: remaining, fleet: muster.townId !== null ? await readTownFleet(tx, muster.worldId, muster.townId, at) : null };
      outcome = result.winner === "attacker" ? "won" : "driven_off";
      // Won or driven off, the army's one raid can sour the nation whose land it is.
      opinion = await raidOpinion(tx, muster.worldId, muster.townId !== null ? await townContentOwner(muster.townId) : await regionContentOwner(muster.regionId), seed);

      // 10. On a win: the plunder by `act`'s formula, split by shares (ruling
      // 5, P7, P8) and credited to each participant.
      if (result.winner === "attacker") {
        const p = raidPlunder(battleC.raid, killed, isTown, seed);
        plunder = { drachmae: p.drachmae, grain: p.grain, spoil: { good: p.spoil.good, label: spoilLabel(p.spoil.good), amount: p.spoil.amount } };
        drachmaeOf = splitByShares(p.drachmae, shares);
        grainOf = splitByShares(p.grain, shares);
        spoilOf = splitByShares(p.spoil.amount, shares);
        for (const id of Object.keys(shares).sort()) {
          await creditDrachmae(tx, id, drachmaeOf[id] ?? 0);
          await creditGood(tx, id, "grain", grainOf[id] ?? 0, at);
          await creditGood(tx, id, p.spoil.good, spoilOf[id] ?? 0, at);
        }
      }
    }
  }

  // 11. The march home: every row on the road that did not fall (the
  // survivors; every row when turned back or repulsed; any row of an owner with
  // no character) is bound for the gathering place by the same road, with no
  // muster on its mission.
  const mission: UnitMission = { kind: "raid", regionId: muster.regionId, ...(muster.townId !== null ? { townId: muster.townId } : {}), departedAt: muster.launchAt.toISOString() };
  const home = outcome === "dispersed" ? [] : survivors;
  for (const r of home) await tx.update(playerUnits).set({ movingTo: muster.gatherId, arrivesAt: homeAt, mission }).where(eq(playerUnits.id, r.id));

  // 12. Fought or repulsed: the intel and one koinon_muster line for each
  // participant with men in the army or hulls that sailed, dated the arrival.
  const fought = outcome !== "dispersed" && outcome !== "turned_back";
  if (fought) {
    for (const o of sides) {
      // The fight updates the intel of every member who fought and has a dynasty (raids prompt 3).
      if (seen) {
        const dynastyId = await dynastyIdOf(tx, o.playerId);
        if (dynastyId) {
          await writeIntel(tx, muster.worldId, dynastyId, { regionId: muster.regionId, townId: muster.townId, pool: seen.pool, fleet: seen.fleet, at, gameDate: formatGameDate(gameDate(at.getTime(), world.startedAt.getTime())) });
        }
      }
      const chronicle: MusterChronicle = {
        koinonName: snapshot.koinonName,
        regionId: muster.regionId,
        regionName,
        ...(muster.townId !== null ? { townId: muster.townId, townName: townName! } : {}),
        force: describeForce(o.rows),
        hulls: hullsOf[o.playerId] ?? 0,
        winner: outcome === "won" ? "attacker" : outcome === "repulsed" ? "repulsed" : "defender",
        killed,
        lost: lostOf[o.playerId] ?? 0,
        share:
          outcome === "won" && plunder?.spoil
            ? { drachmae: drachmaeOf[o.playerId] ?? 0, grain: grainOf[o.playerId] ?? 0, spoil: { good: plunder.spoil.good, label: plunder.spoil.label, amount: spoilOf[o.playerId] ?? 0 } }
            : null,
      };
      await tx.insert(effectLog).values({ characterId: characterOf.get(o.playerId)!, kind: "koinon_muster", detail: { chronicle, musterId: muster.id, line: renderMusterLine(chronicle), source: "koinon" }, createdAt: at });
    }
  }

  // 13. The report on the muster.
  const lost = Object.values(lostOf).reduce((n, v) => n + v, 0);
  const report: MusterReport = {
    ...blank,
    outcome,
    reason: null,
    line: renderMusterReportLine({ ...place, outcome, men: force.men, killed, lost, plunder }),
    homeAt: home.length > 0 ? homeAt.toISOString() : null,
    rounds,
    men: force.men,
    lost,
    killed,
    defender,
    fleet: fought ? fleet : null,
    plunder,
    opinion,
    parts:
      outcome === "dispersed"
        ? []
        : sides.map((o) => ({
            playerId: o.playerId,
            name: o.name,
            men: menOf[o.playerId] ?? 0,
            lost: lostOf[o.playerId] ?? 0,
            hulls: hullsOf[o.playerId] ?? 0,
            seats: seatsOf[o.playerId] ?? 0,
            shares: shares[o.playerId] ?? 0,
            drachmae: drachmaeOf[o.playerId] ?? 0,
            grain: grainOf[o.playerId] ?? 0,
            spoil: spoilOf[o.playerId] ?? 0,
          })),
  };
  await tx.update(koinonMusters).set({ report }).where(eq(koinonMusters.id, muster.id));
  return { outcome: "resolved", at, shrine };
}

// --- The hook: due launches and arrivals resolve before any request -------------------

const RESOLVE_BACKOFF_MS = 60_000;
// When a resolve last threw, by muster or march id, in this process: it is not
// tried again for a minute, so one in trouble cannot slow every request.
const failedAt = new Map<string, number>();

export type CampaignResolverDeps = {
  resolve?: (musterId: string, now: Date) => Promise<unknown>;
  resolveMarch?: (marchId: string, now: Date) => Promise<unknown>;
  onError?: (id: string, err: unknown) => void;
};

type DueItem = { kind: "march" | "army" | "launch"; id: string; at: Date };
const KIND_RANK: Record<DueItem["kind"], number> = { march: 0, army: 1, launch: 2 };

// Three indexed lists: open musters due at their launch, marching musters due
// at their army's arrival, and marching parties due at their arrival. An item
// is a kind and an id (a muster's launch and its army's arrival are two items
// under one id). They sort by instant, then a party's arrival, an army's
// arrival, a launch (the battles at an instant are fought before an army sets
// out), then id. The loop takes the first item not yet taken in this call and
// not within its backoff, resolves it, and reads the lists again before the
// next: a launch can make its army's arrival due at once, ahead of something
// already on the list. It stops at the first `busy`: another request is
// resolving that one and goes on down the same list, so nothing later is
// fought ahead of it. An item is taken at most once per call, so a resolve that
// answers `not_due` cannot loop. A resolve that throws is reported once and
// left for a later request, not tried again for a minute, and holds nothing
// back; it never throws from here.
async function dueCampaigns(now: Date): Promise<DueItem[]> {
  const launches = await db.select({ id: koinonMusters.id, at: koinonMusters.launchAt }).from(koinonMusters).where(and(eq(koinonMusters.status, "open"), lte(koinonMusters.launchAt, now)));
  const armies = await db.select({ id: koinonMusters.id, at: koinonMusters.arrivesAt }).from(koinonMusters).where(and(eq(koinonMusters.status, "marching"), lte(koinonMusters.arrivesAt, now)));
  const marches = await db.select({ id: playerMarches.id, at: playerMarches.arrivesAt }).from(playerMarches).where(and(eq(playerMarches.status, "marching"), lte(playerMarches.arrivesAt, now)));
  const items: DueItem[] = [
    ...marches.map((m) => ({ kind: "march" as const, id: m.id, at: m.at })),
    ...armies.flatMap((m) => (m.at ? [{ kind: "army" as const, id: m.id, at: m.at }] : [])),
    ...launches.map((m) => ({ kind: "launch" as const, id: m.id, at: m.at })),
  ];
  return items.sort((a, b) => a.at.getTime() - b.at.getTime() || KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.id.localeCompare(b.id));
}
export async function resolveDueCampaigns(now: Date, deps: CampaignResolverDeps = {}): Promise<void> {
  const taken = new Set<string>();
  for (;;) {
    const next = (await dueCampaigns(now)).find((item) => {
      if (taken.has(`${item.kind}:${item.id}`)) return false;
      const failed = failedAt.get(item.id);
      return failed === undefined || now.getTime() - failed >= RESOLVE_BACKOFF_MS;
    });
    if (!next) return;
    taken.add(`${next.kind}:${next.id}`);
    try {
      const outcome = await (next.kind === "march" ? (deps.resolveMarch ?? resolveMarch) : (deps.resolve ?? resolveMuster))(next.id, now);
      failedAt.delete(next.id);
      if ((outcome as { outcome?: string } | null | undefined)?.outcome === "busy") return;
    } catch (err) {
      failedAt.set(next.id, now.getTime());
      (deps.onError ?? ((failedId, error) => console.error(`[campaign] resolve of ${failedId} failed`, error)))(next.id, err);
    }
  }
}

// Between a muster's launch, an army's arrival or a party's arrival and its
// resolve only time passes, because every write in the game happens inside a
// request. So the resolve runs before the handler of any request under /api,
// /me or /admin (never /health or static content), and the handler then sees
// the army set out or fought and the party fought. The hook never fails a request.
export function registerCampaignResolver(app: FastifyInstance, deps: CampaignResolverDeps & { now?: () => Date } = {}): void {
  app.addHook("preHandler", async (req) => {
    const path = req.url.split("?")[0]!;
    if (!path.startsWith("/api/") && path !== "/me" && !path.startsWith("/me/") && path !== "/admin" && !path.startsWith("/admin/")) return;
    try {
      await resolveDueCampaigns(deps.now ? deps.now() : new Date(), {
        resolve: deps.resolve,
        resolveMarch: deps.resolveMarch,
        onError: deps.onError ?? ((id, err) => req.log.error({ err, id }, "campaign resolve failed")),
      });
    } catch (err) {
      req.log.error({ err }, "campaign resolver failed");
    }
  });
}
