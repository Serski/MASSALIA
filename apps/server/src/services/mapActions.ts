import crypto from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { createDb, effectLog, playerCharacters, playerUnits, regionIntel, townIntel } from "@massalia/db";
import {
  bandDef,
  campaignSeason,
  fleetStats,
  formatGameDate,
  gameDate,
  HOME_POLITY_ID,
  moveVerdict,
  REACH_REASON,
  renderCampaignLine,
  resolveBattle,
  unitDef,
  type BattleResult,
  type BattleRow,
  type CampaignForcePart,
  type CampaignPayload,
  type ReachEntry,
  type ReachShip,
} from "@massalia/shared";
import { applyComposureDelta } from "./composure.js";
import { barracksView, getBandsContent, getBattleContent, getShipsContent, getUnitsContent, isActive, type BarracksView, type UnitRow } from "./barracks.js";
import { settleAll, type ActingContext } from "./buildings.js";
import { creditDrachmae, creditGood, insertConquest, insertTownConquest, listHoldings } from "./holdings.js";
import { lockPlayer } from "./lock.js";
import { getTopology } from "./mapGraph.js";
import { basesOf, fleetInStock, forceRowOf, homeRegions, reachView, type ReachView } from "./mapReach.js";
import { regionDisplayName, townDisplayName } from "./mapNames.js";
import { readRegionWarband, readTownFleet, readTownGarrison, regionContentOwner, townContentOwner, writeRegionWarband, writeTownGarrison } from "./mapPools.js";
import { townStats } from "./townStats.js";

// ---------------------------------------------------------------------------
// Map actions (barracks prompts 3b, 3c): Scout, Raid and Attack against
// townless regions and towns not owned by Massalia. One locked transaction:
// lock → settleAll (arrivals, holding reversion, tribute, upkeep) → target,
// force and reach checks → for a town by sea, the fleet check → the battle
// (pure, seeded on world + player + target + instant) → losses, plunder or
// conquest → recovery → effect_log with the full report and the Chronicle
// payload. Ships are counted, never debited or moved. The response is composed
// after the commit from the fresh reach and barracks views.
//
// A town (ruling 1–4): the defender is its garrison with the garrison stat
// block, every row's def raised by min(walls, wallsDefCap); the region's
// warband stays out of it. A sea assault lands only if the attacker's naval
// power (Σ ships × naval) is at least the town's (pentekonters × 1 + triremes
// × 5); otherwise the landing is repulsed with no battle and no losses. Taking
// a town makes a town holding: garrison 0, survivors based at the town.
// ---------------------------------------------------------------------------

const db = createDb();
type DbTx = Parameters<Parameters<ReturnType<typeof createDb>["transaction"]>[0]>[0];

const MS_PER_HOUR = 3_600_000;
const FAST_SPD = 6;

export type MapActionType = "scout" | "raid" | "attack";
// Whole rows or, for a trained row, part of it: `count` men march (1..row.count).
// A band marches whole under its contract. The target is a region (`regionId`)
// or a town (`townId`, whose region is resolved through the graph).
export type MapActInput = { type: MapActionType; regionId?: string; townId?: string; rows: { rowId: string; count: number }[] };

export type MapActReport = {
  type: MapActionType;
  regionId: string;
  regionName: string;
  // Set when the target is a town: the town, its survey and the effective def
  // its garrison fought at (garrison def + min(walls, wallsDefCap)).
  townId: string | null;
  townName: string | null;
  town: { walls: number; population: number; garrisonDef: number } | null;
  // Set for a sea assault on a town: both fleets' naval power and whether the
  // landing held. When it did not, no battle was fought.
  fleet: { ships: Record<string, number>; naval: number; defender: { pentekonters: number; triremes: number; naval: number }; held: boolean } | null;
  base: string;
  route: "land" | "sea";
  steps: number;
  recoveryHours: number;
  arrivesAt: string;
  destination: string;
  ships: Record<string, number>;
  winner: "attacker" | "defender" | "stand" | "repulsed" | null;
  rounds: number;
  attacker: { rows: { id: string; unitId: string; label: string; icon: string; start: number; end: number; broke: boolean }[]; losses: number };
  defender: { label: string; start: number; end: number; losses: number } | null;
  plunder: { drachmae: number; grain: number } | null;
  conquest: { regionId: string; townId: string | null; previousOwner: string | null } | null;
  intel: { warband: number; pentekonters?: number; triremes?: number; scoutedGameDate: string } | null;
  line: string;
};

type Failure = { ok: false; code: number; error: string };
export type MapActResult = Failure | { ok: true; report: MapActReport; reach: ReachView; campaign: ReachView["campaign"]; force: ReachView["force"]; fleet: ReachView["fleet"]; roster: BarracksView["roster"] };

// The force as chronicle parts: rows of the same unit merge into one figure
// ("21 peltasts", not "7 peltasts, 7 peltasts and 7 peltasts"), in first-seen
// order; a trained part carries label and plural, a band its label. The
// sentence itself comes from renderForce, shared with the web register.
function describeForce(rows: UnitRow[]): CampaignForcePart[] {
  const merged = new Map<string, CampaignForcePart>();
  for (const r of rows) {
    const key = `${r.source}:${r.unitId}`;
    const m = merged.get(key);
    if (m) {
      m.count += r.count;
      continue;
    }
    if (r.source === "trained") {
      const def = unitDef(getUnitsContent(), r.unitId);
      merged.set(key, { count: r.count, label: def?.label ?? r.unitId, plural: def?.plural ?? `${def?.label ?? r.unitId}s`, source: "trained" });
    } else {
      merged.set(key, { count: r.count, label: bandDef(getBandsContent(), r.unitId)?.label ?? r.unitId, source: "band" });
    }
  }
  return [...merged.values()];
}

async function characterOf(exec: DbTx, playerId: string): Promise<{ id: string; dynastyId: string | null }> {
  const rows = await exec.select({ id: playerCharacters.id, dynastyId: playerCharacters.dynastyId }).from(playerCharacters).where(eq(playerCharacters.playerId, playerId)).limit(1);
  if (!rows[0]) throw new Error("map action: player has no character");
  return rows[0];
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

// The rows an action sends: ours, active, not moving, one base of ours, at
// least one. Each sent count is a whole number within the row; a band goes
// whole. Returns the rows as they would march (count = sent) beside the whole
// rows; the split itself waits until every check has passed, so a refusal
// never leaves a row divided.
type Selection = { owned: UnitRow[]; rows: UnitRow[]; base: string };
async function selectForce(tx: DbTx, ctx: ActingContext, sentRows: { rowId: string; count: number }[], now: Date): Promise<Failure | ({ ok: true } & Selection)> {
  const unitsC = getUnitsContent();
  const bandsC = getBandsContent();
  const fail = (code: number, error: string): Failure => ({ ok: false, code, error });
  const sent = new Map<string, number>();
  for (const r of sentRows) sent.set(r.rowId, (sent.get(r.rowId) ?? 0) + r.count);
  const ids = [...sent.keys()];
  if (ids.length === 0) return fail(400, "Choose at least one row.");
  const owned = await tx
    .select()
    .from(playerUnits)
    .where(and(eq(playerUnits.worldId, ctx.worldId), eq(playerUnits.ownerPlayerId, ctx.playerId), inArray(playerUnits.id, ids)));
  if (owned.length !== ids.length) return fail(404, "No such unit.");
  const labelOf = (r: UnitRow) => (r.source === "trained" ? unitDef(unitsC, r.unitId) : bandDef(bandsC, r.unitId))?.label ?? r.unitId;
  for (const r of owned) {
    if (!isActive(r, now)) return fail(409, `${labelOf(r)} are still training.`);
    if (r.movingTo !== null) return fail(409, `${labelOf(r)} are still on the march.`);
    const n = sent.get(r.id)!;
    if (!Number.isInteger(n) || n < 1 || n > r.count) return fail(400, `Send a whole number of men, up to the ${r.count} in the row.`);
    if (r.source === "band" && n !== r.count) return fail(409, "A band marches as one.");
  }
  const rows: UnitRow[] = owned.map((r) => ({ ...r, count: sent.get(r.id)! }));
  const base = rows[0]!.basedAt;
  if (rows.some((r) => r.basedAt !== base)) return fail(409, "A force marches from one base.");
  const baseIds = new Set((await basesOf(tx, ctx, now, owned)).map((b) => b.id));
  if (!baseIds.has(base)) return fail(409, "That base is not yours.");
  return { ok: true, owned, rows, base };
}

// Split, under the lock, once nothing can refuse: a trained row sent short of
// its count becomes two rows — the sent men as a new row (the one that marches),
// the rest staying home in the original, both reduced by the men that left.
// `rows` is updated in place to the rows that march.
async function splitRows(tx: DbTx, characterId: string, sel: Selection, now: Date): Promise<void> {
  const { owned, rows } = sel;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const whole = owned.find((o) => o.id === r.id)!;
    if (r.count === whole.count) continue;
    const inserted = (
      await tx
        .insert(playerUnits)
        .values({
          worldId: whole.worldId,
          ownerPlayerId: whole.ownerPlayerId,
          source: whole.source,
          unitId: whole.unitId,
          count: r.count,
          startCount: r.count,
          recruitedSeason: whole.recruitedSeason,
          readyAt: whole.readyAt,
          contractEndAt: null,
          basedAt: whole.basedAt,
          movingTo: null,
          arrivesAt: null,
          createdAt: whole.createdAt,
        })
        .returning()
    )[0]!;
    await tx.update(playerUnits).set({ count: whole.count - r.count, startCount: Math.max(whole.count - r.count, whole.startCount - r.count) }).where(eq(playerUnits.id, whole.id));
    await tx.insert(effectLog).values({ characterId, kind: "barracks_split", detail: { fromRowId: whole.id, rowId: inserted.id, unitId: whole.unitId, sent: r.count, left: whole.count - r.count, source: "map" }, createdAt: now });
    rows[i] = inserted;
  }
}

export async function act(ctx: ActingContext, input: MapActInput, now: Date): Promise<MapActResult> {
  const topology = getTopology();
  const unitsC = getUnitsContent();
  const bandsC = getBandsContent();
  const battleC = getBattleContent();
  const shipsC = getShipsContent();
  const outcome = await db.transaction(async (tx): Promise<{ composureDays: number; result: Failure | { ok: true; report: MapActReport } }> => {
    await lockPlayer(tx, ctx.playerId);
    const settled = await settleAll(tx, ctx, now);
    const fail = (code: number, error: string) => ({ composureDays: settled.composureDays, result: { ok: false as const, code, error } });

    // 0. Winter closes campaigns, before any other check.
    if (!campaignSeason(now.getTime(), ctx.worldStartedMs).open) return fail(409, "The passes are closed until spring.");

    // 1. Target: a town, or a townless land region; neither fog, Massalia's,
    // nor ours. Massalia's own ground answers as such before the towns rule
    // (R060 holds a town). A region with towns is attacked through its towns.
    const holdings = await listHoldings(tx, ctx);
    const townId = input.townId ?? null;
    let regionId: string;
    if (townId !== null) {
      const region = topology.townRegion.get(townId);
      if (!region) return fail(404, "No such town.");
      regionId = region;
      if (regionId === topology.massaliaRegion || (await townContentOwner(townId)) === HOME_POLITY_ID || (await homeRegions(topology)).has(regionId)) return fail(409, "Massalia does not act against her own.");
      if (holdings.some((h) => h.townId === townId)) return fail(409, "You hold this town.");
    } else {
      if (typeof input.regionId !== "string" || !topology.land.has(input.regionId)) return fail(404, "No such region.");
      regionId = input.regionId;
      if (regionId === topology.massaliaRegion || (await homeRegions(topology)).has(regionId)) return fail(409, "Massalia does not act against her own.");
      const townsHere = [...topology.townRegion.entries()].some(([, r]) => r === regionId);
      if (townsHere) return fail(409, "This land answers to its towns: choose one.");
      if (holdings.some((h) => h.regionId === regionId && h.townId === "")) return fail(409, "You hold this land.");
    }

    // 2. Rows: ours, active, not moving, one base, at least one; a scout needs speed.
    const selected = await selectForce(tx, ctx, input.rows, now);
    if (!selected.ok) return fail(selected.code, selected.error);
    const { rows, base } = selected;
    const labelOf = (r: UnitRow) => (r.source === "trained" ? unitDef(unitsC, r.unitId) : bandDef(bandsC, r.unitId))?.label ?? r.unitId;
    const iconOf = (r: UnitRow) => (r.source === "trained" ? unitDef(unitsC, r.unitId) : bandDef(bandsC, r.unitId))?.icon ?? "";
    const forceRows = rows.map((r) => forceRowOf(r)).filter((f): f is NonNullable<typeof f> => f !== null);
    if (input.type === "scout" && !forceRows.some((f) => f.spd >= FAST_SPD)) return fail(409, `A scouting party needs a man at Spd ${FAST_SPD} or more.`);

    // 3. Reach with exactly these rows from exactly this base.
    const view = await reachView(tx, ctx, now, { rows, bases: [base] });
    const entry = view.reach[regionId];
    if (!entry) return fail(409, "That land cannot be reached.");
    const verdict = verdictFor(entry, input.type);
    if (!verdict.ok) return fail(409, verdict.reason ?? "Out of reach.");
    const fast = view.force.fast;
    const adjacent = entry.landSteps !== null && entry.landSteps <= 1;
    const byLand = input.type === "attack" ? adjacent : adjacent || (entry.landSteps === 2 && fast);
    const route: "land" | "sea" = byLand ? "land" : "sea";
    const steps = byLand ? entry.landSteps! : entry.seaSteps!;

    // 4. Ships for a sea route: trade-ships first, galleys for what is still short.
    let ships: Record<string, number> = {};
    let naval = 0;
    if (route === "sea") {
      const { counts } = await fleetInStock(tx, ctx);
      const assembled = assembleFleet(view.force.space, counts);
      const stats = fleetStats(assembled.fleet);
      if (stats.space < view.force.space) return fail(409, REACH_REASON.hulls(view.force.space, stats.space));
      if (stats.range < steps) return fail(409, REACH_REASON.range(steps, stats.range));
      ships = assembled.ships;
      naval = Object.entries(ships).reduce((n, [id, count]) => n + count * (shipsC.ships[id]?.naval ?? 0), 0);
    }

    // 4b. Split, under the lock, now that nothing can refuse.
    await splitRows(tx, (await characterOf(tx, ctx.playerId)).id, selected, now);

    // 5. Defender: the region's warband, or the town's garrison behind its
    // walls, after regeneration. A town's fleet is read for the sea rule.
    const isTown = townId !== null;
    const stats = isTown ? await townStats(townId) : null;
    const wallsBonus = stats ? Math.min(stats.walls, battleC.town.wallsDefCap) : 0;
    const npc = isTown ? battleC.npc.garrison : battleC.npc.warband;
    const npcStats = { ...npc.stats, def: npc.stats.def + wallsBonus };
    const warband = isTown ? await readTownGarrison(tx, ctx.worldId, townId, now) : await readRegionWarband(tx, ctx.worldId, regionId, now);
    const townFleet = isTown ? await readTownFleet(tx, ctx.worldId, townId, now) : null;
    const character = await characterOf(tx, ctx.playerId);
    const regionName = await regionDisplayName(regionId);
    const townName = isTown ? await townDisplayName(townId) : null;
    const town: MapActReport["town"] = stats ? { walls: stats.walls, population: stats.population, garrisonDef: npcStats.def } : null;
    // Recovery: max(1, steps) × hoursPerStep hours from now, for any action.
    const recoveryHours = Math.max(1, steps) * battleC.recovery.hoursPerStep;
    const arrivesAt = new Date(now.getTime() + recoveryHours * MS_PER_HOUR);
    const men = rows.reduce((n, r) => n + r.count, 0);
    const forceText = describeForce(rows);
    const place = isTown ? { townId, townName: townName! } : {};
    const attackerRows = () => rows.map((r) => ({ id: r.id, unitId: r.unitId, label: labelOf(r), icon: iconOf(r), start: r.count, end: r.count, broke: false }));

    let report: MapActReport;
    let destination = base;
    let chronicle: CampaignPayload;

    // 5b. A sea assault on a town must beat its fleet first (ruling 3): with
    // lower naval power the landing is repulsed — no battle, no losses, the
    // force returns with recovery, the town's fleet unchanged.
    let fleetLine: MapActReport["fleet"] = null;
    if (isTown && route === "sea" && townFleet && townFleet.pentekonters + townFleet.triremes > 0 && input.type !== "scout") {
      const defenderNaval = townFleet.pentekonters * 1 + townFleet.triremes * 5;
      fleetLine = { ships, naval, defender: { ...townFleet, naval: defenderNaval }, held: naval >= defenderNaval };
    }

    if (input.type === "scout") {
      // 6. Scout: the dynasty's intel snapshot, no battle. A town's intel
      // carries its garrison and fleet.
      const scoutedGameDate = formatGameDate(gameDate(now.getTime(), ctx.worldStartedMs));
      if (character.dynastyId && isTown && townFleet) {
        const seen = { garrison: warband, pentekonters: townFleet.pentekonters, triremes: townFleet.triremes, scoutedAt: now, scoutedGameDate };
        await tx
          .insert(townIntel)
          .values({ worldId: ctx.worldId, dynastyId: character.dynastyId, townId, ...seen })
          .onConflictDoUpdate({ target: [townIntel.worldId, townIntel.dynastyId, townIntel.townId], set: seen });
      } else if (character.dynastyId) {
        await tx
          .insert(regionIntel)
          .values({ worldId: ctx.worldId, dynastyId: character.dynastyId, regionId, warband, scoutedAt: now, scoutedGameDate })
          .onConflictDoUpdate({ target: [regionIntel.worldId, regionIntel.dynastyId, regionIntel.regionId], set: { warband, scoutedAt: now, scoutedGameDate } });
      }
      chronicle = { action: "scout", regionId, regionName, ...place, men, force: forceText, warband, ...(townFleet ? { fleet: townFleet } : {}) };
      report = {
        type: "scout",
        regionId,
        regionName,
        townId,
        townName,
        town,
        fleet: null,
        base,
        route,
        steps,
        recoveryHours,
        arrivesAt: arrivesAt.toISOString(),
        destination,
        ships,
        winner: null,
        rounds: 0,
        attacker: { rows: attackerRows(), losses: 0 },
        defender: null,
        plunder: null,
        conquest: null,
        intel: { warband, ...(townFleet ?? {}), scoutedGameDate },
        line: renderCampaignLine("map_action", chronicle),
      };
    } else if (fleetLine && !fleetLine.held) {
      // 6b. Repulsed at sea: home with recovery, nothing else changes.
      chronicle = { action: input.type, regionId, regionName, ...place, men, force: forceText, winner: "repulsed", killed: 0, lost: 0 };
      report = {
        type: input.type,
        regionId,
        regionName,
        townId,
        townName,
        town,
        fleet: fleetLine,
        base,
        route,
        steps,
        recoveryHours,
        arrivesAt: arrivesAt.toISOString(),
        destination,
        ships,
        winner: "repulsed",
        rounds: 0,
        attacker: { rows: attackerRows(), losses: 0 },
        defender: { label: npc.label, start: warband, end: warband, losses: 0 },
        plunder: null,
        conquest: null,
        intel: null,
        line: renderCampaignLine("map_action", chronicle),
      };
    } else {
      // 7. Raid / Attack: the pure battle, then its consequences.
      const seed = crypto.createHash("sha256").update([ctx.worldId, ctx.playerId, townId ?? regionId, now.toISOString()].join("|")).digest("hex");
      const attacker: BattleRow[] = rows.map((r) => {
        const def = r.source === "trained" ? unitDef(unitsC, r.unitId) : bandDef(bandsC, r.unitId);
        return { id: r.id, label: labelOf(r), count: r.count, stats: def!.stats };
      });
      const defender: BattleRow[] = [{ id: isTown ? "garrison" : "warband", label: npc.label, count: warband, stats: npcStats }];
      const result: BattleResult = resolveBattle({ attacker, defender, seed, config: battleC, mode: input.type });
      const writeDefender = (value: number) => (isTown ? writeTownGarrison(tx, ctx.worldId, townId, value, now) : writeRegionWarband(tx, ctx.worldId, regionId, value, now));

      // Attacker losses per row: shrink or delete, one battle_loss log each.
      const survivors: UnitRow[] = [];
      for (const r of rows) {
        const side = result.attacker.rows.find((x) => x.id === r.id)!;
        const lost = side.start - side.end;
        if (lost > 0) await tx.insert(effectLog).values({ characterId: character.id, kind: "battle_loss", detail: { rowId: r.id, unitId: r.unitId, source: r.source, lost, regionId, townId, action: input.type }, createdAt: now });
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
        await writeDefender(remaining);
        if (result.winner === "attacker") {
          // A town's stores pay townPlunderMultiplier times the region rate.
          const mult = isTown ? battleC.raid.townPlunderMultiplier : 1;
          plunder = { drachmae: Math.round(defLosses * battleC.raid.plunderPerKill * mult), grain: Math.round(defLosses * battleC.raid.grainPerKill * mult) };
          await creditDrachmae(tx, ctx.playerId, plunder.drachmae);
          await creditGood(tx, ctx.playerId, "grain", plunder.grain, now);
        }
      } else if (result.winner === "attacker") {
        // The garrison is in recovery until arrivesAt: the holding's clocks
        // (empty-for-a-day, tribute) start when the men actually stand.
        const previousOwner = isTown ? await townContentOwner(townId) : await regionContentOwner(regionId);
        if (isTown) await insertTownConquest(tx, ctx, regionId, townId, previousOwner, now, arrivesAt);
        else await insertConquest(tx, ctx, regionId, previousOwner, now, arrivesAt);
        await writeDefender(0);
        conquest = { regionId, townId, previousOwner };
        destination = townId ?? regionId;
        for (const r of survivors) await tx.update(playerUnits).set({ basedAt: destination }).where(eq(playerUnits.id, r.id));
      } else {
        await writeDefender(remaining);
      }

      chronicle = { action: input.type, regionId, regionName, ...place, men, force: forceText, winner: result.winner, killed: defLosses, lost: result.attacker.losses, plunder, conquest: conquest !== null };
      report = {
        type: input.type,
        regionId,
        regionName,
        townId,
        townName,
        town,
        fleet: fleetLine,
        base,
        route,
        steps,
        recoveryHours,
        arrivesAt: arrivesAt.toISOString(),
        destination,
        ships,
        winner: result.winner,
        rounds: result.rounds.length,
        attacker: {
          rows: rows.map((r) => {
            const side = result.attacker.rows.find((x) => x.id === r.id)!;
            return { id: r.id, unitId: r.unitId, label: labelOf(r), icon: iconOf(r), start: side.start, end: side.end, broke: side.broke };
          }),
          losses: result.attacker.losses,
        },
        defender: { label: npc.label, start: warband, end: remaining, losses: defLosses },
        plunder,
        conquest,
        intel: null,
        line: renderCampaignLine("map_action", chronicle),
      };
      rows.splice(0, rows.length, ...survivors);
    }

    // 8. Recovery for every surviving participant.
    const mission = { kind: input.type, regionId, ...(isTown ? { townId } : {}), departedAt: now.toISOString() };
    for (const r of rows) await tx.update(playerUnits).set({ movingTo: destination, arrivesAt, mission }).where(eq(playerUnits.id, r.id));

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
  return { ok: true, report: outcome.result.report, reach, campaign: reach.campaign, force: reach.force, fleet: reach.fleet, roster: barracks.roster };
}

// ---------------------------------------------------------------------------
// Move (3c, rulings 10 and 11): men march to another of the player's places —
// the Massalia region, any home region or home town of Massalia's polity, or a
// holding — from one other base. No battle, no campaign recovery: travel is
// move.minutesWithinRegion when origin and destination share a region (a town
// and its region, two towns in one region), else steps × move.minutesPerStep by
// land (one step) or by sea (within range, with hulls). Arrival rebases and
// merges through the barracks settle, which already does that for returns.
// ---------------------------------------------------------------------------

export type MapMoveInput = { baseId: string; rows: { rowId: string; count: number }[] };

export type MapMoveReport = {
  type: "move";
  from: string;
  fromName: string;
  baseId: string;
  regionId: string;
  regionName: string;
  townId: string | null;
  townName: string | null;
  route: "within" | "land" | "sea";
  steps: number;
  minutes: number;
  arrivesAt: string;
  ships: Record<string, number>;
  men: number;
  rows: { id: string; unitId: string; label: string; icon: string; count: number }[];
  line: string;
};

export type MapMoveResult = Failure | { ok: true; report: MapMoveReport; reach: ReachView; campaign: ReachView["campaign"]; force: ReachView["force"]; fleet: ReachView["fleet"]; roster: BarracksView["roster"] };

export async function move(ctx: ActingContext, input: MapMoveInput, now: Date): Promise<MapMoveResult> {
  const unitsC = getUnitsContent();
  const bandsC = getBandsContent();
  const battleC = getBattleContent();
  const outcome = await db.transaction(async (tx): Promise<{ composureDays: number; result: Failure | { ok: true; report: MapMoveReport } }> => {
    await lockPlayer(tx, ctx.playerId);
    const settled = await settleAll(tx, ctx, now);
    const fail = (code: number, error: string) => ({ composureDays: settled.composureDays, result: { ok: false as const, code, error } });

    // 1. Rows from one base of ours.
    const selected = await selectForce(tx, ctx, input.rows, now);
    if (!selected.ok) return fail(selected.code, selected.error);
    const { rows, base } = selected;
    if (base === input.baseId) return fail(409, "The men already stand there.");

    // 2. The destination: a place the player may station men, with its steps from the base.
    const view = await reachView(tx, ctx, now, { rows, bases: [base] });
    const target = view.moveTargets.find((t) => t.id === input.baseId);
    if (!target) return fail(409, "Men may only be sent to Massalia's own ground or a holding of yours.");
    const steps = target.byBase[base];
    if (!steps) return fail(409, "That base is not yours.");
    const verdict = moveVerdict(steps, view.force, { range: view.fleet.range, space: view.fleet.space });
    if (!verdict.ok) return fail(409, verdict.reason ?? "Out of reach.");

    // 3. The route and the travel time; ships for a sea crossing.
    let route: MapMoveReport["route"];
    let stepCount: number;
    let minutes: number;
    let ships: Record<string, number> = {};
    if (steps.landSteps === 0) {
      route = "within";
      stepCount = 0;
      minutes = battleC.move.minutesWithinRegion;
    } else if (steps.landSteps === 1) {
      route = "land";
      stepCount = 1;
      minutes = battleC.move.minutesPerStep;
    } else {
      route = "sea";
      stepCount = steps.seaSteps!;
      minutes = stepCount * battleC.move.minutesPerStep;
      const { counts } = await fleetInStock(tx, ctx);
      const assembled = assembleFleet(view.force.space, counts);
      const stats = fleetStats(assembled.fleet);
      if (stats.space < view.force.space) return fail(409, REACH_REASON.hulls(view.force.space, stats.space));
      if (stats.range < stepCount) return fail(409, REACH_REASON.range(stepCount, stats.range));
      ships = assembled.ships;
    }
    const arrivesAt = new Date(now.getTime() + minutes * 60_000);

    // 4. Split, then set the march.
    const character = await characterOf(tx, ctx.playerId);
    await splitRows(tx, character.id, selected, now);
    const mission = { kind: "move" as const, regionId: target.regionId, ...(target.townId ? { townId: target.townId } : {}), departedAt: now.toISOString() };
    for (const r of rows) await tx.update(playerUnits).set({ movingTo: target.id, arrivesAt, mission }).where(eq(playerUnits.id, r.id));

    // 5. The report and its Chronicle line.
    const fromBase = view.bases.find((b) => b.id === base);
    const fromName = fromBase?.townId ? await townDisplayName(fromBase.townId) : await regionDisplayName(base);
    const regionName = await regionDisplayName(target.regionId);
    const townName = target.townId ? await townDisplayName(target.townId) : null;
    const labelOf = (r: UnitRow) => (r.source === "trained" ? unitDef(unitsC, r.unitId) : bandDef(bandsC, r.unitId))?.label ?? r.unitId;
    const iconOf = (r: UnitRow) => (r.source === "trained" ? unitDef(unitsC, r.unitId) : bandDef(bandsC, r.unitId))?.icon ?? "";
    const men = rows.reduce((n, r) => n + r.count, 0);
    const chronicle: CampaignPayload = { action: "move", regionId: target.regionId, regionName, ...(target.townId ? { townId: target.townId, townName: townName! } : {}), men, force: describeForce(rows), from: fromName, minutes };
    const report: MapMoveReport = {
      type: "move",
      from: base,
      fromName,
      baseId: target.id,
      regionId: target.regionId,
      regionName,
      townId: target.townId,
      townName,
      route,
      steps: stepCount,
      minutes,
      arrivesAt: arrivesAt.toISOString(),
      ships,
      men,
      rows: rows.map((r) => ({ id: r.id, unitId: r.unitId, label: labelOf(r), icon: iconOf(r), count: r.count })),
      line: renderCampaignLine("map_action", chronicle),
    };
    await tx.insert(effectLog).values({ characterId: character.id, kind: "map_action", detail: { ...report, chronicle, source: "map" }, createdAt: now });
    return { composureDays: settled.composureDays, result: { ok: true, report } };
  });

  if (outcome.composureDays > 0) {
    const ch = (await db.select({ id: playerCharacters.id }).from(playerCharacters).where(eq(playerCharacters.playerId, ctx.playerId)).limit(1))[0];
    if (ch) await applyComposureDelta(ch.id, outcome.composureDays, "building:shrine", now);
  }
  if (!outcome.result.ok) return outcome.result;
  const reach = await db.transaction(async (tx) => {
    await lockPlayer(tx, ctx.playerId);
    return reachView(tx, ctx, now);
  });
  const barracks = await barracksView(ctx, now);
  return { ok: true, report: outcome.result.report, reach, campaign: reach.campaign, force: reach.force, fleet: reach.fleet, roster: barracks.roster };
}
