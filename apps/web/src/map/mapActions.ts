import { allowedMapActions, forceStats, HOME_POLITY_ID, REACH_REASON, verdictsFor, type MapActionType, type MapTargetKind } from "@massalia/shared";
import type { FleetView, ReachEntry } from "../api.js";

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

// Reach on top of legality: a button the matrix enables is still disabled when
// the target is out of reach, with the reason as its title. Scouts move like
// raiders, so Scout reads the Raid verdict. The server's verdicts judge the
// whole roster, but the picker sends any selection, so with the fleet given the
// button is judged for a one-man party: it greys only for reasons no selection
// could mend (no men at all, no base within reach, the fleet's range, no hulls),
// never because every man at once would not fit aboard. A missing entry (region
// not in the reach record) keeps the matrix's verdict. `caption` is the first
// reach reason, for a one-line note under the row on touch, where titles are
// unreachable.
const REACH_VERDICT: Partial<Record<MapActionType, "attack" | "raid" | "colonise">> = { attack: "attack", raid: "raid", scout: "raid", colonise: "colonise" };
const ONE_MAN = forceStats([{ spd: 6, space: 1, count: 1 }]);

export function withReach(buttons: MapActionButton[], entry: ReachEntry | undefined, fleet?: FleetView): { buttons: MapActionButton[]; caption: string | null } {
  if (!entry) return { buttons, caption: null };
  // With the fleet known, judge a one-man party; the server's own "no men"
  // verdict stands since a probe would not see it.
  const probed = fleet && entry.attack.reason !== REACH_REASON.noMen ? { ...entry, ...verdictsFor(entry, ONE_MAN, { range: fleet.range, space: fleet.space, tiers: fleet.tiers }) } : entry;
  let caption: string | null = null;
  const out = buttons.map((b) => {
    const key = REACH_VERDICT[b.type];
    if (!b.enabled || !key) return b;
    const verdict = probed[key];
    if (verdict.ok) return b;
    const reason = verdict.reason ?? "Out of reach";
    caption ??= reason;
    return { ...b, enabled: false, title: reason };
  });
  return { buttons: out, caption };
}
