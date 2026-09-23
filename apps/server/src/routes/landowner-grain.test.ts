import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";

// ---------------------------------------------------------------------------
// A Landowner's class resource is grain, seeded at 0 by POST /characters, and the
// starting package adds 10 wheat. Both must land on ONE row: with two, the UI
// showed the 10 while the market list, the vendor sell and the staff food draw
// hit the empty row ("You hold only 0 wheat"). Drives the real create route, then
// the market and vendor routes, then a collect two days on. DB-gated (mirrors
// beta-trait.test.ts).
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const DAY = 86_400_000;
const HOUR = 3_600_000;
const HOUSE = "xanthippos"; // a real HOUSE_ID: startingCharacter needs one
const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const traits = await import("../services/traits.js");
  const composure = await import("../services/composure.js");
  const age = await import("../services/age.js");
  const buildings = await import("../services/buildings.js");
  const barracks = await import("../services/barracks.js");
  const { characterRoutes } = await import("./characters.js");
  const { marketRoutes } = await import("./market.js");
  const { buildingRoutes } = await import("./buildings.js");
  const { errorHandler } = await import("../errorHandler.js");
  return { dbPkg, traits, composure, age, buildings, barracks, characterRoutes, marketRoutes, buildingRoutes, errorHandler };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("a new Landowner's grain (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let app: FastifyInstance;
  let worldId: string;
  const now = new Date();

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    await m.traits.loadTraitDefs();
    await m.composure.loadComposureConfig();
    await m.age.loadAgeConfig();
    await m.buildings.loadBuildingsContent();
    await m.buildings.loadPopsContent();
    await m.barracks.loadBarracksContent(); // collect settles the barracks too
    app = Fastify();
    app.setErrorHandler(m.errorHandler);
    await app.register(cookie, { secret: "test-session-secret-at-least-32-chars-long" });
    await app.register(m.characterRoutes, { prefix: "/characters" });
    await app.register(m.marketRoutes, { prefix: "/api/market" });
    await app.register(m.buildingRoutes, { prefix: "/api/buildings" });
    await app.ready();
  }, 60_000); // three route modules' cold import can pass the hook ceiling on a loaded machine

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE market_listings, world_treasury, character_traits, resources, player_pops, player_buildings, effect_log, characters, player_characters, dynasties, players, sessions, users, worlds CASCADE`);
    await db.insert(m.dbPkg.houses).values({ slug: HOUSE, name: "Xanthippos", initial: "X", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" }).onConflictDoNothing();
    await db.insert(m.dbPkg.professions).values({ slug: "landowner", name: "Landowner", initial: "L", rank: "r", income: "i" }).onConflictDoNothing();
    worldId = (await db.insert(m.dbPkg.worlds).values({ name: "Landowner Grain Test", seed: "lgt", startedAt: new Date(now.getTime() - DAY), endsAt: new Date(now.getTime() + 182 * DAY), status: "active" }).returning())[0]!.id;
  });

  async function verifiedUser() {
    const { users, sessions } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `u-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x", emailVerifiedAt: now }).returning())[0]!;
    const token = crypto.randomBytes(16).toString("base64url");
    await db.insert(sessions).values({ userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + DAY) });
    return { cookie: `massalia_session=${app.signCookie(token)}` };
  }
  // Every grain row the player has, as amounts.
  const grainRows = async (playerId: string) =>
    (await db.select().from(m.dbPkg.resources).where(and(eq(m.dbPkg.resources.scope, "player"), eq(m.dbPkg.resources.scopeId, playerId), eq(m.dbPkg.resources.type, "grain")))).map((r) => Number(r.amount));

  it("creating a Landowner leaves one grain row of 10, which the market list, the vendor sell and the staff food draw all take from", async () => {
    const headers = await verifiedUser();
    const create = await app.inject({ method: "POST", url: "/characters", headers, payload: { name: "Kleon", avatarId: "avatar-30-1", classSlug: "landowner", houseSlug: HOUSE } });
    expect(create.statusCode).toBe(201);
    const playerId = create.json().player.id as string;
    expect(await grainRows(playerId)).toEqual([10]);

    const listed = await app.inject({ method: "POST", url: "/api/market/list", headers, payload: { good: "grain", qty: 4, price: 5 } });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({ ok: true, balance: 6, listing: { good: "grain", remaining: 4 } });

    const sold = await app.inject({ method: "POST", url: "/api/buildings/vendor", headers, payload: { action: "sell", type: "grain", qty: 2 } });
    expect(sold.statusCode).toBe(200);
    expect(sold.json()).toMatchObject({ ok: true, action: "sell", type: "grain", qty: 2, balance: 4 });
    expect(await grainRows(playerId)).toEqual([4]);

    // The starting slave eats 1 grain a day from the pop's creation: two whole days
    // on, the draw takes 2 from that row and buys nothing.
    const ctx = (await m.buildings.buildingContext(playerId, worldId))!;
    const collected = await m.buildings.collect(ctx, new Date(Date.now() + 2 * DAY + HOUR));
    expect(collected.foodDrawn).toBe(2);
    expect(collected.foodBought).toBe(0);
    expect(await grainRows(playerId)).toEqual([2]);
  });
});
