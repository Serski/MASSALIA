import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, isNull, sql } from "drizzle-orm";
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify";
import cookie from "@fastify/cookie";

// ---------------------------------------------------------------------------
// Soft email verification (migration 0046) — integration tests against a REAL
// Postgres, guarded to a *_test database (mirrors password-reset.test.ts).
// RESEND_API_KEY / EMAIL_FROM forced unset → dev-mode email (console, no network).
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const authSvc = await import("./auth.js");
  const emailSvc = await import("./email.js");
  const { authRoutes } = await import("../routes/auth.js");
  return { dbPkg, authSvc, emailSvc, authRoutes };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("email verification (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let app: FastifyInstance;
  let ipCounter = 0;
  const nextIp = () => `10.5.${Math.floor(ipCounter / 256)}.${ipCounter++ % 256}`;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
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
      sql`TRUNCATE TABLE email_verification_tokens, password_reset_tokens, sessions, player_characters, players, dynasties, worlds, users CASCADE`,
    );
  });

  // --- helpers ---------------------------------------------------------------
  const post = (url: string, payload: Record<string, unknown> | undefined, cookie?: string) =>
    app.inject({
      method: "POST",
      url,
      ...(payload ? { payload } : {}),
      headers: { "x-forwarded-for": nextIp(), ...(cookie ? { cookie } : {}) },
    });
  // The signed session cookie a response set, as a `cookie` request-header value
  // (cookie-only auth: the raw token is no longer in the JSON body).
  const sessionCookie = (res: LightMyRequestResponse) => {
    const raw = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
    return raw.find((c) => c.startsWith("massalia_session="))?.split(";")[0] ?? "";
  };
  const register = async (email: string, password: string) => {
    const res = await post("/auth/register", { email, password, termsAccepted: true });
    expect(res.statusCode).toBe(200);
    return { ...(res.json() as { user: { id: string; email: string } }), cookie: sessionCookie(res) };
  };
  const verifiedAt = async (userId: string) =>
    (await db.select({ v: m.dbPkg.users.emailVerifiedAt }).from(m.dbPkg.users).where(eq(m.dbPkg.users.id, userId)).limit(1))[0]?.v ?? null;

  // 1 — single-use.
  it("a verification token is single-use — second consume returns null", async () => {
    const { user } = await register("single@t", "correct-horse");
    const token = await m.authSvc.createEmailVerification(user.id);
    expect((await m.authSvc.consumeEmailVerification(token))?.id).toBe(user.id);
    expect(await m.authSvc.consumeEmailVerification(token)).toBeNull();
  });

  // 2 — expiry.
  it("an expired verification token cannot be consumed", async () => {
    const { user } = await register("expired@t", "correct-horse");
    const token = await m.authSvc.createEmailVerification(user.id);
    await db
      .update(m.dbPkg.emailVerificationTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(and(eq(m.dbPkg.emailVerificationTokens.userId, user.id), isNull(m.dbPkg.emailVerificationTokens.usedAt)));
    expect(await m.authSvc.consumeEmailVerification(token)).toBeNull();
    expect(await verifiedAt(user.id)).toBeNull();
  });

  // 3 — newest-only.
  it("newest-only — issuing a second token invalidates the first", async () => {
    const { user } = await register("newest@t", "correct-horse");
    const first = await m.authSvc.createEmailVerification(user.id);
    const second = await m.authSvc.createEmailVerification(user.id);
    expect(await m.authSvc.consumeEmailVerification(first)).toBeNull();
    expect((await m.authSvc.consumeEmailVerification(second))?.id).toBe(user.id);
  });

  // 4 — consume stamps email_verified_at.
  it("consuming a token sets email_verified_at", async () => {
    const { user } = await register("stamp@t", "correct-horse");
    expect(await verifiedAt(user.id)).toBeNull();
    const token = await m.authSvc.createEmailVerification(user.id);
    await m.authSvc.consumeEmailVerification(token);
    expect(await verifiedAt(user.id)).not.toBeNull();
  });

  // 5 — using a password-reset link also verifies the email (when NULL).
  it("a password reset also verifies the email when it was unverified", async () => {
    const { user } = await register("resetverify@t", "old-password");
    expect(await verifiedAt(user.id)).toBeNull();
    const resetToken = await m.authSvc.createPasswordReset(user.id);
    const res = await post("/auth/reset-password", { token: resetToken, password: "brand-new-password" });
    expect(res.statusCode).toBe(200);
    expect(await verifiedAt(user.id)).not.toBeNull();
  });

  // 6 — resend 409 when already verified.
  it("resend-verification returns 409 once the email is verified", async () => {
    const { user, cookie: session } = await register("already@t", "correct-horse");
    const verifyToken = await m.authSvc.createEmailVerification(user.id);
    await m.authSvc.consumeEmailVerification(verifyToken);

    const res = await post("/auth/resend-verification", undefined, session);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("Your email is already verified.");
  });

  // 6b — resend works (200) while unverified.
  it("resend-verification returns 200 while unverified", async () => {
    const { cookie: session } = await register("resend@t", "correct-horse");
    const res = await post("/auth/resend-verification", undefined, session);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, message: "Verification email sent." });
  });

  // 7 — register still succeeds when the verification email send throws (fire-and-forget).
  it("register succeeds even when the verification email send throws", async () => {
    const spy = vi.spyOn(m.emailSvc, "sendVerificationEmail").mockRejectedValue(new Error("smtp boom"));
    try {
      const res = await post("/auth/register", { email: "throws@t", password: "correct-horse", termsAccepted: true });
      expect(res.statusCode).toBe(200);
      expect(res.json().user.email).toBe("throws@t");
      // The account is real and usable despite the email failure.
      expect((await post("/auth/login", { email: "throws@t", password: "correct-horse" })).statusCode).toBe(200);
    } finally {
      spy.mockRestore();
    }
  });

  // 8 — verify-email needs no session (the token is the proof).
  it("verify-email works with no auth header", async () => {
    const { user } = await register("nosession@t", "correct-horse");
    const token = await m.authSvc.createEmailVerification(user.id);
    const res = await post("/auth/verify-email", { token }); // no cookie
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(await verifiedAt(user.id)).not.toBeNull();
  });

  // 8b — verify-email with a bad token → 400.
  it("verify-email with an invalid token returns 400", async () => {
    const res = await post("/auth/verify-email", { token: "not-a-real-token" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("This verification link is invalid or has expired.");
  });

  // 9 — rate-limit config present on both new routes.
  it("verify-email and resend-verification carry their rate-limit config", async () => {
    const routes: Record<string, { max?: number; timeWindow?: number }> = {};
    const probe = Fastify({ trustProxy: true });
    await probe.register(cookie, { secret: "test-session-secret-at-least-32-chars-long" });
    probe.addHook("onRoute", (route) => {
      const rl = (route.config as { rateLimit?: { max?: number; timeWindow?: number } } | undefined)?.rateLimit;
      if (rl) routes[route.url] = rl;
    });
    await probe.register(m.authRoutes, { prefix: "/auth" });
    await probe.ready();

    expect(routes["/auth/verify-email"]).toEqual({ max: 8, timeWindow: 60_000 });
    expect(routes["/auth/resend-verification"]).toEqual({ max: 3, timeWindow: 3_600_000 });
    await probe.close();
  });
});
