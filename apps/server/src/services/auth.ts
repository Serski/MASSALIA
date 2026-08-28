import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { and, eq, gt, isNull } from "drizzle-orm";
import { createDb, passwordResetTokens, sessions, users } from "@massalia/db";

export const sessionCookieName = "massalia_session";

const db = createDb();
const sessionTtlMs = 30 * 24 * 60 * 60 * 1000;
const passwordResetTtlMs = 60 * 60 * 1000;

// Transaction handle type (drizzle's tx passed to db.transaction's callback), so
// password-reset consumption can run inside the caller's transaction.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type AuthUser = {
  id: string;
  email: string;
};

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

export async function createSession(reply: FastifyReply, userId: string) {
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + sessionTtlMs);
  await db.insert(sessions).values({ userId, tokenHash: hashToken(token), expiresAt });
  // Set the cookie (works on same-site / cookie-friendly browsers) AND return the
  // raw token so the client can fall back to an Authorization: Bearer header.
  // Bearer is needed because cross-site cookies are blocked by iOS Safari etc.
  reply.setCookie(sessionCookieName, token, getCookieOptions());
  return token;
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

function readBearerToken(request: FastifyRequest) {
  const header = request.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

export async function getAuthUser(request: FastifyRequest): Promise<AuthUser | null> {
  // Prefer the cookie (when the browser keeps it); otherwise accept a Bearer token.
  const token = readSignedSessionCookie(request) ?? readBearerToken(request);
  if (!token) return null;

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date()), isNull(users.deletedAt)))
    .limit(1);

  return rows[0] ?? null;
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
