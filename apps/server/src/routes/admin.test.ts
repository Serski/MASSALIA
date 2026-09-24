import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify";
import cookie from "@fastify/cookie";

// ---------------------------------------------------------------------------
// Anti-multi-account + admin tooling — integration tests against a REAL Postgres,
// guarded to a *_test database. Covers: session/auth-event origin, the verified-
// email gates, bans blocking access with the reason, requireAdmin (401/403), and
// one admin_audit row per admin call with the action's effect.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const { authRoutes } = await import("./auth.js");
  const { adminRoutes } = await import("./admin.js");
  const { characterRoutes } = await import("./characters.js");
  const { interactionRoutes } = await import("./interactions.js");
  const { errorHandler } = await import("../errorHandler.js");
  const age = await import("../services/age.js");
  const interactionsSvc = await import("../services/interactions.js");
  const buildings = await import("../services/buildings.js");
  const barracks = await import("../services/barracks.js");
  return { dbPkg, authRoutes, adminRoutes, characterRoutes, interactionRoutes, errorHandler, age, interactionsSvc, buildings, barracks };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("admin tooling and account gates (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let app: FastifyInstance;
  let worldId: string;
  const savedEnv: Record<string, string | undefined> = {};
  const UA = "MassaliaTest/1.0";

  beforeAll(async () => {
    savedEnv.RESEND_API_KEY = process.env.RESEND_API_KEY;
    savedEnv.EMAIL_FROM = process.env.EMAIL_FROM;
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    m = await loadModules();
    db = m.dbPkg.createDb();
    await m.age.loadAgeConfig();
    await m.interactionsSvc.loadInteractionsConfig();
    // The goods and household edits settle the player's economy first.
    await m.buildings.loadBuildingsContent();
    await m.buildings.loadPopsContent();
    await m.barracks.loadBarracksContent();
    app = Fastify({ trustProxy: true });
    app.setErrorHandler(m.errorHandler);
    await app.register(cookie, { secret: "test-session-secret-at-least-32-chars-long" });
    await app.register(m.authRoutes, { prefix: "/auth" });
    await app.register(m.adminRoutes, { prefix: "/admin" });
    await app.register(m.characterRoutes, { prefix: "/characters" });
    await app.register(m.interactionRoutes, { prefix: "/api/interactions" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    process.env.RESEND_API_KEY = savedEnv.RESEND_API_KEY;
    process.env.EMAIL_FROM = savedEnv.EMAIL_FROM;
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE admin_audit, auth_events, effect_log, resources, interactions, email_verification_tokens, sessions, player_characters, dynasties, players, users, worlds CASCADE`);
    await db.insert(m.dbPkg.houses).values({ slug: "test-house", name: "House Test", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" }).onConflictDoNothing();
    worldId = (await db.insert(m.dbPkg.worlds).values({ name: "Admin Test", seed: "atest", startedAt: new Date(), endsAt: new Date(Date.now() + 182 * 86_400_000), status: "active" }).returning())[0]!.id;
  });

  // --- helpers ---------------------------------------------------------------
  const cookieOf = (res: LightMyRequestResponse) => (([] as string[]).concat(res.headers["set-cookie"] ?? []).find((c) => c.startsWith("massalia_session=")) ?? "").split(";")[0]!;
  const call = (method: "GET" | "POST", url: string, opts: { cookie?: string; ip?: string; payload?: Record<string, unknown> } = {}) =>
    app.inject({ method, url, payload: opts.payload, headers: { "x-forwarded-for": opts.ip ?? "203.0.113.10", "user-agent": UA, ...(opts.cookie ? { cookie: opts.cookie } : {}) } });

  // Register a user (from an IP), returning its id + session cookie.
  async function register(email: string, ip = "203.0.113.10") {
    const res = await call("POST", "/auth/register", { ip, payload: { email, password: "correct-horse", termsAccepted: true } });
    expect(res.statusCode).toBe(200);
    return { id: res.json().user.id as string, cookie: cookieOf(res), email };
  }
  const verify = (userId: string) => db.update(m.dbPkg.users).set({ emailVerifiedAt: new Date() }).where(eq(m.dbPkg.users.id, userId));
  const makeAdmin = (userId: string) => db.update(m.dbPkg.users).set({ isAdmin: true }).where(eq(m.dbPkg.users.id, userId));
  async function admin() {
    const a = await register(`admin-${crypto.randomUUID()}@t`, "203.0.113.99");
    await makeAdmin(a.id);
    return a;
  }
  // A player + character for a user, so the character endpoints have a target.
  async function characterFor(userId: string, name: string, drachmae = 500) {
    const player = (await db.insert(m.dbPkg.players).values({ worldId, userId, name, color: "#123456", houseSlug: "test-house" }).returning())[0]!;
    const character = (await db.insert(m.dbPkg.playerCharacters).values({ playerId: player.id, worldId, houseSlug: "test-house", classId: "trader", drachmae, startAge: 30, deathAge: 90 }).returning())[0]!;
    return { playerId: player.id, characterId: character.id };
  }
  const auditRows = () => db.select().from(m.dbPkg.adminAudit).orderBy(m.dbPkg.adminAudit.createdAt);
  const userRow = async (id: string) => (await db.select().from(m.dbPkg.users).where(eq(m.dbPkg.users.id, id)).limit(1))[0]!;

  // --- session + auth-event origin -------------------------------------------
  it("register and login record the IP and user agent on the session and in auth_events", async () => {
    const u = await register("origin@t", "198.51.100.7");
    const login = await call("POST", "/auth/login", { ip: "198.51.100.8", payload: { email: "origin@t", password: "correct-horse" } });
    expect(login.statusCode).toBe(200);
    const sessions = await db.select().from(m.dbPkg.sessions).where(eq(m.dbPkg.sessions.userId, u.id)).orderBy(m.dbPkg.sessions.createdAt);
    expect(sessions.map((s) => [s.ip, s.userAgent])).toEqual([["198.51.100.7", UA], ["198.51.100.8", UA]]);
    const events = await db.select().from(m.dbPkg.authEvents).where(eq(m.dbPkg.authEvents.userId, u.id)).orderBy(m.dbPkg.authEvents.createdAt);
    expect(events.map((e) => [e.kind, e.ip, e.userAgent])).toEqual([["register", "198.51.100.7", UA], ["login", "198.51.100.8", UA]]);
  });

  // --- gates -------------------------------------------------------------------
  it("character creation and gifts need a verified email (403 first, then the usual validation)", async () => {
    const u = await register("unverified@t");
    const create = await call("POST", "/characters", { cookie: u.cookie, payload: {} });
    expect(create.statusCode).toBe(403);
    expect(create.json()).toEqual({ error: "Verify your email before creating a character." });
    const give = await call("POST", "/api/interactions/give", { cookie: u.cookie, payload: { targetCharacterId: crypto.randomUUID(), amount: 5 } });
    expect(give.statusCode).toBe(403);
    expect(give.json()).toEqual({ error: "Verify your email before sending drachmae." });

    await verify(u.id);
    // Past the gate: creation now fails on the empty payload (400), the gift on "no character" (404).
    expect((await call("POST", "/characters", { cookie: u.cookie, payload: {} })).statusCode).toBe(400);
    expect((await call("POST", "/api/interactions/give", { cookie: u.cookie, payload: { targetCharacterId: crypto.randomUUID(), amount: 5 } })).statusCode).toBe(404);
  });

  // --- bans ----------------------------------------------------------------------
  it("a banned user is 401 on authed routes, sees the reason on /auth/me and at login, and is back after unban", async () => {
    const u = await register("banned@t");
    await verify(u.id);
    await db.update(m.dbPkg.users).set({ bannedAt: new Date(), banReason: "Multi-accounting" }).where(eq(m.dbPkg.users.id, u.id));

    const me = await call("GET", "/auth/me", { cookie: u.cookie });
    expect(me.statusCode).toBe(403);
    expect(me.json()).toEqual({ error: "This account has been banned. Reason: Multi-accounting" });
    expect((await call("POST", "/characters", { cookie: u.cookie, payload: {} })).statusCode).toBe(401);
    const login = await call("POST", "/auth/login", { payload: { email: "banned@t", password: "correct-horse" } });
    expect(login.statusCode).toBe(403);
    expect(login.json().error).toMatch(/banned.*Multi-accounting/);

    await db.update(m.dbPkg.users).set({ bannedAt: null, banReason: null }).where(eq(m.dbPkg.users.id, u.id));
    expect((await call("POST", "/auth/login", { payload: { email: "banned@t", password: "correct-horse" } })).statusCode).toBe(200);
  });

  // --- requireAdmin ------------------------------------------------------------------
  it("/admin refuses anonymous (401) and non-admin (403) callers, and writes no audit row for them", async () => {
    const u = await register("plain@t");
    expect((await call("GET", "/admin/users")).statusCode).toBe(401);
    const denied = await call("GET", "/admin/users", { cookie: u.cookie });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ error: "Admin access required." });
    expect((await call("POST", `/admin/users/${u.id}/ban`, { cookie: u.cookie, payload: { reason: "x" } })).statusCode).toBe(403);
    expect(await auditRows()).toHaveLength(0);
  });

  it("a banned admin is refused like any banned user", async () => {
    const a = await admin();
    await db.update(m.dbPkg.users).set({ bannedAt: new Date(), banReason: "r" }).where(eq(m.dbPkg.users.id, a.id));
    expect((await call("GET", "/admin/users", { cookie: a.cookie })).statusCode).toBe(401);
  });

  // --- manual verification -------------------------------------------------------------
  it("admin verify clears the character gate, is idempotent, and audits every call", async () => {
    const a = await admin();
    const stuck = await register("stuck@t", "203.0.113.60");
    expect((await userRow(stuck.id)).emailVerifiedAt).toBeNull();
    expect((await call("POST", "/characters", { cookie: stuck.cookie, payload: {} })).statusCode).toBe(403);

    const before = (await auditRows()).length;
    const verified = await call("POST", `/admin/users/${stuck.id}/verify`, { cookie: a.cookie, payload: { reason: "link expired" } });
    expect(verified.statusCode).toBe(200);
    expect(verified.json().ok).toBe(true);
    const at = (await userRow(stuck.id)).emailVerifiedAt;
    expect(at).not.toBeNull();

    const rows = (await auditRows()).slice(before);
    expect(rows.map((r) => r.action)).toEqual(["users.verify"]);
    expect(rows[0]!.targetUserId).toBe(stuck.id);
    expect(rows[0]!.detail).toMatchObject({ reason: "link expired", previouslyVerifiedAt: null });

    // Past the gate: creation now fails on the empty payload.
    expect((await call("POST", "/characters", { cookie: stuck.cookie, payload: {} })).statusCode).toBe(400);

    // Idempotent — 200, the timestamp is untouched, and it still audits (reason optional).
    const again = await call("POST", `/admin/users/${stuck.id}/verify`, { cookie: a.cookie, payload: {} });
    expect(again.statusCode).toBe(200);
    expect((await userRow(stuck.id)).emailVerifiedAt).toEqual(at);
    expect((await auditRows()).slice(before).map((r) => r.action)).toEqual(["users.verify", "users.verify"]);
  });

  // --- every admin action: its effect + one audit row ----------------------------------
  it("each admin call does its job and writes exactly one admin_audit row", async () => {
    const a = await admin();
    const target = await register("target@t", "203.0.113.50");
    await verify(target.id);
    const { playerId, characterId } = await characterFor(target.id, "Kleitos", 500);
    const other = await register("other@t", "203.0.113.50"); // same IP as the target → cluster
    await register("stranger@t", "203.0.113.77"); // different IP → not in the cluster
    await characterFor(other.id, "Taken");
    const H = { cookie: a.cookie };

    // list + search
    const list = await call("GET", "/admin/users?q=target", H);
    expect(list.statusCode).toBe(200);
    expect(list.json().users.map((u: { email: string }) => u.email)).toEqual(["target@t"]);
    expect(list.json().users[0].characters[0]).toMatchObject({ characterId, name: "Kleitos", drachmae: 500 });
    expect(list.json().users[0].lastIp).toBe("203.0.113.50");
    const byName = await call("GET", "/admin/users?q=klei", H);
    expect(byName.json().users.map((u: { email: string }) => u.email)).toEqual(["target@t"]);

    // cluster
    const cluster = await call("GET", `/admin/users/${target.id}/cluster`, H);
    expect(cluster.statusCode).toBe(200);
    expect(cluster.json().ips).toEqual(["203.0.113.50"]);
    expect(cluster.json().related.map((r: { email: string; sharedIps: string[] }) => [r.email, r.sharedIps])).toEqual([["other@t", ["203.0.113.50"]]]);

    // ban (reason required; sessions end) / unban
    expect((await call("POST", `/admin/users/${target.id}/ban`, { ...H, payload: {} })).statusCode).toBe(400);
    const ban = await call("POST", `/admin/users/${target.id}/ban`, { ...H, payload: { reason: "Second account" } });
    expect(ban.statusCode).toBe(200);
    expect((await userRow(target.id)).banReason).toBe("Second account");
    expect(await db.select().from(m.dbPkg.sessions).where(eq(m.dbPkg.sessions.userId, target.id))).toHaveLength(0);
    expect((await call("POST", `/admin/users/${a.id}/ban`, { ...H, payload: { reason: "me" } })).statusCode).toBe(409); // not yourself
    const unban = await call("POST", `/admin/users/${target.id}/unban`, { ...H, payload: { reason: "Appeal accepted" } });
    expect(unban.statusCode).toBe(200);
    expect((await userRow(target.id)).bannedAt).toBeNull();

    // delete sessions
    await call("POST", "/auth/login", { payload: { email: "target@t", password: "correct-horse" } });
    const drop = await call("POST", `/admin/users/${target.id}/sessions/delete`, H);
    expect(drop.json()).toEqual({ ok: true, deleted: 1 });

    // drachmae: relative, never below zero, logged to effect_log
    const minus = await call("POST", `/admin/characters/${characterId}/drachmae`, { ...H, payload: { delta: -200, reason: "exploit refund" } });
    expect(minus.json()).toMatchObject({ ok: true, drachmae: 300 });
    expect((await call("POST", `/admin/characters/${characterId}/drachmae`, { ...H, payload: { delta: -301, reason: "too much" } })).statusCode).toBe(409);
    const effects = await db.select().from(m.dbPkg.effectLog).where(eq(m.dbPkg.effectLog.characterId, characterId));
    expect(effects).toHaveLength(1);
    expect(effects[0]!.detail).toMatchObject({ delta: -200, reason: "exploit refund", adminUserId: a.id });

    // rename: sanitiser + uniqueness
    expect((await call("POST", `/admin/characters/${characterId}/rename`, { ...H, payload: { name: "1234" } })).statusCode).toBe(400);
    expect((await call("POST", `/admin/characters/${characterId}/rename`, { ...H, payload: { name: "taken" } })).statusCode).toBe(409);
    const renamed = await call("POST", `/admin/characters/${characterId}/rename`, { ...H, payload: { name: "  Kleitos\u200B II  " } });
    expect(renamed.json()).toMatchObject({ ok: true, name: "Kleitos II" });
    expect((await db.select().from(m.dbPkg.players).where(eq(m.dbPkg.players.id, playerId)))[0]!.name).toBe("Kleitos II");

    // reads
    expect((await call("GET", `/admin/characters/${characterId}/effects`, H)).json().effects).toHaveLength(1);
    expect((await call("GET", `/admin/characters/${characterId}/interactions`, H)).json().interactions).toEqual([]);

    // One audit row per successful call, in order, all by this admin; refused
    // calls (400 reason, 409s) write none.
    const rows = await auditRows();
    expect(rows.map((r) => r.action)).toEqual([
      "users.list", "users.list", "users.cluster", "users.ban", "users.unban", "users.sessions.delete",
      "characters.drachmae", "characters.rename", "characters.effects", "characters.interactions",
    ]);
    expect(new Set(rows.map((r) => r.adminUserId))).toEqual(new Set([a.id]));
    expect(rows.find((r) => r.action === "users.ban")!.targetUserId).toBe(target.id);
    expect(rows.find((r) => r.action === "characters.rename")!.detail).toMatchObject({ from: "Kleitos", to: "Kleitos II" });
  });

  // --- stats and inventory ----------------------------------------------------------------
  it("the sheet lists stats, goods and household; each adjust is relative, guarded, logged and audited", async () => {
    const a = await admin();
    const target = await register("sheet@t");
    const { playerId, characterId } = await characterFor(target.id, "Pytheas");
    const { playerCharacters, playerPops, resources, effectLog } = m.dbPkg;
    await db.update(playerCharacters).set({ prestige: 95, devotion: 3 }).where(eq(playerCharacters.id, characterId));
    await db.insert(resources).values({ scope: "player", scopeId: playerId, type: "grain", amount: "4.5", ratePerSecond: "0", lastUpdatedAt: new Date() });
    await db.insert(playerPops).values({ worldId, ownerPlayerId: playerId, popType: "slave", count: 2 });
    const H = { cookie: a.cookie };
    const post = (what: string, payload: Record<string, unknown>) => call("POST", `/admin/characters/${characterId}/${what}`, { ...H, payload });
    type Good = { type: string; label: string; amount: number };
    type Pop = { type: string; count: number; max: number | null };

    // The list line carries the four stats beside the drachmae.
    const list = await call("GET", "/admin/users?q=sheet", H);
    expect(list.json().users[0].characters[0]).toMatchObject({ drachmae: 500, prestige: 95, devotion: 3, militia: 0, intelligence: 0 });

    // The sheet: every content good and pop type, held or not.
    const sheet = (await call("GET", `/admin/characters/${characterId}/sheet`, H)).json();
    expect(sheet).toMatchObject({ characterId, name: "Pytheas", drachmae: 500, stats: { prestige: 95, devotion: 3, militia: 0, intelligence: 0 } });
    expect(sheet.goods.find((g: Good) => g.type === "grain")).toEqual({ type: "grain", label: "Wheat", amount: 4.5 });
    expect(sheet.goods.find((g: Good) => g.type === "iron")).toEqual({ type: "iron", label: "Iron", amount: 0 });
    expect(sheet.pops.find((p: Pop) => p.type === "slave")).toMatchObject({ count: 2, max: null });
    expect(sheet.pops.find((p: Pop) => p.type === "physician")).toMatchObject({ count: 0, max: 1 });

    // Stats: refused, not clamped, outside 0..100; a known stat and a reason are required.
    expect((await post("stats", { stat: "prestige", delta: 5, reason: "event bug" })).json()).toMatchObject({ ok: true, stat: "prestige", value: 100 });
    const over = await post("stats", { stat: "prestige", delta: 1, reason: "x" });
    expect(over.statusCode).toBe(409);
    expect(over.json()).toEqual({ error: "Prestige is 100; +1 would take it outside 0–100." });
    expect((await post("stats", { stat: "devotion", delta: -4, reason: "x" })).statusCode).toBe(409);
    expect((await post("stats", { stat: "drachmae", delta: 1, reason: "x" })).statusCode).toBe(400);
    expect((await post("stats", { stat: "militia", delta: 2 })).statusCode).toBe(400);
    expect((await post("stats", { stat: "militia", delta: 1.5, reason: "x" })).statusCode).toBe(400);

    // Goods: any content good, never below zero.
    expect((await post("goods", { good: "iron", delta: 10, reason: "lost cargo" })).json()).toMatchObject({ ok: true, good: "iron", amount: 10 });
    expect((await post("goods", { good: "grain", delta: -4, reason: "dupe" })).json()).toMatchObject({ ok: true, amount: 0.5 });
    const short = await post("goods", { good: "grain", delta: -1, reason: "x" });
    expect(short.statusCode).toBe(409);
    expect(short.json()).toEqual({ error: "They hold only 0 Wheat." });
    expect((await post("goods", { good: "gold", delta: 1, reason: "x" })).statusCode).toBe(400);
    expect((await post("goods", { good: "constructor", delta: 1, reason: "x" })).statusCode).toBe(400);

    // Household: never below zero, never above a type's cap; a missing row is created.
    expect((await post("pops", { popType: "slave", delta: -3, reason: "x" })).statusCode).toBe(409);
    expect((await post("pops", { popType: "slave", delta: -2, reason: "freed" })).json()).toMatchObject({ ok: true, popType: "slave", count: 0 });
    expect((await post("pops", { popType: "physician", delta: 2, reason: "x" })).statusCode).toBe(409);
    expect((await post("pops", { popType: "physician", delta: 1, reason: "support" })).json()).toMatchObject({ ok: true, count: 1 });
    expect((await post("pops", { popType: "hydra", delta: 1, reason: "x" })).statusCode).toBe(400);

    const after = (await call("GET", `/admin/characters/${characterId}/sheet`, H)).json();
    expect(after.stats.prestige).toBe(100);
    expect(after.goods.find((g: Good) => g.type === "iron").amount).toBe(10);
    expect(after.pops.find((p: Pop) => p.type === "physician").count).toBe(1);

    // One effect_log row per applied edit; refused edits write nothing.
    const effects = await db.select().from(effectLog).where(eq(effectLog.characterId, characterId)).orderBy(effectLog.createdAt);
    expect(effects.map((e) => [e.kind, e.detail])).toEqual([
      ["admin_adjust_stat", { stat: "prestige", delta: 5, reason: "event bug", adminUserId: a.id }],
      ["admin_adjust_goods", { good: "iron", delta: 10, reason: "lost cargo", adminUserId: a.id }],
      ["admin_adjust_goods", { good: "grain", delta: -4, reason: "dupe", adminUserId: a.id }],
      ["admin_adjust_pops", { popType: "slave", delta: -2, reason: "freed", adminUserId: a.id }],
      ["admin_adjust_pops", { popType: "physician", delta: 1, reason: "support", adminUserId: a.id }],
    ]);
    const rows = await auditRows();
    expect(rows.map((r) => r.action)).toEqual([
      "users.list", "characters.sheet", "characters.stat", "characters.goods", "characters.goods", "characters.pops", "characters.pops", "characters.sheet",
    ]);
    expect(rows.find((r) => r.action === "characters.stat")!).toMatchObject({ targetUserId: target.id, detail: { characterId, stat: "prestige", delta: 5, value: 100 } });

    // A non-admin reaches none of it.
    expect((await call("GET", `/admin/characters/${characterId}/sheet`, { cookie: target.cookie })).statusCode).toBe(403);
    expect((await call("POST", `/admin/characters/${characterId}/stats`, { cookie: target.cookie, payload: { stat: "prestige", delta: -1, reason: "x" } })).statusCode).toBe(403);
  });
});
