import { eq } from "drizzle-orm";
import { createDb, players, sessions, users } from "@massalia/db";

const db = createDb();

// Account deletion — anonymize-and-detach, immediate and irreversible. One
// transaction:
//   - users: scrub the PII (email → an anon sentinel, passwordHash → "!deleted",
//     newsletterOptIn → false) and stamp deletedAt.
//   - sessions: hard-delete EVERY session row for the user (log out every device).
//   - players: isActive → false on every world. name/house/party/alignment STAY —
//     pseudonymous world content per the ruling; no other game table is touched.
// Idempotent by construction: a second call re-writes the same terminal state.
export async function deleteAccount(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        email: `deleted:${userId}@anon.invalid`,
        passwordHash: "!deleted",
        newsletterOptIn: false,
        deletedAt: new Date(),
      })
      .where(eq(users.id, userId));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    await tx.update(players).set({ isActive: false }).where(eq(players.userId, userId));
  });
}
