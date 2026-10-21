// ---------------------------------------------------------------------------
// The alert (Military 6a, ruling 2). A place no house holds, at or below
// `share` of its full strength (battle.json alert.share), is on alert: no raid
// is ordered there, and one on the road turns back when it arrives. Scout and
// Attack are still open, and an attack fights the whole pool. The alert lifts
// when the pool's regrowth takes it above the share. One test for every
// caller: a house's raid, a koinon's muster, the League's raid, the strikes
// and the map (6b moves it to the sally pool).
// ---------------------------------------------------------------------------

import { regrownPool } from "./barracks.js";
import { REAL_MS_PER_SEASON } from "./calendar.js";

// Within a hair of the product: 0.29 × 100 is 28.999999999999996 in floating
// point, and a pool of 29 is at it.
const HAIR = 1e-9;

// Whether a pool of `pool` men, of `full` at full strength, is on alert. A
// place with no full strength is never on alert.
export function onAlert(pool: number, full: number, share: number): boolean {
  return full > 0 && pool <= full * share + HAIR;
}

// The least a strike's dead may leave in a pool it drew from (Military 6a,
// ruling 3): half its full strength, rounded up (alert.share of it, within a
// hair). A pool may land exactly on the alert: 50 of 100 is at half.
export function alertFloor(full: number, share: number): number {
  return Math.max(0, Math.ceil(full * share - HAIR));
}

// The line a raid meets at a place on alert, refused or turned back, and the
// one the map shows: a town shuts its gates, a land drives its herds away.
export function alertLine(place: string, kind: "town" | "land"): string {
  return kind === "town" ? `${place} is on alert, gates are shut.` : `${place} is on alert, the herds are driven into the hills.`;
}

// When a pool on alert comes off it (Military 6a, ruling 3: a raids march
// called while its place is on alert waits for this): the first whole day of
// the pool's own regrowth clock, from `markerMs` (its updated_at), whose
// regrowth (regrownPool, one season a day) takes it above the alert.
// `markerMs` itself when the pool is not on alert (a place with no full
// strength never is); null when it never comes off (no regrowth).
export function aboveAlertAt(stored: number, full: number, markerMs: number, regenShare: number, share: number): number | null {
  if (!onAlert(stored, full, share)) return markerMs;
  if (Math.ceil(regenShare * full) <= 0) return null;
  for (let days = 1; ; days++) if (!onAlert(regrownPool(stored, full, days, regenShare), full, share)) return markerMs + days * REAL_MS_PER_SEASON;
}
