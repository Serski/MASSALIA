import { sql } from "drizzle-orm";
import type { createDb } from "@massalia/db";
import { playerCharacters } from "@massalia/db";
import { eq } from "drizzle-orm";

// The drizzle transaction handle as passed to db.transaction's callback.
export type DbTx = Parameters<Parameters<ReturnType<typeof createDb>["transaction"]>[0]>[0];

// --- Per-player serialization -------------------------------------------------
// Every write to a player's drachmae, resources, pops, buildings, stats, or daily
// cards runs under READ COMMITTED, where "read the balance in JS, check it, write
// the computed value back" lets two concurrent requests both pass the check and
// the second write silently overwrite the first. lockPlayer takes a transaction-
// scoped advisory lock keyed on the player's id, so every mutating transaction for
// one player runs strictly one after another (and sees the previous one's commit
// on its first read), while different players never wait on each other.
//
// RULES
//   * It MUST be the first statement inside any db.transaction that mutates a
//     player's drachmae, resources, pops, buildings, stats, or daily cards — a
//     read taken before the lock is a read from before the previous writer
//     committed, which is exactly the race this closes.
//   * The key is players.id (NOT player_characters.id). Use lockCharacterOwner
//     when only the character id is in hand.
//   * The lock is released automatically at COMMIT/ROLLBACK (pg_advisory_xact_lock);
//     never call it outside a transaction — on the pool handle it would pin a
//     random connection for the rest of that connection's life.
//   * Re-entrant within one transaction: a helper that locks (applyEffectsInTx)
//     may be called from a transaction that already holds the lock.
//   * Guarded relative writes (SET drachmae = drachmae - X WHERE drachmae >= X,
//     check the affected row count) remain the second line of defence — the lock
//     makes the read-check-write sequence safe, the guard makes the write itself
//     safe even if a caller forgets the lock.
export async function lockPlayer(tx: DbTx, playerId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${playerId}::text))`);
}

// Same lock, resolved from a character id (player_characters.id -> players.id).
// Returns the player id so the caller can reuse it. Unknown character: no lock,
// null (the caller's own not-found handling applies).
export async function lockCharacterOwner(tx: DbTx, characterId: string): Promise<string | null> {
  const rows = await tx.select({ playerId: playerCharacters.playerId }).from(playerCharacters).where(eq(playerCharacters.id, characterId)).limit(1);
  const playerId = rows[0]?.playerId;
  if (!playerId) return null;
  await lockPlayer(tx, playerId);
  return playerId;
}
