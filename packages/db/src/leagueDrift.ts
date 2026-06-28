import { and, eq, isNull, lt, or } from "drizzle-orm";
import { driftCity, gameDate, type CalendarConfig } from "@massalia/shared";
import { createDb } from "./client.js";
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

// Once-per-game-year drift for the active world's League cities (Atlas Phase 2b-i).
// Idempotent + self-healing: only cities whose last_growth_year is behind the
// current game year are grown, and each is stamped after — so the hourly sweep can
// run safely and catch up across a year boundary (one step, no multi-year replay).
// Diplomacy stances do NOT drift. The growth arithmetic is the pure driftCity helper.
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
