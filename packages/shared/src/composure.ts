import { z } from "zod";
import type { Trait } from "./traits.js";

// ---------------------------------------------------------------------------
// Composure. ALL tunables live in content/composure/composure-config.json —
// no magic numbers in code. These pure functions are the heart of the system.
// ---------------------------------------------------------------------------

export const composureConfigSchema = z
  .object({
    costPerConflict: z.number(),
    gainPerEmbrace: z.number(),
    driftCostFactor: z.number(),
    maxGainPerAction: z.number(),
    baseRecoveryPerDay: z.number(),
    breakResetValue: z.number(),
    maxCopingTraits: z.number().int(),
    copingPool: z.array(z.string()),
    // How heavily a spouse's personality weighs versus the player's own nature
    // (family pack). Her conflict cost / embrace gain are multiplied by this
    // before joining the total. Optional; defaults to SPOUSE_WEIGHT_DEFAULT.
    spouseWeight: z.number().optional(),
    // Optional tunables from the content pack (accepted; behaviour may use them later).
    startingComposure: z.number().optional(),
    breakLockoutDays: z.number().optional(),
    escalation: z.object({ fromBreakNumber: z.number(), prestigePenalty: z.number() }).optional(),
  })
  .strict();

// A spouse's nature must not weigh as heavily as the player's own convictions.
export const SPOUSE_WEIGHT_DEFAULT = 0.45;

export type ComposureConfig = z.infer<typeof composureConfigSchema>;

export function parseComposureConfig(data: unknown): ComposureConfig {
  return composureConfigSchema.parse(data);
}

export const COMPOSURE_MIN = 0;
export const COMPOSURE_MAX = 100;

export function clampComposure(value: number): number {
  return Math.max(COMPOSURE_MIN, Math.min(COMPOSURE_MAX, Math.round(value)));
}

// Per-trait tag reaction: which of the choice's tags each trait opposes / embraces.
export type TraitTagReaction = { trait: Trait; conflictTags: string[]; embraceTags: string[] };

// The single source of truth for conflict/embrace matching. Composure scoring AND
// the philia spouse-reaction coupling both consume this, so they can never diverge
// on what counts as a conflict or an embrace.
export function scoreTraitTags(traits: Trait[], choiceTags: string[]): TraitTagReaction[] {
  const tags = new Set(choiceTags);
  return traits.map((trait) => ({
    trait,
    conflictTags: (trait.opposes ?? []).filter((tag) => tags.has(tag)),
    embraceTags: (trait.embraces ?? []).filter((tag) => tags.has(tag)),
  }));
}

// The heart: composure change for an action, given the actor's traits, the
// choice's tags, and the ideology shift the choice applies.
export function computeComposureDelta(
  heldTraits: Trait[],
  choiceTags: string[],
  ideologyDelta: number,
  config: ComposureConfig,
  spouseTraits: Trait[] = [],
): number {
  let delta = 0;

  for (const r of scoreTraitTags(heldTraits, choiceTags)) {
    if (r.conflictTags.length > 0) delta -= config.costPerConflict;
    if (r.embraceTags.length > 0) delta += config.gainPerEmbrace;
  }

  const heldIds = new Set(heldTraits.map((trait) => trait.id));
  if (heldIds.has("traditionalist") && ideologyDelta > 0) {
    delta -= ideologyDelta * config.driftCostFactor;
  }
  if (heldIds.has("syncretist") && ideologyDelta < 0) {
    delta -= Math.abs(ideologyDelta) * config.driftCostFactor;
  }

  // A living spouse reacts to the same tags at a reduced weight — she is not the
  // player, so her nature moves the number less. Excluded from the ideology-drift
  // clause above (that models the player's own convictions). Added into the same
  // running total so the clamp + single round below apply to the COMBINED result.
  const spouseWeight = config.spouseWeight ?? SPOUSE_WEIGHT_DEFAULT;
  for (const r of scoreTraitTags(spouseTraits, choiceTags)) {
    if (r.conflictTags.length > 0) delta -= config.costPerConflict * spouseWeight;
    if (r.embraceTags.length > 0) delta += config.gainPerEmbrace * spouseWeight;
  }

  // Clamp the positive total only — losses are unbounded.
  if (delta > config.maxGainPerAction) delta = config.maxGainPerAction;
  return Math.round(delta);
}

// Delta + a human-readable reason (for the choice preview and the audit log).
// "Never let a player pay a hidden cost."
export function describeComposureDelta(
  heldTraits: Trait[],
  choiceTags: string[],
  ideologyDelta: number,
  config: ComposureConfig,
  spouseTraits: Trait[] = [],
): { delta: number; reason: string } {
  const delta = computeComposureDelta(heldTraits, choiceTags, ideologyDelta, config, spouseTraits);
  const heldReactions = scoreTraitTags(heldTraits, choiceTags);
  const conflicts = heldReactions.filter((r) => r.conflictTags.length > 0).map((r) => r.trait.name);
  const embraces = heldReactions.filter((r) => r.embraceTags.length > 0).map((r) => r.trait.name);
  const heldIds = new Set(heldTraits.map((t) => t.id));
  const drifts =
    (heldIds.has("traditionalist") && ideologyDelta > 0) || (heldIds.has("syncretist") && ideologyDelta < 0);
  // Her contribution is named separately — never let the player pay a hidden cost
  // (or bank a hidden gain) that is really his wife reacting.
  const spouseReactions = scoreTraitTags(spouseTraits, choiceTags);
  const spouseConflicts = spouseReactions.filter((r) => r.conflictTags.length > 0).map((r) => r.trait.name);
  const spouseEmbraces = spouseReactions.filter((r) => r.embraceTags.length > 0).map((r) => r.trait.name);

  const parts: string[] = [];
  if (conflicts.length) parts.push(`troubles your ${conflicts.join(", ")} nature`);
  if (embraces.length) parts.push(`suits your ${embraces.join(", ")} nature`);
  if (spouseConflicts.length) parts.push(`troubles your wife's ${spouseConflicts.join(", ")} nature`);
  if (spouseEmbraces.length) parts.push(`suits your wife's ${spouseEmbraces.join(", ")} nature`);
  if (drifts) parts.push("strains your convictions");
  const reason = parts.length ? parts.join("; ") : "no effect on your composure";
  return { delta, reason };
}

// --- Lazy recovery (resource-accrual model) --------------------------------

export function recoveryPerDay(heldTraits: Trait[], config: ComposureConfig): number {
  const copingBonus = heldTraits
    .filter((trait) => trait.category === "coping")
    .reduce((sum, trait) => sum + (trait.recoveryBonus ?? 0), 0);
  return config.baseRecoveryPerDay + copingBonus;
}

export type ComposureAccrual = { composure: number; lastUpdate: Date };

// Accrue recovery since lastUpdate. To avoid losing fractional gains on frequent
// reads, lastUpdate only advances once at least a full point has accrued.
export function applyComposureRecovery(
  composure: number,
  lastUpdate: Date | null,
  now: Date,
  perDay: number,
): ComposureAccrual {
  if (lastUpdate === null) return { composure, lastUpdate: now };
  if (composure >= COMPOSURE_MAX) return { composure: COMPOSURE_MAX, lastUpdate: now };

  const days = (now.getTime() - lastUpdate.getTime()) / 86_400_000;
  if (days <= 0) return { composure, lastUpdate };

  const recovered = Math.min(COMPOSURE_MAX, composure + perDay * days);
  const floored = Math.floor(recovered);
  if (floored <= composure) {
    // Not enough time for +1 yet — keep lastUpdate so the accrual continues.
    return { composure, lastUpdate };
  }
  return { composure: floored, lastUpdate: now };
}

// --- Break -----------------------------------------------------------------

export function nextUtcDayBoundary(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

export function isWithdrawn(breakUntil: Date | null, now: Date): boolean {
  return breakUntil !== null && breakUntil.getTime() > now.getTime();
}

export type BreakOutcome = {
  composure: number;
  breakUntil: Date;
  grantedTrait: string | null;
  breaksCount: number;
};

// Resolve a break (composure hit 0). Grants one coping trait the character lacks
// (random from the pool) unless they're already at the cap, in which case the
// break only costs the locked day. `pick` is injectable for deterministic tests.
export function resolveBreak(args: {
  now: Date;
  breaksCount: number;
  heldCopingIds: string[];
  config: ComposureConfig;
  pick?: (candidates: string[]) => string;
}): BreakOutcome {
  const { now, breaksCount, heldCopingIds, config } = args;
  const available = config.copingPool.filter((id) => !heldCopingIds.includes(id));
  let grantedTrait: string | null = null;
  if (heldCopingIds.length < config.maxCopingTraits && available.length > 0) {
    const pick = args.pick ?? ((candidates) => candidates[Math.floor(Math.random() * candidates.length)]!);
    grantedTrait = pick(available);
  }
  // Lockout length from config (breakLockoutDays). 1 = until the next UTC day;
  // each extra day pushes the boundary out by a further full day.
  const lockoutDays = Math.max(1, Math.round(config.breakLockoutDays ?? 1));
  const breakUntil = new Date(nextUtcDayBoundary(now).getTime() + (lockoutDays - 1) * 86_400_000);
  return {
    composure: config.breakResetValue,
    breakUntil,
    grantedTrait,
    breaksCount: breaksCount + 1,
  };
}
