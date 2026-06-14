import { z } from "zod";
import type { CharacterStats } from "./character.js";

// ---------------------------------------------------------------------------
// Daily Routines: the proactive half of the daily loop. A player picks ONE
// routine per UTC day. Cards live in content/routines/routines.json; all tuning
// (pools, repeat penalty, ladders) lives in routines-config.json — no constants
// in code. Effects reuse a subset of the event effect vocab and the composure
// tag pipeline, so routines never introduce new composure/effect math.
// ---------------------------------------------------------------------------

const statName = z.enum(["prestige", "devotion", "militia", "intelligence"]);

// Routines use a subset of the event effect vocab. change_party_favor arrived with
// the mercenary abroad cards (Hoplite Step 3) — foreign service shifts factional
// standing — reusing the event engine's party-favor effect shape.
export type RoutineEffect =
  | { type: "change_stat"; stat: keyof CharacterStats; amount: number }
  | { type: "change_composure"; amount: number }
  | { type: "change_drachmae"; amount: number }
  | { type: "change_party_favor"; party: "palaioi" | "dynatoi"; amount: number };

const routineEffectSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("change_stat"), stat: statName, amount: z.number() }),
  z.object({ type: z.literal("change_composure"), amount: z.number() }),
  z.object({ type: z.literal("change_drachmae"), amount: z.number() }),
  z.object({ type: z.literal("change_party_favor"), party: z.enum(["palaioi", "dynatoi"]), amount: z.number() }),
]);

// Per-class flavour: scale the card's own effect amounts / ladder XP, add a flat
// composure delta, and/or append extra effects. Classes not named use the card as-is.
export type ClassMod = {
  amountMult?: number;
  xpMult?: number;
  composure?: number;
  extra?: RoutineEffect[];
};

const classModSchema = z
  .object({
    amountMult: z.number().optional(),
    xpMult: z.number().optional(),
    composure: z.number().optional(),
    extra: z.array(routineEffectSchema).optional(),
  })
  .strict();

// Routine consumption hooks (Economy Build 1): a card may REQUIRE a good and/or a
// drachmae fee to be picked. A `good` is debited from the player's inventory (the
// resources rows); if absent the pick is rejected. A `fee` is debited from the
// wallet and credited to the world treasury stub. `waivedBy` names a building —
// if the player owns it (any tier), the cost is zeroed (shown as a waiver). NO
// free variants: without the good (and without a waiver) the card cannot be run.
export type RoutineRequirement = {
  good?: { type: string; qty: number };
  fee?: number;
  waivedBy?: string;
};

const routineRequirementSchema = z
  .object({
    good: z.object({ type: z.string(), qty: z.number().int().positive() }).strict().optional(),
    fee: z.number().int().positive().optional(),
    waivedBy: z.string().optional(),
  })
  .strict();

export type RoutineCard = {
  id: string;
  pool: string;
  label: string;
  scene: string;
  tags: string[];
  effects: RoutineEffect[];
  feedsLadder?: string;
  ladderXp?: number;
  classMods?: Record<string, ClassMod>;
  requires?: RoutineRequirement;
};

export const routineCardSchema = z
  .object({
    id: z.string(),
    pool: z.string(),
    label: z.string(),
    scene: z.string(),
    tags: z.array(z.string()),
    effects: z.array(routineEffectSchema),
    feedsLadder: z.string().optional(),
    ladderXp: z.number().optional(),
    classMods: z.record(z.string(), classModSchema).optional(),
    requires: routineRequirementSchema.optional(),
  })
  .strict();

export function parseRoutineFile(data: unknown): RoutineCard[] {
  const arr = Array.isArray(data) ? data : [data];
  return arr.map((card) => routineCardSchema.parse(card) as RoutineCard);
}

// --- Config ----------------------------------------------------------------

export type LadderTier = { xp: number; trait: string };
export type LadderDef = { stat: keyof CharacterStats; tiers: LadderTier[] };

export type RoutinesConfig = {
  dailyPicks: number;
  repeatPenalty: number;
  poolByClass: Record<string, string>;
  ladders: Record<string, LadderDef>;
};

const ladderTierSchema = z.object({ xp: z.number(), trait: z.string() });
const ladderDefSchema = z.object({ stat: statName, tiers: z.array(ladderTierSchema) });

export const routinesConfigSchema = z
  .object({
    dailyPicks: z.number(),
    repeatPenalty: z.number(),
    poolByClass: z.record(z.string(), z.string()),
    ladders: z.record(z.string(), ladderDefSchema),
  })
  .strict();

export function parseRoutinesConfig(data: unknown): RoutinesConfig {
  return routinesConfigSchema.parse(data) as RoutinesConfig;
}

// --- Pure resolution helpers -----------------------------------------------

// Round half up (ties toward +Infinity) — matches applyStatGrowth's Math.round,
// so routine scaling rounds the same way the event engine already does.
export function roundHalfUp(value: number): number {
  return Math.round(value);
}

export type ResolvedRoutine = {
  // Card effects with their amounts scaled by amountMult, plus any `extra` effects.
  effects: RoutineEffect[];
  // Ladder XP after xpMult (0 when the card feeds no ladder).
  ladderXp: number;
  // Flat composure delta this class gets on top of the tag/effect composure.
  composureBonus: number;
};

// Resolve a card for a class: scale the card's own effect amounts by amountMult,
// scale ladder XP by xpMult, surface the flat composure bonus, and append extras.
// The character growthMultiplier is applied LATER (to positive change_stat), the
// same as events — this function does not touch it.
export function applyClassMods(card: RoutineCard, classId: string, config: RoutinesConfig): ResolvedRoutine {
  void config; // tuning is per-card here; config kept for signature parity + future use
  const mod = card.classMods?.[classId];
  const amountMult = mod?.amountMult ?? 1;
  const xpMult = mod?.xpMult ?? 1;
  const composureBonus = mod?.composure ?? 0;

  const scaled: RoutineEffect[] =
    amountMult === 1
      ? card.effects.map((effect) => ({ ...effect }))
      : card.effects.map((effect) => ({ ...effect, amount: roundHalfUp(effect.amount * amountMult) }));

  const extra = (mod?.extra ?? []).map((effect) => ({ ...effect }));
  const ladderXp = roundHalfUp((card.ladderXp ?? 0) * xpMult);

  return { effects: [...scaled, ...extra], ladderXp, composureBonus };
}

export type LadderResult = { newXp: number; traitToGrant?: string; traitToRemove?: string };

// Advance a ladder. Tiers are ABSOLUTE totals (not cumulative): when the new XP
// crosses into a higher tier than the old XP, grant the new tier's trait and (if a
// lower tier was held) remove it. Below the first threshold, nothing is granted.
export function ladderProgress(currentXp: number, addXp: number, ladder: LadderDef): LadderResult {
  const newXp = currentXp + addXp;
  const tierIndexFor = (xp: number): number => {
    let idx = -1;
    ladder.tiers.forEach((tier, i) => {
      if (xp >= tier.xp) idx = i;
    });
    return idx;
  };

  const oldTier = tierIndexFor(currentXp);
  const newTier = tierIndexFor(newXp);
  if (newTier > oldTier && newTier >= 0) {
    return {
      newXp,
      traitToGrant: ladder.tiers[newTier]!.trait,
      ...(oldTier >= 0 ? { traitToRemove: ladder.tiers[oldTier]!.trait } : {}),
    };
  }
  return { newXp };
}

// The next tier threshold above currentXp (null when the top tier is reached).
export function nextLadderThreshold(currentXp: number, ladder: LadderDef): number | null {
  const next = ladder.tiers.find((tier) => currentXp < tier.xp);
  return next ? next.xp : null;
}

// --- Pool routing ----------------------------------------------------------

export function routinePoolFor(classId: string, config: RoutinesConfig): string {
  return config.poolByClass[classId] ?? "citizen";
}

export function routinesForClass(cards: RoutineCard[], classId: string, config: RoutinesConfig): RoutineCard[] {
  const pool = routinePoolFor(classId, config);
  return cards.filter((card) => card.pool === pool);
}
