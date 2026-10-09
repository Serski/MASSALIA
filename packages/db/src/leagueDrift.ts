import { and, eq, isNull, lt, or } from "drizzle-orm";
import { driftCity, gameDate, leagueStabilityBonus, REAL_MS_PER_SEASON, SEASONS_PER_YEAR, type CalendarConfig } from "@massalia/shared";
import { createDb } from "./client.js";
import { loadLeagueBuildings, projectTimings } from "./leagueProjects.js";
import { loadCities } from "./leagueRevenue.js";
import { leagueCities, worlds } from "./schema.js";

const db = createDb();

async function activeWorld(): Promise<{ id: string; startedMs: number } | null> {
  const rows = await db
    .select({ id: worlds.id, startedAt: worlds.startedAt })
    .from(worlds)
    .where(eq(worlds.status, "active"))
    .limit(1);
  return rows[0] ? { id: rows[0].id, startedMs: rows[0].startedAt.getTime() } : null;
}

// Once-per-game-year drift for the active world's League cities: stability falls
// a point and gains what the polis's standing Temple adds (government prompt 2b:
// the buildings standing at the first instant of the year drifted into),
// population grows by 2% of itself or of the polis's founding size, whichever
// is larger (government prompt 2a). Idempotent + self-healing: only
// cities whose last_growth_year is behind the current game year are grown, and
// each is stamped after — so the hourly sweep can run safely and catch up across
// a year boundary (one step, no multi-year replay). Diplomacy stances do NOT
// drift. The arithmetic is the pure driftCity helper; the founding sizes come
// from content/cities/cities.json.
//
// calendarCfg is accepted for sweep-signature parity with the other accruals; the
// game-year math lives in gameDate (shared), keyed off the world's start instant.
export async function accrueLeagueCities(
  calendarCfg: CalendarConfig,
  now: Date = new Date(),
): Promise<{ grew: number; year: number | null }> {
  const world = await activeWorld();
  if (!world) return { grew: 0, year: null };
  const year = gameDate(now.getTime(), world.startedMs).yearInGame;
  const startPopulation = new Map((await loadCities()).cities.map((c) => [c.id, c.start.population]));
  // The Temple's stability: the projects standing when the year began.
  const yearStartMs = world.startedMs + year * SEASONS_PER_YEAR * REAL_MS_PER_SEASON;
  const projects = await projectTimings(db, world.id);
  const buildings = await loadLeagueBuildings();

  // Only the cities that have not yet grown this game year (NULL = never grown).
  const rows = await db
    .select()
    .from(leagueCities)
    .where(
      and(
        eq(leagueCities.worldId, world.id),
        or(isNull(leagueCities.lastGrowthYear), lt(leagueCities.lastGrowthYear, year)),
      ),
    );

  let grew = 0;
  for (const row of rows) {
    const { changed, next } = driftCity(
      {
        population: row.population,
        tax: row.tax,
        stability: row.stability,
        fortifications: row.fortifications,
        garrison: row.garrison,
        lastGrowthYear: row.lastGrowthYear,
      },
      year,
      startPopulation.get(row.cityId) ?? row.population,
      leagueStabilityBonus(projects, buildings, row.cityId, yearStartMs),
    );
    if (!changed) continue;
    // tax + fortifications are intentionally NOT written — they do not drift.
    await db
      .update(leagueCities)
      .set({ population: next.population, garrison: next.garrison, stability: next.stability, lastGrowthYear: next.lastGrowthYear })
      .where(eq(leagueCities.id, row.id));
    grew++;
  }
  return { grew, year };
}
