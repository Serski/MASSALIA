// The lover plot (pack B): pure roll odds. The DB layer performs the actual rolls
// (with an injectable rng) and persists the plot state on the marriage row.

export const LOVER_FALL_BASE = 0.25;
export const LOVER_FALL_FLOOR = 0.05;
export const LOVER_FALL_SWING = 0.15;
// Personalities that make her more / less likely to stray.
export const LOVER_FALL_PRONE = ["hedonist", "hotblooded", "ambitious", "cunning", "greedy"];
export const LOVER_FALL_RESISTANT = ["pious", "temperate", "honest", "patient", "humble"];

export const LOVER_DISCOVERY_CHANCE = 0.15;
export const LOVER_DISCOVERY_PRESTIGE = -3;

// The yearly chance the wife falls to her lover: 25% base, ±15 by personality,
// with a 5% floor. Child-chance coupling lives in childRoll; this is the fall odds.
export function loverFallChance(personalityId: string | null): number {
  let chance = LOVER_FALL_BASE;
  if (personalityId && LOVER_FALL_PRONE.includes(personalityId)) chance += LOVER_FALL_SWING;
  else if (personalityId && LOVER_FALL_RESISTANT.includes(personalityId)) chance -= LOVER_FALL_SWING;
  return Math.max(LOVER_FALL_FLOOR, chance);
}
