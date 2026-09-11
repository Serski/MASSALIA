import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { eq, sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";

// ---------------------------------------------------------------------------
// GET /api/map/reach through a minimal Fastify app (app.inject + a minted
// session cookie): a session is required; the Massalia region never appears;
// a player with one ready unit and no ships can Attack a land neighbour.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const DAY = 86_400_000;

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const { mapRoutes } = await import("./map.js");
  const { errorHandler } = await import("../errorHandler.js");
  const buildings = await import("../services/buildings.js");
  const barracks = await import("../services/barracks.js");
  const mapGraph = await import("../services/mapGraph.js");
  return { dbPkg, mapRoutes, errorHandler, buildings, barracks, mapGraph };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

type ReachView = {
  now: string;
  campaign: { season: string; open: boolean; opensAt: string | null };
  bases: { regionId: string; kind: string }[];
  force: { men: number; space: number; fast: boolean };
  fleet: { ships: Record<string, number>; range: number; space: number };
  reach: Record<string, { landSteps: number | null; seaSteps: number | null; byBase: Record<string, { landSteps: number | null; seaSteps: number | null }>; attack: { ok: boolean; reason?: string }; raid: { ok: boolean }; colonise: { ok: boolean } }>;
};

suite("/api/map/reach (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let app: FastifyInstance;
  let worldId: string;
  const now = new Date();
  const startedAt = new Date(now.getTime() - 9.5 * DAY);

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    await m.buildings.loadBuildingsContent();
    await m.buildings.loadPopsContent();
    await m.barracks.loadBarracksContent();
    await m.mapGraph.loadMapGraph();
    app = Fastify();
    app.setErrorHandler(m.errorHandler);
    await app.register(cookie, { secret: "test-session-secret-at-least-32-chars-long" });
    await app.register(m.mapRoutes, { prefix: "/api/map" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await db.$client.end();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE player_units, player_holdings, player_levy, band_offers, region_intel, region_military, effect_log, resources, player_characters, dynasties, players, sessions, users, worlds CASCADE`);
    await db.insert(m.dbPkg.houses).values({ slug: "test-house", name: "House Test", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" }).onConflictDoNothing();
    const world = (await db.insert(m.dbPkg.worlds).values({ name: "Reach Route Test", seed: "rrt", startedAt, endsAt: new Date(now.getTime() + 182 * DAY), status: "active" }).returning())[0]!;
    worldId = world.id;
  });

  async function freshPlayer() {
    const { users, players, playerCharacters, dynasties, sessions } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `u-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(players).values({ worldId, userId: user.id, name: `Kleon-${Math.random().toString(36).slice(2, 8)}`, color: "#123456", houseSlug: "test-house" }).returning())[0]!;
    const dynasty = (await db.insert(dynasties).values({ worldId, name: "House Test", prestige: 0, houseSlug: "test-house", foundingPlayerId: player.id, generation: 1 }).returning())[0]!;
    await db.insert(playerCharacters).values({ playerId: player.id, worldId, houseSlug: "test-house", classId: "hoplite", dynastyId: dynasty.id, militia: 20, drachmae: 1000, startAge: 30, deathAge: 90 });
    const token = crypto.randomBytes(16).toString("base64url");
    await db.insert(sessions).values({ userId: user.id, tokenHash: crypto.createHash("sha256").update(token).digest("hex"), expiresAt: new Date(now.getTime() + DAY) });
    return { token, playerId: player.id };
  }
  const get = (token?: string) => app.inject({ method: "GET", url: "/api/map/reach", headers: token ? { cookie: `massalia_session=${app.signCookie(token)}` } : {} });

  it("requires a session", async () => {
    expect((await get()).statusCode).toBe(401);
  });

  it("R060 is absent; with one ready unit and no ships a land neighbour is Attack ok and a sea-only target is not", async () => {
    const p = await freshPlayer();
    const recruitedAt = new Date(now.getTime() - 2 * DAY);
    await db.insert(m.dbPkg.playerUnits).values({ worldId, ownerPlayerId: p.playerId, source: "trained", unitId: "hoplite", count: 5, startCount: 5, recruitedSeason: 7, readyAt: new Date(recruitedAt.getTime() + DAY), createdAt: recruitedAt });
    // Upkeep for the settle the route runs first.
    await db.insert(m.dbPkg.resources).values({ scope: "player", scopeId: p.playerId, type: "grain", amount: "1000", ratePerSecond: "0", lastUpdatedAt: startedAt });
    await db.insert(m.dbPkg.resources).values({ scope: "player", scopeId: p.playerId, type: "oliveoil", amount: "1000", ratePerSecond: "0", lastUpdatedAt: startedAt });
    const res = await get(p.token);
    expect(res.statusCode).toBe(200);
    const v = res.json<ReachView>();
    expect(v.bases).toEqual([{ regionId: "R060", kind: "massalia" }]);
    // Season 9 is a Spring: the campaign is open and no reopening instant is given.
    expect(v.campaign).toEqual({ season: "Spring", open: true, opensAt: null });
    expect(Math.abs(Date.parse(v.now) - Date.now())).toBeLessThan(10_000);
    expect(v.force).toEqual({ men: 5, space: 5, fast: false });
    expect(v.fleet).toEqual({ ships: { "trade-ship": 0, galley: 0 }, range: 0, space: 0 });
    expect(v.reach.R060).toBeUndefined();
    expect(v.reach.R174).toBeUndefined();
    expect(v.reach.R046).toMatchObject({ landSteps: 1, byBase: { R060: { landSteps: 1 } }, attack: { ok: true }, raid: { ok: true }, colonise: { ok: true } });
    const seaOnly = Object.values(v.reach).find((e) => e.landSteps === null && e.seaSteps !== null)!;
    expect(seaOnly.attack.ok).toBe(false);
    expect(seaOnly.attack.reason).toMatch(/fleet's range/);
  });

  it("POST /act: a raid happy path returns the report, fresh reach and the roster; a town target is 409", async () => {
    const p = await freshPlayer();
    const { writeRegionWarband } = await import("../services/mapPools.js");
    await writeRegionWarband(db, worldId, "R046", 20, now);
    const recruitedAt = new Date(now.getTime() - 2 * DAY);
    await db.insert(m.dbPkg.playerUnits).values({ worldId, ownerPlayerId: p.playerId, source: "trained", unitId: "peltast", count: 40, startCount: 40, recruitedSeason: 7, readyAt: new Date(recruitedAt.getTime() + DAY), createdAt: recruitedAt });
    const rowId = (await db.select({ id: m.dbPkg.playerUnits.id }).from(m.dbPkg.playerUnits).where(eq(m.dbPkg.playerUnits.ownerPlayerId, p.playerId)))[0]!.id;
    const post = (payload: unknown) => app.inject({ method: "POST", url: "/api/map/act", headers: { cookie: `massalia_session=${app.signCookie(p.token)}` }, payload: payload as Record<string, unknown> });
    const town = await post({ type: "raid", regionId: "R047", rows: [{ rowId, count: 40 }] });
    expect(town.statusCode).toBe(409);
    expect(town.json<{ error: string }>().error).toBe("Towns are for a later season.");
    expect((await post({ type: "pillage", regionId: "R046", rows: [{ rowId, count: 40 }] })).statusCode).toBe(400);
    expect((await post({ type: "raid", regionId: "R046", rowIds: [rowId] })).statusCode).toBe(400); // the old body shape
    expect((await post({ type: "raid", regionId: "R046", rows: [{ rowId, count: 1.5 }] })).statusCode).toBe(400);
    const res = await post({ type: "raid", regionId: "R046", rows: [{ rowId, count: 40 }] });
    expect(res.statusCode).toBe(200);
    const v = res.json<{ report: { type: string; winner: string; regionName: string; plunder: { drachmae: number } | null; line: string }; reach: { reach: Record<string, unknown> }; force: { men: number }; roster: { id: string; movingTo: string | null }[] }>();
    expect(v.report).toMatchObject({ type: "raid", winner: "attacker", regionName: "Salyes" });
    expect(v.report.plunder!.drachmae).toBeGreaterThan(0);
    expect(v.report.line).toMatch(/^Raided Salyes/);
    expect(v.force.men).toBe(0); // the party is recovering
    expect(v.roster.find((r) => r.id === rowId)!.movingTo).toBe("R060");
    expect(v.reach.reach.R046).toBeDefined();
    expect((await app.inject({ method: "POST", url: "/api/map/act", payload: { type: "raid", regionId: "R046", rows: [{ rowId, count: 40 }] } })).statusCode).toBe(401);
  });

  it("a row still training does not count toward the force, so Attack fails for want of men", async () => {
    const p = await freshPlayer();
    await db.insert(m.dbPkg.playerUnits).values({ worldId, ownerPlayerId: p.playerId, source: "trained", unitId: "peltast", count: 5, startCount: 5, recruitedSeason: 9, readyAt: new Date(now.getTime() + DAY), createdAt: now });
    const v = (await get(p.token)).json<ReachView>();
    expect(v.force.men).toBe(0);
    expect(v.reach.R046!.attack).toEqual({ ok: false, reason: "No men under arms." });
  });
});
