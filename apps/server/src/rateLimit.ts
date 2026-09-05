import type { FastifyInstance, FastifyRequest } from "fastify";
import rateLimit from "@fastify/rate-limit";
import Redis from "ioredis";
import { getAuthUser } from "./services/auth.js";

// ---------------------------------------------------------------------------
// Global rate limiting.
//   * 300 requests / minute per key on every route, where the key is the session's
//     user id when a valid session cookie is present and request.ip otherwise
//     (trustProxy in index.ts already resolves the real client behind Railway).
//   * 60 / minute on POST/PUT/PATCH/DELETE under /api/ (set as route config by an
//     onRoute hook, so a route may still declare its own tighter config).
//   * The auth routes keep their own stricter, IP-keyed limits (see routes/auth.ts).
//   * /health and the /content/ static files are exempt.
//   * Redis store when REDIS_URL is set (shared across instances, survives deploys),
//     in-memory otherwise; a Redis error fails open (skipOnError) so a Redis blip
//     never blocks the game.
// A 429 is thrown as an Error with statusCode, so errorHandler.ts answers with the
// `{ error }` shape the web client already renders.
// ---------------------------------------------------------------------------

export const GLOBAL_MAX_PER_MINUTE = 300;
export const API_MUTATION_MAX_PER_MINUTE = 60;
export const MINUTE_MS = 60_000;
export const RATE_LIMIT_MESSAGE = "Too many requests. Try again shortly.";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Redis client backing the limiter. Mirrors services/queue.ts fail-fast options so
// a Redis blip never blocks request handlers.
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
    console.warn(`Rate-limit Redis error (failing open): ${error.message}`);
  });
  return client;
}

// The error @fastify/rate-limit throws on an exceeded limit. errorHandler.ts turns
// it into `429 { error: message }`.
export function tooManyRequests(message: string) {
  return () => Object.assign(new Error(message), { statusCode: 429 });
}

// Per-key identity: the authenticated user (one counter across their devices and
// IPs), else the client IP. getAuthUser memoizes per request, so the route's own
// requireAuth reuses this lookup instead of hitting the DB twice.
export async function rateLimitKey(request: FastifyRequest): Promise<string> {
  const user = await getAuthUser(request);
  return user ? `user:${user.id}` : `ip:${request.ip}`;
}

export function byIp(request: FastifyRequest): string {
  return `ip:${request.ip}`;
}

function exempt(request: FastifyRequest): boolean {
  const path = request.routeOptions?.url ?? request.url;
  return path === "/health" || path.startsWith("/content/");
}

// Register the limiter on `app`. Call AFTER @fastify/cookie (the key reads the
// session cookie) and BEFORE any route is registered (the onRoute hook below must
// see every route). `redis` defaults to the REDIS_URL client; tests pass none.
export async function registerRateLimit(app: FastifyInstance, options: { redis?: Redis | null } = {}): Promise<void> {
  const redis = options.redis === undefined ? createLimiterRedis() : options.redis;

  // Mutations under /api/ default to the tighter budget unless the route brought
  // its own rateLimit config. Added before the plugin so its onRoute hook (which
  // reads config.rateLimit) runs after this one.
  app.addHook("onRoute", (route) => {
    if (!route.url.startsWith("/api/")) return;
    const methods = ([] as string[]).concat(route.method);
    if (!methods.some((method) => MUTATING_METHODS.has(method))) return;
    if (route.config && (route.config as { rateLimit?: unknown }).rateLimit !== undefined) return;
    route.config = { ...(route.config ?? {}), rateLimit: { max: API_MUTATION_MAX_PER_MINUTE, timeWindow: MINUTE_MS } };
  });

  await app.register(rateLimit, {
    global: true,
    max: GLOBAL_MAX_PER_MINUTE,
    timeWindow: MINUTE_MS,
    keyGenerator: rateLimitKey,
    allowList: exempt,
    skipOnError: true,
    errorResponseBuilder: tooManyRequests(RATE_LIMIT_MESSAGE),
    ...(redis ? { redis } : {}),
  });
}
