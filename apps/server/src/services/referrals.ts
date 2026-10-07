import { and, count, eq, isNull, sql } from "drizzle-orm";
import { createDb, effectLog, playerCharacters, players, referrals, users, type DbTx } from "@massalia/db";
import { findCharacterRow, getActivePlayer, getActiveWorldId, type CharacterRow } from "./character.js";

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

// --- The payout when the invited player takes a seat (commit 4) ---------------

export type ReferralPayout = { inviteeUserId: string; worldId: string; inviterPlayerId: string; inviterCharacterId: string; reward: number };

// Read only, called before the seat purchase's transaction: the buyer's unpaid
// referral in the buyer's world, and the inviter's living character there. Any
// miss (no referral, paid already, inviter deleted or banned, no active player,
// no character, not alive) is null and the purchase runs as it always has.
export async function referralPayoutFor(buyer: CharacterRow, reward: number): Promise<ReferralPayout | null> {
  const buyerPlayer = (await db.select({ userId: players.userId }).from(players).where(eq(players.id, buyer.playerId)).limit(1))[0];
  if (!buyerPlayer) return null;
  const referral = (
    await db
      .select({ inviteeUserId: referrals.inviteeUserId, inviterUserId: referrals.inviterUserId, worldId: referrals.worldId })
      .from(referrals)
      .where(and(eq(referrals.inviteeUserId, buyerPlayer.userId), eq(referrals.worldId, buyer.worldId), isNull(referrals.paidAt)))
      .limit(1)
  )[0];
  if (!referral) return null;
  const inviter = (
    await db.select({ id: users.id }).from(users).where(and(eq(users.id, referral.inviterUserId), isNull(users.deletedAt), isNull(users.bannedAt))).limit(1)
  )[0];
  if (!inviter) return null;
  const inviterPlayer = await getActivePlayer(inviter.id, buyer.worldId);
  if (!inviterPlayer) return null;
  const inviterCharacter = await findCharacterRow(inviterPlayer.id, buyer.worldId);
  if (!inviterCharacter || inviterCharacter.status !== "alive") return null;
  return { inviteeUserId: referral.inviteeUserId, worldId: referral.worldId, inviterPlayerId: inviterPlayer.id, inviterCharacterId: inviterCharacter.id, reward };
}

// Inside the purchase transaction, after the seat is claimed, with the buyer and
// the inviter both locked. Claim first: the referral row is stamped paid under
// a paid_at IS NULL guard; a lost claim pays nothing. The credit is a relative
// update guarded on the inviter still being alive; a miss there cannot happen
// under the lock, and if it does the purchase rolls back rather than claim
// without paying. The effect_log row is audit only, never a Chronicle line.
export async function payReferralInTx(tx: DbTx, payout: ReferralPayout, buyer: CharacterRow, now: Date): Promise<boolean> {
  const inviter = (await tx.select({ status: playerCharacters.status }).from(playerCharacters).where(eq(playerCharacters.id, payout.inviterCharacterId)).limit(1))[0];
  if (!inviter || inviter.status !== "alive") return false;
  const claimed = await tx
    .update(referrals)
    .set({ paidAt: now, paidCharacterId: payout.inviterCharacterId })
    .where(and(eq(referrals.inviteeUserId, payout.inviteeUserId), eq(referrals.worldId, payout.worldId), isNull(referrals.paidAt)))
    .returning({ inviteeUserId: referrals.inviteeUserId });
  if (!claimed.length) return false;
  const credited = await tx
    .update(playerCharacters)
    .set({ drachmae: sql`${playerCharacters.drachmae} + ${payout.reward}` })
    .where(and(eq(playerCharacters.id, payout.inviterCharacterId), eq(playerCharacters.status, "alive")))
    .returning({ id: playerCharacters.id });
  if (!credited.length) throw new Error("referral_credit_failed");
  await tx.insert(effectLog).values({ characterId: payout.inviterCharacterId, kind: "referral_reward", detail: { inviteeCharacterId: buyer.id, amount: payout.reward } });
  return true;
}
