import type { FastifyInstance } from "fastify";
import Redis from "ioredis";
import { sql } from "drizzle-orm";
import { createDb } from "@massalia/db";

// ---------------------------------------------------------------------------
// /health that means something: SELECT 1 on Postgres and PING on Redis (when
// REDIS_URL is set), each capped at 2 seconds. 200 { ok: true, db: "ok",
// redis: "ok" | "off" } when everything answers; 503 naming the failing part
// otherwise. Exempt from the rate limiter (rateLimit.ts allowList).
// ---------------------------------------------------------------------------

export const HEALTH_TIMEOUT_MS = 2_000;

export type PartStatus = "ok" | "failed";
export type HealthReport = {
  ok: boolean;
  db: PartStatus;
  redis: PartStatus | "off";
  // Present on failure: "<part>: <reason>" for each failing part.
  error?: string;
};

export type HealthOptions = {
  databaseUrl?: string;
  redisUrl?: string | null; // null/undefined = Redis not configured -> "off"
  timeoutMs?: number;
};

// One line per failure, from the root cause when a driver wrapped it (drizzle's
// "Failed query: ...\nparams: ..." wrapper hides the pg error in `cause`).
function describeError(error: unknown): string {
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.split("\n")[0]!.trim() || "unknown error";
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    timer.unref();
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function checkDb(databaseUrl: string | undefined, timeoutMs: number): Promise<void> {
  const db = createDb(databaseUrl); // the shared pool for this URL
  await withTimeout(db.execute(sql`SELECT 1`), timeoutMs, "SELECT 1");
}

// A throwaway client per probe: no offline queue, no reconnect loop, so a dead
// Redis fails this probe quickly and cleanly without leaving a retrying client behind.
async function checkRedis(redisUrl: string, timeoutMs: number): Promise<void> {
  const client = new Redis(redisUrl, {
    lazyConnect: true,
    connectTimeout: timeoutMs,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  client.on("error", () => {
    /* surfaced through the awaited connect()/ping() below */
  });
  try {
    await withTimeout(
      (async () => {
        await client.connect();
        const pong = await client.ping();
        if (pong !== "PONG") throw new Error(`unexpected PING reply: ${pong}`);
      })(),
      timeoutMs,
      "PING",
    );
  } finally {
    client.disconnect();
  }
}

export async function checkHealth(options: HealthOptions = {}): Promise<HealthReport> {
  const timeoutMs = options.timeoutMs ?? HEALTH_TIMEOUT_MS;
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  const redisUrl = options.redisUrl === undefined ? process.env.REDIS_URL || null : options.redisUrl;

  const [dbResult, redisResult] = await Promise.all([
    checkDb(databaseUrl, timeoutMs).then(() => null, describeError),
    redisUrl ? checkRedis(redisUrl, timeoutMs).then(() => null, describeError) : Promise.resolve(undefined),
  ]);

  const report: HealthReport = {
    ok: dbResult === null && (redisResult === null || redisResult === undefined),
    db: dbResult === null ? "ok" : "failed",
    redis: redisResult === undefined ? "off" : redisResult === null ? "ok" : "failed",
  };
  const errors = [dbResult ? `db: ${dbResult}` : null, redisResult ? `redis: ${redisResult}` : null].filter(Boolean);
  if (errors.length) report.error = errors.join("; ");
  return report;
}

export function registerHealthRoute(app: FastifyInstance, options: HealthOptions = {}) {
  app.get("/health", async (_request, reply) => {
    const report = await checkHealth(options);
    reply.code(report.ok ? 200 : 503);
    return report;
  });
}
