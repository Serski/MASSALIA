import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { createDb, playerCharacters } from "@massalia/db";
import {
  AGE_STAT_KEYS,
  capStat,
  currentAge,
  decayBandFor,
  parseAgeConfig,
  type AgeConfig,
} from "@massalia/shared";

const db = createDb();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const configFile = path.join(repoRoot, "content/age/age-config.json");

let config: AgeConfig | null = null;

// Validate the config at boot (fail fast on a malformed file); memoized.
export async function loadAgeConfig(): Promise<AgeConfig> {
  const raw = await fs.readFile(configFile, "utf8");
  config = parseAgeConfig(JSON.parse(raw));
  return config;
}

export function getAgeConfig(): AgeConfig {
  if (!config) throw new Error("Age config not loaded. Call loadAgeConfig() at boot.");
  return config;
}

// Public asset path for a portrait image (the static server mounts content/ at /content/).
export function portraitUrl(relativePath: string | null): string | null {
  return relativePath ? `/content/age/${relativePath}` : null;
}

// Lazy old-age decay (mirrors composure's lazy recovery): accrue decay since
// last_decay_at and persist when at least one stat drops a whole point. Holding
// the anchor until a point is earned — and advancing it only by the time those
// whole points justify — keeps sub-point progress from being lost across the
// many reads on the fast clock (so slow-decaying stats still decline). Called on
// the same read path that lazily updates composure. No background loop.
export async function decayCharacter(characterId: string, now: Date = new Date()): Promise<void> {
  const cfg = getAgeConfig();
  const rows = await db.select().from(playerCharacters).where(eq(playerCharacters.id, characterId)).limit(1);
  const row = rows[0];
  if (!row) return;

  // Initialise the anchor for legacy/never-decayed rows.
  if (!row.lastDecayAt) {
    await db.update(playerCharacters).set({ lastDecayAt: now }).where(eq(playerCharacters.id, characterId));
    return;
  }

  const age = currentAge(row.startAge, row.createdAt.getTime(), now.getTime(), cfg);
  const band = decayBandFor(age, cfg);
  const rates = AGE_STAT_KEYS.map((key) => [key, band[key] ?? 0] as const).filter(([, perYear]) => perYear !== 0);

  // No decay possible in this band (e.g. Prime): keep the anchor current, no loss.
  if (rates.length === 0) {
    await db.update(playerCharacters).set({ lastDecayAt: now }).where(eq(playerCharacters.id, characterId));
    return;
  }

  const elapsedYears = (now.getTime() - row.lastDecayAt.getTime()) / cfg.realMsPerGameYear;
  if (elapsedYears <= 0) return;

  // Whole points each stat has earned to lose, and the time that justifies them.
  const updates: Partial<Record<(typeof AGE_STAT_KEYS)[number], number>> = {};
  let consumedYears = 0;
  for (const [key, perYear] of rates) {
    const pointsLost = Math.floor(perYear * elapsedYears);
    if (pointsLost > 0) {
      updates[key] = capStat(row[key] - pointsLost, cfg);
      consumedYears = Math.max(consumedYears, pointsLost / perYear);
    }
  }

  // Not enough elapsed for any stat to drop a point yet — hold the anchor so the
  // fractional progress keeps accruing toward the next read.
  if (consumedYears === 0) return;

  const nextAnchor = new Date(row.lastDecayAt.getTime() + consumedYears * cfg.realMsPerGameYear);
  await db
    .update(playerCharacters)
    .set({ ...updates, lastDecayAt: nextAnchor })
    .where(eq(playerCharacters.id, characterId));
}
