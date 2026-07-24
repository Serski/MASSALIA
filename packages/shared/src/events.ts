import { z } from "zod";
import type { CharacterStats } from "./character.js";

export type EventCondition =
  | { type: "province_owner"; provinceId: string; ownerPlayerId: string }
  | { type: "resource_at_least"; scope: "player" | "province"; id: string; resource: string; amount: number };

// Character-scoped effects omit characterId (applied to the acting character).
// change_trait / change_ideology keep an optional characterId for back-compat.
export type EventEffect =
  | { type: "gain_resource"; scope: "player" | "province"; id: string; resource: string; amount: number }
  | { type: "set_province_owner"; provinceId: string; ownerPlayerId: string }
  // World-scoped, explicitly-targeted effects (Atlas Phase 2b-ii). Trigger-agnostic:
  // the target city/faction is named in the payload — these NEVER read the acting
  // player to pick a target, so a future autonomous world tick can invoke them
  // unchanged. fortifications is intentionally excluded (Archon-only, phase 3).
  | { type: "change_city_stat"; cityId: string; stat: "population" | "tax" | "stability" | "garrison"; amount: number }
  | { type: "change_faction_stance"; factionId: string; amount: number }
  | { type: "set_faction_vassal"; factionId: string; vassal: boolean }
  | { type: "change_trait"; traitId: string; operation: "add" | "remove"; characterId?: string }
  | { type: "change_ideology"; amount: number; characterId?: string }
  | { type: "change_stat"; stat: keyof CharacterStats; amount: number }
  | { type: "change_composure"; amount: number }
  | { type: "change_drachmae"; amount: number }
  // Family arena: move philia (the spouse bond) by amount. A no-op with no living
  // spouse (unmarried/widowed) — see the executor.
  | { type: "change_philia"; amount: number }
  | { type: "change_party_favor"; party: "palaioi" | "dynatoi"; amount: number }
  | { type: "spawn_army"; ownerPlayerId: string; provinceId: string; units: Record<string, number> }
  // Festivals (Prompt 7): record a choregos donation to a festival instance.
  | { type: "register_choregos"; festivalId: string; amount: number }
  // Olympiad (Prompt 8 — accepted in schema now, no-op until then).
  | { type: "olympic_nominate" }
  | { type: "olympic_compete"; mode: string };

// Child age bands (years, inclusive): infant 0–4, child 5–9, youth 10–14.
export type ChildAgeBand = "infant" | "child" | "youth";
export const CHILD_AGE_BANDS: Record<ChildAgeBand, readonly [number, number]> = {
  infant: [0, 4],
  child: [5, 9],
  youth: [10, 14],
};

// Event-level gating. An event is eligible only if every present condition passes.
export interface EventRequirements {
  class?: string;
  party?: string;
  office?: string; // e.g. "councilor"
  minStat?: Partial<Record<keyof CharacterStats, number>>;
  trait?: string;
  noTrait?: string;
  noClass?: string[]; // excluded classes (e.g. festivals barred to hetaira/slave)
  // Family arena gating (any of these routes the event to the "family" arena).
  married?: boolean; // requires a LIVING spouse
  spouseTrait?: string; // matches EITHER the spouse's personality OR mechanical trait id
  hasChildren?: boolean; // requires ≥1 living child
  childAgeBand?: ChildAgeBand; // some living child falls in this band
  childSex?: "male" | "female"; // narrows childAgeBand (or, alone, any living child of this sex)
  household?: boolean; // hetaira household events (classId === "hetaira")
}

export interface EventChoice {
  id: string;
  label: string;
  requirements?: EventCondition[];
  effects: EventEffect[];
  resultText: string;
  tags?: string[];
}

export interface EventDefinition {
  id: string;
  weight: number;
  conditions?: EventCondition[];
  requires?: EventRequirements;
  // "calendar" events fire from the festival/calendar system, NOT the daily draw.
  trigger?: string;
  scene: string;
  choices: EventChoice[];
}

// --- Zod validation (loaded content) ---------------------------------------

const conditionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("province_owner"), provinceId: z.string(), ownerPlayerId: z.string() }),
  z.object({
    type: z.literal("resource_at_least"),
    scope: z.enum(["player", "province"]),
    id: z.string(),
    resource: z.string(),
    amount: z.number(),
  }),
]);

const statName = z.enum(["prestige", "devotion", "militia", "intelligence"]);
// World-scoped city stats an event may move (fortifications excluded — Archon-only).
const cityStatName = z.enum(["population", "tax", "stability", "garrison"]);

const effectSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("gain_resource"), scope: z.enum(["player", "province"]), id: z.string(), resource: z.string(), amount: z.number() }),
  z.object({ type: z.literal("set_province_owner"), provinceId: z.string(), ownerPlayerId: z.string() }),
  z.object({ type: z.literal("change_city_stat"), cityId: z.string(), stat: cityStatName, amount: z.number() }),
  z.object({ type: z.literal("change_faction_stance"), factionId: z.string(), amount: z.number() }),
  z.object({ type: z.literal("set_faction_vassal"), factionId: z.string(), vassal: z.boolean() }),
  z.object({ type: z.literal("change_trait"), traitId: z.string(), operation: z.enum(["add", "remove"]), characterId: z.string().optional() }),
  z.object({ type: z.literal("change_ideology"), amount: z.number(), characterId: z.string().optional() }),
  z.object({ type: z.literal("change_stat"), stat: statName, amount: z.number() }),
  z.object({ type: z.literal("change_composure"), amount: z.number() }),
  z.object({ type: z.literal("change_drachmae"), amount: z.number() }),
  z.object({ type: z.literal("change_philia"), amount: z.number() }),
  z.object({ type: z.literal("change_party_favor"), party: z.enum(["palaioi", "dynatoi"]), amount: z.number() }),
  z.object({ type: z.literal("spawn_army"), ownerPlayerId: z.string(), provinceId: z.string(), units: z.record(z.string(), z.number()) }),
  z.object({ type: z.literal("register_choregos"), festivalId: z.string(), amount: z.number() }),
  z.object({ type: z.literal("olympic_nominate") }),
  z.object({ type: z.literal("olympic_compete"), mode: z.string() }),
]);

const requiresSchema = z
  .object({
    class: z.string().optional(),
    party: z.string().optional(),
    office: z.string().optional(),
    minStat: z.record(statName, z.number()).optional(),
    trait: z.string().optional(),
    noTrait: z.string().optional(),
    noClass: z.array(z.string()).optional(),
    married: z.boolean().optional(),
    spouseTrait: z.string().optional(),
    hasChildren: z.boolean().optional(),
    childAgeBand: z.enum(["infant", "child", "youth"]).optional(),
    childSex: z.enum(["male", "female"]).optional(),
    household: z.boolean().optional(),
  })
  .strict();

export const eventChoiceSchema = z.object({
  id: z.string(),
  label: z.string(),
  requirements: z.array(conditionSchema).optional(),
  effects: z.array(effectSchema),
  resultText: z.string(),
  tags: z.array(z.string()).optional(),
});

export const eventDefinitionSchema = z.object({
  id: z.string(),
  weight: z.number(),
  conditions: z.array(conditionSchema).optional(),
  requires: requiresSchema.optional(),
  trigger: z.string().optional(),
  scene: z.string(),
  choices: z.array(eventChoiceSchema),
});

export function parseEventDefinition(data: unknown): EventDefinition {
  return eventDefinitionSchema.parse(data) as EventDefinition;
}

// A content file may be a single event or an array of events (category packs).
export function parseEventFile(data: unknown): EventDefinition[] {
  const arr = Array.isArray(data) ? data : [data];
  return arr.map((entry) => parseEventDefinition(entry));
}

// --- Eligibility, draw, growth (pure) --------------------------------------

export type EligibilityContext = {
  classId: string;
  party: string;
  isCouncilor: boolean;
  stats: CharacterStats;
  traitIds: string[];
  // Family arena inputs. Resolved from a LIVING spouse / living children (never
  // raw spouseCandidateId); default to unmarried/childless when not enriched.
  married: boolean;
  spouseTraitIds: string[]; // personality + mechanical ids of the living spouse; [] when unmarried
  livingChildren: { sex: "male" | "female"; ageYears: number }[];
};

// Calendar/festival events fire from the festival system, never the daily draw.
export function isCalendarEvent(event: EventDefinition): boolean {
  return event.trigger === "calendar";
}

export function isEventEligible(event: EventDefinition, ctx: EligibilityContext): boolean {
  const req = event.requires;
  if (!req) return true;
  if (req.class && req.class !== ctx.classId) return false;
  if (req.noClass && req.noClass.includes(ctx.classId)) return false;
  if (req.party && req.party !== ctx.party) return false;
  if (req.office === "councilor" && !ctx.isCouncilor) return false;
  if (req.trait && !ctx.traitIds.includes(req.trait)) return false;
  if (req.noTrait && ctx.traitIds.includes(req.noTrait)) return false;
  if (req.minStat) {
    for (const [stat, amount] of Object.entries(req.minStat)) {
      if (ctx.stats[stat as keyof CharacterStats] < (amount as number)) return false;
    }
  }
  // --- Family gating -------------------------------------------------------
  if (req.married !== undefined && ctx.married !== req.married) return false;
  // spouseTrait matches EITHER the spouse's personality or mechanical id (its
  // presence implies a living spouse — spouseTraitIds is [] when unmarried).
  if (req.spouseTrait && !ctx.spouseTraitIds.includes(req.spouseTrait)) return false;
  if (req.hasChildren !== undefined && ctx.livingChildren.length > 0 !== req.hasChildren) return false;
  if (req.childAgeBand) {
    const [lo, hi] = CHILD_AGE_BANDS[req.childAgeBand];
    const match = ctx.livingChildren.some(
      (child) => child.ageYears >= lo && child.ageYears <= hi && (!req.childSex || child.sex === req.childSex),
    );
    if (!match) return false;
  } else if (req.childSex) {
    // childSex without a band: any living child of that sex.
    if (!ctx.livingChildren.some((child) => child.sex === req.childSex)) return false;
  }
  if (req.household === true && ctx.classId !== "hetaira") return false;
  return true;
}

// Which daily "arena" an event belongs to, inferred from its gating.
export type EventArena = "class" | "council" | "party" | "general" | "family";

// Any family requirement routes the event to the "family" arena — checked BEFORE
// class/office/party, so a hetaira household event ({class:"hetaira", household})
// lands in "family", not "class".
function hasFamilyRequirement(req: EventRequirements): boolean {
  return (
    req.married !== undefined ||
    req.spouseTrait !== undefined ||
    req.hasChildren !== undefined ||
    req.childAgeBand !== undefined ||
    req.childSex !== undefined ||
    req.household !== undefined
  );
}

export function eventArena(event: EventDefinition): EventArena {
  const req = event.requires;
  if (req && hasFamilyRequirement(req)) return "family";
  if (req?.class) return "class";
  if (req?.office === "councilor") return "council";
  if (req?.party) return "party";
  return "general";
}

// Whether the character qualifies for the family arena at all: a living spouse,
// ≥1 living child, or the hetaira class (her household).
export function qualifiesForFamilyArena(ctx: { classId: string; married: boolean; livingChildren: unknown[] }): boolean {
  return ctx.married || ctx.livingChildren.length > 0 || ctx.classId === "hetaira";
}

// The arenas a character draws a daily card from: class + general always,
// council if a councilor, party if aligned. The family arena is included ONLY on
// the winter day (once per game year by construction — 1 winter per 4-day year)
// and only when the character qualifies.
export function dailyArenasFor(
  ctx: { isCouncilor: boolean; party: string; classId: string; married: boolean; livingChildren: unknown[] },
  isWinter: boolean,
): EventArena[] {
  const arenas: EventArena[] = ["class", "general"];
  if (ctx.isCouncilor) arenas.push("council");
  if (ctx.party && ctx.party !== "none") arenas.push("party");
  if (isWinter && qualifiesForFamilyArena(ctx)) arenas.push("family");
  return arenas;
}

// Weighted draw over eligible events, excluding recently-seen ids. If every
// eligible event was recently seen, fall back to the full eligible set.
export function drawEvent<T extends { id: string; weight: number }>(
  eligible: T[],
  recentIds: string[],
  rng: () => number = Math.random,
): T | null {
  if (eligible.length === 0) return null;
  const recent = new Set(recentIds);
  let pool = eligible.filter((event) => !recent.has(event.id));
  if (pool.length === 0) pool = eligible;

  const total = pool.reduce((sum, event) => sum + Math.max(0, event.weight), 0);
  if (total <= 0) return pool[0] ?? null;
  let roll = rng() * total;
  for (const event of pool) {
    roll -= Math.max(0, event.weight);
    if (roll < 0) return event;
  }
  return pool[pool.length - 1] ?? null;
}

// Positive stat gains scale by the character's growth multiplier (round half up);
// losses are unscaled.
export function applyStatGrowth(amount: number, growthMultiplier: number): number {
  if (amount <= 0) return amount;
  return Math.round(amount * growthMultiplier);
}

// Sum of ideology shifts a choice applies (for the composure drift preview/cost).
export function choiceIdeologyDelta(choice: EventChoice): number {
  return choice.effects
    .filter((effect): effect is Extract<EventEffect, { type: "change_ideology" }> => effect.type === "change_ideology")
    .reduce((sum, effect) => sum + effect.amount, 0);
}

// Sum of explicit change_composure effects on a choice. Composure also moves from
// the tag/ideology-driven layer (describeComposureDelta); the preview combines both
// so a player never pays a hidden composure cost.
export function choiceComposureEffectDelta(choice: EventChoice): number {
  return choice.effects
    .filter((effect): effect is Extract<EventEffect, { type: "change_composure" }> => effect.type === "change_composure")
    .reduce((sum, effect) => sum + effect.amount, 0);
}

// One mechanical effect of a choice, rendered for the up-front cost preview.
export type ChoiceCost = { label: string; tone: "positive" | "negative" | "neutral" };

const STAT_COST_LABELS: Record<keyof CharacterStats, string> = {
  prestige: "Prestige",
  devotion: "Devotion",
  militia: "Militia",
  intelligence: "Intelligence",
};

function signedAmount(amount: number): string {
  return amount > 0 ? `+${amount}` : `${amount}`;
}

// Human-readable mechanical effects shown BEFORE a player commits (stats, drachmae,
// party favor, ideology lean, resources). Composure is surfaced separately (combined
// tag + explicit). Trait/army/province effects stay as post-decision reveals.
export function describeChoiceCosts(choice: EventChoice): ChoiceCost[] {
  const costs: ChoiceCost[] = [];
  for (const effect of choice.effects) {
    switch (effect.type) {
      case "change_stat":
        costs.push({ label: `${signedAmount(effect.amount)} ${STAT_COST_LABELS[effect.stat]}`, tone: effect.amount >= 0 ? "positive" : "negative" });
        break;
      case "change_drachmae":
        costs.push({ label: `${signedAmount(effect.amount)} drachmae`, tone: effect.amount >= 0 ? "positive" : "negative" });
        break;
      case "change_party_favor":
        costs.push({
          label: `${signedAmount(effect.amount)} ${effect.party === "palaioi" ? "Palaioi" : "Dynatoi"} favor`,
          tone: effect.amount >= 0 ? "positive" : "negative",
        });
        break;
      case "change_ideology":
        // Only the acting character's own lean is a visible self-cost.
        if (effect.characterId || effect.amount === 0) break;
        costs.push({ label: `+${Math.abs(effect.amount)} ${effect.amount > 0 ? "Reformist" : "Traditionalist"}`, tone: "neutral" });
        break;
      case "gain_resource":
        costs.push({ label: `+${effect.amount} ${effect.resource}`, tone: "positive" });
        break;
      default:
        break;
    }
  }
  return costs;
}
