import crypto from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Session housekeeping (sessions.ts) — integration test against a REAL Postgres,
// guarded to a *_test database like the other db-package suites.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

suite("session housekeeping (integration)", () => {
  let m: typeof import("./index.js");
  let db: ReturnType<typeof import("./index.js").createDb>;

  beforeAll(async () => {
    m = await import("./index.js");
    db = m.createDb();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE sessions, users CASCADE`);
  });

  const user = async () => (await db.insert(m.users).values({ email: `u-${crypto.randomUUID()}@t`, passwordHash: "x" }).returning())[0]!;
  const session = async (userId: string, createdAt: Date, expiresAt = new Date(createdAt.getTime() + 30 * 86_400_000)) =>
    (await db.insert(m.sessions).values({ userId, tokenHash: crypto.randomUUID(), expiresAt, createdAt }).returning())[0]!;
  const count = async (userId: string) => (await db.select({ id: m.sessions.id }).from(m.sessions).where(eq(m.sessions.userId, userId))).length;

  it("deleteExpiredSessions removes only rows past their expiry", async () => {
    const u = await user();
    const now = new Date();
    await session(u.id, new Date(now.getTime() - 40 * 86_400_000), new Date(now.getTime() - 10 * 86_400_000)); // expired
    await session(u.id, new Date(now.getTime() - 1000), new Date(now.getTime() - 1)); // expired a moment ago
    const live = await session(u.id, now); // live
    expect(await m.deleteExpiredSessions(db, now)).toBe(2);
    const left = await db.select({ id: m.sessions.id }).from(m.sessions).where(eq(m.sessions.userId, u.id));
    expect(left.map((r) => r.id)).toEqual([live.id]);
    expect(await m.deleteExpiredSessions(db, now)).toBe(0); // idempotent
  });

  it("pruneUserSessions keeps the newest 10 for that user and touches nobody else", async () => {
    const alice = await user();
    const bob = await user();
    const t0 = Date.now() - 100_000;
    const ids: string[] = [];
    for (let i = 0; i < 13; i++) ids.push((await session(alice.id, new Date(t0 + i * 1000))).id);
    const bobs = (await session(bob.id, new Date(t0))).id;

    expect(await m.pruneUserSessions(db, alice.id)).toBe(3);
    const left = (await db.select({ id: m.sessions.id }).from(m.sessions).where(eq(m.sessions.userId, alice.id))).map((r) => r.id).sort();
    expect(left).toEqual(ids.slice(3).sort()); // the three OLDEST went
    expect(await count(bob.id)).toBe(1);
    expect((await db.select({ id: m.sessions.id }).from(m.sessions).where(eq(m.sessions.id, bobs)))[0]).toBeDefined();
    expect(await m.pruneUserSessions(db, alice.id)).toBe(0);
    expect(m.MAX_SESSIONS_PER_USER).toBe(10);
  });
});
