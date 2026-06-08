import { z } from "zod";
import type { CharacterStats } from "./character.js";

// ---------------------------------------------------------------------------
// Trait content schema + pure rules (cap, opposites, derived stats).
// Content lives in content/traits/traits.json; the server validates it at boot.
// ---------------------------------------------------------------------------

export const TRAIT_CATEGORIES = ["personality", "upbringing", "class", "coping", "reputation"] as const;
export type TraitCategory = (typeof TRAIT_CATEGORIES)[number];

const statModSchema = z
  .object({
    prestige: z.number().optional(),
    devotion: z.number().optional(),
    militia: z.number().optional(),
    intelligence: z.number().optional(),
  })
  .strict();

export const traitSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    category: z.enum(TRAIT_CATEGORIES),
    statMod: statModSchema.optional(),
    opposes: z.array(z.string()).optional(), // composure tags (Prompt 4)
    embraces: z.array(z.string()).optional(), // composure tags (Prompt 4)
    opposite: z.string().optional(), // personality pairing
    recoveryBonus: z.number().optional(), // coping traits
    incomeMod: z.number().optional(), // % income modifier, e.g. -0.10
  })
  .strict();

export type Trait = z.infer<typeof traitSchema>;

export const traitsFileSchema = z.array(traitSchema);

// Validate the raw parsed JSON. Throws (ZodError) on an invalid file so the
// server can fail fast at boot.
export function parseTraitsFile(data: unknown): Trait[] {
  const traits = traitsFileSchema.parse(data);
  const seen = new Set<string>();
  for (const trait of traits) {
    if (seen.has(trait.id)) throw new Error(`Duplicate trait id in traits.json: ${trait.id}`);
    seen.add(trait.id);
  }
  return traits;
}

export type HeldTrait = Trait & { gainedAt: string };

// --- Pure rules ------------------------------------------------------------

export const MAX_PERSONALITY_TRAITS = 3;

export type AddTraitRejection = "duplicate" | "personality_cap" | "opposite";
export type AddTraitResult = { ok: true } | { ok: false; reason: AddTraitRejection };

// Whether `candidate` may be added given the traits already held.
export function canAddTrait(held: Trait[], candidate: Trait): AddTraitResult {
  if (held.some((trait) => trait.id === candidate.id)) {
    return { ok: false, reason: "duplicate" };
  }
  if (
    candidate.category === "personality" &&
    held.filter((trait) => trait.category === "personality").length >= MAX_PERSONALITY_TRAITS
  ) {
    return { ok: false, reason: "personality_cap" };
  }
  // Opposite pairing is symmetric: reject if the candidate opposes a held trait
  // OR a held trait opposes the candidate.
  if (candidate.opposite && held.some((trait) => trait.id === candidate.opposite)) {
    return { ok: false, reason: "opposite" };
  }
  if (held.some((trait) => trait.opposite === candidate.id)) {
    return { ok: false, reason: "opposite" };
  }
  return { ok: true };
}

// Effective stats = base + sum of statMod across held traits. Never written back
// to base columns — computed on read.
export function effectiveStats(base: CharacterStats, traits: Trait[]): CharacterStats {
  const effective: CharacterStats = { ...base };
  for (const trait of traits) {
    if (!trait.statMod) continue;
    effective.prestige += trait.statMod.prestige ?? 0;
    effective.devotion += trait.statMod.devotion ?? 0;
    effective.militia += trait.statMod.militia ?? 0;
    effective.intelligence += trait.statMod.intelligence ?? 0;
  }
  return effective;
}
