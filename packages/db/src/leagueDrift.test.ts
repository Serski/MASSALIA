import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseCalendarConfig, parseCitiesContent, REAL_MS_PER_SEASON, SEASONS_PER_YEAR } from "@massalia/shared";

// ---------------------------------------------------------------------------
// The yearly city drift (government prompts 2a and 2b): stability falls a point
// a game year, and a polis whose Temple of Artemis stood when the year began
// gains the Temple's 3, so it rises 2. Integration test against a REAL Postgres,
// guarded to a *_test database (it truncates), as leagueRevenue.test.ts.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const content = (file: string) => JSON.parse(readFileSync(resolve(root, "content", file), "utf8"));
const calendar = parseCalendarConfig(content("calendar/calendar-config.json"));
const cities = parseCitiesContent(content("cities/cities.json")).cities;
const startStability = (id: string) => cities.find((c) => c.id === id)!.start.stability;
const SEASON = REAL_MS_PER_SEASON;
const YEAR = SEASONS_PER_YEAR * SEASON;
const T0 = Date.UTC(2000, 0, 1);
// The middle of a game year's first season.
const inYear = (year: number) => new Date(T0 + year * YEAR + SEASON / 2);

suite("the yearly drift and the Temple's stability (integration)", () => {
  let db: Awaited<ReturnType<typeof load>>["db"];
  let dbPkg: Awaited<ReturnType<typeof load>>["dbPkg"];
  let worldId: string;

  async function load() {
    const dbPkg = await import("./index.js");
    return { dbPkg, db: dbPkg.createDb() };
  }

  const stability = async (cityId: string) =>
    (await db.select({ s: dbPkg.leagueCities.stability }).from(dbPkg.leagueCities).where(and(eq(dbPkg.leagueCities.worldId, worldId), eq(dbPkg.leagueCities.cityId, cityId))))[0]!.s;
  const stands = (cityId: string, buildingId: string, completesAt: Date) =>
    db.insert(dbPkg.leagueProjects).values({ worldId, cityId, buildingId, cost: 1, startedAt: new Date(completesAt.getTime() - 4 * SEASON), completesAt });

  beforeAll(async () => {
    ({ db, dbPkg } = await load());
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE league_projects, league_cities, worlds CASCADE`);
    worldId = (await db.insert(dbPkg.worlds).values({ name: "Drift", seed: "drift-live", startedAt: new Date(T0), endsAt: new Date(T0 + 182 * SEASON), status: "active" }).returning())[0]!.id;
    await dbPkg.ensureLeagueCities(db, worldId);
  });

  it("a polis whose Temple stood when the year began rises 2; the others fall 1; a second call in the year changes nothing", async () => {
    // Massalia's Temple stands at the first instant of year 1; Nikaia's a season later.
    await stands("massalia", "temple", new Date(T0 + YEAR));
    await stands("nikaia", "temple", new Date(T0 + YEAR + SEASON));
    expect(await stability("massalia")).toBe(startStability("massalia"));

    // Drifting at year 1 (the first drift, one step): Massalia's Temple stood when
    // the year began, Nikaia's did not yet.
    const year1 = await dbPkg.accrueLeagueCities(calendar, inYear(1));
    expect(year1).toEqual({ grew: cities.length, year: 1 });
    expect(await stability("massalia")).toBe(startStability("massalia") + 2);
    expect(await stability("nikaia")).toBe(startStability("nikaia") - 1);
    expect(await stability("olbia")).toBe(startStability("olbia") - 1);

    // Drifting at year 2: both Temples stand.
    const year2 = await dbPkg.accrueLeagueCities(calendar, inYear(2));
    expect(year2).toEqual({ grew: cities.length, year: 2 });
    expect(await stability("massalia")).toBe(startStability("massalia") + 4);
    expect(await stability("nikaia")).toBe(startStability("nikaia") - 1 + 2);
    expect(await stability("olbia")).toBe(startStability("olbia") - 2);

    expect(await dbPkg.accrueLeagueCities(calendar, inYear(2))).toEqual({ grew: 0, year: 2 });
    expect(await stability("massalia")).toBe(startStability("massalia") + 4);
  });
});
