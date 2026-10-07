import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify";
import cookie from "@fastify/cookie";

// ---------------------------------------------------------------------------
// The invite promo (invite prompt 1) — integration tests against a REAL Postgres,
// guarded to a *_test database. Set up as auth-cookie-only.test.ts is: the auth
// and lobby routes, the production error handler, a fresh IP per request so the
// auth limiter never trips. Every account is made through POST /auth/register,
// so it carries a real referral code; characters are inserted directly.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const { authRoutes } = await import("./auth.js");
  const { lobbyRoutes } = await import("./lobby.js");
  const { errorHandler } = await import("../errorHandler.js");
  const oligarchy = await import("../services/oligarchy.js");
  const referrals = await import("../services/referrals.js");
  const age = await import("../services/age.js");
  return { dbPkg, authRoutes, lobbyRoutes, errorHandler, oligarchy, referrals, age };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("the invite promo (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let app: FastifyInstance;
  let politics: Awaited<ReturnType<Mods["oligarchy"]["loadPoliticsConfig"]>>;
  let worldId: string;
  let ipCounter = 0;
  const nextIp = () => `10.12.${Math.floor(ipCounter / 256)}.${ipCounter++ % 256}`;
  const savedEnv: Record<string, string | undefined> = {};
  const now = new Date();
  const DAY = 86_400_000;

  beforeAll(async () => {
    savedEnv.RESEND_API_KEY = process.env.RESEND_API_KEY;
    savedEnv.EMAIL_FROM = process.env.EMAIL_FROM;
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    m = await loadModules();
    db = m.dbPkg.createDb();
    politics = await m.oligarchy.loadPoliticsConfig();
    await m.age.loadAgeConfig();
    app = Fastify({ trustProxy: true });
    app.setErrorHandler(m.errorHandler);
    await app.register(cookie, { secret: "test-session-secret-at-least-32-chars-long" });
    await app.register(m.authRoutes, { prefix: "/auth" });
    await app.register(m.lobbyRoutes, { prefix: "/api/lobby" });
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
    await db.insert(m.dbPkg.houses).values({ slug: "test-house", name: "Test House", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" }).onConflictDoNothing();
    worldId = (
      await db.insert(m.dbPkg.worlds).values({ name: "Invite Test", seed: "invite-test", startedAt: new Date(now.getTime() - 10 * 60_000), endsAt: new Date(now.getTime() + 182 * DAY), status: "active" }).returning()
    )[0]!.id;
    await m.dbPkg.ensureChamberSeats(worldId, politics.chamber);
  });

  // --- helpers ---------------------------------------------------------------
  const cookieHeader = (res: LightMyRequestResponse) =>
    (([] as string[]).concat(res.headers["set-cookie"] ?? []).find((c) => c.startsWith("massalia_session=")) ?? "").split(";")[0]!;
  async function register(email: string, referralCode?: string) {
    const payload: Record<string, unknown> = { email, password: "correct-horse", termsAccepted: true };
    if (referralCode !== undefined) payload.referralCode = referralCode;
    const res = await app.inject({ method: "POST", url: "/auth/register", payload, headers: { "x-forwarded-for": nextIp() } });
    expect(res.statusCode).toBe(200);
    return { res, id: res.json().user.id as string, cookie: cookieHeader(res) };
  }
  const codeOf = async (userId: string) => (await db.select({ code: m.dbPkg.users.referralCode }).from(m.dbPkg.users).where(eq(m.dbPkg.users.id, userId)))[0]!.code;
  const referralRows = () => db.select().from(m.dbPkg.referrals).orderBy(m.dbPkg.referrals.createdAt);

  // --- recording a referral at sign-up (commit 3) ------------------------------
  it("a sign-up with the inviter's code in lower case records one referral, and the response says nothing of it", async () => {
    const inviter = await register("inviter@t");
    const code = await codeOf(inviter.id);
    const invitee = await register("invitee@t", code.toLowerCase());
    expect(Object.keys(invitee.res.json()).sort()).toEqual(["hasCharacter", "user"]);

    const rows = await referralRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ inviteeUserId: invitee.id, inviterUserId: inviter.id, worldId, paidAt: null, paidCharacterId: null });

    const inviteeCode = await codeOf(invitee.id);
    expect(code).toMatch(m.referrals.REFERRAL_CODE);
    expect(inviteeCode).toMatch(m.referrals.REFERRAL_CODE);
    expect(inviteeCode).not.toBe(code);
  });

  it("a malformed code, an unknown code, a banned inviter's code and a deleted inviter's code each sign up as normal and record nothing", async () => {
    const banned = await register("banned@t");
    const deleted = await register("deleted@t");
    const bannedCode = await codeOf(banned.id);
    const deletedCode = await codeOf(deleted.id);
    await db.update(m.dbPkg.users).set({ bannedAt: now, banReason: "x" }).where(eq(m.dbPkg.users.id, banned.id));
    await db.update(m.dbPkg.users).set({ deletedAt: now }).where(eq(m.dbPkg.users.id, deleted.id));

    await register("a@t", "XYZ");
    await register("b@t", "FEDCBA9876"); // well formed, nobody's
    await register("c@t", bannedCode);
    await register("d@t", deletedCode);
    expect(await referralRows()).toHaveLength(0);
  });

  it("with the world ended, a sign-up with a good code records nothing", async () => {
    const inviter = await register("inviter@t");
    const code = await codeOf(inviter.id);
    await db.update(m.dbPkg.worlds).set({ status: "ended" }).where(eq(m.dbPkg.worlds.id, worldId));
    await register("late@t", code);
    expect(await referralRows()).toHaveLength(0);
  });

  it("ten sign-ups count per inviter per world; a referral in another, ended world does not; the eleventh records nothing", async () => {
    const inviter = await register("inviter@t");
    const code = await codeOf(inviter.id);
    const old = (
      await db.insert(m.dbPkg.worlds).values({ name: "Old World", seed: "old", startedAt: new Date(now.getTime() - 400 * DAY), endsAt: new Date(now.getTime() - 200 * DAY), status: "ended" }).returning()
    )[0]!;
    const earlier = await register("earlier@t");
    await db.insert(m.dbPkg.referrals).values({ inviteeUserId: earlier.id, inviterUserId: inviter.id, worldId: old.id });

    for (let i = 1; i <= 10; i++) await register(`invitee${i}@t`, code);
    const inActive = (await referralRows()).filter((r) => r.worldId === worldId);
    expect(inActive).toHaveLength(10);

    await register("eleventh@t", code);
    expect((await referralRows()).filter((r) => r.worldId === worldId)).toHaveLength(10);
    expect(await referralRows()).toHaveLength(11);
  });

  it("with nine recorded, two sign-ups sent together end with exactly ten", async () => {
    const inviter = await register("inviter@t");
    const code = await codeOf(inviter.id);
    for (let i = 1; i <= 9; i++) await register(`invitee${i}@t`, code);
    await Promise.all([register("race-a@t", code), register("race-b@t", code)]);
    expect((await referralRows()).filter((r) => r.worldId === worldId)).toHaveLength(10);
  });
});
