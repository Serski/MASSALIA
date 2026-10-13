import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { armyUpkeep, desertionPlan, desertionReason, gameDate, HOME_POLITY_ID, LEAGUE_UNIT_IDS, menPaidFor, parseLeagueArmy, treasuryClaimReason, type LeagueArmyContent } from "@massalia/shared";
import { createDb, type DbExec } from "./client.js";
import { loadTownMilitaryContent } from "./military.js";
import { players, playerUnits, resources, treasuries, treasuryLedger, worlds } from "./schema.js";
import { activeWorld } from "./world.js";

const db = createDb();

// ---------------------------------------------------------------------------
// The League's army (government prompt 5a). The ten home towns' garrisons and
// their ships are the League's own: units of the four trained types standing
// in their towns and the fleet at Massalia, owned by the world's one players
// row of kind 'league'. That row's insert is the claim that raises the army,
// once per world; the League treasury pays its upkeep once a season, and men
// desert when it cannot. Nobody orders the army here: that is prompt 5b.
// The numbers come from content/military/league-army.json; the fleet is the
// home towns' ships in content/map/town-military.json.
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const armyFile = path.join(repoRoot, "content/military/league-army.json");

let army: LeagueArmyContent | null = null;
export async function loadLeagueArmy(): Promise<LeagueArmyContent> {
  if (!army) army = parseLeagueArmy(JSON.parse(await readFile(armyFile, "utf8")));
  return army;
}

// The League's row is named "The League" (ruling 3 at STOP 0). The name index
// of 0050 holds it against every active player; should a player hold the name
// already, the row takes the longer form so the army is still raised.
export const LEAGUE_NAME = "The League";
const LEAGUE_NAME_TAKEN = "The League of Massalia";
const LEAGUE_COLOR = "#b8612f";
const SHIP_GOODS = { pentekonters: "trade-ship", triremes: "galley" } as const;

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

// The id of the world's League row, or null before the army is raised.
export async function leaguePlayerId(exec: DbExec, worldId: string): Promise<string | null> {
  const rows = await exec.select({ id: players.id }).from(players).where(and(eq(players.worldId, worldId), eq(players.kind, "league"))).limit(1);
  return rows[0]?.id ?? null;
}

// Raise the League's army in a world, once. Claim first: the League row's
// insert on its partial unique index is the claim, and the units and ships are
// written only in the transaction that inserted it, so a second run, or an
// army that has deserted to nothing, never raises it again. Every row is
// trained, ready from this instant, based at its town. A cheap read answers
// first. Returns whether this call raised it.
export async function ensureLeagueArmy(worldId: string, now: Date = new Date()): Promise<boolean> {
  if (await leaguePlayerId(db, worldId)) return false;
  const world = (await db.select({ startedAt: worlds.startedAt }).from(worlds).where(eq(worlds.id, worldId)).limit(1))[0];
  if (!world) return false;
  const content = await loadLeagueArmy();
  const towns = (await loadTownMilitaryContent()).towns;
  const fleet = Object.values(towns)
    .filter((t) => t.owner === HOME_POLITY_ID)
    .reduce((sum, t) => ({ pentekonters: sum.pentekonters + t.pentekonters, triremes: sum.triremes + t.triremes }), { pentekonters: 0, triremes: 0 });
  const season = gameDate(now.getTime(), world.startedAt.getTime()).seasonIndex;
  try {
    return await db.transaction(async (tx) => {
      const taken = await tx
        .select({ id: players.id })
        .from(players)
        .where(and(eq(players.worldId, worldId), eq(players.isActive, true), sql`lower(${players.name}) = lower(${LEAGUE_NAME})`))
        .limit(1);
      const claimed = await tx
        .insert(players)
        .values({ worldId, kind: "league", userId: null, name: taken[0] ? LEAGUE_NAME_TAKEN : LEAGUE_NAME, color: LEAGUE_COLOR, isActive: true, createdAt: now })
        .onConflictDoNothing({ target: players.worldId, where: sql`kind = 'league'` })
        .returning({ id: players.id });
      const league = claimed[0];
      if (!league) return false; // another run raised it first
      const rows = content.towns.flatMap((town) =>
        LEAGUE_UNIT_IDS.filter((unitId) => town.units[unitId] > 0).map((unitId) => ({
          worldId,
          ownerPlayerId: league.id,
          source: "trained" as const,
          unitId,
          count: town.units[unitId],
          startCount: town.units[unitId],
          recruitedSeason: season,
          readyAt: now,
          basedAt: town.townId,
          createdAt: now,
        })),
      );
      if (rows.length) await tx.insert(playerUnits).values(rows);
      const ships = (Object.keys(SHIP_GOODS) as (keyof typeof SHIP_GOODS)[]).filter((k) => fleet[k] > 0).map((k) => ({ scope: "player", scopeId: league.id, type: SHIP_GOODS[k], amount: String(fleet[k]), ratePerSecond: "0", lastUpdatedAt: now }));
      if (ships.length) await tx.insert(resources).values(ships);
      return true;
    });
  } catch (error) {
    // Both names held by players: the sync must not fail for it. Reported, and
    // tried again at the next sync.
    if (!isUniqueViolation(error)) throw error;
    console.error(`league army: the League's row could not be inserted in world ${worldId}`, error);
    return false;
  }
}

export interface LeagueArmyRow {
  id: string;
  unitId: string;
  count: number;
  basedAt: string;
}

// The League's units in a world, town by town; empty before the army is raised.
export async function leagueArmyRows(exec: DbExec, worldId: string): Promise<LeagueArmyRow[]> {
  return exec
    .select({ id: playerUnits.id, unitId: playerUnits.unitId, count: playerUnits.count, basedAt: playerUnits.basedAt })
    .from(playerUnits)
    .innerJoin(players, eq(players.id, playerUnits.ownerPlayerId))
    .where(and(eq(playerUnits.worldId, worldId), eq(players.kind, "league")))
    .orderBy(playerUnits.basedAt, playerUnits.unitId, playerUnits.id);
}

// The League's ships in a world: its stock of the two hulls.
export async function leagueFleet(exec: DbExec, worldId: string): Promise<{ pentekonters: number; triremes: number }> {
  const leagueId = await leaguePlayerId(exec, worldId);
  if (!leagueId) return { pentekonters: 0, triremes: 0 };
  const rows = await exec
    .select({ type: resources.type, amount: resources.amount })
    .from(resources)
    .where(and(eq(resources.scope, "player"), eq(resources.scopeId, leagueId), inArray(resources.type, [SHIP_GOODS.pentekonters, SHIP_GOODS.triremes])));
  const of = (type: string) => Math.floor(Number(rows.find((r) => r.type === type)?.amount ?? 0));
  return { pentekonters: of(SHIP_GOODS.pentekonters), triremes: of(SHIP_GOODS.triremes) };
}

export interface LeagueArmySettle {
  raised: boolean; // this call raised the army
  charged: boolean; // this call claimed the season's upkeep
  paid: number; // drachmae the treasury paid
  deserted: number; // men who left for want of pay
}

// Pay the League's army for the season now running, for the active world: once
// a season, claimed by its ledger row 'army:s<N>'. The treasury pays the
// upkeep when it holds it and nobody deserts; when it holds less it pays what
// it holds, keeps the men that pays for, and the rest desert, every row
// thinned (desertionPlan), with one more ledger row 'desertion:s<N>:<men>' of
// delta 0. An army of no men is charged nothing and writes nothing. The army
// is raised first when the world has none. Cheap when nothing is due: the
// first reads take no lock. A world with no League treasury row yet is left
// alone, so the army is never charged before the treasury has been opened
// (collectLeagueRevenue runs first in every sync).
export async function settleLeagueArmy(now: Date = new Date()): Promise<LeagueArmySettle> {
  const out: LeagueArmySettle = { raised: false, charged: false, paid: 0, deserted: 0 };
  const world = await activeWorld();
  if (!world) return out;
  out.raised = await ensureLeagueArmy(world.id, now);
  const leagueId = await leaguePlayerId(db, world.id);
  if (!leagueId) return out;

  const season = gameDate(now.getTime(), world.startedMs).seasonIndex;
  const reason = treasuryClaimReason.army(season);
  const isClaimed = async (exec: DbExec) =>
    (await exec.select({ id: treasuryLedger.id }).from(treasuryLedger).where(and(eq(treasuryLedger.worldId, world.id), eq(treasuryLedger.owner, "league"), eq(treasuryLedger.reason, reason))).limit(1)).length > 0;
  const armyOf = (exec: DbExec) => exec.select({ id: playerUnits.id, basedAt: playerUnits.basedAt, unitId: playerUnits.unitId, count: playerUnits.count }).from(playerUnits).where(and(eq(playerUnits.worldId, world.id), eq(playerUnits.ownerPlayerId, leagueId)));

  // 1. The cheap reads, no lock.
  if (await isClaimed(db)) return out;
  if ((await armyOf(db)).reduce((n, r) => n + r.count, 0) === 0) return out;
  const rate = (await loadLeagueArmy()).upkeepPerManPerSeason;

  // 2. One transaction, in the one lock order of every write to the League's
  // men or its treasury (government prompt 5b): the League's player lock first,
  // the same advisory lock the server's lockPlayer takes on its row id, then its
  // treasuries row, then the claim and the unit rows. An order holds the same
  // two locks in the same order, so the settle and an order never deadlock.
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${leagueId}::text))`);
    const locked = await tx.select({ balance: treasuries.balance }).from(treasuries).where(and(eq(treasuries.worldId, world.id), eq(treasuries.owner, "league"))).for("update");
    if (!locked[0]) return out; // the treasury has not been opened yet
    if (await isClaimed(tx)) return out;
    const rows = await armyOf(tx).for("update");
    const men = rows.reduce((n, r) => n + r.count, 0);
    if (men === 0) return out;

    const upkeep = armyUpkeep(men, rate);
    const balance = locked[0].balance;
    const paid = Math.max(0, Math.min(balance, upkeep));
    const claimed = await tx.insert(treasuryLedger).values({ worldId: world.id, owner: "league", delta: -paid, reason, createdAt: now }).onConflictDoNothing().returning({ id: treasuryLedger.id });
    if (claimed.length === 0) return out;
    out.charged = true;
    out.paid = paid;
    if (paid > 0) {
      const debited = await tx
        .update(treasuries)
        .set({ balance: sql`${treasuries.balance} - ${paid}`, updatedAt: now })
        .where(and(eq(treasuries.worldId, world.id), eq(treasuries.owner, "league"), gte(treasuries.balance, paid)))
        .returning({ id: treasuries.id });
      if (debited.length !== 1) throw new Error(`league treasury debit for ${reason} touched ${debited.length} rows`);
    }
    // A treasury that holds the season's upkeep pays it and nobody deserts.
    if (balance >= upkeep) return out;

    const deserters = men - Math.min(men, menPaidFor(paid, rate));
    if (deserters <= 0) return out;
    const lose = desertionPlan(rows, deserters);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const leaving = lose[i]!;
      if (leaving <= 0) continue;
      const touched =
        leaving >= row.count
          ? await tx.delete(playerUnits).where(eq(playerUnits.id, row.id)).returning({ id: playerUnits.id })
          : await tx
              .update(playerUnits)
              .set({ count: sql`${playerUnits.count} - ${leaving}` })
              .where(and(eq(playerUnits.id, row.id), gte(playerUnits.count, leaving)))
              .returning({ id: playerUnits.id });
      if (touched.length !== 1) throw new Error(`desertion from league unit ${row.id} touched ${touched.length} rows`);
    }
    await tx.insert(treasuryLedger).values({ worldId: world.id, owner: "league", delta: 0, reason: desertionReason(season, deserters), createdAt: now });
    out.deserted = deserters;
    return out;
  });
}
