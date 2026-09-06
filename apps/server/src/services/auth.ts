import crypto from "node:crypto";
import net from "node:net";
import type { FastifyReply, FastifyRequest } from "fastify";
import { and, eq, gt, isNull } from "drizzle-orm";
import { authEvents, createDb, emailVerificationTokens, passwordResetTokens, pruneUserSessions, sessions, users, type AuthEventKind } from "@massalia/db";

export const sessionCookieName = "massalia_session";

const db = createDb();
const sessionTtlMs = 30 * 24 * 60 * 60 * 1000;
const passwordResetTtlMs = 60 * 60 * 1000;
const emailVerificationTtlMs = 24 * 60 * 60 * 1000;

// Transaction handle type (drizzle's tx passed to db.transaction's callback), so
// password-reset consumption can run inside the caller's transaction.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type AuthUser = {
  id: string;
  email: string;
};

// --- Request origin (migration 0051) ----------------------------------------
// The client IP (as resolved by trustProxy) and user agent, recorded on every
// session and auth event. An unparseable address is stored as NULL rather than
// failing the insert into the inet column.
export type RequestMeta = { ip: string | null; userAgent: string | null };

export function requestMeta(request: FastifyRequest): RequestMeta {
  const ip = request.ip && net.isIP(request.ip) ? request.ip : null;
  const header = request.headers["user-agent"];
  const userAgent = typeof header === "string" && header.length ? header.slice(0, 512) : null;
  return { ip, userAgent };
}

// One auth_events row per register / login / reset / verify.
export async function recordAuthEvent(userId: string, kind: AuthEventKind, request: FastifyRequest): Promise<void> {
  const meta = requestMeta(request);
  await db.insert(authEvents).values({ userId, kind, ip: meta.ip, userAgent: meta.userAgent });
}

// The copy a banned user sees (login refusal and /auth/me).
export function banMessage(reason: string | null): string {
  return reason ? `This account has been banned. Reason: ${reason}` : "This account has been banned.";
}

export function getCookieOptions() {
  const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
  const isSecureOrigin = webOrigin.startsWith("https://");

  // First-party same-site setup: the web app (apex playmassalia.com) and the API
  // (api.playmassalia.com subdomain) share a registrable domain, so the session
  // cookie is same-site and `SameSite=Lax` is sufficient. This replaces the old
  // cross-site (github.io ↔ railway.app) arrangement that required `SameSite=None`.
  // `secure` stays derived from an https WEB_ORIGIN so local HTTP dev still works.
  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax" as const,
    secure: isSecureOrigin,
    signed: true,
    maxAge: Math.floor(sessionTtlMs / 1000),
  };
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function createSessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

// --- Password reset ---------------------------------------------------------
// Same token discipline as sessions: a random token (reusing createSessionToken)
// is returned to the caller (emailed as a link), but only its SHA-256 hash is
// stored. 60-minute TTL, newest-only, single-use — see migration 0045.

// Issue a reset token for a user. Newest-only: every prior unused token for this
// user is marked used first, so only the freshest link works. Returns the RAW
// token (the hash is what lands in the table).
export async function createPasswordReset(userId: string): Promise<string> {
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + passwordResetTtlMs);
  await db.transaction(async (tx) => {
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.usedAt)));
    await tx.insert(passwordResetTokens).values({ userId, tokenHash: hashToken(token), expiresAt });
  });
  return token;
}

// Atomically consume a reset token WITHIN a caller-provided transaction, so the
// consume and the password update commit (or roll back) together. The mark-used
// UPDATE is guarded by `used_at IS NULL AND expires_at > now()` and RETURNs the
// affected row: under concurrency the loser waits on the row lock, then matches
// zero rows and gets null — the token can never be spent twice. NULL/expired/
// already-used/deleted-user all yield null (no partial state, nothing revealed).
export async function consumePasswordResetTx(tx: Tx, rawToken: string): Promise<AuthUser | null> {
  const marked = await tx
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(passwordResetTokens.tokenHash, hashToken(rawToken)),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, new Date()),
      ),
    )
    .returning({ userId: passwordResetTokens.userId });
  if (marked.length !== 1) return null;

  const rows = await tx
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(and(eq(users.id, marked[0]!.userId), isNull(users.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

// Standalone consume (own transaction) — for direct testing / non-reset callers.
export async function consumePasswordReset(rawToken: string): Promise<AuthUser | null> {
  return db.transaction((tx) => consumePasswordResetTx(tx, rawToken));
}

// --- Email verification -----------------------------------------------------
// Same token discipline as password resets, but a 24-hour TTL and a success side
// effect of stamping users.email_verified_at. Verification is soft (non-blocking):
// nothing gates on it beyond a nagging banner.

// Issue a verification token for a user (newest-only). Returns the RAW token.
export async function createEmailVerification(userId: string): Promise<string> {
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + emailVerificationTtlMs);
  await db.transaction(async (tx) => {
    await tx
      .update(emailVerificationTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(emailVerificationTokens.userId, userId), isNull(emailVerificationTokens.usedAt)));
    await tx.insert(emailVerificationTokens).values({ userId, tokenHash: hashToken(token), expiresAt });
  });
  return token;
}

// Atomically consume a verification token and stamp email_verified_at, in one
// transaction. Same single-use guard as password resets (used_at IS NULL AND
// expires_at > now(), affected-row check). NULL/expired/used/deleted-user → null.
export async function consumeEmailVerification(rawToken: string): Promise<AuthUser | null> {
  return db.transaction(async (tx) => {
    const marked = await tx
      .update(emailVerificationTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(emailVerificationTokens.tokenHash, hashToken(rawToken)),
          isNull(emailVerificationTokens.usedAt),
          gt(emailVerificationTokens.expiresAt, new Date()),
        ),
      )
      .returning({ userId: emailVerificationTokens.userId });
    if (marked.length !== 1) return null;

    const rows = await tx
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(and(eq(users.id, marked[0]!.userId), isNull(users.deletedAt)))
      .limit(1);
    const user = rows[0];
    if (!user) return null;

    await tx.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, user.id));
    return user;
  });
}

// Read the verification flag for a user (for bootstrap payloads / resend guard).
export async function isEmailVerified(userId: string): Promise<boolean> {
  const rows = await db
    .select({ emailVerifiedAt: users.emailVerifiedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return Boolean(rows[0]?.emailVerifiedAt);
}

// Issue a session: store only the token's hash and hand the raw token to the
// browser as the signed httpOnly cookie. Nothing is returned — the raw token never
// leaves the cookie (the web app and API are same-site, so the cookie always flows).
// Each login also prunes the user's older sessions down to MAX_SESSIONS_PER_USER
// (newest kept), in the same transaction as the insert. The session records the
// request's IP and user agent.
export async function createSession(request: FastifyRequest, reply: FastifyReply, userId: string): Promise<void> {
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + sessionTtlMs);
  const meta = requestMeta(request);
  await db.transaction(async (tx) => {
    await tx.insert(sessions).values({ userId, tokenHash: hashToken(token), expiresAt, ip: meta.ip, userAgent: meta.userAgent });
    await pruneUserSessions(tx, userId);
  });
  reply.setCookie(sessionCookieName, token, getCookieOptions());
}

export async function clearSession(request: FastifyRequest, reply: FastifyReply) {
  const token = readSignedSessionCookie(request);
  if (token) {
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  }
  reply.clearCookie(sessionCookieName, getCookieOptions());
}

function readSignedSessionCookie(request: FastifyRequest) {
  const rawCookie = request.cookies[sessionCookieName];
  if (!rawCookie) return null;
  const unsigned = request.unsignCookie(rawCookie);
  if (!unsigned.valid || !unsigned.value) return null;
  return unsigned.value;
}

// The user behind a live session cookie, plus the flags the auth gate reads.
export type SessionState = { user: AuthUser; isAdmin: boolean; bannedAt: Date | null; banReason: string | null };

// One session lookup per request: the rate limiter keys on the user id at
// onRequest and the route's requireAuth asks again moments later.
const sessionByRequest = new WeakMap<FastifyRequest, Promise<SessionState | null>>();

// The raw session state (banned users included) — for /auth/me, which must tell a
// banned user why, and for requireAdmin.
export function getSessionState(request: FastifyRequest): Promise<SessionState | null> {
  let pending = sessionByRequest.get(request);
  if (!pending) {
    pending = lookupSession(request);
    sessionByRequest.set(request, pending);
  }
  return pending;
}

// The authenticated user, or null. A banned user is null here: every authed route
// answers 401 as if logged out, and only /auth/me and login carry the reason.
export async function getAuthUser(request: FastifyRequest): Promise<AuthUser | null> {
  const state = await getSessionState(request);
  if (!state || state.bannedAt) return null;
  return state.user;
}

async function lookupSession(request: FastifyRequest): Promise<SessionState | null> {
  // The signed session cookie is the only credential; an Authorization header is ignored.
  const token = readSignedSessionCookie(request);
  if (!token) return null;

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      isAdmin: users.isAdmin,
      bannedAt: users.bannedAt,
      banReason: users.banReason,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date()), isNull(users.deletedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { user: { id: row.id, email: row.email }, isAdmin: row.isAdmin, bannedAt: row.bannedAt, banReason: row.banReason };
}

export async function requireAuth(request: FastifyRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    const error = new Error("Authentication required");
    (error as Error & { statusCode?: number }).statusCode = 401;
    throw error;
  }
  return user;
}
