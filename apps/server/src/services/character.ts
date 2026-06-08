import { and, eq } from "drizzle-orm";
import { createDb, players, playerCharacters, worlds } from "@massalia/db";
import {
  applyDailyReset,
  CLASS_START,
  effectiveStats,
  HOUSE_START,
  isWithdrawn,
  remainingActions,
  spendAction,
  startingCharacter,
  type CharacterSheet,
  type CharacterStats,
  type ClassId,
  type HeldTrait,
  type Party,
} from "@massalia/shared";
import { getComposureConfig } from "./composure.js";

const db = createDb();

export type CharacterRow = typeof playerCharacters.$inferSelect;
export type PlayerRow = typeof players.$inferSelect;

export async function getActiveWorldId(): Promise<string | null> {
  const rows = await db.select({ id: worlds.id }).from(worlds).where(eq(worlds.status, "active")).limit(1);
  return rows[0]?.id ?? null;
}

export async function getActivePlayer(userId: string, worldId: string): Promise<PlayerRow | null> {
  const rows = await db
    .select()
    .from(players)
    .where(and(eq(players.userId, userId), eq(players.worldId, worldId), eq(players.isActive, true)))
    .limit(1);
  return rows[0] ?? null;
}

function safeHouse(slug: string | null | undefined): string {
  return slug && HOUSE_START[slug] ? slug : "xanthippos";
}

function safeClass(slug: string | null | undefined): ClassId {
  return slug && (slug as ClassId) in CLASS_START ? (slug as ClassId) : "trader";
}

export async function findCharacterRow(playerId: string, worldId: string): Promise<CharacterRow | null> {
  const rows = await db
    .select()
    .from(playerCharacters)
    .where(and(eq(playerCharacters.playerId, playerId), eq(playerCharacters.worldId, worldId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createCharacterRow(
  playerId: string,
  worldId: string,
  houseId: string,
  classId: ClassId,
): Promise<CharacterRow> {
  const start = startingCharacter(houseId, classId);
  // Starting composure is config-driven (composure-config.json), not a literal.
  const startingComposure = getComposureConfig().startingComposure ?? start.composure;
  const inserted = await db
    .insert(playerCharacters)
    .values({
      playerId,
      worldId,
      houseSlug: houseId,
      classId,
      prestige: start.prestige,
      devotion: start.devotion,
      militia: start.militia,
      intelligence: start.intelligence,
      drachmae: start.drachmae,
      ideology: start.ideology,
      party: start.party,
      composure: startingComposure,
      growthMultiplier: String(start.growthMultiplier),
      actionsSpentToday: 0,
      lastActionReset: null,
    })
    .returning();
  return inserted[0]!;
}

// Fetch the player's sheet, auto-provisioning from their house + profession if
// they predate this table (legacy players + seed characters).
export async function ensureCharacterRow(player: PlayerRow, worldId: string): Promise<CharacterRow> {
  const existing = await findCharacterRow(player.id, worldId);
  if (existing) return existing;
  return createCharacterRow(player.id, worldId, safeHouse(player.houseSlug), safeClass(player.professionSlug));
}

// Lazy daily reset: persist a zeroed counter when we cross a UTC day boundary.
export async function withDailyReset(row: CharacterRow, now: Date): Promise<CharacterRow> {
  const reset = applyDailyReset(
    { actionsSpentToday: row.actionsSpentToday, lastActionReset: row.lastActionReset },
    now,
  );
  if (!reset.didReset) return row;
  const updated = await db
    .update(playerCharacters)
    .set({ actionsSpentToday: 0, lastActionReset: reset.lastActionReset })
    .where(eq(playerCharacters.id, row.id))
    .returning();
  return updated[0]!;
}

export type ActionGate = { ok: true } | { ok: false; code: number; error: string };

// The action gate: rejects while withdrawn (under a break), else spends one of
// the day's actions (lazy daily reset included). Used by event-choice resolution.
export async function beginAction(characterId: string, now: Date = new Date()): Promise<ActionGate> {
  const rows = await db.select().from(playerCharacters).where(eq(playerCharacters.id, characterId)).limit(1);
  const row = rows[0];
  if (!row) return { ok: false, code: 404, error: "No active character found." };

  if (isWithdrawn(row.breakUntil, now)) {
    return { ok: false, code: 423, error: "You have withdrawn from public life and cannot act today." };
  }

  const result = spendAction({ actionsSpentToday: row.actionsSpentToday, lastActionReset: row.lastActionReset }, now);
  if (!result.ok) {
    return { ok: false, code: 429, error: "No actions remaining today." };
  }
  await db
    .update(playerCharacters)
    .set({ actionsSpentToday: result.state.actionsSpentToday, lastActionReset: result.state.lastActionReset })
    .where(eq(playerCharacters.id, characterId));
  return { ok: true };
}

export function toCharacterSheet(
  row: CharacterRow,
  traits: HeldTrait[] = [],
  censureExpiresAt: string | null = null,
  now: Date = new Date(),
): CharacterSheet {
  const base: CharacterStats = {
    prestige: row.prestige,
    devotion: row.devotion,
    militia: row.militia,
    intelligence: row.intelligence,
  };
  return {
    id: row.id,
    playerId: row.playerId,
    worldId: row.worldId,
    houseId: row.houseSlug,
    classId: row.classId as ClassId,
    base,
    // Derived on read: base + trait statMods. Never persisted to base columns.
    effective: effectiveStats(base, traits),
    drachmae: row.drachmae,
    ideology: row.ideology,
    party: row.party as Party,
    composure: row.composure,
    withdrawn: isWithdrawn(row.breakUntil, now),
    growthMultiplier: Number(row.growthMultiplier),
    actionsSpentToday: row.actionsSpentToday,
    remainingActions: remainingActions(row.actionsSpentToday),
    lastActionReset: row.lastActionReset ? row.lastActionReset.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    traits,
    censured: censureExpiresAt !== null,
    censureExpiresAt,
  };
}
