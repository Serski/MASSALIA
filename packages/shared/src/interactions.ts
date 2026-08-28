import { z } from "zod";

// ---------------------------------------------------------------------------
// Player→player interactions (Interaction Pipeline, Prompt 1). The config for
// the pipeline every player-to-player action rides. `prestigeFloor` is the
// standing below which a target is shielded from HOSTILE actions (a low-prestige
// newcomer cannot be poisoned by an oligarch) — non-hostile actions ignore it.
// Prompt 1 ships one action (give drachmae, non-hostile). All tuning lives in
// content/politics/interactions.json (Zod-validated at boot); this module is pure.
// ---------------------------------------------------------------------------

export const interactionActionSchema = z.object({
  // Hostile actions (later: poison, assassination) respect the prestige floor;
  // give does not. Kept explicit so the floor is a per-action decision.
  hostile: z.boolean(),
  respectsPrestigeFloor: z.boolean(),
  minAmount: z.number().int().nonnegative(),
  maxAmount: z.number().int().positive(),
});
export type InteractionActionConfig = z.infer<typeof interactionActionSchema>;

// The poison action (Prompt 2). Success chance is a clamped function of the
// actor/target intelligence gap; a target physician lifts the target's defense by
// physicianMod. On success, illnessChance splits illness vs. death (deathChance is
// 1 − illnessChance — never stored).
export const poisonActionSchema = z.object({
  hostile: z.boolean(),
  respectsPrestigeFloor: z.boolean(),
  baseChance: z.number().min(0).max(1),
  statScale: z.number().positive(),
  clampMin: z.number().min(0).max(1),
  clampMax: z.number().min(0).max(1),
  physicianMod: z.number(),
  illnessChance: z.number().min(0).max(1),
});
export type PoisonConfig = z.infer<typeof poisonActionSchema>;

// The assassination action (Prompt 3). Same clamped intel-gap shape as poison, but
// the defense unit (bodyguards) is countable with DIMINISHING RETURNS — each extra
// guard adds less, asymptoting at bodyguardModMax. Success is always death, and the
// attempt costs a flat costDrachmae whatever the outcome.
export const assassinateActionSchema = z.object({
  hostile: z.boolean(),
  respectsPrestigeFloor: z.boolean(),
  costDrachmae: z.number().int().positive(),
  baseChance: z.number().min(0).max(1),
  statScale: z.number().positive(),
  clampMin: z.number().min(0).max(1),
  clampMax: z.number().min(0).max(1),
  bodyguardModMax: z.number().nonnegative(),
  bodyguardDecay: z.number().min(0).max(1),
});
export type AssassinateConfig = z.infer<typeof assassinateActionSchema>;

// The spymaster (Prompt 4) — a singleton household unit with a posture. 'guard'
// adds guardMod to the owner's DEFENSE on both hidden channels; 'hunt' adds huntMod
// to the owner's own attack intelligence. One posture switch per postureCooldownHours.
export const spymasterConfigSchema = z.object({
  guardMod: z.number().nonnegative(),
  huntMod: z.number().nonnegative(),
  postureCooldownHours: z.number().positive(),
});
export type SpymasterConfig = z.infer<typeof spymasterConfigSchema>;

export type SpymasterPosture = "guard" | "hunt";

export const interactionsConfigSchema = z
  .object({
    // The standing below which a target is shielded from hostile interactions.
    prestigeFloor: z.number().int().nonnegative(),
    // One hostile attempt (poison OR assassinate, combined) per attacker→target pair
    // per this many hours, counted from the attempt regardless of outcome. The
    // in-fiction lock copy calls this "two seasons".
    hostileCooldownHours: z.number().positive(),
    actions: z.object({
      give: interactionActionSchema,
      poison: poisonActionSchema,
      assassinate: assassinateActionSchema,
    }),
    spymaster: spymasterConfigSchema,
  })
  .passthrough(); // future actions ride along without a schema bump here

export type InteractionsConfig = z.infer<typeof interactionsConfigSchema>;

export function parseInteractionsConfig(data: unknown): InteractionsConfig {
  return interactionsConfigSchema.parse(data);
}

// The poison success probability (pure). D = target effective intelligence + a
// physician's defensive bonus + the target's spymaster guard (guardMod, or 0 — the
// caller resolves it from the spymaster's posture). p = clamp(base + (A − D)/statScale).
// The clamp floor is the untouchable-elite guard: even a maximally-defended target can
// be poisoned with at least clampMin probability; the ceiling caps a lopsided attacker.
export function poisonSuccessChance(actorIntel: number, targetIntel: number, hasPhysician: boolean, targetSpymasterGuard: number, cfg: PoisonConfig): number {
  const defense = targetIntel + (hasPhysician ? cfg.physicianMod : 0) + targetSpymasterGuard;
  const raw = cfg.baseChance + (actorIntel - defense) / cfg.statScale;
  return Math.min(cfg.clampMax, Math.max(cfg.clampMin, raw));
}

// Bodyguard defensive bonus with diminishing returns (pure). Each guard adds less
// than the last; the sum asymptotes at bodyguardModMax and never exceeds it. With
// the defaults (max 24, decay 0.5): n=0→0, 1→12, 2→18, 3→21.
export function bodyguardDefense(n: number, cfg: AssassinateConfig): number {
  return cfg.bodyguardModMax * (1 - cfg.bodyguardDecay ** n);
}

// The assassination success probability (pure) — same shape as poisonSuccessChance,
// but the defender's unit bonus is the diminishing-returns bodyguard curve. The
// target's spymaster guard (guardMod, or 0 — caller-resolved) adds to D on this
// channel too. The clamp floor is the same untouchable-elite guard.
export function assassinateSuccessChance(actorIntel: number, targetIntel: number, bodyguardCount: number, targetSpymasterGuard: number, cfg: AssassinateConfig): number {
  const defense = targetIntel + bodyguardDefense(bodyguardCount, cfg) + targetSpymasterGuard;
  const raw = cfg.baseChance + (actorIntel - defense) / cfg.statScale;
  return Math.min(cfg.clampMax, Math.max(cfg.clampMin, raw));
}
