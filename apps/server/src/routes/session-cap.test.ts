import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify";
import cookie from "@fastify/cookie";

// ---------------------------------------------------------------------------
// Per-user session cap: every login prunes that user's sessions down to the
// newest 10 (integration; *_test database; mirrors auth-cookie-only.test.ts).
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const { authRoutes } = await import("./auth.js");
  return { dbPkg, authRoutes };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("session cap on login (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let app: FastifyInstance;
  let ipCounter = 0;
  const nextIp = () => `10.17.${Math.floor(ipCounter / 256)}.${ipCounter++ % 256}`;
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
    await db.execute(sql`TRUNCATE TABLE email_verification_tokens, sessions, player_characters, players, dynasties, worlds, users CASCADE`);
  });

  const post = (url: string, payload: Record<string, unknown>) => app.inject({ method: "POST", url, payload, headers: { "x-forwarded-for": nextIp() } });
  const cookieOf = (res: LightMyRequestResponse) => (([] as string[]).concat(res.headers["set-cookie"] ?? []).find((c) => c.startsWith("massalia_session=")) ?? "").split(";")[0]!;
  const meWith = (cookieHeader: string) => app.inject({ method: "GET", url: "/auth/me", headers: { "x-forwarded-for": nextIp(), cookie: cookieHeader } });

  it("the 11th login evicts the oldest session; the newest 10 keep working", async () => {
    const reg = await post("/auth/register", { email: "many@t", password: "correct-horse", termsAccepted: true });
    expect(reg.statusCode).toBe(200);
    const userId = reg.json().user.id as string;
    const cookies = [cookieOf(reg)]; // registration opened session #1
    for (let i = 0; i < 10; i++) {
      const login = await post("/auth/login", { email: "many@t", password: "correct-horse" });
      expect(login.statusCode).toBe(200);
      cookies.push(cookieOf(login));
    }
    // 11 sessions were opened; only the newest 10 remain.
    const rows = await db.select({ id: m.dbPkg.sessions.id }).from(m.dbPkg.sessions).where(eq(m.dbPkg.sessions.userId, userId));
    expect(rows).toHaveLength(10);
    expect((await meWith(cookies[0]!)).json().user).toBeNull(); // the oldest (registration) is gone
    expect((await meWith(cookies[1]!)).json().user?.id).toBe(userId); // #2 survived
    expect((await meWith(cookies[10]!)).json().user?.id).toBe(userId); // the newest works
  });
});
