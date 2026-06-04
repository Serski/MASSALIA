import bcrypt from "bcryptjs";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, eq } from "drizzle-orm";
import { createDb, players, users, worlds } from "@massalia/db";
import { clearSession, createSession, getAuthUser, requireAuth } from "../services/auth.js";

const db = createDb();

type AuthPayload = {
  email?: string;
  password?: string;
};

const authAttempts = new Map<string, { count: number; resetAt: number }>();

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

function checkRateLimit(request: FastifyRequest) {
  const key = `${request.ip}:${request.url}`;
  const now = Date.now();
  const current = authAttempts.get(key);
  if (!current || current.resetAt < now) {
    authAttempts.set(key, { count: 1, resetAt: now + 60_000 });
    return;
  }
  current.count += 1;
  if (current.count > 8) {
    const error = new Error("Too many attempts. Try again shortly.");
    (error as Error & { statusCode?: number }).statusCode = 429;
    throw error;
  }
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
  app.post("/register", async (request, reply) => {
    checkRateLimit(request);
    const { email, password } = assertAuthPayload(request.body as AuthPayload);
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing[0]) {
      reply.code(409);
      return { error: "Email is already registered." };
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const created = await db.insert(users).values({ email, passwordHash }).returning({ id: users.id, email: users.email });
    const user = created[0]!;
    await createSession(reply, user.id);
    return { user, hasCharacter: false };
  });

  app.post("/login", async (request, reply) => {
    checkRateLimit(request);
    const { email, password } = assertAuthPayload(request.body as AuthPayload);
    const found = await db.select().from(users).where(eq(users.email, email)).limit(1);
    const user = found[0];
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      reply.code(401);
      return { error: "Invalid email or password." };
    }

    await createSession(reply, user.id);
    return { user: { id: user.id, email: user.email }, hasCharacter: await hasCharacter(user.id) };
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
