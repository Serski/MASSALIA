import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

// One pg.Pool per database URL, cached at module level. createDb() is called at
// import time by ~30 service/route modules; before this cache each call opened its
// own pool (each with its own connection limit), so a "concurrent" pair of requests
// often serialized on pool warm-up instead of racing, and the process could hold
// far more Postgres connections than any single pool's `max` suggests.
//
// Sizing: DB_POOL_MAX (default 10) connections, idle ones closed after 30s. The
// signature is unchanged, so every existing call site keeps working; the returned
// drizzle handles share the pool.
const pools = new Map<string, pg.Pool>();

function poolFor(databaseUrl: string): pg.Pool {
  const existing = pools.get(databaseUrl);
  if (existing) return existing;
  const max = Number(process.env.DB_POOL_MAX ?? 10);
  const pool = new pg.Pool({ connectionString: databaseUrl, max: Number.isFinite(max) && max > 0 ? max : 10, idleTimeoutMillis: 30_000 });
  pools.set(databaseUrl, pool);
  // Logged once per URL (credentials stripped) — a booting server must print this exactly once.
  console.info(`[db] pool created for ${describe(databaseUrl)} (max ${pool.options.max})`);
  return pool;
}

function describe(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    return `${url.hostname}${url.port ? `:${url.port}` : ""}${url.pathname}`;
  } catch {
    return "<database>";
  }
}

// The drizzle handle, its transaction handle, and "either" — for helpers that run
// on the pool by default but inside a caller's transaction when one is passed.
export type DbHandle = ReturnType<typeof createDb>;
export type DbTx = Parameters<Parameters<DbHandle["transaction"]>[0]>[0];
export type DbExec = DbHandle | DbTx;

export function createDb(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  return drizzle(poolFor(databaseUrl), { schema });
}
