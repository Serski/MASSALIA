import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { leagueClassGrants, leagueClassPay, leagueDocket, leagueMorale, parseLeagueBuildings, projectKey, projectMotion, type LeagueBuilding, type LeagueClassGrant, type ProjectMotion, type ProjectTiming } from "@massalia/shared";
import { createDb, type DbExec } from "./client.js";
import { ensureLeagueCities, loadCities } from "./leagueRevenue.js";
import { leagueCities, leagueProjects, treasuries } from "./schema.js";
import { activeWorld } from "./world.js";

const db = createDb();

// ---------------------------------------------------------------------------
// The League's building projects (government prompt 2a): the docket the Archons
// choose from each Winter, the motion behind a project id, and the sweep that
// finds a finished building standing. The buildings come from
// content/politics/league-buildings.json, the poleis from cities.json.
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const buildingsFile = path.join(repoRoot, "content/politics/league-buildings.json");

let buildings: LeagueBuilding[] | null = null;
export async function loadLeagueBuildings(): Promise<LeagueBuilding[]> {
  if (!buildings) buildings = parseLeagueBuildings(JSON.parse(await readFile(buildingsFile, "utf8"))).buildings;
  return buildings;
}

const FORTIFICATIONS_MAX = 5;

// Every project the League can put to the chamber now: the world's poleis with
// their live populations (content names, content order), the pairs already built
// or under way, and what the League treasury holds.
export async function leagueDocketFor(worldId: string): Promise<ProjectMotion[]> {
  await ensureLeagueCities(db, worldId);
  const [defs, cities] = await Promise.all([loadLeagueBuildings(), loadCities()]);
  const rows = await db.select({ cityId: leagueCities.cityId, population: leagueCities.population }).from(leagueCities).where(eq(leagueCities.worldId, worldId));
  const population = new Map(rows.map((r) => [r.cityId, r.population]));
  const poleis = cities.cities.map((c) => ({ id: c.id, name: c.name, population: population.get(c.id) ?? c.start.population }));
  const projects = await db.select({ cityId: leagueProjects.cityId, buildingId: leagueProjects.buildingId }).from(leagueProjects).where(eq(leagueProjects.worldId, worldId));
  const taken = new Set(projects.map((p) => projectKey(p.cityId, p.buildingId)));
  const balance = (await db.select({ balance: treasuries.balance }).from(treasuries).where(and(eq(treasuries.worldId, worldId), eq(treasuries.owner, "league"))).limit(1))[0]?.balance ?? 0;
  return leagueDocket(defs, poleis, taken, balance);
}

// The motion behind a project id, with no eligibility check; null for any other id.
export async function leagueProjectMotion(id: string): Promise<ProjectMotion | null> {
  const [defs, cities] = await Promise.all([loadLeagueBuildings(), loadCities()]);
  return projectMotion(id, defs, cities.cities);
}

// Every project of the world, under way or standing, as the instant it stands.
// One select; the pure rules in @massalia/shared decide by time from here.
export async function projectTimings(exec: DbExec, worldId: string): Promise<ProjectTiming[]> {
  const rows = await exec.select({ cityId: leagueProjects.cityId, buildingId: leagueProjects.buildingId, completesAt: leagueProjects.completesAt }).from(leagueProjects).where(eq(leagueProjects.worldId, worldId));
  return rows.map((r) => ({ cityId: r.cityId, buildingId: r.buildingId, completesAt: r.completesAt.getTime() }));
}

// What the League pays a character of `classId` in this world for the seasons
// fromSeason to toSeason inclusive (government prompt 2b): leagueClassPay over
// the world's projects. 0 when the range is empty.
export async function leagueClassPayFor(exec: DbExec, worldId: string, worldStartMs: number, classId: string, fromSeason: number, toSeason: number): Promise<number> {
  if (fromSeason > toSeason) return 0;
  return leagueClassPay(await projectTimings(exec, worldId), await loadLeagueBuildings(), classId, worldStartMs, fromSeason, toSeason);
}

// The grants running for `classId` in this world at `at`, titled from the cities content.
export async function leagueClassGrantsFor(exec: DbExec, worldId: string, classId: string, at: Date): Promise<LeagueClassGrant[]> {
  const [defs, cities] = await Promise.all([loadLeagueBuildings(), loadCities()]);
  return leagueClassGrants(await projectTimings(exec, worldId), defs, cities.cities, classId, at.getTime());
}

// The blessing every army in this world fights under at `at` (government prompt
// 2b): the Temple's morale and the instant the run of Temples ends, or null.
export async function leagueMoraleAt(exec: DbExec, worldId: string, at: Date): Promise<{ amount: number; until: Date } | null> {
  const blessing = leagueMorale(await projectTimings(exec, worldId), await loadLeagueBuildings(), at.getTime());
  return blessing ? { amount: blessing.amount, until: new Date(blessing.untilMs) } : null;
}

export interface CompletedProject {
  id: string;
  cityId: string;
  buildingId: string;
  completesAt: Date;
}

// Find the active world's projects whose completes_at has passed and mark them
// standing, once: the claim is the UPDATE of completed_at on the rows still NULL,
// in one transaction with the Walls' fortifications. A cheap read answers first,
// since GET /me/state runs this on every dashboard load. Returns the claimed rows.
export async function completeLeagueProjects(now: Date = new Date()): Promise<CompletedProject[]> {
  const world = await activeWorld();
  if (!world) return [];
  const due = await db
    .select({ id: leagueProjects.id })
    .from(leagueProjects)
    .where(and(eq(leagueProjects.worldId, world.id), isNull(leagueProjects.completedAt), lte(leagueProjects.completesAt, now)))
    .limit(1);
  if (due.length === 0) return [];

  await ensureLeagueCities(db, world.id);
  const defs = await loadLeagueBuildings();
  return db.transaction(async (tx) => {
    const claimed = await tx
      .update(leagueProjects)
      .set({ completedAt: sql`${leagueProjects.completesAt}` })
      .where(and(eq(leagueProjects.worldId, world.id), isNull(leagueProjects.completedAt), lte(leagueProjects.completesAt, now)))
      .returning({ id: leagueProjects.id, cityId: leagueProjects.cityId, buildingId: leagueProjects.buildingId, completesAt: leagueProjects.completesAt });
    for (const row of claimed) {
      const def = defs.find((b) => b.id === row.buildingId);
      if (!def || def.fortifications <= 0) continue;
      const raised = await tx
        .update(leagueCities)
        .set({ fortifications: sql`LEAST(${FORTIFICATIONS_MAX}, ${leagueCities.fortifications} + ${def.fortifications})` })
        .where(and(eq(leagueCities.worldId, world.id), eq(leagueCities.cityId, row.cityId)))
        .returning({ id: leagueCities.id });
      if (raised.length !== 1) throw new Error(`fortifications of ${row.cityId} touched ${raised.length} rows`);
    }
    return claimed;
  });
}
