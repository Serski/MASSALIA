import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { characterTraits, composureLog, createDb, playerCharacters } from "@massalia/db";
import {
  applyComposureRecovery,
  clampComposure,
  parseComposureConfig,
  recoveryPerDay,
  resolveBreak,
  type ComposureConfig,
} from "@massalia/shared";
import { getHeldTraits } from "./traits.js";

const db = createDb();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const configFile = path.join(repoRoot, "content/composure/composure-config.json");

let config: ComposureConfig | null = null;

// Validate the config at boot (fail fast on a malformed file); memoized.
export async function loadComposureConfig(): Promise<ComposureConfig> {
  const raw = await fs.readFile(configFile, "utf8");
  config = parseComposureConfig(JSON.parse(raw));
  return config;
}

export function getComposureConfig(): ComposureConfig {
  if (!config) throw new Error("Composure config not loaded. Call loadComposureConfig() at boot.");
  return config;
}

type CharacterRow = typeof playerCharacters.$inferSelect;

async function loadRow(characterId: string): Promise<CharacterRow | null> {
  const rows = await db.select().from(playerCharacters).where(eq(playerCharacters.id, characterId)).limit(1);
  return rows[0] ?? null;
}

// Lazy recovery: accrue composure since lastComposureUpdate, persisting if it
// advanced. Returns the current composure. Called on every read and before writes.
export async function recoverComposure(characterId: string, now: Date = new Date()): Promise<number> {
  const row = await loadRow(characterId);
  if (!row) return 0;
  const traits = await getHeldTraits(characterId);
  const perDay = recoveryPerDay(traits, getComposureConfig());
  const accrued = applyComposureRecovery(row.composure, row.lastComposureUpdate, now, perDay);
  if (accrued.composure !== row.composure || row.lastComposureUpdate === null) {
    await db
      .update(playerCharacters)
      .set({ composure: accrued.composure, lastComposureUpdate: accrued.lastUpdate })
      .where(eq(playerCharacters.id, characterId));
  }
  return accrued.composure;
}

export type ComposureChange = { composure: number; broke: boolean; grantedTrait: string | null };

// Apply a composure delta from an action: recover first, clamp 0..100, log it,
// and trigger a break if it hits 0.
export async function applyComposureDelta(
  characterId: string,
  delta: number,
  reason: string,
  now: Date = new Date(),
): Promise<ComposureChange> {
  await recoverComposure(characterId, now);
  const row = await loadRow(characterId);
  if (!row) return { composure: 0, broke: false, grantedTrait: null };

  const cfg = getComposureConfig();
  const newComposure = clampComposure(row.composure + delta);
  await db
    .insert(composureLog)
    .values({ characterId, delta: newComposure - row.composure, reason });
  await db
    .update(playerCharacters)
    .set({ composure: newComposure, lastComposureUpdate: now })
    .where(eq(playerCharacters.id, characterId));

  if (newComposure > 0) {
    return { composure: newComposure, broke: false, grantedTrait: null };
  }

  // Break: composure hit 0.
  const heldCopingIds = (await getHeldTraits(characterId))
    .filter((t) => t.category === "coping")
    .map((t) => t.id);
  const outcome = resolveBreak({ now, breaksCount: row.breaksCount, heldCopingIds, config: cfg });
  await db
    .update(playerCharacters)
    .set({
      composure: outcome.composure,
      breakUntil: outcome.breakUntil,
      breaksCount: outcome.breaksCount,
      lastComposureUpdate: now,
    })
    .where(eq(playerCharacters.id, characterId));
  if (outcome.grantedTrait) {
    await db.insert(characterTraits).values({ characterId, traitId: outcome.grantedTrait }).onConflictDoNothing();
  }
  await db
    .insert(composureLog)
    .values({ characterId, delta: outcome.composure, reason: "break — withdrew from public life" });

  return { composure: outcome.composure, broke: true, grantedTrait: outcome.grantedTrait };
}
