export type EventCondition =
  | { type: "province_owner"; provinceId: string; ownerPlayerId: string }
  | { type: "resource_at_least"; scope: "player" | "province"; id: string; resource: string; amount: number };

export type EventEffect =
  | { type: "gain_resource"; scope: "player" | "province"; id: string; resource: string; amount: number }
  | { type: "set_province_owner"; provinceId: string; ownerPlayerId: string }
  | { type: "change_trait"; characterId: string; traitId: string; operation: "add" | "remove" }
  | { type: "spawn_army"; ownerPlayerId: string; provinceId: string; units: Record<string, number> };

export interface EventChoice {
  id: string;
  label: string;
  requirements?: EventCondition[];
  effects: EventEffect[];
  resultText: string;
}

export interface EventDefinition {
  id: string;
  weight: number;
  conditions?: EventCondition[];
  scene: string;
  choices: EventChoice[];
}
