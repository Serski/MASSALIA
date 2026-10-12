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
    await db.execute(sql`TRUNCATE TABLE league_wars, faction_relations, league_festivals, league_projects, agenda_cycles, treasuries, league_cities, sessions, users, worlds CASCADE`);
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
    wars: { opensAt: string; opensLabel: string; drafting: boolean; items: { id: string; factionId: string; name: string; bandLabel: string }[]; atWar: { factionId: string; name: string; nation: string; throughLabel: string }[] };
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
    expect(w.wars.items).toEqual([]);
    expect(w.buildings).toHaveLength(5);
  });

  // --- The war docket (government prompt 4) ---------------------------------------
  // This suite's world is in its first Spring, the war motion's drafting season.
  const SIX_NATIONS = [
    { id: "war:cadurci:y0", factionId: "cadurci", name: "Cadurci", bandLabel: "Unfriendly" },
    { id: "war:volcae:y0", factionId: "volcae", name: "Volcae", bandLabel: "Hostile" },
    { id: "war:allobroges:y0", factionId: "allobroges", name: "Allobroges", bandLabel: "Unfriendly" },
    { id: "war:saluvii:y0", factionId: "saluvii", name: "Saluvii", bandLabel: "Unfriendly" },
    { id: "war:tarusates:y0", factionId: "tarusates", name: "Tarusates", bandLabel: "Unfriendly" },
    { id: "war:carthage:y0", factionId: "carthage", name: "Carthage", bandLabel: "Hostile" },
  ];
  const diplomacy = async () =>
    ((await app.inject({ method: "GET", url: "/api/league/diplomacy", headers: { cookie: `massalia_session=${app.signCookie(await session())}` } })).json() as { factions: { id: string; atWar: boolean; warThroughLabel: string | null }[] }).factions;

  it("works.wars in the first Spring: the docket is open with the six nations below 0, each with its band, and no war under way", async () => {
    const w = await works();
    expect(w.wars.drafting).toBe(true);
    expect(w.wars.opensLabel).toBe("Spring, 300 BC");
    expect(w.wars.opensAt).toBe(new Date(worldStartedAt.getTime() + DAY).toISOString());
    expect(w.wars.items).toEqual(SIX_NATIONS);
    expect(w.wars.atWar).toEqual([]);
    for (const f of await diplomacy()) expect(f.warThroughLabel, f.id).toBeNull();
  });

  it("works.wars follows the bars: a nation that fell joins the docket with its band, and the cycle's own docket shows once a sync has fixed it", async () => {
    await db.insert(m.dbPkg.factionRelations).values({ worldId, factionId: "helvii", stance: "hostile", opinion: -160, atWar: false });
    let w = await works();
    expect(w.wars.items.map((i) => [i.factionId, i.bandLabel])).toEqual([["cadurci", "Unfriendly"], ["helvii", "Hostile"], ["volcae", "Hostile"], ["allobroges", "Unfriendly"], ["saluvii", "Unfriendly"], ["tarusates", "Unfriendly"], ["carthage", "Hostile"]]);

    await db.insert(m.dbPkg.agendaCycles).values({ worldId, scope: "war", gameYear: 0, phase: "drafting", cardIds: ["war:volcae:y0", "war:carthage:y0"], opensAt: new Date(worldStartedAt.getTime() + DAY), votingEndsAt: new Date(worldStartedAt.getTime() + 3 * DAY) });
    w = await works();
    expect(w.wars.drafting).toBe(true);
    expect(w.wars.items.map((i) => i.id)).toEqual(["war:volcae:y0", "war:carthage:y0"]);
  });

  it("a war under way shows with the season it runs through, drops its nation from the docket, and the Diplomacy page names that season", async () => {
    await db.insert(m.dbPkg.factionRelations).values({ worldId, factionId: "carthage", stance: "hostile", opinion: -200, atWar: true });
    // Declared at the world's start for 8 seasons: its last season is year 1's Autumn.
    await db.insert(m.dbPkg.leagueWars).values({ worldId, factionId: "carthage", gameYear: 0, cost: 2000, startsAt: worldStartedAt, endsAt: new Date(worldStartedAt.getTime() + 8 * DAY) });
    const w = await works();
    expect(w.wars.atWar).toEqual([{ factionId: "carthage", name: "Carthage", nation: "Carthage", throughLabel: "Autumn, 299 BC" }]);
    expect(w.wars.items).toEqual(SIX_NATIONS.slice(0, 5));

    // A people takes the article where a sentence names it; a major power does not.
    await db.insert(m.dbPkg.factionRelations).values({ worldId, factionId: "volcae", stance: "hostile", opinion: -200, atWar: true });
    await db.insert(m.dbPkg.leagueWars).values({ worldId, factionId: "volcae", gameYear: 1, cost: 2000, startsAt: worldStartedAt, endsAt: new Date(worldStartedAt.getTime() + 10 * DAY) });
    expect((await works()).wars.atWar.map((x) => [x.name, x.nation, x.throughLabel]).sort()).toEqual([["Carthage", "Carthage", "Autumn, 299 BC"], ["Volcae", "the Volcae", "Spring, 298 BC"]]);
    await db.delete(m.dbPkg.leagueWars).where(sql`world_id = ${worldId} AND faction_id = 'volcae'`);
    await db.delete(m.dbPkg.factionRelations).where(sql`world_id = ${worldId} AND faction_id = 'volcae'`);

    const factions = await diplomacy();
    expect(factions.find((f) => f.id === "carthage")).toMatchObject({ atWar: true, warThroughLabel: "Autumn, 299 BC" });
    expect(factions.filter((f) => f.id !== "carthage").every((f) => f.warThroughLabel === null && !f.atWar)).toBe(true);
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
