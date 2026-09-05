import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";

// ---------------------------------------------------------------------------
// Concurrency: two IDENTICAL requests fired with Promise.all against ONE player
// must debit exactly once (vendor buy, build) and resolve a daily card exactly
// once. Against a REAL Postgres guarded to a *_test database (the suite truncates
// it); the routes run through a minimal Fastify app via app.inject(), with the
// production error handler + a Bearer session (mirrors me-onboarding.test.ts).
// Under READ COMMITTED without the player lock + guarded relative writes, both
// requests read the same balance, both pass the check, and the second write
// overwrites the first — every assertion here fails in that world.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const DAY = 86_400_000;

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const { buildingRoutes } = await import("./buildings.js");
  const { eventRoutes } = await import("./events.js");
  const { interactionRoutes } = await import("./interactions.js");
  const { serviceRoutes } = await import("./service.js");
  const { festivalRoutes } = await import("./festival.js");
  const { olympiadRoutes } = await import("./olympiad.js");
  const festival = await import("../services/festival.js");
  const service = await import("../services/service.js");
  const { errorHandler } = await import("../errorHandler.js");
  const buildings = await import("../services/buildings.js");
  const engine = await import("../services/eventEngine.js");
  const daily = await import("../services/dailyDecisions.js");
  const age = await import("../services/age.js");
  const traits = await import("../services/traits.js");
  const composure = await import("../services/composure.js");
  const family = await import("../services/family.js");
  const interactions = await import("../services/interactions.js");
  const oligarchy = await import("../services/oligarchy.js");
  return { dbPkg, buildingRoutes, eventRoutes, interactionRoutes, serviceRoutes, festivalRoutes, olympiadRoutes, service, festival, errorHandler, buildings, engine, daily, age, traits, composure, family, interactions, oligarchy };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("per-player serialization (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let app: FastifyInstance;
  let worldId: string;
  // 1.5 real days into the world clock: a non-winter day, so the daily draw never
  // enriches with the family arena (keeps the events route to its core queries).
  const now = new Date();
  const startedAt = new Date(now.getTime() - 1.5 * DAY);
  const today = now.toISOString().slice(0, 10);

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    await m.buildings.loadBuildingsContent();
    await m.buildings.loadPopsContent();
    await m.age.loadAgeConfig();
    await m.traits.loadTraitDefs();
    await m.composure.loadComposureConfig();
    await m.family.loadFamilyConfig();
    await m.interactions.loadInteractionsConfig();
    await m.oligarchy.loadPoliticsConfig();
    await m.service.loadRanksContent();
    await m.festival.loadCalendarConfig();

    app = Fastify();
    app.setErrorHandler(m.errorHandler);
    await app.register(cookie, { secret: "test-session-secret-at-least-32-chars-long" });
    await app.register(m.buildingRoutes, { prefix: "/api/buildings" });
    await app.register(m.eventRoutes, { prefix: "/api/events" });
    await app.register(m.interactionRoutes, { prefix: "/api/interactions" });
    await app.register(m.serviceRoutes, { prefix: "/api/service" });
    await app.register(m.festivalRoutes, { prefix: "/api/festivals" });
    await app.register(m.olympiadRoutes, { prefix: "/api/olympics" });
    // Test-only routes for the error handler contract.
    app.get("/boom", async () => {
      throw new Error("relation \"secret\" does not exist");
    });
    app.get("/teapot", async () => {
      const error = new Error("Short and stout.") as Error & { statusCode?: number };
      error.statusCode = 418;
      throw error;
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.execute(sql`
      TRUNCATE TABLE daily_decisions, event_history, effect_log, composure_log, character_traits, world_treasury,
        festival_events, festival_donations, festival_choregos, olympiads, olympic_candidates, olympic_votes, treasuries, treasury_ledger,
        player_buildings, player_pops, resources, player_characters, dynasties, players, sessions, users, worlds CASCADE
    `);
    await db
      .insert(m.dbPkg.houses)
      .values({ slug: "test-house", name: "Test House", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" })
      .onConflictDoNothing();
    const world = (
      await db.insert(m.dbPkg.worlds).values({ name: "Race Test", seed: "race", startedAt, endsAt: new Date(now.getTime() + 182 * DAY), status: "active" }).returning()
    )[0]!;
    worldId = world.id;
  });

  // A user + active player + character + live session token. Landowners own their
  // estate's T1 staffing and a material stock so a build can succeed.
  async function freshPlayer(drachmae: number, classId = "landowner") {
    const { users, players, playerCharacters, playerPops, resources, sessions } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `u-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(players).values({ worldId, userId: user.id, name: "P", color: "#123456", houseSlug: "test-house" }).returning())[0]!;
    const character = (
      await db.insert(playerCharacters).values({ playerId: player.id, worldId, houseSlug: "test-house", classId, drachmae, startAge: 30, deathAge: 90 }).returning()
    )[0]!;
    const pops = (m.buildings.getBuildingsContent().classBuildings[classId]?.staffing ?? {}) as Record<string, number>;
    for (const [popType, count] of Object.entries(pops)) {
      if (count > 0) await db.insert(playerPops).values({ worldId, ownerPlayerId: player.id, popType, count });
    }
    for (const type of ["timber", "stone", "iron", "marble", "wool", "leather"]) {
      await db.insert(resources).values({ scope: "player", scopeId: player.id, type, amount: "500", ratePerSecond: "0", lastUpdatedAt: startedAt });
    }
    const token = crypto.randomBytes(16).toString("base64url");
    await db.insert(sessions).values({ userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + DAY) });
    return { token, playerId: player.id, characterId: character.id };
  }

  const wallet = async (playerId: string) =>
    (await db.select({ d: m.dbPkg.playerCharacters.drachmae }).from(m.dbPkg.playerCharacters).where(eq(m.dbPkg.playerCharacters.playerId, playerId)).limit(1))[0]!.d;
  const setWallet = (playerId: string, amount: number) =>
    db.update(m.dbPkg.playerCharacters).set({ drachmae: amount }).where(eq(m.dbPkg.playerCharacters.playerId, playerId));
  const goodBalance = async (playerId: string, type: string) => {
    const rows = await db
      .select()
      .from(m.dbPkg.resources)
      .where(and(eq(m.dbPkg.resources.scope, "player"), eq(m.dbPkg.resources.scopeId, playerId), eq(m.dbPkg.resources.type, type)))
      .limit(1);
    return Number(rows[0]?.amount ?? 0);
  };

  const post = (url: string, token: string, payload?: Record<string, unknown>) =>
    app.inject({ method: "POST", url, payload, headers: { authorization: `Bearer ${token}` } });
  const get = (url: string, token: string) => app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });

  // Every service module owns its own pg Pool, and a Pool opens connections lazily.
  // Without this, the second of two "concurrent" requests spends its first ~10ms
  // opening a connection while the first one finishes — and the race never
  // overlaps, so the pre-fix code would pass by accident. Three parallel reads per
  // surface leave every pool on the path with idle connections to spare.
  const warmPools = (token: string) =>
    Promise.all([...Array.from({ length: 3 }, () => get("/api/buildings/mine", token)), ...Array.from({ length: 3 }, () => get("/api/events/daily", token))]);
  const statuses = (responses: { statusCode: number }[]) => responses.map((r) => r.statusCode).sort((a, b) => a - b);

  // First login: a player row with no character yet (legacy/seed players, or the
  // create flow's follow-up requests) hit several ensureCharacterRow paths at once.
  it("first-login provisioning: two parallel first requests for a fresh player yield exactly one character row and no 5xx", async () => {
    const { users, players, sessions, playerCharacters, houses } = m.dbPkg;
    // A real house: ensureCharacterRow only honours slugs in HOUSE_START (else it
    // falls back to xanthippos), and player_characters.house_slug is a FK to houses.
    await db
      .insert(houses)
      .values({ slug: "xanthippos", name: "Xanthippos", initial: "X", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" })
      .onConflictDoNothing();
    const user = (await db.insert(users).values({ email: `fresh-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (
      // No profession: ensureCharacterRow falls back to its default class (trader).
      await db.insert(players).values({ worldId, userId: user.id, name: "Fresh", color: "#654321", houseSlug: "xanthippos" }).returning()
    )[0]!;
    const token = crypto.randomBytes(16).toString("base64url");
    await db.insert(sessions).values({ userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + DAY) });
    // Warm the pools with ANOTHER player so this one's first two requests truly overlap.
    const other = await freshPlayer(100);
    await warmPools(other.token);

    const responses = await Promise.all([get("/api/buildings/mine", token), get("/api/events/daily", token)]);
    expect(statuses(responses), JSON.stringify(responses.map((r) => r.json()))).toEqual([200, 200]);
    const rows = await db.select({ id: playerCharacters.id }).from(playerCharacters).where(eq(playerCharacters.playerId, player.id));
    expect(rows).toHaveLength(1);
  });

  it("vendor buy: two identical concurrent buys with money for one debit exactly once", async () => {
    const { token, playerId } = await freshPlayer(1_000_000);
    // Probe the seasonal unit price with one real buy, then fund EXACTLY one more.
    const probe = await post("/api/buildings/vendor", token, { action: "buy", type: "chicken", qty: 1 });
    expect(probe.statusCode).toBe(200);
    const total = probe.json().total as number;
    expect(total).toBeGreaterThan(0);
    await setWallet(playerId, total);
    await warmPools(token);

    const responses = await Promise.all([
      post("/api/buildings/vendor", token, { action: "buy", type: "chicken", qty: 1 }),
      post("/api/buildings/vendor", token, { action: "buy", type: "chicken", qty: 1 }),
    ]);
    expect(statuses(responses)).toEqual([200, 402]);
    const rejected = responses.find((r) => r.statusCode === 402)!;
    expect(rejected.json()).toEqual({ error: `You need ${total} drachmae for that.` });
    // One debit, one chicken (plus the probe's): never 0 with two chickens.
    expect(await wallet(playerId)).toBe(0);
    expect(await goodBalance(playerId, "chicken")).toBe(2);
  });

  it("salary settle racing a vendor buy lands on the exact expected wallet", async () => {
    // A recruit (8 dr/day, no militia trickle) enlisted 3 in-game days + 1h ago:
    // accrueService consumes exactly 3 whole days → 24 dr, whatever the ms jitter.
    const { token, playerId, characterId } = await freshPlayer(1_000_000, "hoplite");
    await db
      .update(m.dbPkg.playerCharacters)
      .set({ armyRank: "recruit", lastSalaryAt: new Date(now.getTime() - 3 * DAY - 3_600_000) })
      .where(eq(m.dbPkg.playerCharacters.id, characterId));
    const probe = await post("/api/buildings/vendor", token, { action: "buy", type: "chicken", qty: 1 });
    expect(probe.statusCode).toBe(200);
    const price = probe.json().total as number;
    // Fund exactly the price: the buy must succeed whichever order the lock picks.
    await setWallet(playerId, price);
    await warmPools(token);
    await Promise.all(Array.from({ length: 3 }, () => get("/api/service", token))); // the service module's own pool

    const [collect, buy] = await Promise.all([post("/api/service/collect", token), post("/api/buildings/vendor", token, { action: "buy", type: "chicken", qty: 1 })]);
    expect(collect.statusCode).toBe(200);
    expect(collect.json().collected).toEqual({ drachmae: 24, militia: 0 });
    expect(buy.statusCode).toBe(200);
    // price + 24 − price: an absolute salary write would have resurrected the spent price.
    expect(await wallet(playerId)).toBe(24);
    expect(await goodBalance(playerId, "chicken")).toBe(2);
  });

  it("build: two identical concurrent builds raise one building and debit once", async () => {
    const { token, playerId } = await freshPlayer(100); // estate T1 costs 50
    await warmPools(token);
    const responses = await Promise.all([post("/api/buildings/build", token, { buildingId: "estate" }), post("/api/buildings/build", token, { buildingId: "estate" })]);
    expect(statuses(responses)).toEqual([200, 409]);
    const ok = responses.find((r) => r.statusCode === 200)!.json() as { cost: number; materials: Record<string, number> };
    expect(responses.find((r) => r.statusCode === 409)!.json()).toEqual({ error: "You already hold that building." });

    expect(await wallet(playerId)).toBe(100 - ok.cost);
    const rows = await db.select().from(m.dbPkg.playerBuildings).where(eq(m.dbPkg.playerBuildings.ownerPlayerId, playerId));
    expect(rows).toHaveLength(1);
    // Materials debited exactly once as well.
    for (const [good, qty] of Object.entries(ok.materials)) {
      expect(await goodBalance(playerId, good)).toBe(500 - qty);
    }
  });

  // A real content event with a change_drachmae choice that touches nothing needing
  // extra fixtures (no traits/world effects), so the resolve exercises the wallet path.
  async function simpleDrachmaeEvent() {
    const events = await m.engine.listEvents();
    const simple = new Set(["change_stat", "change_drachmae", "change_ideology", "change_party_favor", "change_composure"]);
    for (const event of events) {
      if ((event as { calendar?: unknown }).calendar) continue;
      for (const choice of event.choices) {
        const kinds = choice.effects.map((e) => e.type);
        if (kinds.includes("change_drachmae") && kinds.every((k) => simple.has(k))) return { event, choice };
      }
    }
    throw new Error("no simple change_drachmae event in content");
  }

  it("daily card: two identical concurrent resolves apply the choice exactly once", async () => {
    const { token, characterId } = await freshPlayer(500, "trader");
    const { event, choice } = await simpleDrachmaeEvent();
    const amount = choice.effects.filter((e): e is Extract<typeof e, { type: "change_drachmae" }> => e.type === "change_drachmae").reduce((s, e) => s + e.amount, 0);
    // Today's set, as the draw would have left it: one unresolved general card.
    await db.insert(m.dbPkg.dailyDecisions).values({ characterId, utcDay: today, arena: "general", eventId: event.id });
    await warmPools(token); // GET /daily returns the card above (the set exists), drawing nothing

    const url = `/api/events/${event.id}/choices/${choice.id}`;
    const responses = await Promise.all([post(url, token), post(url, token)]);
    expect(statuses(responses)).toEqual([200, 409]);
    expect(responses.find((r) => r.statusCode === 409)!.json()).toEqual({ error: "You have already resolved that decision today." });

    const cards = await db.select().from(m.dbPkg.dailyDecisions).where(eq(m.dbPkg.dailyDecisions.characterId, characterId));
    expect(cards).toHaveLength(1);
    expect(cards[0]!.resolved).toBe(true);
    expect(cards[0]!.resolvedChoiceId).toBe(choice.id);
    const history = await db.select().from(m.dbPkg.eventHistory).where(eq(m.dbPkg.eventHistory.characterId, characterId));
    expect(history).toHaveLength(1);
    const debits = await db
      .select()
      .from(m.dbPkg.effectLog)
      .where(and(eq(m.dbPkg.effectLog.characterId, characterId), eq(m.dbPkg.effectLog.kind, "change_drachmae")));
    expect(debits).toHaveLength(1);
    const row = (await db.select().from(m.dbPkg.playerCharacters).where(eq(m.dbPkg.playerCharacters.id, characterId)).limit(1))[0]!;
    expect(row.drachmae).toBe(Math.max(0, 500 + amount));
  });

  it("daily card: the claim itself wins exactly once under the lock (service level)", async () => {
    const { token, characterId } = await freshPlayer(500, "trader");
    const { event, choice } = await simpleDrachmaeEvent();
    const card = (await db.insert(m.dbPkg.dailyDecisions).values({ characterId, utcDay: today, arena: "general", eventId: event.id }).returning())[0]!;

    // Both calls start from the same unresolved row — no route pre-check in the way —
    // so this is the UPDATE ... WHERE resolved = false RETURNING race, serialized by lockPlayer.
    await warmPools(token);
    const results = await Promise.all([m.daily.resolveDailyCard(card, choice), m.daily.resolveDailyCard(card, choice)]);
    expect(results.filter((r) => r.claimed)).toHaveLength(1);
    expect(results.filter((r) => !r.claimed)).toHaveLength(1);
    const history = await db.select().from(m.dbPkg.eventHistory).where(eq(m.dbPkg.eventHistory.characterId, characterId));
    expect(history).toHaveLength(1);
  });

  // The world clock: 1.5 real days in → year 0 of the game (festival instances key on it).
  const gameYear = 0;

  it("festival: two identical concurrent resolves donate, debit and record exactly once", async () => {
    const { token, characterId, playerId } = await freshPlayer(500, "trader");
    // The Dionysia as delivered to this character, unresolved. "choregos-tragedy":
    // −25 dr, +1 stat, register_choregos 25 (a donation row + a treasury cut).
    const fe = (await db.insert(m.dbPkg.festivalEvents).values({ characterId, festivalId: "fest-dionysia", eventId: "fest-dionysia", gameYear }).returning())[0]!;
    await warmPools(token);

    const payload = { festivalId: "fest-dionysia", choiceId: "choregos-tragedy" };
    const responses = await Promise.all([post("/api/festivals/resolve", token, payload), post("/api/festivals/resolve", token, payload)]);
    expect(statuses(responses)).toEqual([200, 409]);
    expect(responses.find((r) => r.statusCode === 409)!.json()).toEqual({ error: "You have already marked this festival." });

    const row = (await db.select().from(m.dbPkg.festivalEvents).where(eq(m.dbPkg.festivalEvents.id, fe.id)).limit(1))[0]!;
    expect(row.resolved).toBe(true);
    expect(row.resolvedChoiceId).toBe("choregos-tragedy");
    expect(await wallet(playerId)).toBe(475);
    expect(await db.select().from(m.dbPkg.festivalDonations).where(eq(m.dbPkg.festivalDonations.characterId, characterId))).toHaveLength(1);
    expect(await db.select().from(m.dbPkg.eventHistory).where(eq(m.dbPkg.eventHistory.characterId, characterId))).toHaveLength(1);
    expect(await db.select().from(m.dbPkg.composureLog).where(eq(m.dbPkg.composureLog.characterId, characterId))).toHaveLength(1);
    // Exactly one treasury cut was ledgered.
    expect(await db.select().from(m.dbPkg.treasuryLedger).where(eq(m.dbPkg.treasuryLedger.reason, "cut:festival_donation"))).toHaveLength(1);
  });

  it("Olympiad: two identical concurrent nominations register the candidacy exactly once", async () => {
    const { token, characterId } = await freshPlayer(500, "trader");
    // A cycle in its nomination window + the nominate card delivered, unresolved.
    await db.insert(m.dbPkg.olympiads).values({ worldId, gameYear, phase: "nomination", nominationEndsAt: new Date(now.getTime() + 2 * DAY) });
    const fe = (await db.insert(m.dbPkg.festivalEvents).values({ characterId, festivalId: "olympiad", eventId: "olympic-nominate", gameYear }).returning())[0]!;
    await warmPools(token);

    const responses = await Promise.all([post("/api/olympics/resolve", token, { choiceId: "stand" }), post("/api/olympics/resolve", token, { choiceId: "stand" })]);
    expect(statuses(responses)).toEqual([200, 409]);
    expect(responses.find((r) => r.statusCode === 200)!.json().nominated).toBe(true);
    expect(responses.find((r) => r.statusCode === 409)!.json()).toEqual({ error: "No Olympic event awaits you." });

    const row = (await db.select().from(m.dbPkg.festivalEvents).where(eq(m.dbPkg.festivalEvents.id, fe.id)).limit(1))[0]!;
    expect(row.resolved).toBe(true);
    expect(row.resolvedChoiceId).toBe("stand");
    expect(await db.select().from(m.dbPkg.olympicCandidates).where(eq(m.dbPkg.olympicCandidates.characterId, characterId))).toHaveLength(1);
    expect(await db.select().from(m.dbPkg.eventHistory).where(eq(m.dbPkg.eventHistory.characterId, characterId))).toHaveLength(1);
    expect(await db.select().from(m.dbPkg.composureLog).where(eq(m.dbPkg.composureLog.characterId, characterId))).toHaveLength(1);
  });

  it("error handler: 4xx keep status + message, 5xx are masked, malformed :characterId is a 400", async () => {
    const { token } = await freshPlayer(100);
    const teapot = await app.inject({ method: "GET", url: "/teapot" });
    expect(teapot.statusCode).toBe(418);
    expect(teapot.json()).toEqual({ error: "Short and stout." });

    const boom = await app.inject({ method: "GET", url: "/boom" });
    expect(boom.statusCode).toBe(500);
    expect(boom.json()).toEqual({ error: "Something went wrong." });

    const unauthenticated = await app.inject({ method: "GET", url: "/api/buildings/mine" });
    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.json()).toEqual({ error: "Authentication required" });

    const malformed = await app.inject({ method: "GET", url: "/api/interactions/profile/not-a-uuid", headers: { authorization: `Bearer ${token}` } });
    expect(malformed.statusCode).toBe(400);
    expect(typeof malformed.json().error).toBe("string");

    // A well-formed uuid passes validation and reaches the handler (404: no such citizen).
    const missing = await app.inject({ method: "GET", url: `/api/interactions/profile/${crypto.randomUUID()}`, headers: { authorization: `Bearer ${token}` } });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: "No such citizen." });
  });
});
