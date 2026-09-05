import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";

// ---------------------------------------------------------------------------
// Global rate limiter (rateLimit.ts) — integration tests against a REAL Postgres,
// guarded to a *_test database (the key generator resolves the session cookie to
// a user id). A minimal Fastify app with the production error handler, the
// limiter (in-memory store) and probe routes stands in for index.ts.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const { registerRateLimit, GLOBAL_MAX_PER_MINUTE, API_MUTATION_MAX_PER_MINUTE, RATE_LIMIT_MESSAGE } = await import("../rateLimit.js");
  const { errorHandler } = await import("../errorHandler.js");
  const { authRoutes } = await import("./auth.js");
  return { dbPkg, registerRateLimit, GLOBAL_MAX_PER_MINUTE, API_MUTATION_MAX_PER_MINUTE, RATE_LIMIT_MESSAGE, errorHandler, authRoutes };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("global rate limit (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let app: FastifyInstance;
  let ipCounter = 0;
  // Each test gets its own client IP so the in-memory counters never bleed across cases.
  const freshIp = () => `10.13.${Math.floor(ipCounter / 256)}.${ipCounter++ % 256}`;

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    app = Fastify({ trustProxy: true });
    app.setErrorHandler(m.errorHandler);
    await app.register(cookie, { secret: "test-session-secret-at-least-32-chars-long" });
    await m.registerRateLimit(app, { redis: null });
    await app.register(m.authRoutes, { prefix: "/auth" });
    app.get("/health", async () => ({ ok: true }));
    app.get("/content/x.json", async () => ({ static: true }));
    app.get("/api/probe", async () => ({ ok: true }));
    app.post("/api/probe", async () => ({ ok: true }));
    app.delete("/api/probe", async () => ({ ok: true }));
    app.post("/me/probe", async () => ({ ok: true }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE sessions, player_characters, players, dynasties, worlds, users CASCADE`);
  });

  // --- helpers ---------------------------------------------------------------
  const send = (method: "GET" | "POST" | "DELETE", url: string, ip: string, extra: Record<string, string> = {}) =>
    app.inject({ method, url, headers: { "x-forwarded-for": ip, ...extra }, ...(method === "GET" ? {} : { payload: {} }) });
  const burst = async (n: number, fire: () => ReturnType<typeof send>) => {
    const out = [];
    for (let i = 0; i < n; i++) out.push(await fire());
    return out;
  };
  const statuses = (responses: { statusCode: number }[]) => responses.map((r) => r.statusCode);

  // A live session cookie for a fresh user (the same signing the server does).
  const sessionCookie = async () => {
    const user = (await db.insert(m.dbPkg.users).values({ email: `u-${crypto.randomUUID()}@t`, passwordHash: "x" }).returning())[0]!;
    const raw = crypto.randomBytes(32).toString("base64url");
    await db.insert(m.dbPkg.sessions).values({ userId: user.id, tokenHash: crypto.createHash("sha256").update(raw).digest("hex"), expiresAt: new Date(Date.now() + 86_400_000) });
    return { userId: user.id, cookie: `massalia_session=${app.signCookie(raw)}` };
  };

  it("advertises the 300/min budget on ordinary routes and 60/min on /api/ mutations", async () => {
    const ip = freshIp();
    const get = await send("GET", "/api/probe", ip);
    expect(get.statusCode).toBe(200);
    expect(get.headers["x-ratelimit-limit"]).toBe(String(m.GLOBAL_MAX_PER_MINUTE));
    const post = await send("POST", "/api/probe", ip);
    expect(post.headers["x-ratelimit-limit"]).toBe(String(m.API_MUTATION_MAX_PER_MINUTE));
    const del = await send("DELETE", "/api/probe", ip);
    expect(del.headers["x-ratelimit-limit"]).toBe(String(m.API_MUTATION_MAX_PER_MINUTE));
    // A mutation outside /api/ keeps the general budget.
    const me = await send("POST", "/me/probe", ip);
    expect(me.headers["x-ratelimit-limit"]).toBe(String(m.GLOBAL_MAX_PER_MINUTE));
  });

  it("the 61st /api/ mutation in a minute is a 429 with the { error } shape", async () => {
    const ip = freshIp();
    const responses = await burst(m.API_MUTATION_MAX_PER_MINUTE + 1, () => send("POST", "/api/probe", ip));
    expect(statuses(responses).filter((s) => s === 200)).toHaveLength(m.API_MUTATION_MAX_PER_MINUTE);
    const last = responses.at(-1)!;
    expect(last.statusCode).toBe(429);
    expect(last.json()).toEqual({ error: m.RATE_LIMIT_MESSAGE });
    // The general budget on the same key is separate: reads still flow.
    expect((await send("GET", "/api/probe", ip)).statusCode).toBe(200);
  });

  it("keys by the session's user id when a valid cookie is present, else by IP", async () => {
    const ip = freshIp();
    const alice = await sessionCookie();
    const bob = await sessionCookie();
    // Alice exhausts her own mutation budget from this IP...
    const hers = await burst(m.API_MUTATION_MAX_PER_MINUTE + 1, () => send("POST", "/api/probe", ip, { cookie: alice.cookie }));
    expect(hers.at(-1)!.statusCode).toBe(429);
    // ...Bob on the very same IP is untouched, and so is an anonymous caller (IP key).
    expect((await send("POST", "/api/probe", ip, { cookie: bob.cookie })).statusCode).toBe(200);
    expect((await send("POST", "/api/probe", ip)).statusCode).toBe(200);
    // Alice from another IP is still out: the budget follows the user, not the address.
    expect((await send("POST", "/api/probe", freshIp(), { cookie: alice.cookie })).statusCode).toBe(429);
    // A forged/unsigned cookie is no session: it falls back to the IP key.
    const forged = await send("POST", "/api/probe", freshIp(), { cookie: "massalia_session=not-a-signed-value" });
    expect(forged.statusCode).toBe(200);
  });

  it("/health and /content/ are exempt", async () => {
    const ip = freshIp();
    const health = await burst(m.GLOBAL_MAX_PER_MINUTE + 5, () => send("GET", "/health", ip));
    expect(new Set(statuses(health))).toEqual(new Set([200]));
    expect(health[0]!.headers["x-ratelimit-limit"]).toBeUndefined();
    const content = await send("GET", "/content/x.json", ip);
    expect(content.statusCode).toBe(200);
    expect(content.headers["x-ratelimit-limit"]).toBeUndefined();
  });

  it("the auth routes keep their stricter IP-keyed limits and message", async () => {
    const ip = freshIp();
    // Rejected payloads still count: the limiter runs before the handler.
    const responses = await burst(9, () => app.inject({ method: "POST", url: "/auth/login", payload: { email: "nope", password: "x" }, headers: { "x-forwarded-for": ip } }));
    expect(statuses(responses).slice(0, 8)).toEqual(Array(8).fill(400));
    expect(responses[8]!.statusCode).toBe(429);
    expect(responses[8]!.json()).toEqual({ error: "Too many attempts. Try again shortly." });
    expect(responses[0]!.headers["x-ratelimit-limit"]).toBe("8");
    // forgot-password: 3 per hour.
    const forgot = await burst(4, () => app.inject({ method: "POST", url: "/auth/forgot-password", payload: { email: "nope" }, headers: { "x-forwarded-for": ip } }));
    expect(statuses(forgot)).toEqual([400, 400, 400, 429]);
  });
});
