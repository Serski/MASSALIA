import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";

// ---------------------------------------------------------------------------
// GET /me/state settles the player (dashboard refetch prompt, Sept 2026) — an
// integration test against a REAL Postgres, guarded to a *_test database. The
// route goes through a minimal Fastify app via app.inject() with a minted session
// cookie (as me-onboarding.test.ts). Its lazy-on-read surface needs the content
// boot, so beforeAll runs the same loaders index.ts does.
//
// The case is the one the shipbuilder hit: a slipway finished a day ago with its
// naval supplies unbanked. One GET /me/state must settle them into `resources`
// and answer with the settled balance, plus the two clock fields the client's
// rollover timer is armed from.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const DAY = 86_400_000;
const HOUR = 3_600_000;

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const { meRoutes } = await import("./me.js");
  const buildings = await import("./../services/buildings.js");
  const loaders = {
    traits: (await import("../services/traits.js")).loadTraitDefs,
    composure: (await import("../services/composure.js")).loadComposureConfig,
    routines: (await import("../services/routines.js")).loadRoutineContent,
    age: (await import("../services/age.js")).loadAgeConfig,
    family: (await import("../services/family.js")).loadFamilyConfig,
    calendar: (await import("../services/festival.js")).loadCalendarConfig,
    politics: (await import("../services/oligarchy.js")).loadPoliticsConfig,
    interactions: (await import("../services/interactions.js")).loadInteractionsConfig,
    agenda: (await import("../services/agenda.js")).loadAgendaContent,
    ranks: (await import("../services/service.js")).loadRanksContent,
    contracts: (await import("../services/merc.js")).loadContractsContent,
    barracks: (await import("../services/barracks.js")).loadBarracksContent,
    stories: (await import("../services/story.js")).loadStories,
  };
  return { dbPkg, meRoutes, buildings, loaders };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("GET /me/state settles the player (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let app: FastifyInstance;
  let worldId: string;
  let worldStartedAt: Date;
  let houseSlug: string;

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    await m.loaders.traits();
    await m.loaders.composure();
    await m.loaders.routines();
    await m.loaders.age();
    await m.loaders.family();
    await m.loaders.calendar();
    await m.loaders.politics();
    await m.loaders.interactions();
    await m.loaders.agenda();
    await m.buildings.loadBuildingsContent();
    await m.buildings.loadPopsContent();
    await m.loaders.ranks();
    await m.loaders.contracts();
    await m.loaders.barracks();
    await m.loaders.stories();
    app = Fastify();
    await app.register(cookie, { secret: "test-session-secret-at-least-32-chars-long" });
    await app.register(m.meRoutes, { prefix: "/me" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE world_treasury, player_buildings, player_pops, resources, effect_log, character_traits, player_characters, dynasties, players, sessions, users, worlds CASCADE`);
    // Shared seed rows: never truncated, so read the house back (an earlier file may
    // have seeded the slug under another name) and upsert the profession the join needs.
    await db.insert(m.dbPkg.houses).values({ slug: "test-house", name: "House Test", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" }).onConflictDoNothing();
    houseSlug = (await db.select({ slug: m.dbPkg.houses.slug }).from(m.dbPkg.houses).where(eq(m.dbPkg.houses.slug, "test-house")).limit(1))[0]!.slug;
    await db.insert(m.dbPkg.professions).values({ slug: "shipbuilder", name: "Shipbuilder", initial: "S", rank: "Craftsman", income: "ships" }).onConflictDoNothing();
    // The route settles at the real clock, so the world starts two real days ago.
    worldStartedAt = new Date(Date.now() - 2 * DAY);
    const world = (
      await db.insert(m.dbPkg.worlds).values({ name: "State Test", seed: "stest", startedAt: worldStartedAt, endsAt: new Date(worldStartedAt.getTime() + 182 * DAY), status: "active" }).returning()
    )[0]!;
    worldId = world.id;
  });

  // A shipbuilder with the slipway's staffing and materials, a live session, and
  // a character row so ensureCharacterRow finds it rather than minting a fresh one.
  async function shipbuilder() {
    const { users, players, playerCharacters, playerPops, resources, sessions } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `u-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (
      await db.insert(players).values({ worldId, userId: user.id, name: `P-${Math.random().toString(36).slice(2, 8)}`, color: "#123456", professionSlug: "shipbuilder", houseSlug }).returning()
    )[0]!;
    await db.insert(playerCharacters).values({ playerId: player.id, worldId, houseSlug, classId: "shipbuilder", drachmae: 100, startAge: 30, deathAge: 90 });
    const staffing = (m.buildings.getBuildingsContent().classBuildings.shipbuilder?.staffing ?? {}) as Record<string, number>;
    for (const [popType, count] of Object.entries(staffing)) {
      if (count > 0) await db.insert(playerPops).values({ worldId, ownerPlayerId: player.id, popType, count });
    }
    for (const type of ["timber", "stone", "iron", "marble", "wool", "leather"]) {
      await db.insert(resources).values({ scope: "player", scopeId: player.id, type, amount: "500", ratePerSecond: "0", lastUpdatedAt: worldStartedAt });
    }
    const token = crypto.randomBytes(16).toString("base64url");
    await db.insert(sessions).values({ userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + DAY) });
    return { token, playerId: player.id };
  }

  async function goodBalance(playerId: string, type: string) {
    const rows = await db
      .select()
      .from(m.dbPkg.resources)
      .where(and(eq(m.dbPkg.resources.scope, "player"), eq(m.dbPkg.resources.scopeId, playerId), eq(m.dbPkg.resources.type, type)))
      .limit(1);
    return Number(rows[0]?.amount ?? 0);
  }

  const getState = (token: string) => app.inject({ method: "GET", url: "/me/state", headers: { cookie: `massalia_session=${app.signCookie(token)}` } });

  it("a day of unbanked slipway accrual lands in resources after one GET /me/state, with now and seasonEndsAt", async () => {
    const { token, playerId } = await shipbuilder();
    const ctx = (await m.buildings.buildingContext(playerId, worldId))!;
    // Built a day and an hour ago: tier 1 completes in an hour, so the slipway has
    // been active for a day with nothing settling it since.
    const builtAt = new Date(Date.now() - DAY - HOUR);
    const built = await m.buildings.build("shipbuilder", ctx, "slipway", builtAt);
    expect(built.ok).toBe(true);
    expect(await goodBalance(playerId, "naval-supplies")).toBe(0);

    const before = Date.now();
    const res = await getState(token);
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // The settle banked ~1 naval supply (1/day, guarded full output) into resources...
    const banked = await goodBalance(playerId, "naval-supplies");
    expect(banked).toBeGreaterThan(0.8);
    expect(banked).toBeLessThan(1.5);
    // ...and the answer carries the settled balance, not the pre-settle zero.
    expect(body.resources.balances["naval-supplies"]).toBeCloseTo(banked, 6);

    // The clock fields: `now` is the server's clock at this read, `seasonEndsAt` the
    // next whole-day step from the world's start, after `now`.
    const now = Date.parse(body.now);
    expect(Number.isNaN(now)).toBe(false);
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
    const seasonEndsAt = Date.parse(body.seasonEndsAt);
    expect(seasonEndsAt).toBeGreaterThan(now);
    expect(seasonEndsAt - now).toBeLessThanOrEqual(DAY);
    expect((seasonEndsAt - worldStartedAt.getTime()) % DAY).toBe(0);
  });

  it("a second GET /me/state settles nothing new: the balance holds and the markers sit at the last read", async () => {
    const { token, playerId } = await shipbuilder();
    const ctx = (await m.buildings.buildingContext(playerId, worldId))!;
    await m.buildings.build("shipbuilder", ctx, "slipway", new Date(Date.now() - DAY - HOUR));
    expect((await getState(token)).statusCode).toBe(200);
    const first = await goodBalance(playerId, "naval-supplies");
    expect((await getState(token)).statusCode).toBe(200);
    const second = await goodBalance(playerId, "naval-supplies");
    // Milliseconds apart: the second settle adds a negligible sliver, never a day.
    expect(second).toBeGreaterThanOrEqual(first);
    expect(second - first).toBeLessThan(0.01);
  });
});
