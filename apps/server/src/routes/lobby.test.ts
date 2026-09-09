import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import type { LobbyResponse } from "./lobby.js";
import type { StandingsResponse } from "./standings.js";

// ---------------------------------------------------------------------------
// GET /api/lobby against a REAL Postgres guarded to a *_test database (the suite
// truncates it); the route runs through a minimal Fastify app via app.inject()
// with the production error handler + a signed session cookie (mirrors
// concurrency.test.ts). Read-only: the fixtures are inserted directly.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const DAY = 86_400_000;

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const { lobbyRoutes } = await import("./lobby.js");
  const { standingsRoutes } = await import("./standings.js");
  const { errorHandler } = await import("../errorHandler.js");
  return { dbPkg, lobbyRoutes, standingsRoutes, errorHandler };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

// Keys that would leak a raw metric. The response carries rank positions only.
const FORBIDDEN_KEYS = ["prestige", "drachmae", "wealth", "devotion", "militia", "intelligence"];

function collectKeys(value: unknown, into: Set<string>): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => collectKeys(v, into));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      into.add(k);
      collectKeys(v, into);
    }
  }
  return into;
}

suite("GET /api/lobby (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let app: FastifyInstance;
  let worldId: string;
  const now = new Date();
  const startedAt = new Date(now.getTime() - 1.5 * DAY);
  const endsAt = new Date(now.getTime() + 182 * DAY);

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    app = Fastify();
    app.setErrorHandler(m.errorHandler);
    await app.register(cookie, { secret: "test-session-secret-at-least-32-chars-long" });
    await app.register(m.lobbyRoutes, { prefix: "/api/lobby" });
    await app.register(m.standingsRoutes, { prefix: "/api/standings" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE office_history, offices, player_characters, dynasties, players, sessions, users, worlds CASCADE`);
    await db
      .insert(m.dbPkg.houses)
      .values({ slug: "test-house", name: "Test House", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" })
      .onConflictDoNothing();
    await db.insert(m.dbPkg.professions).values({ slug: "test-trader", name: "Test Trader", initial: "T", rank: "r", income: "i" }).onConflictDoNothing();
    worldId = (await db.insert(m.dbPkg.worlds).values({ name: "Lobby Test", seed: "lobby", tagline: "The first season", startedAt, endsAt, status: "active" }).returning())[0]!.id;
  });

  // A user with a live session and, optionally, a player + character in the active world.
  async function freshUser(opts: { character?: { name: string; prestige: number } } = {}) {
    const { users, players, playerCharacters, dynasties, sessions } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `u-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const token = crypto.randomBytes(16).toString("base64url");
    await db.insert(sessions).values({ userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + DAY) });
    if (!opts.character) return { user, token, playerId: null, characterId: null };
    const player = (
      await db
        .insert(players)
        .values({ worldId, userId: user.id, name: opts.character.name, color: "#123456", houseSlug: "test-house", professionSlug: "test-trader" })
        .returning()
    )[0]!;
    const dynasty = (await db.insert(dynasties).values({ worldId, name: `Line of ${opts.character.name}`, houseSlug: "test-house", foundingPlayerId: player.id, generation: 3 }).returning())[0]!;
    const character = (
      await db
        .insert(playerCharacters)
        .values({ playerId: player.id, worldId, houseSlug: "test-house", classId: "trader", prestige: opts.character.prestige, dynastyId: dynasty.id, startAge: 30, deathAge: 90 })
        .returning()
    )[0]!;
    return { user, token, playerId: player.id, characterId: character.id };
  }

  const sessionCookie = (token: string) => ({ cookie: `massalia_session=${app.signCookie(token)}` });
  const lobby = async (token: string) => {
    const res = await app.inject({ method: "GET", url: "/api/lobby", headers: sessionCookie(token) });
    expect(res.statusCode).toBe(200);
    return res.json() as LobbyResponse;
  };

  it("401 without a session", async () => {
    const res = await app.inject({ method: "GET", url: "/api/lobby" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "Authentication required" });
  });

  it("a user with no character: the active world with you = null, an empty record", async () => {
    const { user, token } = await freshUser();
    const body = await lobby(token);
    expect(body.user).toEqual({ email: user.email, emailVerified: false, newsletterOptIn: false, isAdmin: false, memberSince: user.createdAt.toISOString() });
    expect(body.worlds.active).not.toBeNull();
    expect(body.worlds.active!.id).toBe(worldId);
    expect(body.worlds.active!.name).toBe("Lobby Test");
    expect(body.worlds.active!.tagline).toBe("The first season");
    expect(body.worlds.active!.startedAt).toBe(startedAt.toISOString());
    expect(body.worlds.active!.endsAt).toBe(endsAt.toISOString());
    // 1.5 days in: the second season of year 0 → "Spring, 300 BC"; 182 days left.
    expect(body.worlds.active!.gameDateLabel).toBe("Spring, 300 BC");
    expect(body.worlds.active!.seasonEndsIn).toBe(182);
    expect(body.worlds.active!.playerCount).toBe(0);
    expect(body.worlds.active!.you).toBeNull();
    expect(body.worlds.announced).toEqual([]);
    expect(body.worlds.ended).toEqual([]);
    expect(body.record).toEqual({ worldsPlayed: 0, offices: [] });
  });

  it("a user with a character: prestigeRank matches their rank on the /api/standings prestige board", async () => {
    await freshUser({ character: { name: "Kleon", prestige: 50 } });
    const viewer = await freshUser({ character: { name: "Pytheas", prestige: 5 } });
    await freshUser({ character: { name: "Gyptis", prestige: 20 } });

    const body = await lobby(viewer.token);
    const standings = await app.inject({ method: "GET", url: "/api/standings", headers: sessionCookie(viewer.token) });
    expect(standings.statusCode).toBe(200);
    const board = (standings.json() as StandingsResponse).boards.prestige;
    const mine = board.find((row) => row.isViewer)!;
    expect(mine.playerId).toBe(viewer.playerId);
    expect(mine.rank).toBe(3);

    const you = body.worlds.active!.you!;
    expect(you.prestigeRank).toBe(mine.rank);
    expect(you.rosterSize).toBe(board.length);
    expect(you).toEqual({
      characterId: viewer.characterId,
      name: "Pytheas",
      houseName: "Test House",
      professionName: "Test Trader",
      dynastyName: "Line of Pytheas",
      generation: 3,
      prestigeRank: 3,
      rosterSize: 3,
    });
    expect(body.worlds.active!.playerCount).toBe(3);
    expect(body.record.worldsPlayed).toBe(1);
  });

  it("an announced world is listed under announced and never as the active world", async () => {
    const soon = new Date(now.getTime() + 10 * DAY);
    const later = new Date(now.getTime() + 30 * DAY);
    const b = (await db.insert(m.dbPkg.worlds).values({ name: "Season Three", seed: "s3", startedAt: later, endsAt: new Date(later.getTime() + 182 * DAY), status: "announced" }).returning())[0]!;
    const a = (
      await db.insert(m.dbPkg.worlds).values({ name: "Season Two", seed: "s2", tagline: "Soon", startedAt: soon, endsAt: new Date(soon.getTime() + 182 * DAY), status: "announced" }).returning()
    )[0]!;
    const { token } = await freshUser();
    const body = await lobby(token);
    expect(body.worlds.active!.id).toBe(worldId);
    expect(body.worlds.announced).toEqual([
      { id: a.id, name: "Season Two", tagline: "Soon", startsAt: soon.toISOString() },
      { id: b.id, name: "Season Three", tagline: null, startsAt: later.toISOString() },
    ]);
    expect(body.worlds.ended).toEqual([]);
  });

  it("an ended world is listed under ended with every player row counted", async () => {
    const { users, players } = m.dbPkg;
    const endedStart = new Date(now.getTime() - 400 * DAY);
    const endedEnd = new Date(now.getTime() - 218 * DAY);
    const ended = (
      await db.insert(m.dbPkg.worlds).values({ name: "Season Zero", seed: "s0", tagline: "Gone", startedAt: endedStart, endsAt: endedEnd, status: "ended" }).returning()
    )[0]!;
    const { user, token } = await freshUser();
    const other = (await db.insert(users).values({ email: `o-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    await db.insert(players).values({ worldId: ended.id, userId: user.id, name: "Old Me", color: "#000000", isActive: false });
    await db.insert(players).values({ worldId: ended.id, userId: other.id, name: "Old Rival", color: "#000000", isActive: true });

    const body = await lobby(token);
    expect(body.worlds.active!.id).toBe(worldId);
    expect(body.worlds.announced).toEqual([]);
    expect(body.worlds.ended).toEqual([
      { id: ended.id, name: "Season Zero", tagline: "Gone", startedAt: endedStart.toISOString(), endsAt: endedEnd.toISOString(), playerCount: 2 },
    ]);
    // The detached seat in the ended world still counts as a world played.
    expect(body.record.worldsPlayed).toBe(1);
  });

  it("an office_history row for the user's character appears in record.offices with the world name", async () => {
    const viewer = await freshUser({ character: { name: "Protis", prestige: 10 } });
    const rival = await freshUser({ character: { name: "Rival", prestige: 10 } });
    await db.insert(m.dbPkg.officeHistory).values({ worldId, characterId: viewer.characterId!, office: "archon", side: "palaioi", startedYear: 7, acquiredVia: "elected" });
    await db.insert(m.dbPkg.officeHistory).values({ worldId, characterId: rival.characterId!, office: "ephor", side: "dynatoi", startedYear: 7, acquiredVia: "elected" });

    const body = await lobby(viewer.token);
    expect(body.record.offices).toEqual([{ worldName: "Lobby Test", office: "archon", side: "palaioi", startedYear: 7, endedYear: null, acquiredVia: "elected" }]);
  });

  it("the JSON never carries a raw metric key", async () => {
    const viewer = await freshUser({ character: { name: "Euxenos", prestige: 10 } });
    await db.insert(m.dbPkg.officeHistory).values({ worldId, characterId: viewer.characterId!, office: "archon", side: "palaioi", startedYear: 7, acquiredVia: "elected" });
    const body = await lobby(viewer.token);
    const keys = collectKeys(body, new Set());
    for (const forbidden of FORBIDDEN_KEYS) expect(keys.has(forbidden), forbidden).toBe(false);
  });
});
