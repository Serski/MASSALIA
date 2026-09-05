// ---------------------------------------------------------------------------
// World 2 map actions — the shared legality matrix (infrastructure only; no action
// resolves yet). Every map action targets a town or a townless region:
//   scout / raid / attack  — legal against towns and townless regions;
//   colonise               — legal only against townless regions;
//   nothing                — against anything Massalia owns.
// Pure and DB-free so the client can grey out buttons and the server can validate
// the same way when actions arrive in a later batch.
// ---------------------------------------------------------------------------

export type MapActionType = "attack" | "raid" | "scout" | "colonise";
export type MapTargetKind = "town" | "region";
export type MapActionTarget = { kind: MapTargetKind; id: string };

export const MAP_ACTION_TYPES: readonly MapActionType[] = ["attack", "raid", "scout", "colonise"];

// The polity id whose holdings are never legal targets.
export const HOME_POLITY_ID = "massalia";

export type AllowedMapActionsInput = {
  kind: MapTargetKind;
  // Regions holding a town are never colonised (and towns, by definition, have one).
  hasTown: boolean;
  // The current owner's polity id; null for genuinely ownerless land.
  ownerId: string | null;
};

export function allowedMapActions(input: AllowedMapActionsInput): MapActionType[] {
  if (input.ownerId === HOME_POLITY_ID) return [];
  const actions: MapActionType[] = ["attack", "raid", "scout"];
  if (input.kind === "region" && !input.hasTown) actions.push("colonise");
  return actions;
}
