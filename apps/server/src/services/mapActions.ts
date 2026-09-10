import crypto from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createDb, effectLog, playerCharacters, playerUnits, regionIntel, resources } from "@massalia/db";
import {
  bandDef,
  fleetStats,
  formatGameDate,
  gameDate,
  REACH_REASON,
  renderCampaignLine,
  resolveBattle,
  unitDef,
  type BattleResult,
  type BattleRow,
  type CampaignPayload,
  type ReachEntry,
  type ReachShip,
} from "@massalia/shared";
import { applyComposureDelta } from "./composure.js";
import { barracksView, getBandsContent, getBattleContent, getShipsContent, getUnitsContent, isActive, type BarracksView, type UnitRow } from "./barracks.js";
import { settleAll, type ActingContext } from "./buildings.js";
import { insertConquest, listHoldings } from "./holdings.js";
import { lockPlayer } from "./lock.js";
import { getTopology } from "./mapGraph.js";
import { fleetInStock, forceRowOf, homeRegions, reachView, type ReachView } from "./mapReach.js";
import { regionDisplayName } from "./mapNames.js";
import { readRegionWarband, regionContentOwner, writeRegionWarband } from "./mapPools.js";

// ---------------------------------------------------------------------------
// Map actions (barracks prompt 3b): Scout, Raid and Attack against townless
// regions not owned by Massalia. One locked transaction: lock → settleAll
// (arrivals, holding reversion, upkeep) → target, force and reach checks → the
// battle (pure, seeded on world + player + region + instant) → losses, plunder
// or conquest → recovery → effect_log with the full report and the Chronicle
// payload. Ships are counted, never debited or moved. The response is composed
// after the commit from the fresh reach and barracks views.
// ---------------------------------------------------------------------------

const db = createDb();
type DbTx = Parameters<Parameters<ReturnType<typeof createDb>["transaction"]>[0]>[0];

const MS_PER_DAY = 86_400_000;
const FAST_SPD = 6;

export type MapActionType = "scout" | "raid" | "attack";
export type MapActInput = { type: MapActionType; regionId: string; rowIds: string[] };

export type MapActReport = {
  type: MapActionType;
  regionId: string;
  regionName: string;
  base: string;
  route: "land" | "sea";
  steps: number;
  recoveryDays: number;
  arrivesAt: string;
  destination: string;
  ships: Record<string, number>;
  winner: "attacker" | "defender" | "stand" | null;
  rounds: number;
  attacker: { rows: { id: string; unitId: string; label: string; start: number; end: number; broke: boolean }[]; losses: number };
  defender: { label: string; start: number; end: number; losses: number } | null;
  plunder: { drachmae: number; grain: number } | null;
  conquest: { regionId: string; previousOwner: string | null } | null;
  intel: { warband: number; scoutedGameDate: string } | null;
  line: string;
};

type Failure = { ok: false; code: number; error: string };
export type MapActResult = Failure | { ok: true; report: MapActReport; reach: ReachView; force: ReachView["force"]; fleet: ReachView["fleet"]; roster: BarracksView["roster"] };

// "20 peltasts", "10 hoplites and 20 Cretan archers".
function describeForce(rows: UnitRow[]): string {
  const parts = rows.map((r) => {
    const def = r.source === "trained" ? unitDef(getUnitsContent(), r.unitId) : bandDef(getBandsContent(), r.unitId);
    const label = def?.label ?? r.unitId;
    return r.source === "trained" ? `${r.count} ${label.toLowerCase()}${r.count === 1 ? "" : "s"}` : `${r.count} ${label}`;
  });
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

async function characterOf(exec: DbTx, playerId: string): Promise<{ id: string; dynastyId: string | null }> {
  const rows = await exec.select({ id: playerCharacters.id, dynastyId: playerCharacters.dynastyId }).from(playerCharacters).where(eq(playerCharacters.playerId, playerId)).limit(1);
  if (!rows[0]) throw new Error("map action: player has no character");
  return rows[0];
}

async function creditDrachmae(exec: DbTx, playerId: string, amount: number): Promise<void> {
  if (amount <= 0) return;
  await exec.update(playerCharacters).set({ drachmae: sql`${playerCharacters.drachmae} + ${amount}` }).where(eq(playerCharacters.playerId, playerId));
}

async function creditGood(exec: DbTx, playerId: string, type: string, qty: number, now: Date): Promise<void> {
  if (qty <= 0) return;
  const existing = (await exec.select({ id: resources.id }).from(resources).where(and(eq(resources.scope, "player"), eq(resources.scopeId, playerId), eq(resources.type, type))).limit(1))[0];
  if (existing) await exec.update(resources).set({ amount: sql`${resources.amount} + ${String(qty)}::numeric` }).where(eq(resources.id, existing.id));
  else await exec.insert(resources).values({ scope: "player", scopeId: playerId, type, amount: String(qty), ratePerSecond: "0", lastUpdatedAt: now });
}

// Ships for a sea route: enough trade-ships for the force's space, then galleys
// if space is still short; stock is counted, never debited.
function assembleFleet(forceSpace: number, counts: Record<string, number>): { ships: Record<string, number>; fleet: ReachShip[] } {
  const shipsC = getShipsContent();
  const taken: Record<string, number> = {};
  let space = 0;
  for (const id of ["trade-ship", "galley"]) {
    const def = shipsC.ships[id];
    if (!def || space >= forceSpace) continue;
    const need = def.troopSpace > 0 ? Math.ceil((forceSpace - space) / def.troopSpace) : 0;
    const n = Math.min(need, counts[id] ?? 0);
    if (n > 0) {
      taken[id] = n;
      space += n * def.troopSpace;
    }
  }
  const fleet: ReachShip[] = Object.entries(taken).map(([id, count]) => ({ shipId: id, count, range: shipsC.ships[id]!.range, troopSpace: shipsC.ships[id]!.troopSpace }));
  return { ships: taken, fleet };
}

function verdictFor(entry: ReachEntry, type: MapActionType) {
  // Scouts move like raiders: one step, two when every man is fast, or by sea.
  return type === "attack" ? entry.attack : entry.raid;
}

export async function act(ctx: ActingContext, input: MapActInput, now: Date): Promise<MapActResult> {
  const topology = getTopology();
  const unitsC = getUnitsContent();
  const bandsC = getBandsContent();
  const battleC = getBattleContent();
  const outcome = await db.transaction(async (tx): Promise<{ composureDays: number; result: Failure | { ok: true; report: MapActReport } }> => {
    await lockPlayer(tx, ctx.playerId);
    const settled = await settleAll(tx, ctx, now);
    const fail = (code: number, error: string) => ({ composureDays: settled.composureDays, result: { ok: false as const, code, error } });

    // 1. Target: a townless land region that is neither fog, Massalia's, nor ours.
    // Massalia's own ground answers as such before the towns rule (R060 holds a town).
    const { regionId } = input;
    if (!topology.land.has(regionId)) return fail(404, "No such region.");
    if (regionId === topology.massaliaRegion || (await homeRegions(topology)).has(regionId)) return fail(409, "Massalia does not act against her own.");
    const townsHere = [...topology.townRegion.entries()].some(([, r]) => r === regionId);
    if (townsHere) return fail(409, "Towns are for a later season.");
    const holdings = await listHoldings(tx, ctx);
    if (holdings.some((h) => h.regionId === regionId)) return fail(409, "You hold this land.");

    // 2. Rows: ours, active, not moving, one base, at least one; a scout needs speed.
    const ids = [...new Set(input.rowIds)];
    if (ids.length === 0) return fail(400, "Choose at least one row.");
    const rows = await tx
      .select()
      .from(playerUnits)
      .where(and(eq(playerUnits.worldId, ctx.worldId), eq(playerUnits.ownerPlayerId, ctx.playerId), inArray(playerUnits.id, ids)));
    if (rows.length !== ids.length) return fail(404, "No such unit.");
    const labelOf = (r: UnitRow) => (r.source === "trained" ? unitDef(unitsC, r.unitId) : bandDef(bandsC, r.unitId))?.label ?? r.unitId;
    for (const r of rows) {
      if (!isActive(r, now)) return fail(409, `${labelOf(r)} are still training.`);
      if (r.movingTo !== null) return fail(409, `${labelOf(r)} are still on the march.`);
    }
    const base = rows[0]!.basedAt;
    if (rows.some((r) => r.basedAt !== base)) return fail(409, "A force marches from one base.");
    const baseIds = new Set([topology.massaliaRegion, ...holdings.map((h) => h.regionId)]);
    if (!baseIds.has(base)) return fail(409, "That base is not yours.");
    const forceRows = rows.map((r) => forceRowOf(r)).filter((f): f is NonNullable<typeof f> => f !== null);
    if (input.type === "scout" && !forceRows.some((f) => f.spd >= FAST_SPD)) return fail(409, `A scouting party needs a man at Spd ${FAST_SPD} or more.`);

    // 3. Reach with exactly these rows from exactly this base.
    const view = await reachView(tx, ctx, now, { rows, bases: [base] });
    const entry = view.reach[regionId];
    if (!entry) return fail(409, "That land cannot be reached.");
    const verdict = verdictFor(entry, input.type);
    if (!verdict.ok) return fail(409, verdict.reason ?? "Out of reach.");
    const fast = view.force.fast;
    const byLand = input.type === "attack" ? entry.landSteps === 1 : entry.landSteps === 1 || (entry.landSteps === 2 && fast);
    const route: "land" | "sea" = byLand ? "land" : "sea";
    const steps = byLand ? entry.landSteps! : entry.seaSteps!;

    // 4. Ships for a sea route: trade-ships first, galleys for what is still short.
    let ships: Record<string, number> = {};
    if (route === "sea") {
      const { counts } = await fleetInStock(tx, ctx);
      const assembled = assembleFleet(view.force.space, counts);
      const stats = fleetStats(assembled.fleet);
      if (stats.space < view.force.space) return fail(409, REACH_REASON.hulls(view.force.space, stats.space));
      if (stats.range < steps) return fail(409, REACH_REASON.range(steps, stats.range));
      ships = assembled.ships;
    }

    // 5. Defender: the region's warband after regeneration.
    const warband = await readRegionWarband(tx, ctx.worldId, regionId, now);
    const character = await characterOf(tx, ctx.playerId);
    const regionName = await regionDisplayName(regionId);
    const recoveryDays = Math.max(1, steps);
    const arrivesAt = new Date(now.getTime() + recoveryDays * MS_PER_DAY);
    const men = rows.reduce((n, r) => n + r.count, 0);
    const forceText = describeForce(rows);

    let report: MapActReport;
    let destination = base;
    let chronicle: CampaignPayload;

    if (input.type === "scout") {
      // 6. Scout: the dynasty's intel snapshot, no battle.
      const scoutedGameDate = formatGameDate(gameDate(now.getTime(), ctx.worldStartedMs));
      if (character.dynastyId) {
        await tx
          .insert(regionIntel)
          .values({ worldId: ctx.worldId, dynastyId: character.dynastyId, regionId, warband, scoutedAt: now, scoutedGameDate })
          .onConflictDoUpdate({ target: [regionIntel.worldId, regionIntel.dynastyId, regionIntel.regionId], set: { warband, scoutedAt: now, scoutedGameDate } });
      }
      chronicle = { action: "scout", regionId, regionName, men, force: forceText, warband };
      report = {
        type: "scout",
        regionId,
        regionName,
        base,
        route,
        steps,
        recoveryDays,
        arrivesAt: arrivesAt.toISOString(),
        destination,
        ships,
        winner: null,
        rounds: 0,
        attacker: { rows: rows.map((r) => ({ id: r.id, unitId: r.unitId, label: labelOf(r), start: r.count, end: r.count, broke: false })), losses: 0 },
        defender: null,
        plunder: null,
        conquest: null,
        intel: { warband, scoutedGameDate },
        line: renderCampaignLine("map_action", chronicle),
      };
    } else {
      // 7. Raid / Attack: the pure battle, then its consequences.
      const seed = crypto.createHash("sha256").update([ctx.worldId, ctx.playerId, regionId, now.toISOString()].join("|")).digest("hex");
      const attacker: BattleRow[] = rows.map((r) => {
        const def = r.source === "trained" ? unitDef(unitsC, r.unitId) : bandDef(bandsC, r.unitId);
        return { id: r.id, label: labelOf(r), count: r.count, stats: def!.stats };
      });
      const defender: BattleRow[] = [{ id: "warband", label: battleC.npc.warband.label, count: warband, stats: battleC.npc.warband.stats }];
      const result: BattleResult = resolveBattle({ attacker, defender, seed, config: battleC, mode: input.type });

      // Attacker losses per row: shrink or delete, one battle_loss log each.
      const survivors: UnitRow[] = [];
      for (const r of rows) {
        const side = result.attacker.rows.find((x) => x.id === r.id)!;
        const lost = side.start - side.end;
        if (lost > 0) await tx.insert(effectLog).values({ characterId: character.id, kind: "battle_loss", detail: { rowId: r.id, unitId: r.unitId, source: r.source, lost, regionId, action: input.type }, createdAt: now });
        if (side.end <= 0) await tx.delete(playerUnits).where(eq(playerUnits.id, r.id));
        else {
          if (lost > 0) await tx.update(playerUnits).set({ count: side.end }).where(eq(playerUnits.id, r.id));
          survivors.push({ ...r, count: side.end });
        }
      }
      const defLosses = result.defender.losses;
      const remaining = Math.max(0, warband - defLosses);

      let plunder: MapActReport["plunder"] = null;
      let conquest: MapActReport["conquest"] = null;
      if (input.type === "raid") {
        await writeRegionWarband(tx, ctx.worldId, regionId, remaining, now);
        if (result.winner === "attacker") {
          plunder = { drachmae: Math.round(defLosses * battleC.raid.plunderPerKill), grain: Math.round(defLosses * battleC.raid.grainPerKill) };
          await creditDrachmae(tx, ctx.playerId, plunder.drachmae);
          await creditGood(tx, ctx.playerId, "grain", plunder.grain, now);
        }
      } else if (result.winner === "attacker") {
        const previousOwner = await regionContentOwner(regionId);
        await insertConquest(tx, ctx, regionId, previousOwner, now);
        // The garrison is in recovery until arrivesAt: date last_garrisoned_at there
        // so the empty-for-a-day clock starts when the men actually stand.
        await tx.execute(sql`UPDATE player_holdings SET last_garrisoned_at = ${arrivesAt} WHERE world_id = ${ctx.worldId} AND region_id = ${regionId}`);
        await writeRegionWarband(tx, ctx.worldId, regionId, 0, now);
        conquest = { regionId, previousOwner };
        destination = regionId;
        for (const r of survivors) await tx.update(playerUnits).set({ basedAt: regionId }).where(eq(playerUnits.id, r.id));
      } else {
        await writeRegionWarband(tx, ctx.worldId, regionId, remaining, now);
      }

      chronicle = { action: input.type, regionId, regionName, men, force: forceText, winner: result.winner, killed: defLosses, lost: result.attacker.losses, plunder, conquest: conquest !== null };
      report = {
        type: input.type,
        regionId,
        regionName,
        base,
        route,
        steps,
        recoveryDays,
        arrivesAt: arrivesAt.toISOString(),
        destination,
        ships,
        winner: result.winner,
        rounds: result.rounds.length,
        attacker: {
          rows: rows.map((r) => {
            const side = result.attacker.rows.find((x) => x.id === r.id)!;
            return { id: r.id, unitId: r.unitId, label: labelOf(r), start: side.start, end: side.end, broke: side.broke };
          }),
          losses: result.attacker.losses,
        },
        defender: { label: battleC.npc.warband.label, start: warband, end: remaining, losses: defLosses },
        plunder,
        conquest,
        intel: null,
        line: renderCampaignLine("map_action", chronicle),
      };
      rows.splice(0, rows.length, ...survivors);
    }

    // 8. Recovery for every surviving participant.
    for (const r of rows) await tx.update(playerUnits).set({ movingTo: destination, arrivesAt }).where(eq(playerUnits.id, r.id));

    // 9. The report on the character, with the Chronicle payload alongside.
    await tx.insert(effectLog).values({ characterId: character.id, kind: "map_action", detail: { ...report, chronicle, source: "map" }, createdAt: now });
    return { composureDays: settled.composureDays, result: { ok: true, report } };
  });

  if (outcome.composureDays > 0) {
    const ch = (await db.select({ id: playerCharacters.id }).from(playerCharacters).where(eq(playerCharacters.playerId, ctx.playerId)).limit(1))[0];
    if (ch) await applyComposureDelta(ch.id, outcome.composureDays, "building:shrine", now);
  }
  if (!outcome.result.ok) return outcome.result;

  // 10. Compose the response from fresh reads so the client re-renders from one payload.
  const reach = await db.transaction(async (tx) => {
    await lockPlayer(tx, ctx.playerId);
    return reachView(tx, ctx, now);
  });
  const barracks = await barracksView(ctx, now);
  return { ok: true, report: outcome.result.report, reach, force: reach.force, fleet: reach.fleet, roster: barracks.roster };
}
