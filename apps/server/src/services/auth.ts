import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { and, eq, gt } from "drizzle-orm";
import { createDb, sessions, users } from "@massalia/db";

export const sessionCookieName = "massalia_session";

const db = createDb();
const sessionTtlMs = 30 * 24 * 60 * 60 * 1000;

export type AuthUser = {
  id: string;
  email: string;
};

export function getCookieOptions() {
  const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
  const isSecureOrigin = webOrigin.startsWith("https://");

  return {
    httpOnly: true,
    path: "/",
    sameSite: isSecureOrigin ? "none" as const : "lax" as const,
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
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
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
