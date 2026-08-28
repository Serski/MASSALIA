import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, isNull, sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";

// ---------------------------------------------------------------------------
// Password reset (migration 0045) — integration tests against a REAL Postgres,
// guarded to a *_test database (mirrors account.test.ts). Exercises the reset
// token service (createPasswordReset/consumePasswordReset) directly AND the
// /forgot-password + /reset-password endpoints via a minimal Fastify app.
// RESEND_API_KEY / EMAIL_FROM are forced unset so the email path stays in
// dev-mode (console log, no network) for the whole suite.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const authSvc = await import("./auth.js");
  const { authRoutes } = await import("../routes/auth.js");
  return { dbPkg, authSvc, authRoutes };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

const GENERIC = "If that email is registered, a reset link is on its way.";

suite("password reset (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let app: FastifyInstance;
  let ipCounter = 0;
  const nextIp = () => `10.7.${Math.floor(ipCounter / 256)}.${ipCounter++ % 256}`;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    // Force dev-mode email for the suite (no live Resend calls). Saved/restored.
    savedEnv.RESEND_API_KEY = process.env.RESEND_API_KEY;
    savedEnv.EMAIL_FROM = process.env.EMAIL_FROM;
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;

    m = await loadModules();
    db = m.dbPkg.createDb();
    app = Fastify({ trustProxy: true });
    await app.register(cookie, { secret: "test-session-secret-at-least-32-chars-long" });
    await app.register(m.authRoutes, { prefix: "/auth" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    process.env.RESEND_API_KEY = savedEnv.RESEND_API_KEY;
    process.env.EMAIL_FROM = savedEnv.EMAIL_FROM;
  });

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE password_reset_tokens, sessions, player_characters, players, dynasties, worlds, users CASCADE`,
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
  const get = (url: string, token?: string) =>
    app.inject({ method: "GET", url, headers: { "x-forwarded-for": nextIp(), ...(token ? { authorization: `Bearer ${token}` } : {}) } });

  const resetTokenCount = async (userId?: string) => {
    const rows = userId
      ? await db.select({ id: m.dbPkg.passwordResetTokens.id }).from(m.dbPkg.passwordResetTokens).where(eq(m.dbPkg.passwordResetTokens.userId, userId))
      : await db.select({ id: m.dbPkg.passwordResetTokens.id }).from(m.dbPkg.passwordResetTokens);
    return rows.length;
  };
  const sessionCount = async (userId: string) =>
    (await db.select({ id: m.dbPkg.sessions.id }).from(m.dbPkg.sessions).where(eq(m.dbPkg.sessions.userId, userId))).length;
  const register = async (email: string, password: string) => {
    const res = await post("/auth/register", { email, password, termsAccepted: true });
    expect(res.statusCode).toBe(200);
    return res.json() as { user: { id: string }; token: string };
  };

  // 1 — /forgot-password is enumeration-safe: identical generic 200 for a real
  //     user, an unknown email, and a deleted tombstone; no token row for the
  //     latter two.
  it("forgot-password returns the same generic 200 for real / unknown / deleted, with no token for unknown or deleted", async () => {
    const { user } = await register("real@t", "correct-horse");

    // (a) real user
    const a = await post("/auth/forgot-password", { email: "real@t" });
    expect(a.statusCode).toBe(200);
    expect(a.json()).toEqual({ ok: true, message: GENERIC });
    expect(await resetTokenCount(user.id)).toBe(1);

    // (b) unknown email — same response, no token created anywhere
    const b = await post("/auth/forgot-password", { email: "nobody@t" });
    expect(b.statusCode).toBe(200);
    expect(b.json()).toEqual({ ok: true, message: GENERIC });
    expect(await resetTokenCount()).toBe(1); // still only the real user's

    // (c) deleted/tombstoned user — same response, no new token for them
    const del = await register("gone@t", "correct-horse");
    await post("/auth/delete-account", { password: "correct-horse" }, del.token);
    const c = await post("/auth/forgot-password", { email: "gone@t" });
    expect(c.statusCode).toBe(200);
    expect(c.json()).toEqual({ ok: true, message: GENERIC });
    expect(await resetTokenCount(del.user.id)).toBe(0);
  });

  // 2 — token single-use: a second consume of the same token fails.
  it("a reset token is single-use — second consume returns null", async () => {
    const { user } = await register("single@t", "correct-horse");
    const token = await m.authSvc.createPasswordReset(user.id);

    const first = await m.authSvc.consumePasswordReset(token);
    expect(first?.id).toBe(user.id);
    const second = await m.authSvc.consumePasswordReset(token);
    expect(second).toBeNull();
  });

  // 3 — expired token fails.
  it("an expired reset token cannot be consumed", async () => {
    const { user } = await register("expired@t", "correct-horse");
    const token = await m.authSvc.createPasswordReset(user.id);
    // Age it past the 60-minute TTL.
    await db
      .update(m.dbPkg.passwordResetTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(and(eq(m.dbPkg.passwordResetTokens.userId, user.id), isNull(m.dbPkg.passwordResetTokens.usedAt)));

    expect(await m.authSvc.consumePasswordReset(token)).toBeNull();
  });

  // 4 — newest-only: issuing a new token kills the prior unused one.
  it("newest-only — issuing a second token invalidates the first", async () => {
    const { user } = await register("newest@t", "correct-horse");
    const first = await m.authSvc.createPasswordReset(user.id);
    const second = await m.authSvc.createPasswordReset(user.id);

    expect(await m.authSvc.consumePasswordReset(first)).toBeNull(); // superseded
    expect((await m.authSvc.consumePasswordReset(second))?.id).toBe(user.id);
  });

  // 5 — successful reset via the route: hash rewritten, ALL prior sessions gone,
  //     a working new session issued (login-shaped payload).
  it("reset-password updates the hash, drops all prior sessions, and issues a working session", async () => {
    const { user } = await register("do-reset@t", "old-password");
    // A second live session (another device) that must also be evicted.
    await db.insert(m.dbPkg.sessions).values({ userId: user.id, tokenHash: `extra-${user.id}`, expiresAt: new Date(Date.now() + 86_400_000) });
    expect(await sessionCount(user.id)).toBe(2);

    const token = await m.authSvc.createPasswordReset(user.id);
    const res = await post("/auth/reset-password", { token, password: "brand-new-password" });
    expect(res.statusCode).toBe(200);
    const payload = res.json() as { user: { id: string; email: string }; hasCharacter: boolean; token: string };
    expect(payload.user).toEqual({ id: user.id, email: "do-reset@t" });
    expect(payload.hasCharacter).toBe(false);
    expect(typeof payload.token).toBe("string");

    // Exactly one session survives — the freshly issued one — old ones evicted.
    expect(await sessionCount(user.id)).toBe(1);

    // The new session token authenticates on an authed route.
    const me = await get("/auth/me", payload.token);
    expect(me.statusCode).toBe(200);
    expect(me.json().user?.id).toBe(user.id);

    // New password logs in; the old one no longer does.
    expect((await post("/auth/login", { email: "do-reset@t", password: "brand-new-password" })).statusCode).toBe(200);
    expect((await post("/auth/login", { email: "do-reset@t", password: "old-password" })).statusCode).toBe(401);
  });

  // 6 — password rejected by the SAME rule as register (min 8) → 400, and the
  //     token is NOT consumed (still usable afterward).
  it("a too-short password is rejected 400 and leaves the token usable", async () => {
    const { user } = await register("weak@t", "correct-horse");
    const token = await m.authSvc.createPasswordReset(user.id);

    const bad = await post("/auth/reset-password", { token, password: "short" });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe("Password must be at least 8 characters.");

    // Token untouched → a valid retry succeeds.
    const good = await post("/auth/reset-password", { token, password: "now-long-enough" });
    expect(good.statusCode).toBe(200);
    expect(good.json().user.id).toBe(user.id);
  });

  // 7 — invalid/expired token at the route → 400 with the fixed message.
  it("reset-password with a bad token returns the invalid/expired 400", async () => {
    const res = await post("/auth/reset-password", { token: "not-a-real-token", password: "long-enough-pass" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("This reset link is invalid or has expired. Request a new one.");
  });

  // 8 — dev-mode email: with env unset, sendPasswordResetEmail logs instead of sending.
  it("dev-mode email logs the reset link instead of sending", async () => {
    await register("logme@t", "correct-horse");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const res = await post("/auth/forgot-password", { email: "logme@t" });
      expect(res.statusCode).toBe(200);
      const logged = spy.mock.calls.map((c) => String(c[0]));
      const line = logged.find((l) => l.includes("[email dev-mode]"));
      expect(line).toBeTruthy();
      expect(line).toContain("/?reset=");
      expect(line).toContain("logme@t");
    } finally {
      spy.mockRestore();
    }
  });

  // 9 — rate-limit config present on both new routes (config inspection).
  it("forgot-password and reset-password carry their rate-limit config", async () => {
    const routes: Record<string, { max?: number; timeWindow?: number }> = {};
    const probe = Fastify({ trustProxy: true });
    await probe.register(cookie, { secret: "test-session-secret-at-least-32-chars-long" });
    probe.addHook("onRoute", (route) => {
      const rl = (route.config as { rateLimit?: { max?: number; timeWindow?: number } } | undefined)?.rateLimit;
      if (rl) routes[route.url] = rl;
    });
    await probe.register(m.authRoutes, { prefix: "/auth" });
    await probe.ready();

    expect(routes["/auth/forgot-password"]).toEqual({ max: 3, timeWindow: 3_600_000 });
    expect(routes["/auth/reset-password"]).toEqual({ max: 8, timeWindow: 60_000 });
    await probe.close();
  });
});
