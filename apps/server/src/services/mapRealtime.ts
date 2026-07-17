// Realtime channel for the province/map system. Same in-process pub/sub pattern
// as services/worldState.ts (a Set of listeners), kept SEPARATE so the older map
// prototype is untouched. Diff-based on purpose: subscribers get the full state
// once on connect (from the route), then one small change event per conquest —
// never a full-state re-push, which would be O(all provinces) per change per
// subscriber and hurt when many players watch the same war.

// The per-change payload pushed to every subscriber. Mirrors one province's row
// in map_province_state after a change, plus the tick the change happened.
export interface MapProvinceChange {
  provinceId: string;
  ownerPolityId: string | null;
  controllerPolityId: string | null;
  sinceTick: number;
  tick: number;
  // 'occupy' (controller only) | 'annex' (owner + controller).
  changeType: string;
}

type Listener = (change: MapProvinceChange) => void;

const listeners = new Set<Listener>();

export function subscribeMap(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Fan a single province change out to every connected subscriber. Best-effort:
// a slow/broken listener never blocks the request that published the change.
export function publishMapChange(change: MapProvinceChange): void {
  for (const listener of listeners) {
    try {
      listener(change);
    } catch {
      // A dead SSE connection throwing on write must not break the others.
    }
  }
}
