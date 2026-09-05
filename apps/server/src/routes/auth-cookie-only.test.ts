import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify";
import cookie from "@fastify/cookie";

// ---------------------------------------------------------------------------
// Cookie-only auth — integration tests against a REAL Postgres, guarded to a
// *_test database (mirrors services/account.test.ts). The web app and API are
// same-site (playmassalia.com / api.playmassalia.com), so the session travels
// only as the signed httpOnly cookie: register, login and reset-password must
// NOT echo the raw token in their JSON, and an `Authorization: Bearer` header
// (the pre-switch localStorage fallback) is ignored.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const authSvc = await import("../services/auth.js");
  const { authRoutes } = await import("./auth.js");
  return { dbPkg, authSvc, authRoutes };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("auth responses are cookie-only (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let app: FastifyInstance;
  let ipCounter = 0;
  const nextIp = () => `10.11.${Math.floor(ipCounter / 256)}.${ipCounter++ % 256}`;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    // Dev-mode email for the suite (register sends a verification mail).
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
      sql`TRUNCATE TABLE password_reset_tokens, email_verification_tokens, sessions, player_characters, players, dynasties, worlds, users CASCADE`,
    );
  });

  // --- helpers ---------------------------------------------------------------
  const post = (url: string, payload: Record<string, unknown>, headers: Record<string, string> = {}) =>
    app.inject({ method: "POST", url, payload, headers: { "x-forwarded-for": nextIp(), ...headers } });
  const me = (headers: Record<string, string> = {}) =>
    app.inject({ method: "GET", url: "/auth/me", headers: { "x-forwarded-for": nextIp(), ...headers } });

  const setCookies = (res: LightMyRequestResponse) => ([] as string[]).concat(res.headers["set-cookie"] ?? []);
  const sessionSetCookie = (res: LightMyRequestResponse) => setCookies(res).find((c) => c.startsWith("massalia_session=")) ?? "";
  const cookieHeader = (res: LightMyRequestResponse) => sessionSetCookie(res).split(";")[0]!;

  // A response that opened a session: no token in the body, the session in a
  // signed httpOnly cookie, and that cookie authenticating /auth/me as `userId`.
  const expectCookieOnlySession = async (res: LightMyRequestResponse, userId: string) => {
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body).not.toHaveProperty("token");
    expect(JSON.stringify(body)).not.toMatch(/token/i);

    const setCookie = sessionSetCookie(res);
    expect(setCookie).toMatch(/^massalia_session=./);
    expect(setCookie).toMatch(/;\s*HttpOnly/i);
    expect(setCookie).toMatch(/;\s*SameSite=Lax/i);

    const authed = await me({ cookie: cookieHeader(res) });
    expect(authed.statusCode).toBe(200);
    expect(authed.json().user?.id).toBe(userId);
  };

  it("register sets the session cookie and returns no token field", async () => {
    const res = await post("/auth/register", { email: "reg@t", password: "correct-horse", termsAccepted: true });
    expect(res.json().user.email).toBe("reg@t");
    expect(res.json().hasCharacter).toBe(false);
    await expectCookieOnlySession(res, res.json().user.id as string);
  });

  it("login sets the session cookie and returns no token field", async () => {
    const reg = await post("/auth/register", { email: "login@t", password: "correct-horse", termsAccepted: true });
    const userId = reg.json().user.id as string;

    const res = await post("/auth/login", { email: "login@t", password: "correct-horse" });
    expect(res.json().user).toEqual({ id: userId, email: "login@t" });
    await expectCookieOnlySession(res, userId);
  });

  it("reset-password sets the session cookie and returns no token field", async () => {
    const reg = await post("/auth/register", { email: "reset@t", password: "old-password", termsAccepted: true });
    const userId = reg.json().user.id as string;
    const resetToken = await m.authSvc.createPasswordReset(userId);

    const res = await post("/auth/reset-password", { token: resetToken, password: "brand-new-password" });
    expect(res.json().user).toEqual({ id: userId, email: "reset@t" });
    await expectCookieOnlySession(res, userId);
  });

  it("/auth/me without credentials is anonymous", async () => {
    const res = await me();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ user: null, hasCharacter: false });
  });

  // The pre-switch fallback is gone: a raw session token sent as a Bearer header
  // authenticates nothing, even when it matches a live session row.
  it("a Bearer token is ignored — only the cookie authenticates", async () => {
    const reg = await post("/auth/register", { email: "legacy@t", password: "correct-horse", termsAccepted: true });
    const userId = reg.json().user.id as string;
    const raw = crypto.randomBytes(32).toString("base64url");
    await db.insert(m.dbPkg.sessions).values({
      userId,
      tokenHash: crypto.createHash("sha256").update(raw).digest("hex"),
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const res = await me({ authorization: `Bearer ${raw}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ user: null, hasCharacter: false });

    // The same token as the signed cookie is the real session.
    const viaCookie = await me({ cookie: `massalia_session=${app.signCookie(raw)}` });
    expect(viaCookie.json().user?.id).toBe(userId);
  });
});
