import type { Topology } from "./mapGraph.js";

// ---------------------------------------------------------------------------
// Reach — which land provinces a player's force can Attack, Raid or Colonise
// from its bases, and why not. Pure: the server passes the topology, the
// player's bases, the active force, the fleet in stock and the set of regions
// Massalia itself owns; nothing here touches a database or the clock.
//
// Rules (barracks spec §8/§9 as ruled in prompt 3a):
//   land   Attack 1 step from a base; Raid 2 steps if every row is Spd 6+.
//   sea    a target's sea distance is the fewest sea provinces from any coastal
//          base's coast to a sea the target touches; it is in reach when that
//          distance is within the fleet's range (the lowest range of any ship
//          type present) and the force's space fits aboard.
//   Colonise uses Attack's reach (a colony party has to get there); legality by
//   target kind and owner stays with allowedMapActions.
// Entries exist only for land provinces that are not fog, not the Massalia
// region, not owned by Massalia (`homeRegions`) and not one of the player's own
// bases (a holding is ground to march from, never a target).
// ---------------------------------------------------------------------------

export type ReachForceRow = { spd: number; space: number; count: number };
export type ReachShip = { shipId: string; count: number; range: number; troopSpace: number };

export type ReachInput = {
  topology: Topology;
  /** region ids: massaliaRegion + held regions */
  bases: string[];
  /** active rows only */
  force: ReachForceRow[];
  fleet: ReachShip[];
  /** land regions owned by HOME_POLITY_ID (never targets) */
  homeRegions: Set<string>;
};

export type ReachVerdict = { ok: boolean; reason?: string };

export type ReachEntry = {
  /** shortest land distance from any base, null if > 2 */
  landSteps: number | null;
  /** fewest sea provinces from any base's coast to a sea touching this region, null if none */
  seaSteps: number | null;
  attack: ReachVerdict;
  raid: ReachVerdict;
  colonise: ReachVerdict;
};

export const MAX_LAND_STEPS = 2;
export const RAID_FAST_SPD = 6;

export const REACH_REASON = {
  noMen: "No men under arms.",
  noBase: "No base within reach.",
  tooFar: `Too far by land; a raiding party needs every man at Spd ${RAID_FAST_SPD} or more.`,
  range: (seaSteps: number, fleetRange: number) => `Beyond the fleet's range (${seaSteps} seas, fleet reaches ${fleetRange}).`,
  hulls: (forceSpace: number, fleetSpace: number) => `Not enough hulls: ${forceSpace} space needed, ${fleetSpace} aboard.`,
} as const;

export type FleetStats = { range: number; space: number };
export type ForceStats = { men: number; space: number; fast: boolean };

// fleetRange = min(range) over ship types with count > 0 (0 with no ships);
// fleetSpace = Σ count × troopSpace.
export function fleetStats(fleet: ReachShip[]): FleetStats {
  const present = fleet.filter((s) => s.count > 0);
  return {
    range: present.length ? Math.min(...present.map((s) => s.range)) : 0,
    space: present.reduce((n, s) => n + s.count * s.troopSpace, 0),
  };
}

// forceSpace = Σ count × space; fast = every row has spd >= 6 (an empty force is not fast).
export function forceStats(force: ReachForceRow[]): ForceStats {
  return {
    men: force.reduce((n, r) => n + r.count, 0),
    space: force.reduce((n, r) => n + r.count * r.space, 0),
    fast: force.length > 0 && force.every((r) => r.spd >= RAID_FAST_SPD),
  };
}

export type ReachSteps = { landSteps: number | null; seaSteps: number | null };
export type ReachVerdicts = { attack: ReachVerdict; raid: ReachVerdict; colonise: ReachVerdict };

// The three verdicts for one target from its steps, the force and the fleet —
// the rule the record is built from, exported so a client can re-run it for a
// hand-picked force against the steps the server reported.
export function verdictsFor(steps: ReachSteps, force: ForceStats, fleet: FleetStats): ReachVerdicts {
  const land = steps.landSteps;
  const sea = steps.seaSteps;

  // The sea route, and why it fails when it does (range before hulls).
  const seaOk = sea !== null && sea <= fleet.range && force.space <= fleet.space;
  const seaReason = sea === null ? null : sea > fleet.range ? REACH_REASON.range(sea, fleet.range) : force.space > fleet.space ? REACH_REASON.hulls(force.space, fleet.space) : null;

  // Attack: 1 land step, or by sea.
  let attack: ReachVerdict;
  if (force.men === 0) attack = { ok: false, reason: REACH_REASON.noMen };
  else if (land === 1 || seaOk) attack = { ok: true };
  else if (sea === null) attack = { ok: false, reason: REACH_REASON.noBase };
  else attack = { ok: false, reason: seaReason! };

  // Raid: 1 land step, 2 with a fast force, or by sea.
  let raid: ReachVerdict;
  if (force.men === 0) raid = { ok: false, reason: REACH_REASON.noMen };
  else if (land === 1 || (land === 2 && force.fast) || seaOk) raid = { ok: true };
  else if (land === null && sea === null) raid = { ok: false, reason: REACH_REASON.noBase };
  else if (land === 2 && !force.fast) raid = { ok: false, reason: REACH_REASON.tooFar };
  else if (sea === null) raid = { ok: false, reason: REACH_REASON.noBase };
  else raid = { ok: false, reason: seaReason! };

  // Colonise: Attack's reach, without the men rule (legality by target kind
  // and owner stays with allowedMapActions).
  let colonise: ReachVerdict;
  if (land === 1 || seaOk) colonise = { ok: true };
  else if (sea === null) colonise = { ok: false, reason: REACH_REASON.noBase };
  else colonise = { ok: false, reason: seaReason! };

  return { attack, raid, colonise };
}

// The route an action would take for a target: land when its land steps satisfy
// the action (1, or 2 for a fast raiding party), else sea.
export function routeFor(type: "attack" | "raid", steps: ReachSteps, force: ForceStats): { route: "land" | "sea"; steps: number } | null {
  const byLand = type === "attack" ? steps.landSteps === 1 : steps.landSteps === 1 || (steps.landSteps === 2 && force.fast);
  if (byLand) return { route: "land", steps: steps.landSteps! };
  return steps.seaSteps === null ? null : { route: "sea", steps: steps.seaSteps };
}

export function computeReach(input: ReachInput): Record<string, ReachEntry> {
  const t = input.topology;
  const bases = new Set(input.bases.filter((b) => t.land.has(b)));

  // Land distance: multi-source BFS over land from every base, depth ≤ 2.
  const landSteps = new Map<string, number>();
  let frontier: string[] = [];
  for (const b of bases) {
    landSteps.set(b, 0);
    frontier.push(b);
  }
  for (let depth = 1; depth <= MAX_LAND_STEPS && frontier.length; depth++) {
    const next: string[] = [];
    for (const cur of frontier) {
      for (const n of t.land.get(cur) ?? []) {
        if (landSteps.has(n)) continue;
        landSteps.set(n, depth);
        next.push(n);
      }
    }
    frontier = next;
  }

  // Sea distance: every coastal base's linked seas are distance 1; BFS through
  // sea. A base that is not coastal contributes nothing.
  const seaSteps = new Map<string, number>();
  frontier = [];
  for (const b of bases) {
    if (!t.coastal.has(b)) continue;
    for (const s of t.coast.get(b) ?? []) {
      if (seaSteps.has(s)) continue;
      seaSteps.set(s, 1);
      frontier.push(s);
    }
  }
  while (frontier.length) {
    const next: string[] = [];
    for (const cur of frontier) {
      const d = seaSteps.get(cur)!;
      for (const n of t.sea.get(cur) ?? []) {
        if (seaSteps.has(n)) continue;
        seaSteps.set(n, d + 1);
        next.push(n);
      }
    }
    frontier = next;
  }

  const fleet = fleetStats(input.fleet);
  const force = forceStats(input.force);

  const out: Record<string, ReachEntry> = {};
  for (const id of t.land.keys()) {
    if (id === t.massaliaRegion || input.homeRegions.has(id) || bases.has(id)) continue;

    const land = landSteps.get(id) ?? null;
    let sea: number | null = null;
    for (const s of t.coast.get(id) ?? []) {
      const d = seaSteps.get(s);
      if (d !== undefined && (sea === null || d < sea)) sea = d;
    }
    out[id] = { landSteps: land, seaSteps: sea, ...verdictsFor({ landSteps: land, seaSteps: sea }, force, fleet) };
  }
  return out;
}
