import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";

// ---------------------------------------------------------------------------
// GET /api/buildings/mine through a minimal Fastify app (app.inject + a minted
// session cookie, the production error handler). The supply plan sits in its
// own try (economy supply-plan prompt 1, STOP 1 check a): forced to throw, the
// Ledger's payload still answers 200, without the plan, and the failure is
// logged as "supply: failed <message>".
// ---------------------------------------------------------------------------

vi.mock("@massalia/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@massalia/shared")>();
  return { ...actual, supplyPlan: vi.fn(actual.supplyPlan) };
});

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const DAY = 86_400_000;

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const shared = await import("@massalia/shared");
  const { buildingRoutes } = await import("./buildings.js");
  const { errorHandler } = await import("../errorHandler.js");
  const buildings = await import("../services/buildings.js");
  const barracks = await import("../services/barracks.js");
  return { dbPkg, shared, buildingRoutes, errorHandler, buildings, barracks };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("/api/buildings/mine (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let app: FastifyInstance;
  let worldId: string;
  const now = new Date();

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    await m.buildings.loadBuildingsContent();
    await m.buildings.loadPopsContent();
    await m.barracks.loadBarracksContent();
    app = Fastify();
    app.setErrorHandler(m.errorHandler);
    await app.register(cookie, { secret: "test-session-secret-at-least-32-chars-long" });
    await app.register(m.buildingRoutes, { prefix: "/api/buildings" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await db.$client.end();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await db.execute(sql`TRUNCATE TABLE league_festivals, league_projects, league_cities, world_treasury, player_units, player_levy, band_offers, effect_log, resources, player_buildings, player_pops, player_characters, dynasties, players, sessions, users, worlds CASCADE`);
    await db.insert(m.dbPkg.houses).values({ slug: "test-house", name: "House Test", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" }).onConflictDoNothing();
    const world = (await db.insert(m.dbPkg.worlds).values({ name: "Mine Route Test", seed: "mrt", startedAt: new Date(now.getTime() - 2.5 * DAY), endsAt: new Date(now.getTime() + 182 * DAY), status: "active" }).returning())[0]!;
    worldId = world.id;
  });

  // A landowner with four slaves (they eat wheat), so the plan has a line.
  async function freshPlayer(): Promise<string> {
    const { users, players, playerCharacters, playerPops, sessions } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `u-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(players).values({ worldId, userId: user.id, name: `Kleon-${Math.random().toString(36).slice(2, 8)}`, color: "#123456", houseSlug: "test-house" }).returning())[0]!;
    await db.insert(playerCharacters).values({ playerId: player.id, worldId, houseSlug: "test-house", classId: "landowner", militia: 20, drachmae: 500, startAge: 30, deathAge: 90 });
    await db.insert(playerPops).values({ worldId, ownerPlayerId: player.id, popType: "slave", count: 4 });
    const token = crypto.randomBytes(16).toString("base64url");
    await db.insert(sessions).values({ userId: user.id, tokenHash: crypto.createHash("sha256").update(token).digest("hex"), expiresAt: new Date(now.getTime() + DAY) });
    return token;
  }
  const getMine = (token: string) => app.inject({ method: "GET", url: "/api/buildings/mine", headers: { cookie: `massalia_session=${app.signCookie(token)}` } });

  it("answers the plan with the payload", async () => {
    const res = await getMine(await freshPlayer());
    expect(res.statusCode).toBe(200);
    const body = res.json<{ supply?: { household: { good: string; need: number }[] }; army: { perDay: Record<string, number> } }>();
    expect(body.supply?.household).toMatchObject([{ good: "grain", need: 4 }]);
    expect(body.army).toEqual({ perDay: {} });
  });

  it("a plan that throws is logged and left out; the payload still answers 200", async () => {
    const token = await freshPlayer();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(m.shared.supplyPlan).mockImplementationOnce(() => {
      throw new Error("forced for the test");
    });
    const res = await getMine(token);
    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body).not.toHaveProperty("supply");
    expect(body).toMatchObject({ pops: { slave: 4 }, army: { perDay: {} }, buildings: [] });
    expect(errors).toHaveBeenCalledWith("supply: failed forced for the test");
  });
});
