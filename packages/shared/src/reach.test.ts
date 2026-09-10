import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseShipsContent, parseUnitsContent } from "./barracks.js";
import { parseBuildingsContent } from "./buildings.js";
import { HOME_POLITY_ID } from "./mapActions.js";
import { buildTopology, parseCoastLinks, parseMapGraph } from "./mapGraph.js";
import { computeReach, fleetStats, forceStats, REACH_REASON, type ReachForceRow, type ReachShip } from "./reach.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel: string) => JSON.parse(readFileSync(resolve(root, rel), "utf8"));

const topology = buildTopology(parseMapGraph(read("content/map/graph.json")), parseCoastLinks(read("content/map/coast-links.json")));
const goods = Object.keys(parseBuildingsContent(read("content/buildings/buildings.json")).vendor);
const units = parseUnitsContent(read("content/military/units.json"), goods);
const ships = parseShipsContent(read("content/military/ships.json"), goods);

// Regions Massalia owns per the military content: townless regions by owner, and
// towns by owner resolved to their region through the graph.
const homeRegions = new Set<string>();
for (const [id, r] of Object.entries(read("content/map/region-military.json").regions as Record<string, { owner: string }>)) if (r.owner === HOME_POLITY_ID) homeRegions.add(id);
for (const [town, t] of Object.entries(read("content/map/town-military.json").towns as Record<string, { owner: string }>)) {
  if (t.owner !== HOME_POLITY_ID) continue;
  const region = topology.townRegion.get(town);
  if (region) homeRegions.add(region);
}

const stats = (unitId: string, count: number): ReachForceRow => ({ spd: units.units[unitId]!.stats.spd, space: units.units[unitId]!.stats.space, count });
const ship = (shipId: string, count: number): ReachShip => ({ shipId, count, range: ships.ships[shipId]!.range, troopSpace: ships.ships[shipId]!.troopSpace });
const reach = (opts: { bases?: string[]; force: ReachForceRow[]; fleet?: ReachShip[] }) =>
  computeReach({ topology, bases: opts.bases ?? ["R060"], force: opts.force, fleet: opts.fleet ?? [], homeRegions });

// Sea distance from R150 (Massalia's sea) to every sea, for picking targets.
function seaDistancesFrom(seaId: string): Map<string, number> {
  const d = new Map([[seaId, 1]]);
  let frontier = [seaId];
  while (frontier.length) {
    const next: string[] = [];
    for (const cur of frontier) {
      for (const n of topology.sea.get(cur)!) {
        if (d.has(n)) continue;
        d.set(n, d.get(cur)! + 1);
        next.push(n);
      }
    }
    frontier = next;
  }
  return d;
}
// Land distance from R060, depth-limited.
function landDistancesFrom(id: string, max = 3): Map<string, number> {
  const d = new Map([[id, 0]]);
  let frontier = [id];
  for (let depth = 1; depth <= max && frontier.length; depth++) {
    const next: string[] = [];
    for (const cur of frontier) {
      for (const n of topology.land.get(cur)!) {
        if (d.has(n)) continue;
        d.set(n, depth);
        next.push(n);
      }
    }
    frontier = next;
  }
  return d;
}
const landFrom060 = landDistancesFrom("R060");
const seaFrom150 = seaDistancesFrom("R150");
// A target's sea distance is the min over the seas it touches.
const seaStepsOf = (id: string): number | null => {
  let best: number | null = null;
  for (const s of topology.coast.get(id) ?? []) {
    const d = seaFrom150.get(s);
    if (d !== undefined && (best === null || d < best)) best = d;
  }
  return best;
};
const eligible = (id: string) => id !== "R060" && !homeRegions.has(id) && topology.land.has(id);
// A coastal region exactly 5 seas out and not within 1 land step of Massalia.
const fiveSeasOut = [...topology.land.keys()].find((id) => eligible(id) && seaStepsOf(id) === 5 && (landFrom060.get(id) ?? 99) > 1)!;
// A region two land steps out (and not on the Massalia sea, so land is the only way).
const twoStepsOut = [...topology.land.keys()].find((id) => eligible(id) && landFrom060.get(id) === 2 && seaStepsOf(id) === null)!;

describe("reach", () => {
  it("from R060 with one hoplite and no ships, the land neighbours are one step and Attack ok; the Massalia-owned one is absent", () => {
    const r = reach({ force: [stats("hoplite", 1)] });
    const neighbours = ["R046", "R047", "R052", "R059"];
    expect([...topology.land.get("R060")!].sort()).toEqual(neighbours);
    // R052 (arelate) and R059 (antipolis, nikaia, …) hold Massalia's towns: home
    // ground, never targets, so only R046 and R047 get entries.
    expect(homeRegions.has("R052")).toBe(true);
    expect(homeRegions.has("R059")).toBe(true);
    expect(r.R052).toBeUndefined();
    expect(r.R059).toBeUndefined();
    expect(neighbours.filter((n) => !homeRegions.has(n))).toEqual(["R046", "R047"]);
    for (const id of neighbours.filter((n) => !homeRegions.has(n))) {
      expect(r[id]!.landSteps, id).toBe(1);
      expect(r[id]!.attack, id).toEqual({ ok: true });
      expect(r[id]!.raid, id).toEqual({ ok: true });
      expect(r[id]!.colonise, id).toEqual({ ok: true });
    }
    expect(fleetStats([])).toEqual({ range: 0, space: 0 });
    expect(forceStats([stats("hoplite", 1)])).toEqual({ men: 1, space: 1, fast: false });
  });

  it("a two-step region is Raid-not-ok with the Spd reason for hoplites, and ok for an all-peltast force", () => {
    expect(twoStepsOut).toBeDefined();
    const slow = reach({ force: [stats("hoplite", 10)] })[twoStepsOut]!;
    expect(slow.landSteps).toBe(2);
    expect(slow.seaSteps).toBeNull();
    expect(slow.raid).toEqual({ ok: false, reason: REACH_REASON.tooFar });
    expect(slow.attack).toEqual({ ok: false, reason: REACH_REASON.noBase });
    const fast = reach({ force: [stats("peltast", 10)] })[twoStepsOut]!;
    expect(fast.raid).toEqual({ ok: true });
    expect(fast.attack).toEqual({ ok: false, reason: REACH_REASON.noBase });
    // Mixed: one slow row spoils the raid.
    expect(reach({ force: [stats("peltast", 10), stats("hoplite", 1)] })[twoStepsOut]!.raid).toEqual({ ok: false, reason: REACH_REASON.tooFar });
  });

  it("an empty force cannot Attack or Raid, but Colonise still reads reach", () => {
    const r = reach({ force: [] });
    expect(r.R046!.attack).toEqual({ ok: false, reason: REACH_REASON.noMen });
    expect(r.R046!.raid).toEqual({ ok: false, reason: REACH_REASON.noMen });
    expect(r.R046!.colonise).toEqual({ ok: true });
  });

  it("sea: 40 peltasts on one trade-ship fail on hulls; two clear it and a coastal region five seas out is Attack ok; a galley drops the range to 4", () => {
    expect(fiveSeasOut).toBeDefined();
    const peltasts = [stats("peltast", 40)]; // space 40
    const one = reach({ force: peltasts, fleet: [ship("trade-ship", 1)] })[fiveSeasOut]!;
    expect(one.seaSteps).toBe(5);
    expect(one.attack).toEqual({ ok: false, reason: REACH_REASON.hulls(40, 20) });
    expect(one.raid).toEqual({ ok: false, reason: REACH_REASON.hulls(40, 20) });
    expect(one.colonise).toEqual({ ok: false, reason: REACH_REASON.hulls(40, 20) });

    const two = reach({ force: peltasts, fleet: [ship("trade-ship", 2)] })[fiveSeasOut]!;
    expect(two.attack).toEqual({ ok: true });
    expect(two.raid).toEqual({ ok: true });
    expect(two.colonise).toEqual({ ok: true });

    const fleet = [ship("trade-ship", 2), ship("galley", 1)];
    expect(fleetStats(fleet)).toEqual({ range: 4, space: 44 });
    const withGalley = reach({ force: peltasts, fleet })[fiveSeasOut]!;
    expect(withGalley.attack).toEqual({ ok: false, reason: REACH_REASON.range(5, 4) });
    // Range is reported before hulls when both fail.
    expect(reach({ force: [stats("peltast", 40), stats("hoplite", 40)], fleet: [ship("galley", 1)] })[fiveSeasOut]!.attack).toEqual({ ok: false, reason: REACH_REASON.range(5, 4) });
  });

  it("a second coastal base extends sea reach from its own coast", () => {
    // R114 (Lixus) touches only R162, far from Massalia's sea.
    const far = [...topology.seaToCoast.get("R162")!].find((id) => id !== "R114" && eligible(id) && (landFrom060.get(id) ?? 99) > 1)!;
    expect(far).toBeDefined();
    const fleet = [ship("trade-ship", 2)];
    const before = reach({ force: [stats("peltast", 20)], fleet })[far]!;
    expect(before.seaSteps === null || before.seaSteps > 1).toBe(true);
    const after = reach({ bases: ["R060", "R114"], force: [stats("peltast", 20)], fleet })[far]!;
    expect(after.seaSteps).toBe(1);
    expect(after.attack).toEqual({ ok: true });
    // The new base's land neighbours are one step too.
    for (const n of topology.land.get("R114")!) if (eligible(n)) expect(reach({ bases: ["R060", "R114"], force: [stats("hoplite", 1)] })[n]!.landSteps).toBe(1);
  });

  it("a held region is a base, not a target: it drops out of the record while its neighbours come within a step", () => {
    const r = reach({ bases: ["R060", "R114"], force: [stats("hoplite", 1)] });
    expect(r.R114).toBeUndefined();
    for (const n of topology.land.get("R114")!) if (eligible(n)) expect(r[n]!.landSteps).toBe(1);
  });

  it("R060, fog and home-owned regions never appear; every other land province does", () => {
    const r = reach({ force: [stats("hoplite", 1)] });
    expect(r.R060).toBeUndefined();
    expect(r.R174).toBeUndefined();
    expect(r.R175).toBeUndefined();
    expect(homeRegions.size).toBeGreaterThan(0);
    for (const id of homeRegions) expect(r[id], id).toBeUndefined();
    // Every land province that is neither R060 nor home ground has an entry.
    const expected = [...topology.land.keys()].filter((id) => id !== "R060" && !homeRegions.has(id));
    expect(Object.keys(r).sort()).toEqual(expected.sort());
  });
});
