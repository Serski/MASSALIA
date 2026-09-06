import { and, eq, lt, notInArray, sql } from "drizzle-orm";
import type { DbExec, DbHandle } from "./client.js";
import { sessions } from "./schema.js";

// Session housekeeping.
//   * deleteExpiredSessions — the worker's daily sweep: rows past expires_at are
//     dead already (getAuthUser filters on expires_at), this just reclaims them.
//   * pruneUserSessions — the per-user cap applied on every login: keep the newest
//     MAX_SESSIONS_PER_USER rows (by created_at, then id), delete the rest, so a
//     stolen or forgotten device eventually falls off and the table cannot grow
//     without bound for one account.
export const MAX_SESSIONS_PER_USER = 10;

export async function deleteExpiredSessions(db: DbHandle, now: Date = new Date()): Promise<number> {
  const gone = await db.delete(sessions).where(lt(sessions.expiresAt, now)).returning({ id: sessions.id });
  return gone.length;
}

export async function pruneUserSessions(exec: DbExec, userId: string, keep: number = MAX_SESSIONS_PER_USER): Promise<number> {
  const newest = exec
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(sql`${sessions.createdAt} DESC, ${sessions.id} DESC`)
    .limit(keep);
  const gone = await exec
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), notInArray(sessions.id, newest)))
    .returning({ id: sessions.id });
  return gone.length;
}
