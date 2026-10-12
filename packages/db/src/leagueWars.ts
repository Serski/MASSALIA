import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { opinionBand, parseFactionsContent, parseLeagueWar, warDocket, warMotion, type FactionDef, type LeagueWar, type WarMotion, type WarRelation } from "@massalia/shared";
import { createDb, type DbExec } from "./client.js";
import { factionRelations, leagueWars, treasuries } from "./schema.js";
import { activeWorld } from "./world.js";

const db = createDb();

// ---------------------------------------------------------------------------
// The League's wars (government prompt 4): the Spring docket the Archons choose
// from, the motion behind a war id, the wars under way, and the sweep that
// brings peace when a war's seasons have run. The war's numbers come from
// content/politics/league-war.json, the nations from diplomacy/factions.json.
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const warFile = path.join(repoRoot, "content/politics/league-war.json");
const factionsFile = path.join(repoRoot, "content/diplomacy/factions.json");

let war: LeagueWar | null = null;
export async function loadLeagueWar(): Promise<LeagueWar> {
  if (!war) war = parseLeagueWar(JSON.parse(await readFile(warFile, "utf8")));
  return war;
}

let factions: FactionDef[] | null = null;
export async function loadFactions(): Promise<FactionDef[]> {
  if (!factions) factions = parseFactionsContent(JSON.parse(await readFile(factionsFile, "utf8"))).factions;
  return factions;
}

// The wars the League can put to the chamber in `year`: the nations whose bar
// in this world is below the war's line and that are not at war, within the
// League's balance. A nation with no row yet counts at its content start.
export async function warDocketFor(worldId: string, year: number): Promise<WarMotion[]> {
  const [def, nations] = await Promise.all([loadLeagueWar(), loadFactions()]);
  const rows = await db.select({ factionId: factionRelations.factionId, opinion: factionRelations.opinion, atWar: factionRelations.atWar }).from(factionRelations).where(eq(factionRelations.worldId, worldId));
  const relations = new Map<string, WarRelation>(rows.map((r) => [r.factionId, { opinion: r.opinion, atWar: r.atWar }]));
  const balance = (await db.select({ balance: treasuries.balance }).from(treasuries).where(and(eq(treasuries.worldId, worldId), eq(treasuries.owner, "league"))).limit(1))[0]?.balance ?? 0;
  return warDocket(nations, relations, def, year, balance);
}

// The motion behind a war id, with no eligibility check; null for any other id.
export async function warMotionFor(id: string): Promise<WarMotion | null> {
  const [def, nations] = await Promise.all([loadLeagueWar(), loadFactions()]);
  return warMotion(id, nations, def);
}

export interface ActiveWar {
  factionId: string;
  startsAt: Date;
  endsAt: Date;
}

// The world's wars under way: declared, and peace not yet come. One select.
export async function activeWars(exec: DbExec, worldId: string): Promise<ActiveWar[]> {
  return exec
    .select({ factionId: leagueWars.factionId, startsAt: leagueWars.startsAt, endsAt: leagueWars.endsAt })
    .from(leagueWars)
    .where(and(eq(leagueWars.worldId, worldId), isNull(leagueWars.endedAt)));
}

export interface EndedWar {
  id: string;
  factionId: string;
  endsAt: Date;
}

// Peace comes by itself: find the active world's wars whose ends_at has passed
// and end them, once. The claim is the UPDATE of ended_at on the rows still
// NULL, in one transaction with each nation's flag dropping and its bar set to
// the war's peaceOpinion. A cheap read answers first, since every agenda sync
// runs this. Returns the claimed rows.
export async function endLeagueWars(now: Date = new Date()): Promise<EndedWar[]> {
  const world = await activeWorld();
  if (!world) return [];
  const due = await db
    .select({ id: leagueWars.id })
    .from(leagueWars)
    .where(and(eq(leagueWars.worldId, world.id), isNull(leagueWars.endedAt), lte(leagueWars.endsAt, now)))
    .limit(1);
  if (due.length === 0) return [];

  const def = await loadLeagueWar();
  return db.transaction(async (tx) => {
    const claimed = await tx
      .update(leagueWars)
      .set({ endedAt: sql`${leagueWars.endsAt}` })
      .where(and(eq(leagueWars.worldId, world.id), isNull(leagueWars.endedAt), lte(leagueWars.endsAt, now)))
      .returning({ id: leagueWars.id, factionId: leagueWars.factionId, endsAt: leagueWars.endsAt });
    for (const row of claimed) {
      const settled = await tx
        .update(factionRelations)
        .set({ atWar: false, opinion: def.peaceOpinion, stance: opinionBand(def.peaceOpinion).id })
        .where(and(eq(factionRelations.worldId, world.id), eq(factionRelations.factionId, row.factionId)))
        .returning({ id: factionRelations.id });
      if (settled.length !== 1) throw new Error(`peace with ${row.factionId} touched ${settled.length} rows`);
    }
    return claimed;
  });
}
