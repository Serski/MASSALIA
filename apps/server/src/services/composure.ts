import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { characterTraits, composureLog, createDb, playerCharacters, type DbExec } from "@massalia/db";
import {
  applyComposureRecovery,
  choiceComposureEffectDelta,
  choiceIdeologyDelta,
  clampComposure,
  describeComposureDelta,
  parseComposureConfig,
  philiaModifiers,
  recoveryPerDay,
  resolveBreak,
  type ComposureConfig,
  type EventChoice,
  type Trait,
} from "@massalia/shared";
import { getHeldTraits } from "./traits.js";
import { livingSpouseState } from "./family.js";

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

// Net composure change for a choice = the trait/ideology-driven layer PLUS any
// explicit change_composure effects. Combined so the preview equals what resolving
// actually applies — never a hidden composure cost. Shared by the events route
// (preview + live resolve) and the lazy default path (applyExpiredDefaults), so
// an expired card pays exactly what the player would have.
export function composurePreview(choice: EventChoice, traits: Trait[], config: ComposureConfig, spouseTraits: Trait[]): { delta: number; reason: string } {
  // Her reaction to the choice's tags hits composure with attribution + spouseWeight
  // (same as routines). Deliberately NO tag-derived philia here — family events move
  // philia only through their explicit change_philia effects (the double-count guard).
  const tag = describeComposureDelta(traits, choice.tags ?? [], choiceIdeologyDelta(choice), config, spouseTraits);
  const explicit = choiceComposureEffectDelta(choice);
  const delta = tag.delta + explicit;
  const reason = tag.delta !== 0 ? tag.reason : explicit !== 0 ? "the toll of the act itself" : tag.reason;
  return { delta, reason };
}

type CharacterRow = typeof playerCharacters.$inferSelect;

async function loadRow(characterId: string, exec: DbExec = db): Promise<CharacterRow | null> {
  const rows = await exec.select().from(playerCharacters).where(eq(playerCharacters.id, characterId)).limit(1);
  return rows[0] ?? null;
}

// Lazy recovery: accrue composure since lastComposureUpdate, persisting if it
// advanced. Returns the current composure. Called on every read and before writes.
// `exec` runs the read + write inside a caller's transaction (claim-first resolves).
export async function recoverComposure(characterId: string, now: Date = new Date(), exec: DbExec = db): Promise<number> {
  const row = await loadRow(characterId, exec);
  if (!row) return 0;
  const traits = await getHeldTraits(characterId);
  // A living spouse in the DEVOTED philia band lifts the daily recovery rate. Lives
  // inside the recovery computation so every recoverComposure caller inherits it
  // without edits. Gated on spouseCandidateId — unmarried pays zero reads.
  const spouse = await livingSpouseState(row, now);
  const philiaBonus = spouse && spouse.philia !== null ? philiaModifiers(spouse.philia).composureRecoveryBonus : 0;
  const perDay = recoveryPerDay(traits, getComposureConfig()) + philiaBonus;
  const accrued = applyComposureRecovery(row.composure, row.lastComposureUpdate, now, perDay);
  if (accrued.composure !== row.composure || row.lastComposureUpdate === null) {
    await exec
      .update(playerCharacters)
      .set({ composure: accrued.composure, lastComposureUpdate: accrued.lastUpdate })
      .where(eq(playerCharacters.id, characterId));
  }
  return accrued.composure;
}

export type ComposureChange = { composure: number; broke: boolean; grantedTrait: string | null };

// Apply a composure delta from an action: recover first, clamp 0..100, log it,
// and trigger a break if it hits 0. `exec` runs every write inside a caller's
// transaction, so a claim-first resolve charges composure only when it won.
export async function applyComposureDelta(
  characterId: string,
  delta: number,
  reason: string,
  now: Date = new Date(),
  exec: DbExec = db,
): Promise<ComposureChange> {
  await recoverComposure(characterId, now, exec);
  const row = await loadRow(characterId, exec);
  if (!row) return { composure: 0, broke: false, grantedTrait: null };

  const cfg = getComposureConfig();
  const newComposure = clampComposure(row.composure + delta);
  await exec
    .insert(composureLog)
    .values({ characterId, delta: newComposure - row.composure, reason });
  await exec
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
  await exec
    .update(playerCharacters)
    .set({
      composure: outcome.composure,
      breakUntil: outcome.breakUntil,
      breaksCount: outcome.breaksCount,
      lastComposureUpdate: now,
    })
    .where(eq(playerCharacters.id, characterId));
  if (outcome.grantedTrait) {
    await exec.insert(characterTraits).values({ characterId, traitId: outcome.grantedTrait }).onConflictDoNothing();
  }
  await exec
    .insert(composureLog)
    .values({ characterId, delta: outcome.composure, reason: "break — withdrew from public life" });

  return { composure: outcome.composure, broke: true, grantedTrait: outcome.grantedTrait };
}
