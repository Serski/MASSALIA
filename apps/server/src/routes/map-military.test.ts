import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";

// ---------------------------------------------------------------------------
// GET /api/map/military — World 2 military read entitlements. Integration test
// against a REAL Postgres, guarded to a *_test database (mirrors map-stream.test).
// Massalia-owned towns are "home" for every player; everything else appears only
// through the requester's own dynasty's intel snapshot. Intel rows are inserted
// directly as fixtures — nothing in this batch writes them.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const DAY = 86_400_000;
const T0 = Date.UTC(2000, 0, 1);

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const map = await import("./map.js");
  const { errorHandler } = await import("../errorHandler.js");
  return { dbPkg, map, errorHandler };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("GET /api/map/military (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let app: FastifyInstance;
  let worldId: string;

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    app = Fastify();
    app.setErrorHandler(m.errorHandler);
    await app.register(cookie, { secret: "test-session-secret-at-least-32-chars-long" });
    await app.register(m.map.mapRoutes, { prefix: "/api/map" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE town_intel, region_intel, town_military, region_military, sessions, player_characters, players, dynasties, worlds, users CASCADE`,
    );
    await db
      .insert(m.dbPkg.houses)
      .values({ slug: "test-house", name: "Test House", initial: "T", alignment: "centrist", stance: "test", motto: "test", patron: "test", crest: "test" })
      .onConflictDoNothing();
    const world = (
      await db
        .insert(m.dbPkg.worlds)
        .values({ name: "W", seed: "s", startedAt: new Date(T0), endsAt: new Date(T0 + 182 * DAY), status: "active" })
        .returning()
    )[0]!;
    worldId = world.id;
    await m.dbPkg.ensureTownMilitary(db, worldId);
    await m.dbPkg.ensureRegionMilitary(db, worldId);
  });

  // A user + active player + dynasty + character row + live session. The character
  // row is inserted directly so the route's ensureCharacterRow finds it and never
  // reaches the content-config-dependent creation path.
  async function freshPlayer() {
    const user = (await db.insert(m.dbPkg.users).values({ email: `u-${crypto.randomUUID()}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(m.dbPkg.players).values({ worldId, userId: user.id, name: `P-${crypto.randomUUID().slice(0, 8)}`, color: "#123456" }).returning())[0]!;
    const dynasty = (await db.insert(m.dbPkg.dynasties).values({ worldId, name: "House Test" }).returning())[0]!;
    await db.insert(m.dbPkg.playerCharacters).values({ playerId: player.id, worldId, dynastyId: dynasty.id, houseSlug: "test-house", classId: "trader" });
    const raw = crypto.randomBytes(32).toString("base64url");
    await db.insert(m.dbPkg.sessions).values({ userId: user.id, tokenHash: crypto.createHash("sha256").update(raw).digest("hex"), expiresAt: new Date(Date.now() + DAY) });
    return { dynastyId: dynasty.id, cookie: `massalia_session=${app.signCookie(raw)}` };
  }

  const get = (cookieHeader?: string) =>
    app.inject({ method: "GET", url: "/api/map/military", headers: cookieHeader ? { cookie: cookieHeader } : {} });

  it("rejects an unauthenticated request", async () => {
    const res = await get();
    expect(res.statusCode).toBe(401);
  });

  it("exposes Massalia's live pools as home to any player, and nothing else", async () => {
    const { cookie: c } = await freshPlayer();
    const res = await get(c);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { towns: Record<string, unknown>; regions: Record<string, unknown> };
    expect(body.towns.massalia).toEqual({ garrison: 1000, pentekonters: 10, triremes: 30, source: "home" });
    // Exactly the ten Massaliote towns (content owners), no foreign town or region.
    expect(Object.keys(body.towns).sort()).toEqual(
      ["agathe", "antipolis", "athinopolis", "emporion", "massalia", "monoikos", "nikaia", "olbia-provence", "rhoda", "arelate"].sort(),
    );
    expect(body.towns.carthage).toBeUndefined();
    expect(body.regions.R105).toBeUndefined();
    expect(Object.keys(body.regions)).toEqual([]);
  });

  it("surfaces the requester's own intel snapshots with their scouted date, never the live pool", async () => {
    const { dynastyId, cookie: c } = await freshPlayer();
    await db.insert(m.dbPkg.townIntel).values({ worldId, dynastyId, townId: "carthage", garrison: 25000, pentekonters: 9, triremes: 55, scoutedGameDate: "Spring, 299 BC" });
    await db.insert(m.dbPkg.regionIntel).values({ worldId, dynastyId, regionId: "R105", warband: 3900, scoutedGameDate: "Spring, 299 BC" });
    const body = (await get(c)).json() as { towns: Record<string, unknown>; regions: Record<string, unknown> };
    expect(body.towns.carthage).toEqual({ garrison: 25000, pentekonters: 9, triremes: 55, source: "intel", scoutedGameDate: "Spring, 299 BC" });
    expect(body.regions.R105).toEqual({ warband: 3900, source: "intel", scoutedGameDate: "Spring, 299 BC" });
    // Home entries are untouched by intel.
    expect(body.towns.massalia).toEqual({ garrison: 1000, pentekonters: 10, triremes: 30, source: "home" });
  });

  it("never leaks another dynasty's intel", async () => {
    const spy = await freshPlayer();
    const other = await freshPlayer();
    await db.insert(m.dbPkg.townIntel).values({ worldId, dynastyId: spy.dynastyId, townId: "rome", garrison: 29000, pentekonters: 4, triremes: 6, scoutedGameDate: "Summer, 299 BC" });
    await db.insert(m.dbPkg.regionIntel).values({ worldId, dynastyId: spy.dynastyId, regionId: "R129", warband: 2400, scoutedGameDate: "Summer, 299 BC" });
    const mine = (await get(spy.cookie)).json() as { towns: Record<string, unknown>; regions: Record<string, unknown> };
    const theirs = (await get(other.cookie)).json() as { towns: Record<string, unknown>; regions: Record<string, unknown> };
    expect(mine.towns.rome).toBeDefined();
    expect(mine.regions.R129).toBeDefined();
    expect(theirs.towns.rome).toBeUndefined();
    expect(theirs.regions.R129).toBeUndefined();
  });
});
