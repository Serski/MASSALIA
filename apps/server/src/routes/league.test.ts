import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { buildingEffects, festivalEffects, leagueDocket, parseCitiesContent, parseLeagueBuildings, parseLeagueFestivals, polisTax } from "@massalia/shared";

// ---------------------------------------------------------------------------
// GET /api/league/cities (government prompt 1): the Tax column is what each
// polis pays the League treasury a season, polisTax of its live population,
// not the stored column nothing ever paid. Integration test against a REAL
// Postgres, guarded to a *_test database; a minimal Fastify app with a minted
// session cookie, as the other route tests build one.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const DAY = 86_400_000;
const HOUR = 3_600_000;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const cities = parseCitiesContent(JSON.parse(readFileSync(resolve(root, "content/cities/cities.json"), "utf8")));
const buildings = parseLeagueBuildings(JSON.parse(readFileSync(resolve(root, "content/politics/league-buildings.json"), "utf8"))).buildings;
const festivals = parseLeagueFestivals(JSON.parse(readFileSync(resolve(root, "content/politics/league-festivals.json"), "utf8"))).festivals;

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const { leagueRoutes, loadLeagueContent } = await import("./league.js");
  const { loadPoliticsConfig, getPoliticsConfig } = await import("../services/oligarchy.js");
  const { loadAgendaContent } = await import("../services/agenda.js");
  return { dbPkg, leagueRoutes, loadLeagueContent, loadPoliticsConfig, getPoliticsConfig, loadAgendaContent };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("GET /api/league/cities: the tax each polis pays a season (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let app: FastifyInstance;
  let worldId: string;
  let worldStartedAt: Date;

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    await m.loadLeagueContent();
    await m.loadPoliticsConfig();
    await m.loadAgendaContent();
    app = Fastify();
    await app.register(cookie, { secret: "test-session-secret-at-least-32-chars-long" });
    await app.register(m.leagueRoutes, { prefix: "/api/league" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE league_festivals, league_projects, agenda_cycles, treasuries, league_cities, sessions, users, worlds CASCADE`);
    worldStartedAt = new Date(Date.now() - DAY);
    worldId = (await db.insert(m.dbPkg.worlds).values({ name: "Cities Test", seed: "ctest", startedAt: worldStartedAt, endsAt: new Date(Date.now() + 181 * DAY), status: "active" }).returning())[0]!.id;
    // The League treasury at 60,000, so every project and festival is within reach.
    await db.insert(m.dbPkg.treasuries).values({ worldId, owner: "league", balance: 60_000 });
  });

  async function session(): Promise<string> {
    const user = (await db.insert(m.dbPkg.users).values({ email: `u-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const token = crypto.randomBytes(16).toString("base64url");
    await db.insert(m.dbPkg.sessions).values({ userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + DAY) });
    return token;
  }
  const get = (token?: string) => app.inject({ method: "GET", url: "/api/league/cities", headers: token ? { cookie: `massalia_session=${app.signCookie(token)}` } : {} });

  it("answers 401 without a session", async () => {
    expect((await get()).statusCode).toBe(401);
  });

  it("each city's tax is polisTax of its population; Massalia pays 400 at the start", async () => {
    const res = await get(await session());
    expect(res.statusCode).toBe(200);
    const body = res.json() as { cities: { id: string; population: number; tax: number }[] };
    expect(body.cities).toHaveLength(cities.cities.length);
    const cfg = m.getPoliticsConfig().treasury;
    for (const c of body.cities) expect(c.tax, c.id).toBe(polisTax(c.population, cfg));
    const massalia = body.cities.find((c) => c.id === "massalia")!;
    expect(massalia.population).toBe(20_000);
    expect(massalia.tax).toBe(400);
    // The read seeded the world's nine rows once; a second read adds none.
    expect((await db.select().from(m.dbPkg.leagueCities)).length).toBe(cities.cities.length);
    await get(await session());
    expect((await db.select().from(m.dbPkg.leagueCities)).length).toBe(cities.cities.length);
  });

  it("a polis shows its League buildings: the ones standing and the ones under way with the date they stand", async () => {
    type City = { id: string; buildings: { buildingId: string; name: string; status: string; completesLabel: string | null }[] };
    const startedMs = Date.now() - DAY;
    await db.insert(m.dbPkg.leagueProjects).values({ worldId, cityId: "nikaia", buildingId: "port", cost: 2000, startedAt: new Date(startedMs), completesAt: new Date(startedMs + 8 * DAY + HOUR) });
    await db.insert(m.dbPkg.leagueProjects).values({ worldId, cityId: "nikaia", buildingId: "temple", cost: 1000, startedAt: new Date(startedMs), completesAt: new Date(startedMs + DAY), completedAt: new Date(startedMs + DAY) });
    const body = (await get(await session())).json() as { cities: City[] };
    const nikaia = body.cities.find((c) => c.id === "nikaia")!;
    // Content order: the Temple before the Port.
    expect(nikaia.buildings).toEqual([
      { buildingId: "temple", name: "Temple of Artemis", status: "built", completesLabel: null },
      { buildingId: "port", name: "Port", status: "building", completesLabel: "Winter, 298 BC" },
    ]);
    expect(body.cities.find((c) => c.id === "massalia")!.buildings).toEqual([]);
  });

  // --- The League's plans, in advance (government prompt 3b) ---------------------
  type Works = {
    buildings: { id: string; name: string; cost: number; seasons: number; populationAbove: number | null; partyLean: string; effects: string[] }[];
    projects: { opensAt: string; opensLabel: string; drafting: boolean; items: { id: string; cityId: string; polis: string; buildingId: string; name: string }[] };
    festivals: { opensAt: string; opensLabel: string; drafting: boolean; items: { id: string; name: string; cost: number; partyLean: string; effects: string[] }[]; year: number; yearLabel: string };
  };
  const works = async () => ((await get(await session())).json() as { works: Works }).works;
  const startDocket = () => leagueDocket(buildings, cities.cities.map((c) => ({ id: c.id, name: c.name, population: c.start.population })), new Set(), 60_000);

  it("works.buildings is the five content buildings with what each does, for 'The city'", async () => {
    const w = await works();
    expect(w.buildings.map((b) => b.id)).toEqual(buildings.map((b) => b.id));
    expect(w.buildings.map((b) => [b.name, b.cost, b.seasons, b.populationAbove, b.partyLean])).toEqual(buildings.map((b) => [b.name, b.cost, b.seasons, b.populationAbove, b.partyLean]));
    expect(w.buildings[0]!.effects).toEqual(["Priests +20 dr a season for 4 seasons", "Every army +3 morale for 2 years", "The city +3 stability a year"]);
    expect(w.buildings[3]!.effects).toEqual(["The city's fortifications +1"]);
    for (const b of w.buildings) expect(b.effects).toEqual(buildingEffects(buildings.find((x) => x.id === b.id)!, "The city"));
  });

  it("in a Spring the dockets are the coming ones, as they would open today", async () => {
    const w = await works();
    expect(w.projects.drafting).toBe(false);
    expect(w.projects.opensAt).toBe(new Date(worldStartedAt.getTime() + 4 * DAY).toISOString());
    expect(w.projects.opensLabel).toBe("Winter, 299 BC");
    expect(w.projects.items.map((i) => i.id)).toEqual(startDocket().map((p) => p.id));
    expect(w.projects.items).toHaveLength(36);
    expect(w.projects.items[0]).toEqual({ id: "project:massalia:temple", cityId: "massalia", polis: "Massalia", buildingId: "temple", name: "Temple of Artemis" });

    expect(w.festivals.drafting).toBe(false);
    expect(w.festivals.opensLabel).toBe("Summer, 300 BC");
    expect(w.festivals.year).toBe(1);
    expect(w.festivals.yearLabel).toBe("299 BC");
    expect(w.festivals.items.map((i) => i.id)).toEqual(["festival:dionysia:y1", "festival:artemisia:y1", "festival:apollo:y1"]);
    for (const item of w.festivals.items) {
      const f = festivals.find((x) => `festival:${x.id}:y1` === item.id)!;
      expect(item).toEqual({ id: item.id, name: f.name, cost: f.cost, partyLean: f.partyLean, effects: festivalEffects(f) });
    }
  });

  it("a project under way is not on the coming docket", async () => {
    await db.insert(m.dbPkg.leagueProjects).values({ worldId, cityId: "massalia", buildingId: "temple", cost: 1000, startedAt: worldStartedAt, completesAt: new Date(worldStartedAt.getTime() + 4 * DAY) });
    const w = await works();
    expect(w.projects.items).toHaveLength(35);
    expect(w.projects.items.some((i) => i.id === "project:massalia:temple")).toBe(false);
  });

  it("while the League drafts, the docket is the cycle's own, or as it would open when no sync has fixed it yet", async () => {
    // The world's first Winter: the League drafting year 0.
    const startedAt = new Date(Date.now() - HOUR);
    await db.update(m.dbPkg.worlds).set({ startedAt }).where(sql`id = ${worldId}`);
    await db.insert(m.dbPkg.agendaCycles).values({ worldId, scope: "league", gameYear: 0, phase: "drafting", cardIds: ["project:nikaia:walls", "project:olbia:port"], opensAt: startedAt, votingEndsAt: new Date(startedAt.getTime() + 2 * DAY) });
    let w = await works();
    expect(w.projects.drafting).toBe(true);
    expect(w.projects.opensLabel).toBe("Winter, 300 BC");
    expect(w.projects.items.map((i) => [i.id, i.polis, i.name])).toEqual([["project:nikaia:walls", "Nikaia", "Walls"], ["project:olbia:port", "Olbia", "Port"]]);

    await db.delete(m.dbPkg.agendaCycles).where(sql`world_id = ${worldId}`);
    w = await works();
    expect(w.projects.drafting).toBe(true);
    expect(w.projects.items).toHaveLength(36);
  });

  it("with no treasuries row both dockets are empty", async () => {
    await db.delete(m.dbPkg.treasuries).where(sql`world_id = ${worldId}`);
    const w = await works();
    expect(w.projects.items).toEqual([]);
    expect(w.festivals.items).toEqual([]);
    expect(w.buildings).toHaveLength(5);
  });

  it("a grown polis pays more: the tax follows the live population, not the stored column", async () => {
    await get(await session());
    await db.execute(sql`UPDATE league_cities SET population = 22973, tax = 1200 WHERE world_id = ${worldId} AND city_id = 'massalia'`);
    const body = (await get(await session())).json() as { cities: { id: string; population: number; tax: number }[] };
    const massalia = body.cities.find((c) => c.id === "massalia")!;
    expect(massalia.population).toBe(22_973);
    expect(massalia.tax).toBe(459);
  });
});
