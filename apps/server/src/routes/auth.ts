import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import Redis from "ioredis";
import { and, eq, sql } from "drizzle-orm";
import { createDb, players, sessions, users, worlds } from "@massalia/db";
import {
  clearSession,
  consumeEmailVerification,
  consumePasswordResetTx,
  createEmailVerification,
  createPasswordReset,
  createSession,
  getAuthUser,
  isEmailVerified,
  requireAuth,
} from "../services/auth.js";
import { sendPasswordResetEmail, sendVerificationEmail } from "../services/email.js";
import { deleteAccount } from "../services/account.js";

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
  termsAccepted?: boolean;
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

// Base for emailed links. Reset/verify links are query params on root (GitHub
// Pages 404s SPA paths), e.g. `${webBaseUrl()}/?verify=TOKEN`.
function webBaseUrl() {
  return (process.env.WEB_ORIGIN ?? "https://playmassalia.com").replace(/\/$/, "");
}

function httpError(message: string, statusCode: number) {
  const error = new Error(message);
  (error as Error & { statusCode?: number }).statusCode = statusCode;
  return error;
}

// The password rule enforced at register/login. Reset re-uses this exact check so
// a reset can never set a password weaker than registration would accept.
function assertPasswordStrength(password: string) {
  if (password.length < 8) {
    throw httpError("Password must be at least 8 characters.", 400);
  }
}

function assertAuthPayload(payload: AuthPayload) {
  const email = typeof payload.email === "string" ? normalizeEmail(payload.email) : "";
  const password = typeof payload.password === "string" ? payload.password : "";
  if (!email.includes("@") || email.length > 254) {
    throw httpError("Enter a valid email address.", 400);
  }
  assertPasswordStrength(password);
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
    // Required consent gate (no storage): registration is the point of agreement.
    if ((request.body as AuthPayload).termsAccepted !== true) {
      reply.code(400);
      return { error: "You must accept the Terms of Service and Privacy Policy to register." };
    }
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

    // Soft verification is non-blocking: a token/email problem must never fail or
    // delay registration. Create the token (fast, local) then fire-and-forget the
    // network send — which itself never throws — so register returns immediately.
    try {
      const verifyToken = await createEmailVerification(user.id);
      void sendVerificationEmail(user.email, `${webBaseUrl()}/?verify=${verifyToken}`).catch(() => {});
    } catch (error) {
      console.error(`Verification token on register failed for ${user.id}: ${error instanceof Error ? error.message : String(error)}`);
    }

    return { user, hasCharacter: false, token };
  });

  app.post("/login", { config: { rateLimit: { max: 8, timeWindow: 60_000 } } }, async (request, reply) => {
    const { email, password } = assertAuthPayload(request.body as AuthPayload);
    const found = await db.select().from(users).where(eq(users.email, email)).limit(1);
    const user = found[0];
    // A deleted account is refused before the bcrypt compare (its hash is a sentinel).
    if (!user || user.deletedAt || !(await bcrypt.compare(password, user.passwordHash))) {
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

  // Account deletion (anonymize-and-detach): immediate, irreversible, no grace period.
  // Re-authenticate with the password, then scrub PII + drop every session + detach
  // players (see services/account.ts). The session row is deleted inside deleteAccount;
  // clearSession only clears the cookie.
  app.post("/delete-account", { config: { rateLimit: { max: 5, timeWindow: 60_000 } } }, async (request, reply) => {
    const authed = await requireAuth(request);
    const body = request.body as AuthPayload | undefined;
    const password = typeof body?.password === "string" ? body.password : "";
    const found = await db.select().from(users).where(eq(users.id, authed.id)).limit(1);
    const user = found[0];
    if (!user || user.deletedAt || !(await bcrypt.compare(password, user.passwordHash))) {
      reply.code(401);
      return { error: "Password is incorrect." };
    }
    await deleteAccount(user.id);
    await clearSession(request, reply);
    return { ok: true };
  });

  // Request a reset link. Enumeration-safe: ALWAYS returns the same generic 200,
  // whether the email is unknown, live, or a deleted tombstone. A token is created
  // and an email attempted only for a live (non-deleted) account; nothing about the
  // outcome (existence or delivery) is reflected in the response. Tight rate limit
  // (3/hour/IP) to blunt reset spam.
  app.post("/forgot-password", { config: { rateLimit: { max: 3, timeWindow: 3_600_000 } } }, async (request, reply) => {
    const body = request.body as { email?: unknown } | undefined;
    const email = typeof body?.email === "string" ? normalizeEmail(body.email) : "";
    if (!email.includes("@") || email.length > 254) {
      reply.code(400);
      return { error: "Enter a valid email address." };
    }

    const found = await db.select().from(users).where(eq(users.email, email)).limit(1);
    const user = found[0];
    if (user && !user.deletedAt) {
      const token = await createPasswordReset(user.id);
      await sendPasswordResetEmail(email, `${webBaseUrl()}/?reset=${token}`);
    }

    return { ok: true, message: "If that email is registered, a reset link is on its way." };
  });

  // Complete a reset. Password is validated (same rule as register) BEFORE the token
  // is touched, so a rejected password leaves the token usable. On success, one
  // transaction consumes the token (atomic single-use), rewrites the password hash,
  // and drops every existing session; a fresh session is then issued and the
  // login-shaped payload returned so the web client reuses its login-success path.
  app.post("/reset-password", { config: { rateLimit: { max: 8, timeWindow: 60_000 } } }, async (request, reply) => {
    const body = request.body as { token?: unknown; password?: unknown } | undefined;
    const token = typeof body?.token === "string" ? body.token : "";
    const password = typeof body?.password === "string" ? body.password : "";
    try {
      assertPasswordStrength(password);
    } catch (error) {
      reply.code(400);
      return { error: (error as Error).message };
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await db.transaction(async (tx) => {
      const consumed = await consumePasswordResetTx(tx, token);
      if (!consumed) return null;
      // Receiving and using a reset link proves ownership of the address, so mark
      // the email verified too (COALESCE keeps an earlier verification timestamp).
      await tx
        .update(users)
        .set({ passwordHash, emailVerifiedAt: sql`COALESCE(${users.emailVerifiedAt}, now())` })
        .where(eq(users.id, consumed.id));
      await tx.delete(sessions).where(eq(sessions.userId, consumed.id));
      return consumed;
    });

    if (!user) {
      reply.code(400);
      return { error: "This reset link is invalid or has expired. Request a new one." };
    }

    const sessionToken = await createSession(reply, user.id);
    return { user: { id: user.id, email: user.email }, hasCharacter: await hasCharacter(user.id), token: sessionToken };
  });

  // Verify an email from the emailed link. No auth: the token IS the proof.
  // Single-use/expiry handled in consumeEmailVerification; invalid → generic 400.
  app.post("/verify-email", { config: { rateLimit: { max: 8, timeWindow: 60_000 } } }, async (request, reply) => {
    const body = request.body as { token?: unknown } | undefined;
    const token = typeof body?.token === "string" ? body.token : "";
    const verified = await consumeEmailVerification(token);
    if (!verified) {
      reply.code(400);
      return { error: "This verification link is invalid or has expired." };
    }
    return { ok: true };
  });

  // Resend the verification email to the logged-in user. 409 if already verified.
  app.post("/resend-verification", { config: { rateLimit: { max: 3, timeWindow: 3_600_000 } } }, async (request, reply) => {
    const authed = await requireAuth(request);
    if (await isEmailVerified(authed.id)) {
      reply.code(409);
      return { error: "Your email is already verified." };
    }
    const token = await createEmailVerification(authed.id);
    await sendVerificationEmail(authed.email, `${webBaseUrl()}/?verify=${token}`);
    return { ok: true, message: "Verification email sent." };
  });

  app.get("/me", async (request) => {
    const user = await getAuthUser(request);
    if (!user) return { user: null, hasCharacter: false };
    return { user, hasCharacter: await hasCharacter(user.id), emailVerified: await isEmailVerified(user.id) };
  });

  // TODO: Add Discord OAuth callbacks here after Phase 1 email/password auth settles.
  app.get("/discord/todo", async () => ({ todo: "Discord OAuth plugs into auth service later." }));
}
