import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { parseCitiesContent, polisTax } from "@massalia/shared";

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
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const cities = parseCitiesContent(JSON.parse(readFileSync(resolve(root, "content/cities/cities.json"), "utf8")));

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const { leagueRoutes, loadLeagueContent } = await import("./league.js");
  const { loadPoliticsConfig, getPoliticsConfig } = await import("../services/oligarchy.js");
  return { dbPkg, leagueRoutes, loadLeagueContent, loadPoliticsConfig, getPoliticsConfig };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("GET /api/league/cities: the tax each polis pays a season (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let app: FastifyInstance;
  let worldId: string;

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    await m.loadLeagueContent();
    await m.loadPoliticsConfig();
    app = Fastify();
    await app.register(cookie, { secret: "test-session-secret-at-least-32-chars-long" });
    await app.register(m.leagueRoutes, { prefix: "/api/league" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE league_cities, sessions, users, worlds CASCADE`);
    worldId = (await db.insert(m.dbPkg.worlds).values({ name: "Cities Test", seed: "ctest", startedAt: new Date(Date.now() - DAY), endsAt: new Date(Date.now() + 181 * DAY), status: "active" }).returning())[0]!.id;
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

  it("a grown polis pays more: the tax follows the live population, not the stored column", async () => {
    await get(await session());
    await db.execute(sql`UPDATE league_cities SET population = 22973, tax = 1200 WHERE world_id = ${worldId} AND city_id = 'massalia'`);
    const body = (await get(await session())).json() as { cities: { id: string; population: number; tax: number }[] };
    const massalia = body.cities.find((c) => c.id === "massalia")!;
    expect(massalia.population).toBe(22_973);
    expect(massalia.tax).toBe(459);
  });
});
