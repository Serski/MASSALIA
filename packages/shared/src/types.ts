export type WorldStatus = "scheduled" | "active" | "archived";
export type ControlStatus = "controlled" | "occupied" | "contested";

export interface World {
  id: string;
  name: string;
  seed: string;
  startedAt: string;
  endsAt: string;
  status: WorldStatus;
}

export interface ProvinceState {
  id: string;
  worldId: string;
  name: string;
  regionId: string;
  realmId: string;
  terrain: string;
  ownerPlayerId: string | null;
  ownerName: string | null;
  factionId: string | null;
  factionColor: string;
  politicalColor: string;
  controlStatus: ControlStatus;
  isCity: boolean;
  buildings: Array<{ type: string; level: number; queuedCompletionAt: string | null }>;
  resources: Array<{ type: string; amount: number; ratePerSecond: number; lastUpdatedAt: string }>;
}

export interface MapGameState {
  world: World;
  provinces: Record<string, ProvinceState>;
}
