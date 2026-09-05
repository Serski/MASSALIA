import { allowedMapActions, HOME_POLITY_ID, type MapActionType, type MapTargetKind } from "@massalia/shared";

// The four map actions in display order, with their labels. Rendered as an inert
// button row on both the town and the region panel: legality (enabled/disabled)
// comes from the shared matrix; nothing fires yet — that is a later batch.
export const MAP_ACTIONS: readonly { type: MapActionType; label: string }[] = [
  { type: "attack", label: "Attack" },
  { type: "raid", label: "Raid" },
  { type: "scout", label: "Scout" },
  { type: "colonise", label: "Colonise" },
];

export type MapActionButton = { type: MapActionType; label: string; enabled: boolean; title?: string };

// Why a button is greyed out. Massalia's own holdings outrank the colonise rule.
export function disabledReason(action: MapActionType, input: { kind: MapTargetKind; hasTown: boolean; ownerId: string | null }): string {
  if (input.ownerId === HOME_POLITY_ID) return "Massalia does not act against her own";
  if (action === "colonise") return "Colonies are founded in open country";
  return "Not available here";
}

export function mapActionButtons(input: { kind: MapTargetKind; hasTown: boolean; ownerId: string | null }): MapActionButton[] {
  const allowed = new Set(allowedMapActions(input));
  return MAP_ACTIONS.map(({ type, label }) =>
    allowed.has(type) ? { type, label, enabled: true } : { type, label, enabled: false, title: disabledReason(type, input) },
  );
}
