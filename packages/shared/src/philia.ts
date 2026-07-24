// Philia: the 0–100 spouse bond and its consequences (clamp, bands, band
// modifiers, and the fertility multiplier). Kept in its own module so the
// consequence surface has one home; family.ts moves philia, this reads it.

export const PHILIA_MIN = 0;
export const PHILIA_MAX = 100;
export function clampPhilia(value: number): number {
  return Math.max(PHILIA_MIN, Math.min(PHILIA_MAX, value));
}

export type PhiliaBand = "estranged" | "cold" | "dutiful" | "warm" | "devoted";

// Bands (inclusive upper bounds): estranged ≤10, cold ≤30, dutiful ≤70,
// warm ≤80, devoted >80.
export function philiaBand(p: number): PhiliaBand {
  if (p <= 10) return "estranged";
  if (p <= 30) return "cold";
  if (p <= 70) return "dutiful";
  if (p <= 80) return "warm";
  return "devoted";
}

export type PhiliaModifiers = { assassinationDefenseMod: number; composureRecoveryBonus: number };

// Band modifiers. Only the two extreme bands carry a modifier today.
// NOTE: assassinationDefenseMod has NO consumer — it is a defined input reserved
// for the future D4 intrigue system (exported + tested here, wired nowhere).
export function philiaModifiers(p: number): PhiliaModifiers {
  switch (philiaBand(p)) {
    case "estranged":
      return { assassinationDefenseMod: -5, composureRecoveryBonus: 0 };
    case "devoted":
      return { assassinationDefenseMod: 0, composureRecoveryBonus: 2 };
    default:
      return { assassinationDefenseMod: 0, composureRecoveryBonus: 0 };
  }
}

// Fertility multiplier from philia: min(philia / 50, 1.2). A floor of 0 falls out
// naturally (philia is clamped to [0,100]). 50 → 1.0 (today's neutral behaviour).
export function philiaFertilityMultiplier(p: number): number {
  return Math.min(p / 50, 1.2);
}
