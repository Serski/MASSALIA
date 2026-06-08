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
  | { type: "change_trait"; traitId: string; operation: "add" | "remove"; characterId?: string }
  | { type: "change_ideology"; amount: number; characterId?: string }
  | { type: "change_stat"; stat: keyof CharacterStats; amount: number }
  | { type: "change_composure"; amount: number }
  | { type: "change_drachmae"; amount: number }
  | { type: "change_party_favor"; party: "palaioi" | "dynatoi"; amount: number }
  | { type: "spawn_army"; ownerPlayerId: string; provinceId: string; units: Record<string, number> };

// Event-level gating. An event is eligible only if every present condition passes.
export interface EventRequirements {
  class?: string;
  party?: string;
  office?: string; // e.g. "councilor"
  minStat?: Partial<Record<keyof CharacterStats, number>>;
  trait?: string;
  noTrait?: string;
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

const effectSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("gain_resource"), scope: z.enum(["player", "province"]), id: z.string(), resource: z.string(), amount: z.number() }),
  z.object({ type: z.literal("set_province_owner"), provinceId: z.string(), ownerPlayerId: z.string() }),
  z.object({ type: z.literal("change_trait"), traitId: z.string(), operation: z.enum(["add", "remove"]), characterId: z.string().optional() }),
  z.object({ type: z.literal("change_ideology"), amount: z.number(), characterId: z.string().optional() }),
  z.object({ type: z.literal("change_stat"), stat: statName, amount: z.number() }),
  z.object({ type: z.literal("change_composure"), amount: z.number() }),
  z.object({ type: z.literal("change_drachmae"), amount: z.number() }),
  z.object({ type: z.literal("change_party_favor"), party: z.enum(["palaioi", "dynatoi"]), amount: z.number() }),
  z.object({ type: z.literal("spawn_army"), ownerPlayerId: z.string(), provinceId: z.string(), units: z.record(z.string(), z.number()) }),
]);

const requiresSchema = z
  .object({
    class: z.string().optional(),
    party: z.string().optional(),
    office: z.string().optional(),
    minStat: z.record(statName, z.number()).optional(),
    trait: z.string().optional(),
    noTrait: z.string().optional(),
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
};

export function isEventEligible(event: EventDefinition, ctx: EligibilityContext): boolean {
  const req = event.requires;
  if (!req) return true;
  if (req.class && req.class !== ctx.classId) return false;
  if (req.party && req.party !== ctx.party) return false;
  if (req.office === "councilor" && !ctx.isCouncilor) return false;
  if (req.trait && !ctx.traitIds.includes(req.trait)) return false;
  if (req.noTrait && ctx.traitIds.includes(req.noTrait)) return false;
  if (req.minStat) {
    for (const [stat, amount] of Object.entries(req.minStat)) {
      if (ctx.stats[stat as keyof CharacterStats] < (amount as number)) return false;
    }
  }
  return true;
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
