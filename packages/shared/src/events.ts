import { z } from "zod";

export type EventCondition =
  | { type: "province_owner"; provinceId: string; ownerPlayerId: string }
  | { type: "resource_at_least"; scope: "player" | "province"; id: string; resource: string; amount: number };

export type EventEffect =
  | { type: "gain_resource"; scope: "player" | "province"; id: string; resource: string; amount: number }
  | { type: "set_province_owner"; provinceId: string; ownerPlayerId: string }
  | { type: "change_trait"; characterId: string; traitId: string; operation: "add" | "remove" }
  | { type: "change_ideology"; characterId: string; amount: number }
  | { type: "spawn_army"; ownerPlayerId: string; provinceId: string; units: Record<string, number> };

export interface EventChoice {
  id: string;
  label: string;
  requirements?: EventCondition[];
  effects: EventEffect[];
  resultText: string;
  // Composure tags — matched against trait opposes/embraces. Optional, so events
  // authored before composure remain valid.
  tags?: string[];
}

export interface EventDefinition {
  id: string;
  weight: number;
  conditions?: EventCondition[];
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

const effectSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("gain_resource"), scope: z.enum(["player", "province"]), id: z.string(), resource: z.string(), amount: z.number() }),
  z.object({ type: z.literal("set_province_owner"), provinceId: z.string(), ownerPlayerId: z.string() }),
  z.object({ type: z.literal("change_trait"), characterId: z.string(), traitId: z.string(), operation: z.enum(["add", "remove"]) }),
  z.object({ type: z.literal("change_ideology"), characterId: z.string(), amount: z.number() }),
  z.object({ type: z.literal("spawn_army"), ownerPlayerId: z.string(), provinceId: z.string(), units: z.record(z.string(), z.number()) }),
]);

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
  scene: z.string(),
  choices: z.array(eventChoiceSchema),
});

export function parseEventDefinition(data: unknown): EventDefinition {
  return eventDefinitionSchema.parse(data) as EventDefinition;
}

// Sum of ideology shifts a choice applies (for composure drift preview/cost).
export function choiceIdeologyDelta(choice: EventChoice): number {
  return choice.effects
    .filter((effect): effect is Extract<EventEffect, { type: "change_ideology" }> => effect.type === "change_ideology")
    .reduce((sum, effect) => sum + effect.amount, 0);
}
