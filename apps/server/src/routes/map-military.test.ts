import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
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
  const buildings = await import("../services/buildings.js");
  const barracks = await import("../services/barracks.js");
  const mapGraph = await import("../services/mapGraph.js");
  const mapPools = await import("../services/mapPools.js");
  return { dbPkg, map, errorHandler, buildings, barracks, mapGraph, mapPools };
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
    // The alert reads the battle content and the map's towns (Military 6a).
    await m.buildings.loadBuildingsContent();
    await m.barracks.loadBarracksContent();
    await m.mapGraph.loadMapGraph();
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
      sql`TRUNCATE TABLE player_holdings, town_intel, region_intel, town_military, region_military, sessions, player_characters, players, dynasties, worlds, users CASCADE`,
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
  async function freshPlayer(opts: { name?: string; houseSlug?: string } = {}) {
    const user = (await db.insert(m.dbPkg.users).values({ email: `u-${crypto.randomUUID()}@t`, passwordHash: "x" }).returning())[0]!;
    const name = opts.name ?? `P-${crypto.randomUUID().slice(0, 8)}`;
    const player = (await db.insert(m.dbPkg.players).values({ worldId, userId: user.id, name, color: "#123456", ...(opts.houseSlug ? { houseSlug: opts.houseSlug } : {}) }).returning())[0]!;
    const dynasty = (await db.insert(m.dbPkg.dynasties).values({ worldId, name: "House Test" }).returning())[0]!;
    await db.insert(m.dbPkg.playerCharacters).values({ playerId: player.id, worldId, dynastyId: dynasty.id, houseSlug: "test-house", classId: "trader" });
    const raw = crypto.randomBytes(32).toString("base64url");
    await db.insert(m.dbPkg.sessions).values({ userId: user.id, tokenHash: crypto.createHash("sha256").update(raw).digest("hex"), expiresAt: new Date(Date.now() + DAY) });
    return { playerId: player.id, name, dynastyId: dynasty.id, cookie: `massalia_session=${app.signCookie(raw)}` };
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
    // The home towns' garrisons are the League's army (government prompt 5a): its
    // men based in each town, and the whole fleet at Massalia.
    expect(body.towns.massalia).toEqual({ garrison: 1000, pentekonters: 29, triremes: 40, source: "home" });
    expect(body.towns.nikaia).toEqual({ garrison: 150, pentekonters: 0, triremes: 0, source: "home" });
    expect(Object.fromEntries(Object.entries(body.towns).map(([id, t]) => [id, (t as { garrison: number }).garrison]))).toEqual({
      massalia: 1000, emporion: 250, nikaia: 150, "olbia-provence": 150, rhoda: 120, agathe: 100, antipolis: 100, arelate: 100, athinopolis: 50, monoikos: 30,
    });
    for (const [id, t] of Object.entries(body.towns)) {
      if (id !== "massalia") expect(t, id).toMatchObject({ pentekonters: 0, triremes: 0, source: "home" });
    }
    // Exactly the ten Massaliote towns (content owners), no foreign town or region.
    expect(Object.keys(body.towns).sort()).toEqual(
      ["agathe", "antipolis", "athinopolis", "emporion", "massalia", "monoikos", "nikaia", "olbia-provence", "rhoda", "arelate"].sort(),
    );
    expect(body.towns.carthage).toBeUndefined();
    expect(body.regions.R105).toBeUndefined();
    expect(Object.keys(body.regions)).toEqual([]);
  });

  // Strikes prompt 1: a nation's march shows on its target's panel for everyone.
  it("a nation's march on a home town is on its panel for everyone: its line and its about, no pool's numbers, no draws", async () => {
    const { cookie: c } = await freshPlayer();
    const strikesAt = new Date(Date.now() + 11 * 3_600_000);
    await db.insert(m.dbPkg.strikes).values({ worldId, nationId: "volcae", trigger: "war", mode: "raid", seasonIndex: 30, regionId: "R050", townId: "agathe", targetKind: "home", force: 473, about: 470, draws: [{ placeId: "tolosa", kind: "town", men: 460 }, { placeId: "nemausus", kind: "town", men: 13 }], calledAt: new Date(Date.now() - 3_600_000), strikesAt });
    const body = (await get(c)).json() as { strikes: { towns: Record<string, Record<string, unknown>>; regions: Record<string, unknown> } };
    const time = `${strikesAt.toISOString().slice(11, 16)} UTC`;
    expect(body.strikes.towns.agathe).toEqual({ nation: "the Volcae", status: "marching", mode: "raid", trigger: "war", about: 470, strikesAt: strikesAt.toISOString(), line: `The Volcae march on Agathe with about 470 men. They strike at ${time}.`, dateLabel: expect.any(String) });
    expect(Object.keys(body.strikes.towns)).toEqual(["agathe"]);
    expect(body.strikes.regions).toEqual({});
    const text = JSON.stringify(body.strikes);
    for (const secret of ["473", "tolosa", "nemausus", "draws", "force"]) expect(text).not.toContain(secret);
  });

  // Military 6a, ruling 2: the places on alert are shown to everyone on the map.
  it("the places on alert are flagged for every player, a flag and no number; one above half, a holding and Massalia's own never are", async () => {
    const viewer = await freshPlayer();
    const holder = await freshPlayer();
    const now = new Date();
    await m.mapPools.writeTownGarrison(db, worldId, "reii", 80, now); // half its full 160
    await m.mapPools.writeRegionWarband(db, worldId, "R046", 37, now); // under half its full 100
    await m.mapPools.writeRegionWarband(db, worldId, "R078", 51, now); // above half
    await m.mapPools.writeRegionWarband(db, worldId, "R057", 100, now); // a quarter of its 400, but held
    await db.insert(m.dbPkg.playerHoldings).values({ worldId, regionId: "R057", townId: "", ownerPlayerId: holder.playerId, kind: "conquest", previousOwner: "sordones", since: now, lastGarrisonedAt: now, lastTributeAt: now });
    await m.mapPools.writeTownGarrison(db, worldId, "agathe", 10, now); // Massalia's own
    const body = (await get(viewer.cookie)).json() as { alert: unknown };
    expect(body.alert).toEqual({ towns: { reii: true }, regions: { R046: true } });
    // The same for any player: it is the place's, not the viewer's intel.
    expect(((await get(holder.cookie)).json() as { alert: unknown }).alert).toEqual(body.alert);
    expect(JSON.stringify(body.alert)).not.toMatch(/80|37|160|100/);
  });

  it("a home town's garrison is the League's men alone: a player's own men standing there do not count, and it follows the army as it thins", async () => {
    const viewer = await freshPlayer();
    // The first read raises the army; the town_military rows are no longer read.
    await get(viewer.cookie);
    await db.update(m.dbPkg.townMilitary).set({ garrison: 7, pentekonters: 7, triremes: 7 }).where(eq(m.dbPkg.townMilitary.worldId, worldId));
    // A player bases 140 of his own men at Agathe, as players do.
    await db.insert(m.dbPkg.playerUnits).values({ worldId, ownerPlayerId: viewer.playerId, source: "trained", unitId: "hoplite", count: 140, startCount: 140, recruitedSeason: 0, readyAt: new Date(T0), basedAt: "agathe" });
    let body = (await get(viewer.cookie)).json() as { towns: Record<string, { garrison: number; pentekonters: number; triremes: number }> };
    expect(body.towns.agathe).toMatchObject({ garrison: 100, pentekonters: 0, triremes: 0 });
    expect(body.towns.massalia).toMatchObject({ garrison: 1000, pentekonters: 29, triremes: 40 });

    // The League's hoplites at Agathe thin to 19: the panel shows what stands.
    const league = (await m.dbPkg.leaguePlayerId(db, worldId))!;
    await db.update(m.dbPkg.playerUnits).set({ count: 19 }).where(and(eq(m.dbPkg.playerUnits.ownerPlayerId, league), eq(m.dbPkg.playerUnits.basedAt, "agathe"), eq(m.dbPkg.playerUnits.unitId, "hoplite")));
    await db.delete(m.dbPkg.playerUnits).where(and(eq(m.dbPkg.playerUnits.ownerPlayerId, league), eq(m.dbPkg.playerUnits.basedAt, "monoikos")));
    body = (await get(viewer.cookie)).json() as typeof body;
    expect(body.towns.agathe!.garrison).toBe(19 + 25 + 15 + 10);
    // A home town with no man left still shows, at 0.
    expect(body.towns.monoikos).toMatchObject({ garrison: 0, pentekonters: 0, triremes: 0 });
  });

  it("surfaces the requester's own intel snapshots with their scouted date, never the live pool", async () => {
    const { dynastyId, cookie: c } = await freshPlayer();
    await db.insert(m.dbPkg.townIntel).values({ worldId, dynastyId, townId: "carthage", garrison: 25000, pentekonters: 9, triremes: 55, scoutedGameDate: "Spring, 299 BC" });
    await db.insert(m.dbPkg.regionIntel).values({ worldId, dynastyId, regionId: "R105", warband: 3900, scoutedGameDate: "Spring, 299 BC" });
    const body = (await get(c)).json() as { towns: Record<string, unknown>; regions: Record<string, unknown> };
    expect(body.towns.carthage).toEqual({ garrison: 25000, pentekonters: 9, triremes: 55, source: "intel", scoutedGameDate: "Spring, 299 BC" });
    expect(body.regions.R105).toEqual({ warband: 3900, source: "intel", scoutedGameDate: "Spring, 299 BC" });
    // Home entries are untouched by intel.
    expect(body.towns.massalia).toEqual({ garrison: 1000, pentekonters: 29, triremes: 40, source: "home" });
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

  // Holdings prompt 1: who holds a conquered place is public to every player.
  it("every holding's holder is public to every player, by house and character name, and nothing more", async () => {
    // The houses row is shared across the DB suites: read its name back, never pin it.
    const house = (await db.select({ name: m.dbPkg.houses.name }).from(m.dbPkg.houses).where(eq(m.dbPkg.houses.slug, "test-house")))[0]!;
    const townHolder = await freshPlayer({ name: "Konrad", houseSlug: "test-house" });
    const landHolder = await freshPlayer({ name: "Damon" }); // no house: the join is a left join
    const onlooker = await freshPlayer();
    const at = new Date(T0 + 10 * DAY);
    await db.insert(m.dbPkg.playerHoldings).values([
      { worldId, regionId: "R047", townId: "reii", ownerPlayerId: townHolder.playerId, kind: "conquest", previousOwner: "saluvii", since: at, lastGarrisonedAt: at, lastTributeAt: at },
      { worldId, regionId: "R046", townId: "", ownerPlayerId: landHolder.playerId, kind: "conquest", previousOwner: "unclaimed", since: at, lastGarrisonedAt: at, lastTributeAt: at },
    ]);

    type Body = { towns: Record<string, unknown>; regions: Record<string, unknown>; holdings: { towns: Record<string, unknown>; regions: Record<string, unknown> } };
    const expected = {
      towns: { reii: { playerId: townHolder.playerId, characterName: "Konrad", houseName: house.name } },
      regions: { R046: { playerId: landHolder.playerId, characterName: "Damon", houseName: null } },
    };
    for (const viewer of [townHolder, landHolder, onlooker]) {
      const body = (await get(viewer.cookie)).json() as Body;
      expect(body.holdings).toEqual(expected);
      // Exactly the three keys: never the garrison, the tribute or a date.
      expect(Object.keys(body.holdings.towns.reii as object).sort()).toEqual(["characterName", "houseName", "playerId"]);
      expect(Object.keys(body.holdings.regions.R046 as object).sort()).toEqual(["characterName", "houseName", "playerId"]);
      // The pools are as they were: home towns only, no foreign region.
      expect(body.towns.massalia).toEqual({ garrison: 1000, pentekonters: 29, triremes: 40, source: "home" });
      expect(body.towns.reii).toBeUndefined();
      expect(body.regions.R046).toBeUndefined();
    }
  });
});
