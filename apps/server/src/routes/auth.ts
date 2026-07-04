import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import Redis from "ioredis";
import { and, eq } from "drizzle-orm";
import { createDb, players, users, worlds } from "@massalia/db";
import { clearSession, createSession, getAuthUser } from "../services/auth.js";

const db = createDb();

// Redis client backing the auth rate limiter. Mirrors services/queue.ts fail-fast
// options so a Redis blip never blocks request handlers; when REDIS_URL is unset
// (dev/tests) the limiter falls back to @fastify/rate-limit's in-memory store.
function createLimiterRedis(): Redis | undefined {
  const url = process.env.REDIS_URL;
  if (!url) return undefined;
  const client = new Redis(url, {
    enableOfflineQueue: false,
    connectTimeout: 1000,
    maxRetriesPerRequest: null,
    retryStrategy: (times: number) => (times > 3 ? null : Math.min(times * 100, 500)),
  });
  // Never crash the server because Redis blinked — the limiter fails open (skipOnError).
  client.on("error", (error: Error) => {
    console.warn(`Auth rate-limit Redis error (failing open): ${error.message}`);
  });
  return client;
}

type AuthPayload = {
  email?: string;
  password?: string;
  newsletterOptIn?: boolean;
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function assertAuthPayload(payload: AuthPayload) {
  const email = typeof payload.email === "string" ? normalizeEmail(payload.email) : "";
  const password = typeof payload.password === "string" ? payload.password : "";
  if (!email.includes("@") || email.length > 254) {
    const error = new Error("Enter a valid email address.");
    (error as Error & { statusCode?: number }).statusCode = 400;
    throw error;
  }
  if (password.length < 8) {
    const error = new Error("Password must be at least 8 characters.");
    (error as Error & { statusCode?: number }).statusCode = 400;
    throw error;
  }
  return { email, password };
}

async function hasCharacter(userId: string) {
  const activeWorld = await db.select().from(worlds).where(eq(worlds.status, "active")).limit(1);
  const world = activeWorld[0];
  if (!world) return false;
  const existing = await db
    .select({ id: players.id })
    .from(players)
    .where(and(eq(players.userId, userId), eq(players.worldId, world.id), eq(players.isActive, true)))
    .limit(1);
  return Boolean(existing[0]);
}

export async function authRoutes(app: FastifyInstance) {
  // Per-client-IP limiter, scoped to this auth plugin (global: false) so only the
  // register/login routes below opt in — /logout, /me and everything else stay
  // unlimited. Redis store in prod (shared across instances, survives deploys),
  // in-memory otherwise. skipOnError fails open: a Redis error lets the request
  // through rather than blocking auth (matches queue.ts best-effort-Redis policy).
  const limiterRedis = createLimiterRedis();
  await app.register(rateLimit, {
    global: false,
    max: 8,
    timeWindow: 60_000,
    skipOnError: true,
    ...(limiterRedis ? { redis: limiterRedis } : {}),
    // @fastify/rate-limit throws whatever this returns; include statusCode so
    // Fastify responds 429 (not 500), and expose `error` so the web client (api.ts)
    // shows the friendly message instead of Fastify's generic "Too Many Requests".
    errorResponseBuilder: () => ({ statusCode: 429, error: "Too many attempts. Try again shortly." }),
  });

  app.post("/register", { config: { rateLimit: { max: 8, timeWindow: 60_000 } } }, async (request, reply) => {
    const { email, password } = assertAuthPayload(request.body as AuthPayload);
    const newsletterOptIn = (request.body as AuthPayload).newsletterOptIn === true;
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing[0]) {
      reply.code(409);
      return { error: "Email is already registered." };
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const created = await db
      .insert(users)
      .values({ email, passwordHash, newsletterOptIn })
      .returning({ id: users.id, email: users.email });
    const user = created[0]!;
    const token = await createSession(reply, user.id);
    return { user, hasCharacter: false, token };
  });

  app.post("/login", { config: { rateLimit: { max: 8, timeWindow: 60_000 } } }, async (request, reply) => {
    const { email, password } = assertAuthPayload(request.body as AuthPayload);
    const found = await db.select().from(users).where(eq(users.email, email)).limit(1);
    const user = found[0];
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      reply.code(401);
      return { error: "Invalid email or password." };
    }

    const token = await createSession(reply, user.id);
    return { user: { id: user.id, email: user.email }, hasCharacter: await hasCharacter(user.id), token };
  });

  app.post("/logout", async (request, reply) => {
    await clearSession(request, reply);
    return { ok: true };
  });

  app.get("/me", async (request) => {
    const user = await getAuthUser(request);
    if (!user) return { user: null, hasCharacter: false };
    return { user, hasCharacter: await hasCharacter(user.id) };
  });

  // TODO: Add Discord OAuth callbacks here after Phase 1 email/password auth settles.
  app.get("/discord/todo", async () => ({ todo: "Discord OAuth plugs into auth service later." }));
}
