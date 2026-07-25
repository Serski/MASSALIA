import { philiaModifiers } from "./philia.js";

// Family pack C: the tragedies. A marriage languishing at or below the philia
// threshold risks, each game year, a terminal act by the wife — resolved by her
// personality into one of three archetypes. Pure logic; the roll and its side
// effects live in rollChildrenDue (packages/db), which the worker can reach.

export const TRAGEDY_PHILIA_THRESHOLD = 5; // the roll exists only at philia <= this
export const TRAGEDY_YEARLY_CHANCE = 0.1;

// Clytemnestra's attempt: a base chance, eroded per militia point, hard-floored so
// a strong household is never fully immune.
const CLYTEMNESTRA_BASE_CHANCE = 0.25;
const CLYTEMNESTRA_MILITIA_FALLOFF = 0.03;
const CLYTEMNESTRA_MIN_CHANCE = 0.05;

// The personalities dangerous enough to turn on the player rather than themselves.
const CLYTEMNESTRA_PERSONALITIES = new Set(["ruthless", "hotblooded", "ambitious", "cunning", "greedy"]);

export type TragedyArchetype = "medea" | "clytemnestra" | "phaedra";

// Which tragedy a philia<=threshold marriage resolves to, by the wife's nature:
// - medea:        a ruthless wife who ran the lover plot AND bore living children —
//                 she takes the children with her (the hard triple gate).
// - clytemnestra: any dangerous personality that fails Medea's gate (incl. a
//                 ruthless wife with no plot or no children) — she attempts the
//                 player's life.
// - phaedra:      everyone else, a wife with no personality included — she alone dies.
export function tragedyArchetype(input: {
  personalityId: string | null;
  loverPlotWasRun: boolean; // loverStartedAt != null
  hasLivingChildren: boolean;
}): TragedyArchetype {
  if (input.personalityId === "ruthless" && input.loverPlotWasRun && input.hasLivingChildren) return "medea";
  if (input.personalityId !== null && CLYTEMNESTRA_PERSONALITIES.has(input.personalityId)) return "clytemnestra";
  return "phaedra";
}

// Clytemnestra's success chance: base + the estranged band's assassination-defense
// swing, minus militia, floored. This is the FIRST real consumer of
// philiaModifiers().assassinationDefenseMod.
export function clytemnestraSuccessChance(
  militia: number,
  // The estranged-band assassination-defense modifier. Defaults to the value the
  // shared band table gives at the tragedy threshold (always the estranged band),
  // so the swing is DERIVED — never a hardcoded 5. A test may pass its own to prove
  // the chance tracks the modifier.
  assassinationDefenseMod: number = philiaModifiers(TRAGEDY_PHILIA_THRESHOLD).assassinationDefenseMod,
): number {
  // assassinationDefenseMod is a DEFENSE modifier: the estranged band's -5 means the
  // player is defended 5 points WORSE, i.e. +5 to HER success. Negate it exactly ONCE
  // here to convert defense into attacker advantage — do NOT negate again at any call site.
  const chance = CLYTEMNESTRA_BASE_CHANCE + -assassinationDefenseMod / 100 - CLYTEMNESTRA_MILITIA_FALLOFF * militia;
  return Math.max(CLYTEMNESTRA_MIN_CHANCE, chance);
}
