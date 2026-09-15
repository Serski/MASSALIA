import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify";
import cookie from "@fastify/cookie";

// ---------------------------------------------------------------------------
// /api/market through a minimal Fastify app (app.inject + a minted session
// cookie, the production error handler): a smoke pass over the four endpoints,
// 401 without a session, and the route-level 400s. The service's rules are
// covered by services/market.test.ts.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const DAY = 86_400_000;

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const { marketRoutes } = await import("./market.js");
  const { errorHandler } = await import("../errorHandler.js");
  const buildings = await import("../services/buildings.js");
  const age = await import("../services/age.js");
  return { dbPkg, marketRoutes, errorHandler, buildings, age };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("/api/market (integration)", () => {
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
    await m.age.loadAgeConfig();
    app = Fastify();
    app.setErrorHandler(m.errorHandler);
    await app.register(cookie, { secret: "test-session-secret-at-least-32-chars-long" });
    await app.register(m.marketRoutes, { prefix: "/api/market" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await db.$client.end();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE market_listings, world_treasury, resources, effect_log, player_characters, dynasties, players, sessions, users, worlds CASCADE`);
    await db.insert(m.dbPkg.houses).values({ slug: "test-house", name: "House Test", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" }).onConflictDoNothing();
    const world = (await db.insert(m.dbPkg.worlds).values({ name: "Market Route Test", seed: "mrt", startedAt: new Date(now.getTime() - DAY), endsAt: new Date(now.getTime() + 182 * DAY), status: "active" }).returning())[0]!;
    worldId = world.id;
  });

  async function freshPlayer(name: string, drachmae: number, goods: Record<string, number> = {}) {
    const { users, players, playerCharacters, resources, sessions } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `u-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(players).values({ worldId, userId: user.id, name, color: "#123456", houseSlug: "test-house" }).returning())[0]!;
    await db.insert(playerCharacters).values({ playerId: player.id, worldId, houseSlug: "test-house", classId: "landowner", drachmae, startAge: 30, deathAge: 90 });
    for (const [type, amount] of Object.entries(goods)) {
      await db.insert(resources).values({ scope: "player", scopeId: player.id, type, amount: String(amount), ratePerSecond: "0", lastUpdatedAt: now });
    }
    const token = crypto.randomBytes(16).toString("base64url");
    await db.insert(sessions).values({ userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + DAY) });
    return { token, playerId: player.id };
  }
  const cookieFor = (token: string) => `massalia_session=${app.signCookie(token)}`;
  const get = (token: string): Promise<LightMyRequestResponse> => app.inject({ method: "GET", url: "/api/market", headers: { cookie: cookieFor(token) } });
  const post = (token: string, path: string, payload: unknown): Promise<LightMyRequestResponse> =>
    app.inject({ method: "POST", url: `/api/market/${path}`, headers: { cookie: cookieFor(token) }, payload: payload as Record<string, unknown> });

  it("requires a session on every endpoint", async () => {
    expect((await app.inject({ method: "GET", url: "/api/market" })).statusCode).toBe(401);
    for (const path of ["list", "buy", "cancel"]) {
      expect((await app.inject({ method: "POST", url: `/api/market/${path}`, payload: {} })).statusCode).toBe(401);
    }
  });

  it("list → view → buy → cancel", async () => {
    const seller = await freshPlayer("Kallias", 0, { wine: 30 });
    const buyer = await freshPlayer("Nikias", 50);

    const listed = await post(seller.token, "list", { good: "wine", qty: 20, price: 9 });
    expect(listed.statusCode).toBe(200);
    const { listing, balance } = listed.json<{ listing: { id: string }; balance: number }>();
    expect(balance).toBe(10);

    const view = await get(buyer.token);
    expect(view.statusCode).toBe(200);
    expect(view.json()).toMatchObject({ open: 0, cap: 10, taxExempt: false, listings: [{ id: listing.id, good: "wine", remaining: 20, price: 9, mine: false, seller: { name: "Kallias" } }] });
    expect((await get(seller.token)).json()).toMatchObject({ open: 1, listings: [{ mine: true }] });

    const bought = await post(buyer.token, "buy", { listingId: listing.id, qty: 5 });
    expect(bought.statusCode).toBe(200);
    expect(bought.json()).toEqual({ ok: true, qty: 5, total: 45, tax: 4, wallet: 5, balance: 5, remaining: 15 });

    expect((await post(buyer.token, "buy", { listingId: listing.id, qty: 1 })).statusCode).toBe(402);
    expect((await post(buyer.token, "buy", { listingId: listing.id, qty: 16 })).statusCode).toBe(409);
    expect((await post(seller.token, "buy", { listingId: listing.id, qty: 1 })).statusCode).toBe(409);

    const cancelled = await post(seller.token, "cancel", { listingId: listing.id });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toEqual({ ok: true, returned: 15, balance: 25 });
    expect((await post(seller.token, "cancel", { listingId: listing.id })).statusCode).toBe(404);
  });

  it("answers 400 for missing or malformed bodies and 404 for an unknown good", async () => {
    const p = await freshPlayer("Kallias", 0, { wine: 5 });
    expect((await post(p.token, "list", { qty: 1, price: 1 })).statusCode).toBe(400);
    expect((await post(p.token, "list", { good: "wine", qty: "1", price: 1 })).statusCode).toBe(400);
    expect((await post(p.token, "list", { good: "wine", qty: 1, price: 10_001 })).statusCode).toBe(400);
    expect((await post(p.token, "list", { good: "ambrosia", qty: 1, price: 1 })).statusCode).toBe(404);
    expect((await post(p.token, "buy", { listingId: "not-a-uuid", qty: 1 })).statusCode).toBe(400);
    expect((await post(p.token, "buy", { listingId: crypto.randomUUID(), qty: 1.5 })).statusCode).toBe(400);
    expect((await post(p.token, "buy", { listingId: crypto.randomUUID(), qty: 1 })).statusCode).toBe(404);
    expect((await post(p.token, "cancel", {})).statusCode).toBe(400);
  });
});
