import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { and, eq, sql } from "drizzle-orm";
import { createDb, players, sessions, users, worlds } from "@massalia/db";
import {
  banMessage,
  clearSession,
  consumeEmailVerification,
  consumePasswordResetTx,
  createEmailVerification,
  createPasswordReset,
  createSession,
  getSessionState,
  isEmailVerified,
  recordAuthEvent,
  requireAuth,
} from "../services/auth.js";
import { sendPasswordResetEmail, sendVerificationEmail } from "../services/email.js";
import { deleteAccount } from "../services/account.js";
import { byIp, tooManyRequests } from "../rateLimit.js";

const db = createDb();

// The auth routes' own, stricter limits, layered on the global limiter registered
// in index.ts (rateLimit.ts). Per-route config replaces the global budget for that
// route. Keyed by client IP (not session) and with the auth-specific message, so
// they behave exactly as before the global limiter existed.
const AUTH_RATE_LIMIT_MESSAGE = "Too many attempts. Try again shortly.";
const authLimit = (max: number, timeWindow: number) => ({
  rateLimit: { max, timeWindow, keyGenerator: byIp, errorResponseBuilder: tooManyRequests(AUTH_RATE_LIMIT_MESSAGE) },
});

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
// a reset can never set a password weaker than registration would accept. The
// upper bound keeps the rule honest — bcrypt silently hashes only the first 72
// bytes — and bounds the hashing work per request.
const PASSWORD_MIN_CHARS = 8;
const PASSWORD_MAX_CHARS = 128;
function assertPasswordStrength(password: string) {
  if (password.length < PASSWORD_MIN_CHARS) {
    throw httpError(`Password must be at least ${PASSWORD_MIN_CHARS} characters.`, 400);
  }
  if (password.length > PASSWORD_MAX_CHARS) {
    throw httpError(`Password must be at most ${PASSWORD_MAX_CHARS} characters.`, 400);
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
  app.post("/register", { config: authLimit(8, 60_000) }, async (request, reply) => {
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
    await createSession(request, reply, user.id);
    await recordAuthEvent(user.id, "register", request);

    // Soft verification is non-blocking: a token/email problem must never fail or
    // delay registration. Create the token (fast, local) then fire-and-forget the
    // network send — which itself never throws — so register returns immediately.
    try {
      const verifyToken = await createEmailVerification(user.id);
      void sendVerificationEmail(user.email, `${webBaseUrl()}/?verify=${verifyToken}`).catch(() => {});
    } catch (error) {
      console.error(`Verification token on register failed for ${user.id}: ${error instanceof Error ? error.message : String(error)}`);
    }

    return { user, hasCharacter: false };
  });

  app.post("/login", { config: authLimit(8, 60_000) }, async (request, reply) => {
    const { email, password } = assertAuthPayload(request.body as AuthPayload);
    const found = await db.select().from(users).where(eq(users.email, email)).limit(1);
    const user = found[0];
    // A deleted account is refused before the bcrypt compare (its hash is a sentinel).
    if (!user || user.deletedAt || !(await bcrypt.compare(password, user.passwordHash))) {
      reply.code(401);
      return { error: "Invalid email or password." };
    }
    // Right password, banned account: say why, open nothing.
    if (user.bannedAt) {
      reply.code(403);
      return { error: banMessage(user.banReason) };
    }

    await createSession(request, reply, user.id);
    await recordAuthEvent(user.id, "login", request);
    return { user: { id: user.id, email: user.email }, hasCharacter: await hasCharacter(user.id) };
  });

  app.post("/logout", async (request, reply) => {
    await clearSession(request, reply);
    return { ok: true };
  });

  // Account deletion (anonymize-and-detach): immediate, irreversible, no grace period.
  // Re-authenticate with the password, then scrub PII + drop every session + detach
  // players (see services/account.ts). The session row is deleted inside deleteAccount;
  // clearSession only clears the cookie.
  app.post("/delete-account", { config: authLimit(5, 60_000) }, async (request, reply) => {
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
  // outcome (existence or delivery) is reflected in the response — and the send is
  // fire-and-forget (as on /register), so response time does not reveal whether an
  // address is registered. Tight rate limit (3/hour/IP) to blunt reset spam.
  app.post("/forgot-password", { config: authLimit(3, 3_600_000) }, async (request, reply) => {
    const body = request.body as { email?: unknown } | undefined;
    const email = typeof body?.email === "string" ? normalizeEmail(body.email) : "";
    if (!email.includes("@") || email.length > 254) {
      reply.code(400);
      return { error: "Enter a valid email address." };
    }

    const found = await db.select().from(users).where(eq(users.email, email)).limit(1);
    const user = found[0];
    if (user && !user.deletedAt) {
      try {
        const token = await createPasswordReset(user.id);
        void sendPasswordResetEmail(email, `${webBaseUrl()}/?reset=${token}`).catch(() => {});
      } catch (error) {
        console.error(`Reset token on forgot-password failed for ${user.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return { ok: true, message: "If that email is registered, a reset link is on its way." };
  });

  // Complete a reset. Password is validated (same rule as register) BEFORE the token
  // is touched, so a rejected password leaves the token usable. On success, one
  // transaction consumes the token (atomic single-use), rewrites the password hash,
  // and drops every existing session; a fresh session cookie is then issued and
  // the login-shaped payload returned so the web client reuses its login-success path.
  app.post("/reset-password", { config: authLimit(8, 60_000) }, async (request, reply) => {
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

    await createSession(request, reply, user.id);
    await recordAuthEvent(user.id, "reset", request);
    return { user: { id: user.id, email: user.email }, hasCharacter: await hasCharacter(user.id) };
  });

  // Verify an email from the emailed link. No auth: the token IS the proof.
  // Single-use/expiry handled in consumeEmailVerification; invalid → generic 400.
  app.post("/verify-email", { config: authLimit(8, 60_000) }, async (request, reply) => {
    const body = request.body as { token?: unknown } | undefined;
    const token = typeof body?.token === "string" ? body.token : "";
    const verified = await consumeEmailVerification(token);
    if (!verified) {
      reply.code(400);
      return { error: "This verification link is invalid or has expired." };
    }
    await recordAuthEvent(verified.id, "verify", request);
    return { ok: true };
  });

  // Resend the verification email to the logged-in user. 409 if already verified.
  app.post("/resend-verification", { config: authLimit(3, 3_600_000) }, async (request, reply) => {
    const authed = await requireAuth(request);
    if (await isEmailVerified(authed.id)) {
      reply.code(409);
      return { error: "Your email is already verified." };
    }
    const token = await createEmailVerification(authed.id);
    await sendVerificationEmail(authed.email, `${webBaseUrl()}/?verify=${token}`);
    return { ok: true, message: "Verification email sent." };
  });

  // A banned user with a live cookie gets 403 + the reason here (every other route
  // treats them as logged out); anyone else gets the usual bootstrap payload.
  app.get("/me", async (request, reply) => {
    const state = await getSessionState(request);
    if (!state) return { user: null, hasCharacter: false };
    if (state.bannedAt) {
      reply.code(403);
      return { error: banMessage(state.banReason) };
    }
    const user = state.user;
    return { user, hasCharacter: await hasCharacter(user.id), emailVerified: await isEmailVerified(user.id), isAdmin: state.isAdmin };
  });

  // TODO: Add Discord OAuth callbacks here after Phase 1 email/password auth settles.
  app.get("/discord/todo", async () => ({ todo: "Discord OAuth plugs into auth service later." }));
}
