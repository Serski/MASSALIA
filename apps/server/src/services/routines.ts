import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { createDb, dailyRoutines, effectLog, playerCharacters } from "@massalia/db";
import {
  applyClassMods,
  applyStatGrowth,
  capStat,
  describeComposureDelta,
  isWithdrawn,
  ladderProgress,
  nextLadderThreshold,
  parseRoutineFile,
  parseRoutinesConfig,
  roundHalfUp,
  routinesForClass,
  type ChoiceCost,
  type CharacterStats,
  type RoutineCard,
  type RoutinesConfig,
} from "@massalia/shared";
import { applyComposureDelta, getComposureConfig, recoverComposure } from "./composure.js";
import { getAgeConfig } from "./age.js";
import { addTrait, getHeldTraits, removeTrait, TraitRuleError } from "./traits.js";
import { utcDayString } from "./dailyDecisions.js";
import { eligibleForCampaign, grantCampaignFavor } from "./elections.js";
import { broadcastState } from "./worldState.js";

const db = createDb();

// The campaign routine (Politics Prompt 2) lives in the "campaign" pool — off
// every class pool — and is surfaced ONLY to declared candidates in an active
// election. Picking it grants party-favor visibility that feeds the NPC sway.
const CAMPAIGN_POOL = "campaign";

function campaignCard(): RoutineCard | null {
  return getRoutineCards().find((card) => card.pool === CAMPAIGN_POOL) ?? null;
}

// The campaign card a declared candidate may pick today (appended to their pool),
// or null when they are not standing in an active election.
export async function campaignCardFor(characterId: string): Promise<RoutineCard | null> {
  const card = campaignCard();
  if (!card) return null;
  return (await eligibleForCampaign(characterId)) ? card : null;
}
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const routinesFile = path.join(repoRoot, "content/routines/routines.json");
const routinesConfigFile = path.join(repoRoot, "content/routines/routines-config.json");

type CharacterRow = typeof playerCharacters.$inferSelect;

// Ladder key -> the player_characters XP column that backs it.
const LADDER_XP_COLUMN = {
  rhetoric: "rhetoricXp",
  philosophia: "philosophiaXp",
  gymnasium: "gymnasiumXp",
  mysteries: "mysteriesXp",
} as const satisfies Record<string, keyof CharacterRow>;

let cards: RoutineCard[] | null = null;
let config: RoutinesConfig | null = null;

// Validate both content files at boot (fail fast on a malformed file); memoized.
export async function loadRoutineContent(): Promise<{ cards: RoutineCard[]; config: RoutinesConfig }> {
  const [rawCards, rawConfig] = await Promise.all([
    fs.readFile(routinesFile, "utf8"),
    fs.readFile(routinesConfigFile, "utf8"),
  ]);
  cards = parseRoutineFile(JSON.parse(rawCards));
  config = parseRoutinesConfig(JSON.parse(rawConfig));
  return { cards, config };
}

export function getRoutineCards(): RoutineCard[] {
  if (!cards) throw new Error("Routine content not loaded. Call loadRoutineContent() at boot.");
  return cards;
}

export function getRoutinesConfig(): RoutinesConfig {
  if (!config) throw new Error("Routine content not loaded. Call loadRoutineContent() at boot.");
  return config;
}

const STAT_LABELS: Record<keyof CharacterStats, string> = {
  prestige: "Prestige",
  devotion: "Devotion",
  militia: "Militia",
  intelligence: "Intelligence",
};

function signed(amount: number): string {
  return amount > 0 ? `+${amount}` : `${amount}`;
}

// Cost chips for a final (post-classMods, post-growth) effect list.
function costChips(effects: { type: string; stat?: keyof CharacterStats; amount: number }[]): ChoiceCost[] {
  const chips: ChoiceCost[] = [];
  for (const effect of effects) {
    if (effect.type === "change_stat" && effect.stat) {
      chips.push({ label: `${signed(effect.amount)} ${STAT_LABELS[effect.stat]}`, tone: effect.amount >= 0 ? "positive" : "negative" });
    } else if (effect.type === "change_drachmae") {
      chips.push({ label: `${signed(effect.amount)} drachmae`, tone: effect.amount >= 0 ? "positive" : "negative" });
    }
  }
  return chips;
}

export type RoutinePreview = {
  id: string;
  label: string;
  scene: string;
  tags: string[];
  feedsLadder: string | null;
  costs: ChoiceCost[];
  composureDelta: number;
  composureReason: string;
};

// Per-character resolved preview: effects after classMods + growthMultiplier, and
// the composure delta from the tag pipeline + any classMods composure bonus —
// the same preview path events use (never a hidden cost).
export function previewRoutine(
  card: RoutineCard,
  row: Pick<CharacterRow, "classId" | "growthMultiplier">,
  traits: Parameters<typeof describeComposureDelta>[0],
): RoutinePreview {
  const cfg = getRoutinesConfig();
  const resolved = applyClassMods(card, row.classId, cfg);
  const growth = Number(row.growthMultiplier);

  const finalEffects = resolved.effects.map((effect) =>
    effect.type === "change_stat" ? { ...effect, amount: applyStatGrowth(effect.amount, growth) } : effect,
  );

  const tag = describeComposureDelta(traits, card.tags, 0, getComposureConfig());
  const composureFromEffects = resolved.effects
    .filter((effect): effect is Extract<typeof effect, { type: "change_composure" }> => effect.type === "change_composure")
    .reduce((sum, effect) => sum + effect.amount, 0);
  const composureDelta = tag.delta + composureFromEffects + resolved.composureBonus;
  const composureReason =
    tag.delta !== 0 ? tag.reason : composureDelta !== 0 ? "the rhythm of the day" : tag.reason;

  return {
    id: card.id,
    label: card.label,
    scene: card.scene,
    tags: card.tags,
    feedsLadder: card.feedsLadder ?? null,
    costs: costChips(finalEffects),
    composureDelta,
    composureReason,
  };
}

// Ladder state for the four tracks (for the progress bars).
export function ladderStates(row: CharacterRow) {
  const cfg = getRoutinesConfig();
  return Object.fromEntries(
    Object.entries(cfg.ladders).map(([key, def]) => {
      const column = LADDER_XP_COLUMN[key as keyof typeof LADDER_XP_COLUMN];
      const xp = column ? (row[column] as number) : 0;
      return [key, { xp, nextThreshold: nextLadderThreshold(xp, def), stat: def.stat, tiers: def.tiers }];
    }),
  );
}

export type RoutineResolution =
  | { ok: false; code: number; error: string }
  | {
      ok: true;
      routineId: string;
      label: string;
      repeated: boolean;
      costs: ChoiceCost[];
      composureDelta: number;
      composureReason: string;
      composure: number;
      broke: boolean;
      grantedTrait: string | null;
      ladder: { id: string; newXp: number; nextThreshold: number | null; traitGranted: string | null } | null;
    };

// Resolve a routine for the acting character. One pick/day (daily_routines unique
// row), withdrawn-gated like events, with the same-routine-as-yesterday repeat
// penalty on stat/drachmae/ladder XP (not composure).
export async function resolveRoutine(row: CharacterRow, routineId: string, now: Date = new Date()): Promise<RoutineResolution> {
  const cfg = getRoutinesConfig();
  const pool = routinesForClass(getRoutineCards(), row.classId, cfg);
  let card = pool.find((candidate) => candidate.id === routineId);
  // The campaign card is off-pool: allow it only for a declared candidate.
  if (!card && routineId === campaignCard()?.id) {
    card = (await campaignCardFor(row.id)) ?? undefined;
  }
  if (!card) return { ok: false, code: 409, error: "That routine is not among your daily choices." };

  if (isWithdrawn(row.breakUntil, now)) {
    return { ok: false, code: 423, error: "You have withdrawn from public life and cannot act today." };
  }

  const utcDay = utcDayString(now);
  const already = await db
    .select({ id: dailyRoutines.id })
    .from(dailyRoutines)
    .where(and(eq(dailyRoutines.characterId, row.id), eq(dailyRoutines.utcDay, utcDay)));
  if (already.length > 0) return { ok: false, code: 409, error: "You have already chosen your routine today." };

  // Repeat penalty: same routine as yesterday halves stat/drachmae/ladder gains.
  const yesterday = utcDayString(new Date(now.getTime() - 86_400_000));
  const priorRows = await db
    .select({ routineId: dailyRoutines.routineId })
    .from(dailyRoutines)
    .where(and(eq(dailyRoutines.characterId, row.id), eq(dailyRoutines.utcDay, yesterday)));
  const repeated = priorRows.some((prior) => prior.routineId === routineId);
  const penalty = repeated ? cfg.repeatPenalty : 1;

  // Lazy composure recovery first, then read the fresh sheet (composure + XP).
  await recoverComposure(row.id, now);
  const freshRows = await db.select().from(playerCharacters).where(eq(playerCharacters.id, row.id)).limit(1);
  const fresh = freshRows[0] ?? row;

  const resolved = applyClassMods(card, row.classId, cfg);

  // Repeat penalty hits stat/drachmae amounts and ladder XP — never composure.
  const penalizedEffects = resolved.effects.map((effect) =>
    effect.type === "change_stat" || effect.type === "change_drachmae"
      ? { ...effect, amount: roundHalfUp(effect.amount * penalty) }
      : effect,
  );
  const penalizedLadderXp = roundHalfUp(resolved.ladderXp * penalty);

  // Combined composure delta (tag pipeline + explicit change_composure + classMods bonus).
  const traits = await getHeldTraits(row.id);
  const tag = describeComposureDelta(traits, card.tags, 0, getComposureConfig());
  const composureFromEffects = resolved.effects
    .filter((effect): effect is Extract<typeof effect, { type: "change_composure" }> => effect.type === "change_composure")
    .reduce((sum, effect) => sum + effect.amount, 0);
  const composureDelta = tag.delta + composureFromEffects + resolved.composureBonus;
  const composureReason =
    tag.delta !== 0 ? tag.reason : composureDelta !== 0 ? "the rhythm of the day" : tag.reason;

  // Stat/drachmae effects + effect log + the daily_routines claim, in one tx.
  const appliedCosts: ChoiceCost[] = [];
  await db.transaction(async (tx) => {
    for (const effect of penalizedEffects) {
      if (effect.type === "change_stat") {
        const rows = await tx.select().from(playerCharacters).where(eq(playerCharacters.id, row.id)).limit(1);
        const current = rows[0];
        if (!current) continue;
        const applied = applyStatGrowth(effect.amount, Number(current.growthMultiplier));
        const next = capStat(current[effect.stat] + applied, getAgeConfig());
        await tx.update(playerCharacters).set({ [effect.stat]: next }).where(eq(playerCharacters.id, row.id));
        await tx.insert(effectLog).values({
          characterId: row.id,
          kind: "change_stat",
          detail: { stat: effect.stat, requested: effect.amount, applied, source: `routine:${card.id}` },
        });
        appliedCosts.push({ label: `${signed(applied)} ${STAT_LABELS[effect.stat]}`, tone: applied >= 0 ? "positive" : "negative" });
      } else if (effect.type === "change_drachmae") {
        const rows = await tx.select({ drachmae: playerCharacters.drachmae }).from(playerCharacters).where(eq(playerCharacters.id, row.id)).limit(1);
        const current = rows[0];
        if (!current) continue;
        const next = Math.max(0, current.drachmae + effect.amount);
        await tx.update(playerCharacters).set({ drachmae: next }).where(eq(playerCharacters.id, row.id));
        await tx.insert(effectLog).values({
          characterId: row.id,
          kind: "change_drachmae",
          detail: { amount: effect.amount, value: next, source: `routine:${card.id}` },
        });
        appliedCosts.push({ label: `${signed(effect.amount)} drachmae`, tone: effect.amount >= 0 ? "positive" : "negative" });
      }
      // change_composure handled below as a single combined delta.
    }
    await tx.insert(dailyRoutines).values({ characterId: row.id, utcDay, routineId: card.id });
  });

  // Composure via the break-aware service + audit log (same as event resolution).
  const composure = await applyComposureDelta(row.id, composureDelta, `routine:${card.id}`, now);

  // Advance the fed ladder and grant/upgrade the tier trait via the trait service.
  let ladderOut: { id: string; newXp: number; nextThreshold: number | null; traitGranted: string | null } | null = null;
  if (card.feedsLadder && penalizedLadderXp !== 0) {
    const ladderDef = cfg.ladders[card.feedsLadder];
    const column = LADDER_XP_COLUMN[card.feedsLadder as keyof typeof LADDER_XP_COLUMN];
    if (ladderDef && column) {
      const currentXp = fresh[column] as number;
      const progress = ladderProgress(currentXp, penalizedLadderXp, ladderDef);
      await db.update(playerCharacters).set({ [column]: progress.newXp }).where(eq(playerCharacters.id, row.id));
      if (progress.traitToRemove) await removeTrait(row.id, progress.traitToRemove);
      if (progress.traitToGrant) {
        try {
          await addTrait(row.id, progress.traitToGrant);
        } catch (error) {
          if (!(error instanceof TraitRuleError)) throw error;
          console.warn(`routine ladder grant skipped (${error.reason}): ${error.message}`);
        }
      }
      ladderOut = {
        id: card.feedsLadder,
        newXp: progress.newXp,
        nextThreshold: nextLadderThreshold(progress.newXp, ladderDef),
        traitGranted: progress.traitToGrant ?? null,
      };
    }
  }

  // Campaign visibility: +party favor toward the candidate's own party (feeds the
  // NPC favor-sway at the close tally). Independents court no party — no-op there.
  if (card.pool === CAMPAIGN_POOL) await grantCampaignFavor(row.id);

  await broadcastState();

  return {
    ok: true,
    routineId: card.id,
    label: card.label,
    repeated,
    costs: appliedCosts,
    composureDelta,
    composureReason,
    composure: composure.composure,
    broke: composure.broke,
    grantedTrait: composure.grantedTrait,
    ladder: ladderOut,
  };
}
