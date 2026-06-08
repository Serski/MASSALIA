import { and, eq, gt } from "drizzle-orm";
import { censures, createDb, getCensure, playerCharacters, resolveCensureIfExpired } from "@massalia/db";
import {
  CENSURE_DURATION_MS,
  hasDriftedFromParty,
  meetsPartyIdeology,
  type JoinableParty,
  type PoliticalParty,
} from "@massalia/shared";
import { addTrait } from "./traits.js";
import { enqueueCensureResolution } from "./queue.js";

const db = createDb();

export class PartyError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

// The character's active (unexpired) censure, after lazily resolving expired ones.
export async function activeCensure(characterId: string, now: Date = new Date()) {
  await resolveCensureIfExpired(characterId, now);
  const rows = await db
    .select()
    .from(censures)
    .where(and(eq(censures.characterId, characterId), gt(censures.expiresAt, now)))
    .limit(1);
  return rows[0] ?? null;
}

async function loadCharacter(characterId: string) {
  const rows = await db.select().from(playerCharacters).where(eq(playerCharacters.id, characterId)).limit(1);
  return rows[0] ?? null;
}

export async function joinParty(characterId: string, party: JoinableParty) {
  const character = await loadCharacter(characterId);
  if (!character) throw new PartyError(404, "No active character found.");
  if (await activeCensure(characterId)) {
    throw new PartyError(409, "You are under censure and cannot change party allegiance.");
  }
  if (character.party !== "none") {
    throw new PartyError(409, "You are already in a party. Leave it before joining another.");
  }
  if (!meetsPartyIdeology(party, character.ideology)) {
    const side = party === "dynatoi" ? "Reformist" : "Traditionalist";
    throw new PartyError(400, `Joining the ${party === "dynatoi" ? "Dynatoi" : "Palaioi"} requires at least 10% ${side} ideology.`);
  }
  await db.update(playerCharacters).set({ party }).where(eq(playerCharacters.id, characterId));
  return { party };
}

export async function leaveParty(characterId: string) {
  const character = await loadCharacter(characterId);
  if (!character) throw new PartyError(404, "No active character found.");
  if (await activeCensure(characterId)) {
    throw new PartyError(409, "You are under censure and cannot change party allegiance.");
  }
  if (character.party === "none") {
    throw new PartyError(400, "You are not in a party.");
  }
  await db.update(playerCharacters).set({ party: "none" }).where(eq(playerCharacters.id, characterId));
  // Voluntary defection while in good standing brands you a turncoat.
  await addTrait(characterId, "turncoat").catch(() => {
    /* turncoat is reputation (no cap/opposite); ignore the rare rule error */
  });
  return { party: "none" as const };
}

// Single hook: run after any effect batch that changed a character's ideology.
// Opens a censure if a member has drifted out of range and isn't already censured.
export async function onIdeologyChanged(characterId: string, now: Date = new Date()) {
  // First settle any censure that has already expired.
  await resolveCensureIfExpired(characterId, now);

  const character = await loadCharacter(characterId);
  if (!character) return;
  if (!hasDriftedFromParty(character.party as PoliticalParty, character.ideology)) return;
  if (await getCensure(characterId)) return; // already censured

  const expiresAt = new Date(now.getTime() + CENSURE_DURATION_MS);
  await db
    .insert(censures)
    .values({ characterId, party: character.party, expiresAt })
    .onConflictDoNothing();
  // Fire-and-forget: never block the request on Redis. Lazy-on-read resolution
  // is the safety net if the worker/Redis is unavailable.
  void enqueueCensureResolution(characterId, CENSURE_DURATION_MS);
}
