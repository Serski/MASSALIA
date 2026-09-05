import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { eq, sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";

// ---------------------------------------------------------------------------
// Onboarding seen-flags (migration 0042) — integration tests against a REAL
// Postgres, guarded to a *_test database (mirrors account.test.ts). The endpoint
// goes through a minimal Fastify app via app.inject(); the /me/state derivation
// (introSeen/sheetSeen = the players timestamps being non-null) is asserted on its
// exact source columns, since /me/state's full lazy-sync surface needs the entire
// content-config boot to run and account.test.ts records that no route-test
// infrastructure exists for it.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const DAY = 86_400_000;
const T0 = Date.UTC(2000, 0, 1);

// Mirror auth.ts's private session-token hashing (sha256 hex) so a row inserted
// here authenticates via the signed session cookie.
function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const { meRoutes } = await import("./me.js");
  return { dbPkg, meRoutes };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("onboarding seen-flags (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let app: FastifyInstance;
  let worldId: string;

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    app = Fastify();
    // requireAuth reads the signed session cookie, so the cookie plugin must be
    // present for request.cookies / unsignCookie (and app.signCookie below).
    await app.register(cookie, { secret: "test-session-secret-at-least-32-chars-long" });
    await app.register(m.meRoutes, { prefix: "/me" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE sessions, player_characters, players, dynasties, worlds, users CASCADE`);
    const world = (
      await db
        .insert(m.dbPkg.worlds)
        .values({ name: "W", seed: "s", startedAt: new Date(T0), endsAt: new Date(T0 + 182 * DAY), status: "active" })
        .returning()
    )[0]!;
    worldId = world.id;
  });

  // A fresh user + active player + a live session token. professionSlug/houseSlug are
  // left NULL (the endpoint keys off the active player only, no join needed).
  async function freshPlayer() {
    const user = (
      await db
        .insert(m.dbPkg.users)
        .values({ email: `u-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" })
        .returning()
    )[0]!;
    const player = (
      await db.insert(m.dbPkg.players).values({ worldId, userId: user.id, name: "P", color: "#123456" }).returning()
    )[0]!;
    const token = crypto.randomBytes(16).toString("base64url");
    await db
      .insert(m.dbPkg.sessions)
      .values({ userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + DAY) });
    return { token, playerId: player.id };
  }

  const playerRow = async (id: string) =>
    (await db.select().from(m.dbPkg.players).where(eq(m.dbPkg.players.id, id)).limit(1))[0]!;

  // Exactly the derivation /me/state exposes.
  const stateFlags = (row: { introSeenAt: Date | null; sheetSeenAt: Date | null }) => ({
    introSeen: row.introSeenAt !== null,
    sheetSeen: row.sheetSeenAt !== null,
  });

  const post = (step: unknown, token?: string) =>
    app.inject({
      method: "POST",
      url: "/me/onboarding",
      payload: { step },
      headers: token ? { cookie: `massalia_session=${app.signCookie(token)}` } : {},
    });

  // 1 — a fresh player reads as un-onboarded on both flags.
  it("a fresh player exposes introSeen=false and sheetSeen=false in state", async () => {
    const { playerId } = await freshPlayer();
    const row = await playerRow(playerId);
    expect(row.introSeenAt).toBeNull();
    expect(row.sheetSeenAt).toBeNull();
    expect(stateFlags(row)).toEqual({ introSeen: false, sheetSeen: false });
  });

  // 2 — POST intro stamps intro_seen_at (state flips true); sheet stays untouched.
  it("POST intro sets intro_seen_at and flips introSeen, leaving sheetSeen false", async () => {
    const { token, playerId } = await freshPlayer();
    const res = await post("intro", token);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const row = await playerRow(playerId);
    expect(row.introSeenAt).not.toBeNull();
    expect(row.sheetSeenAt).toBeNull();
    expect(stateFlags(row)).toEqual({ introSeen: true, sheetSeen: false });
  });

  // 3 — first-seen is immutable: a repeat POST is a no-op ack, timestamp unchanged.
  it("a repeat POST intro leaves the original intro_seen_at untouched", async () => {
    const { token, playerId } = await freshPlayer();
    // Pre-stamp an old, known instant so any re-stamp with now() would be visibly newer.
    const pinned = new Date(T0);
    await db.update(m.dbPkg.players).set({ introSeenAt: pinned }).where(eq(m.dbPkg.players.id, playerId));

    const res = await post("intro", token);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const row = await playerRow(playerId);
    expect(row.introSeenAt?.getTime()).toBe(pinned.getTime());
  });

  // 4 — sheet behaves identically: sets when null, immutable once set.
  it("POST sheet sets sheet_seen_at, and a repeat leaves it untouched", async () => {
    const { token, playerId } = await freshPlayer();

    const first = await post("sheet", token);
    expect(first.statusCode).toBe(200);
    let row = await playerRow(playerId);
    expect(row.sheetSeenAt).not.toBeNull();
    expect(row.introSeenAt).toBeNull();
    expect(stateFlags(row)).toEqual({ introSeen: false, sheetSeen: true });
    const stamped = row.sheetSeenAt!.getTime();

    const second = await post("sheet", token);
    expect(second.statusCode).toBe(200);
    row = await playerRow(playerId);
    expect(row.sheetSeenAt!.getTime()).toBe(stamped);
  });

  // 5 — an unrecognized step is rejected with the file's 400 error shape; nothing set.
  it("an unknown step returns 400 and stamps neither column", async () => {
    const { token, playerId } = await freshPlayer();
    const res = await post("bogus", token);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Unknown onboarding step." });

    const row = await playerRow(playerId);
    expect(row.introSeenAt).toBeNull();
    expect(row.sheetSeenAt).toBeNull();
  });

  // 6 — auth is required (same as newsletter): no token → 401, nothing set.
  it("rejects an unauthenticated request with 401", async () => {
    const { playerId } = await freshPlayer();
    const res = await post("intro");
    expect(res.statusCode).toBe(401);

    const row = await playerRow(playerId);
    expect(row.introSeenAt).toBeNull();
  });
});
