import { eq } from "drizzle-orm";
import { createDb } from "./client.js";
import { playerCharacters, worlds } from "./schema.js";

const db = createDb();

// Exactly one world is active at any instant. The calendar restarts with every
// world, so anything that walks characters or keys on game time asks here first.
export async function activeWorld(): Promise<{ id: string; startedMs: number } | null> {
  const rows = await db.select({ id: worlds.id, startedAt: worlds.startedAt }).from(worlds).where(eq(worlds.status, "active")).limit(1);
  return rows[0] ? { id: rows[0].id, startedMs: rows[0].startedAt.getTime() } : null;
}

// True when the character exists and lives in the active world; false for an
// unknown id or when no world is active. The worker's per-character jobs ask this
// before working (and before re-arming) so an ended world's jobs drain away.
export async function characterInActiveWorld(characterId: string): Promise<boolean> {
  const world = await activeWorld();
  if (!world) return false;
  const rows = await db.select({ worldId: playerCharacters.worldId }).from(playerCharacters).where(eq(playerCharacters.id, characterId)).limit(1);
  return rows[0]?.worldId === world.id;
}
