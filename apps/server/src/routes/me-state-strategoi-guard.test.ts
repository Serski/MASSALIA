import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { eq, sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";

// ---------------------------------------------------------------------------
// The Strategoi's term end must never fail GET /me/state (Strategoi prompt 1).
// The route awaits syncElections, which ends the Strategoi's terms; with that
// forced to throw, the route still answers 200 and the server logs what failed.
// The whole @massalia/db module is real but for endStrategoiTerms. The harness
// is me-state.test.ts's. Integration test against a REAL Postgres, guarded to a
// *_test database.
// ---------------------------------------------------------------------------

vi.mock("@massalia/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@massalia/db")>();
  return {
    ...actual,
    endStrategoiTerms: vi.fn(async () => {
      throw new Error("the term end broke");
    }),
  };
});

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const DAY = 86_400_000;

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

suite("GET /me/state with a failing Strategoi term end (integration)", () => {
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
      await db.insert(m.dbPkg.worlds).values({ name: "Strategoi Guard", seed: "sguard", startedAt: worldStartedAt, endsAt: new Date(worldStartedAt.getTime() + 182 * DAY), status: "active" }).returning()
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const getState = (token: string) => app.inject({ method: "GET", url: "/me/state", headers: { cookie: `massalia_session=${app.signCookie(token)}` } });

  it("the term end throws: GET /me/state answers 200 and the log says what failed", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { token } = await shipbuilder();
    const res = await getState(token);
    expect(res.statusCode).toBe(200);
    expect(vi.mocked(m.dbPkg.endStrategoiTerms)).toHaveBeenCalled();
    expect(logged.mock.calls.map((c) => c[0])).toContain("strategoi: failed the term end broke");
  });
});
