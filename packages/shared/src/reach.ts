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
  /** region ids: massaliaRegion + the regions of every base (held regions, held towns, home ground with men) */
  bases: string[];
  /** active rows only */
  force: ReachForceRow[];
  fleet: ReachShip[];
  /** land regions owned by HOME_POLITY_ID (never targets) */
  homeRegions: Set<string>;
  /**
   * Regions that get no entry besides the Massalia region and home ground:
   * by default every base region (a region holding is ground to march from,
   * never a target). A caller whose bases include the region of a held town
   * passes only its region holdings here, so the region's other towns stay
   * targets (at 0 land steps from that base).
   */
  excluded?: Set<string>;
};

export type ReachVerdict = { ok: boolean; reason?: string };

export type ReachEntry = {
  /** shortest land distance from any base, null if > 2 */
  landSteps: number | null;
  /** fewest sea provinces from any base's coast to a sea touching this region, null if none */
  seaSteps: number | null;
  /** the same two distances from each base on its own, so a client can judge a force that marches from one base */
  byBase: Record<string, ReachSteps>;
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

// A fleet's reach: `range` is the farthest any hull sails, `space` every hull's
// troop space, and `tiers` the space each ship type adds with its own range, so
// a crossing counts only the hulls that can make it (ruling 3 as amended: a
// short-ranged warship neither sails nor limits the fleet). `tiers` may be
// absent on an older payload, in which case every hull is assumed in range.
export type FleetStats = { range: number; space: number; tiers?: { range: number; space: number }[] };
export type ForceStats = { men: number; space: number; fast: boolean };

// fleetRange = max(range) over ship types with count > 0 (0 with no ships);
// fleetSpace = Σ count × troopSpace; tiers per present type.
export function fleetStats(fleet: ReachShip[]): FleetStats {
  const present = fleet.filter((s) => s.count > 0);
  return {
    range: present.length ? Math.max(...present.map((s) => s.range)) : 0,
    space: present.reduce((n, s) => n + s.count * s.troopSpace, 0),
    tiers: present.map((s) => ({ range: s.range, space: s.count * s.troopSpace })),
  };
}

// The troop space that can make a crossing of `seaSteps` seas: the hulls whose
// range covers it.
export function fleetSpaceAt(fleet: FleetStats, seaSteps: number): number {
  if (!fleet.tiers) return seaSteps <= fleet.range ? fleet.space : 0;
  return fleet.tiers.filter((t) => t.range >= seaSteps).reduce((n, t) => n + t.space, 0);
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

  // The sea route, and why it fails when it does (range before hulls). Only
  // hulls whose range covers the crossing carry men.
  const spaceAt = sea === null ? 0 : fleetSpaceAt(fleet, sea);
  const seaOk = sea !== null && sea <= fleet.range && force.space <= spaceAt;
  const seaReason = sea === null ? null : sea > fleet.range ? REACH_REASON.range(sea, fleet.range) : force.space > spaceAt ? REACH_REASON.hulls(force.space, spaceAt) : null;

  // Adjacent by land: one step, or none (a town in the same region as a base).
  const adjacent = land !== null && land <= 1;

  // Attack: 1 land step, or by sea.
  let attack: ReachVerdict;
  if (force.men === 0) attack = { ok: false, reason: REACH_REASON.noMen };
  else if (adjacent || seaOk) attack = { ok: true };
  else if (sea === null) attack = { ok: false, reason: REACH_REASON.noBase };
  else attack = { ok: false, reason: seaReason! };

  // Raid: 1 land step, 2 with a fast force, or by sea.
  let raid: ReachVerdict;
  if (force.men === 0) raid = { ok: false, reason: REACH_REASON.noMen };
  else if (adjacent || (land === 2 && force.fast) || seaOk) raid = { ok: true };
  else if (land === null && sea === null) raid = { ok: false, reason: REACH_REASON.noBase };
  else if (land === 2 && !force.fast) raid = { ok: false, reason: REACH_REASON.tooFar };
  else if (sea === null) raid = { ok: false, reason: REACH_REASON.noBase };
  else raid = { ok: false, reason: seaReason! };

  // Colonise: Attack's reach, without the men rule (legality by target kind
  // and owner stays with allowedMapActions).
  let colonise: ReachVerdict;
  if (adjacent || seaOk) colonise = { ok: true };
  else if (sea === null) colonise = { ok: false, reason: REACH_REASON.noBase };
  else colonise = { ok: false, reason: seaReason! };

  return { attack, raid, colonise };
}

// Move (3c): men march to another of the player's places — within one region,
// one land step, or by sea within range with hulls. Attack's rule with the
// same reasons; no men means nothing marches.
export function moveVerdict(steps: ReachSteps, force: ForceStats, fleet: FleetStats): ReachVerdict {
  return verdictsFor(steps, force, fleet).attack;
}

// The route an action would take for a target: land when its land steps satisfy
// the action (0 or 1, or 2 for a fast raiding party), else sea. A move takes
// Attack's route.
export function routeFor(type: "attack" | "raid" | "move", steps: ReachSteps, force: ForceStats): { route: "land" | "sea"; steps: number } | null {
  const land = steps.landSteps;
  const adjacent = land !== null && land <= 1;
  const byLand = type === "raid" ? adjacent || (land === 2 && force.fast) : adjacent;
  if (byLand) return { route: "land", steps: land! };
  return steps.seaSteps === null ? null : { route: "sea", steps: steps.seaSteps };
}

// Land distance from one base: BFS over land, depth ≤ MAX_LAND_STEPS.
export function landStepsFrom(t: Topology, base: string): Map<string, number> {
  const steps = new Map<string, number>([[base, 0]]);
  let frontier = [base];
  for (let depth = 1; depth <= MAX_LAND_STEPS && frontier.length; depth++) {
    const next: string[] = [];
    for (const cur of frontier) {
      for (const n of t.land.get(cur) ?? []) {
        if (steps.has(n)) continue;
        steps.set(n, depth);
        next.push(n);
      }
    }
    frontier = next;
  }
  return steps;
}

// Sea distance from one base: its linked seas are distance 1, then BFS through
// sea. A base that is not coastal reaches no sea at all.
export function seaStepsFrom(t: Topology, base: string): Map<string, number> {
  const steps = new Map<string, number>();
  if (!t.coastal.has(base)) return steps;
  let frontier: string[] = [];
  for (const s of t.coast.get(base) ?? []) {
    if (steps.has(s)) continue;
    steps.set(s, 1);
    frontier.push(s);
  }
  while (frontier.length) {
    const next: string[] = [];
    for (const cur of frontier) {
      const d = steps.get(cur)!;
      for (const n of t.sea.get(cur) ?? []) {
        if (steps.has(n)) continue;
        steps.set(n, d + 1);
        next.push(n);
      }
    }
    frontier = next;
  }
  return steps;
}

// The distances from one base, for reading many targets.
export type BaseDistances = { base: string; land: Map<string, number>; sea: Map<string, number> };
export function distancesFrom(t: Topology, base: string): BaseDistances {
  return { base, land: landStepsFrom(t, base), sea: seaStepsFrom(t, base) };
}

// The steps from one base to a land region: land distance, and the fewest seas
// from the base's coast to a sea the region touches.
export function stepsTo(t: Topology, from: BaseDistances, regionId: string): ReachSteps {
  const land = from.land.get(regionId) ?? null;
  let sea: number | null = null;
  for (const c of t.coast.get(regionId) ?? []) {
    const d = from.sea.get(c);
    if (d !== undefined && (sea === null || d < sea)) sea = d;
  }
  return { landSteps: land, seaSteps: sea };
}

export function computeReach(input: ReachInput): Record<string, ReachEntry> {
  const t = input.topology;
  const bases = [...new Set(input.bases.filter((b) => t.land.has(b)))];

  // Distances per base; the record's own steps are the minimum over bases (the
  // same as a multi-source search), kept per base so a force from one base can
  // be judged on its own.
  const perBase = bases.map((b) => distancesFrom(t, b));
  const excluded = input.excluded ?? new Set(bases);

  const fleet = fleetStats(input.fleet);
  const force = forceStats(input.force);

  const out: Record<string, ReachEntry> = {};
  for (const id of t.land.keys()) {
    if (id === t.massaliaRegion || input.homeRegions.has(id) || excluded.has(id)) continue;

    const byBase: Record<string, ReachSteps> = {};
    let land: number | null = null;
    let sea: number | null = null;
    for (const pb of perBase) {
      const steps = stepsTo(t, pb, id);
      byBase[pb.base] = steps;
      if (steps.landSteps !== null && (land === null || steps.landSteps < land)) land = steps.landSteps;
      if (steps.seaSteps !== null && (sea === null || steps.seaSteps < sea)) sea = steps.seaSteps;
    }
    out[id] = { landSteps: land, seaSteps: sea, byBase, ...verdictsFor({ landSteps: land, seaSteps: sea }, force, fleet) };
  }
  return out;
}
