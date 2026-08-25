import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";

// ---------------------------------------------------------------------------
// Account deletion (anonymize-and-detach) — integration tests against a REAL
// Postgres, guarded to a *_test database (mirrors buildings.test.ts / agenda.test.ts).
// The service (deleteAccount) is exercised directly; the endpoint + the login/auth
// guards go through a minimal Fastify app via app.inject() (built-in; no route-test
// infrastructure exists, so this file stands up its own).
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const account = await import("./account.js");
  const authSvc = await import("./auth.js");
  const { authRoutes } = await import("../routes/auth.js");
  return { dbPkg, account, authSvc, authRoutes };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

const T0 = Date.UTC(2000, 0, 1);
const DAY = 86_400_000;

suite("account deletion (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let app: FastifyInstance;
  let ipCounter = 0;
  // Unique client IP per request so the per-route auth rate-limiter (in-memory in
  // tests) never accumulates across cases — each inject gets its own bucket.
  const nextIp = () => `10.9.${Math.floor(ipCounter / 256)}.${ipCounter++ % 256}`;

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    // trustProxy so X-Forwarded-For drives request.ip (the rate-limit key); cookie
    // plugin is required by createSession/clearSession (setCookie/unsignCookie).
    app = Fastify({ trustProxy: true });
    await app.register(cookie, { secret: "test-session-secret-at-least-32-chars-long" });
    await app.register(m.authRoutes, { prefix: "/auth" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE sessions, player_characters, players, dynasties, worlds, users CASCADE`,
    );
  });

  // --- helpers ---------------------------------------------------------------
  const post = (url: string, payload: Record<string, unknown>, token?: string) =>
    app.inject({
      method: "POST",
      url,
      payload,
      headers: { "x-forwarded-for": nextIp(), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });

  const userByEmail = async (email: string) =>
    (await db.select().from(m.dbPkg.users).where(eq(m.dbPkg.users.email, email)).limit(1))[0];
  const userById = async (id: string) =>
    (await db.select().from(m.dbPkg.users).where(eq(m.dbPkg.users.id, id)).limit(1))[0];
  const sessionCount = async (userId: string) =>
    (await db.select({ id: m.dbPkg.sessions.id }).from(m.dbPkg.sessions).where(eq(m.dbPkg.sessions.userId, userId))).length;

  async function seedWorld(seed: string) {
    return (
      await db
        .insert(m.dbPkg.worlds)
        .values({ name: `W-${seed}`, seed, startedAt: new Date(T0), endsAt: new Date(T0 + 182 * DAY), status: "active" })
        .returning()
    )[0]!;
  }

  // 1 — service level: tombstone + detach across worlds; sessions dropped.
  it("deleteAccount tombstones the user, drops every session, and detaches players in all worlds", async () => {
    const user = (await db.insert(m.dbPkg.users).values({ email: "svc@t", passwordHash: "realhash", newsletterOptIn: true }).returning())[0]!;
    const w1 = await seedWorld("s1");
    const w2 = await seedWorld("s2");
    await db.insert(m.dbPkg.players).values({ worldId: w1.id, userId: user.id, name: "Alpha", color: "#111111" });
    await db.insert(m.dbPkg.players).values({ worldId: w2.id, userId: user.id, name: "Beta", color: "#222222" });
    await db.insert(m.dbPkg.sessions).values({ userId: user.id, tokenHash: `seed-${user.id}`, expiresAt: new Date(Date.now() + DAY) });

    await m.account.deleteAccount(user.id);

    const after = await userById(user.id);
    expect(after!.email).toBe(`deleted:${user.id}@anon.invalid`);
    expect(after!.passwordHash).toBe("!deleted");
    expect(after!.newsletterOptIn).toBe(false);
    expect(after!.deletedAt).not.toBeNull();
    expect(await sessionCount(user.id)).toBe(0);
    const players = await db.select().from(m.dbPkg.players).where(eq(m.dbPkg.players.userId, user.id));
    expect(players).toHaveLength(2);
    expect(players.every((p) => p.isActive === false)).toBe(true);
    // Ruling: pseudonymous world content stays — names untouched.
    expect(players.map((p) => p.name).sort()).toEqual(["Alpha", "Beta"]);
  });

  // 2 — wrong password: 401, nothing mutated, session intact.
  it("POST /delete-account with the wrong password → 401, user row + sessions untouched", async () => {
    const reg = await post("/auth/register", { email: "wrong@t", password: "correct-horse" });
    expect(reg.statusCode).toBe(200);
    const token = reg.json().token as string;
    const before = await userByEmail("wrong@t");
    expect(await sessionCount(before!.id)).toBe(1);

    const res = await post("/auth/delete-account", { password: "not-the-password" }, token);
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("Password is incorrect.");

    const after = await userById(before!.id);
    expect(after).toEqual(before); // byte-identical
    expect(after!.deletedAt).toBeNull();
    expect(await sessionCount(before!.id)).toBe(1); // session intact
  });

  // 3 — old bearer token is dead after deletion (requireAuth on an authed route).
  it("a bearer token is rejected (401) on an authed route after the account is deleted", async () => {
    const reg = await post("/auth/register", { email: "stale@t", password: "correct-horse" });
    const token = reg.json().token as string;

    const del = await post("/auth/delete-account", { password: "correct-horse" }, token);
    expect(del.statusCode).toBe(200);
    expect(del.json().ok).toBe(true);

    // The same (now-stale) token hits the authed delete-account route again.
    const reuse = await post("/auth/delete-account", { password: "correct-horse" }, token);
    expect(reuse.statusCode).toBe(401); // requireAuth: session gone + deletedAt set
  });

  // 4 & 5 — login with the old credentials is refused; the email frees up for reuse.
  it("after deletion, login with the old email+password is refused and the email re-registers to a fresh id", async () => {
    const reg = await post("/auth/register", { email: "reuse@t", password: "correct-horse" });
    const oldId = reg.json().user.id as string;
    const token = reg.json().token as string;
    expect((await post("/auth/delete-account", { password: "correct-horse" }, token)).statusCode).toBe(200);

    // 4: pre-deletion credentials no longer log in.
    const login = await post("/auth/login", { email: "reuse@t", password: "correct-horse" });
    expect(login.statusCode).toBe(401);
    expect(login.json().error).toBe("Invalid email or password.");

    // 5: the freed email re-registers to a brand-new users id.
    const again = await post("/auth/register", { email: "reuse@t", password: "brand-new-pass" });
    expect(again.statusCode).toBe(200);
    expect(again.json().user.id).not.toBe(oldId);
  });
});
