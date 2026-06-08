import { eq } from "drizzle-orm";
import { censureExpiryOutcome, DEFECTION_TRAIT_ID, type PoliticalParty } from "@massalia/shared";
import { createDb } from "./client.js";
import { censures, characterTraits, playerCharacters } from "./schema.js";

const db = createDb();

export type CensureResolution = "none" | "pending" | "kicked" | "cleared";

// The character's current censure row, or null. (Does not check expiry.)
export async function getCensure(characterId: string) {
  const rows = await db.select().from(censures).where(eq(censures.characterId, characterId)).limit(1);
  return rows[0] ?? null;
}

// Resolve an expired censure: kick (party 'none' + turncoat) if still out of
// range, otherwise clear. No-op if there's no censure or it hasn't expired.
// Used by both the BullMQ worker (scheduled) and the server (lazy-on-read).
export async function resolveCensureIfExpired(characterId: string, now: Date = new Date()): Promise<CensureResolution> {
  const censure = await getCensure(characterId);
  if (!censure) return "none";
  if (censure.expiresAt.getTime() > now.getTime()) return "pending";

  const charRows = await db.select().from(playerCharacters).where(eq(playerCharacters.id, characterId)).limit(1);
  const character = charRows[0];
  if (!character) {
    await db.delete(censures).where(eq(censures.id, censure.id));
    return "cleared";
  }

  const outcome = censureExpiryOutcome(character.party as PoliticalParty, character.ideology);
  if (outcome === "kick") {
    await db.update(playerCharacters).set({ party: "none" }).where(eq(playerCharacters.id, characterId));
    await db.insert(characterTraits).values({ characterId, traitId: DEFECTION_TRAIT_ID }).onConflictDoNothing();
    await db.delete(censures).where(eq(censures.id, censure.id));
    return "kicked";
  }

  await db.delete(censures).where(eq(censures.id, censure.id));
  return "cleared";
}
