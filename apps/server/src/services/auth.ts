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

export async function getAuthUser(request: FastifyRequest): Promise<AuthUser | null> {
  const token = readSignedSessionCookie(request);
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
