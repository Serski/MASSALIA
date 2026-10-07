import { and, count, eq, isNull, sql } from "drizzle-orm";
import { createDb, referrals, users } from "@massalia/db";
import { getActiveWorldId } from "./character.js";

// ---------------------------------------------------------------------------
// The invite promo (invite prompt 1). Every account has a referral code for its
// invite link (playmassalia.com/?invite=CODE); a sign-up through the link records
// who invited it in the world active at sign-up. Identifiers say referral so
// nothing reads like the koinon's invitations. The content numbers (reward,
// perWorld) are passed in by the callers: this module imports nothing from
// oligarchy.ts, so the two services never import each other.
// ---------------------------------------------------------------------------

const db = createDb();

export const REFERRAL_CODE = /^[0-9A-F]{10}$/;

// Record a sign-up through an invite link. "ignored" for anything that is not a
// live inviter's code in an active world; "full" once the inviter has perWorld
// referrals in that world (the sign-up itself goes through as normal); otherwise
// "recorded". The advisory lock serialises sign-ups through one link, so two
// cannot both take the last place.
export async function recordReferral(inviteeUserId: string, rawCode: unknown, perWorld: number): Promise<"recorded" | "ignored" | "full"> {
  if (typeof rawCode !== "string") return "ignored";
  const code = rawCode.trim().toUpperCase();
  if (!REFERRAL_CODE.test(code)) return "ignored";
  const worldId = await getActiveWorldId();
  if (!worldId) return "ignored";
  const inviter = (
    await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.referralCode, code), isNull(users.deletedAt), isNull(users.bannedAt)))
      .limit(1)
  )[0];
  if (!inviter || inviter.id === inviteeUserId) return "ignored";
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`referral:${inviter.id}`}))`);
    const [made] = await tx
      .select({ n: count() })
      .from(referrals)
      .where(and(eq(referrals.inviterUserId, inviter.id), eq(referrals.worldId, worldId)));
    if ((made?.n ?? 0) >= perWorld) return "full";
    await tx.insert(referrals).values({ inviteeUserId, inviterUserId: inviter.id, worldId }).onConflictDoNothing();
    return "recorded";
  });
}
