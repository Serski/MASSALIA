import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { armyUpkeep, desertionPlan, LEAGUE_UNIT_IDS, leagueUnitsLine, leagueUnitsMen, menPaidFor, parseLeagueArmy, type DesertionRow } from "./index.js";

// ---------------------------------------------------------------------------
// The League's army (government prompt 5a), pure rules: the content is the
// ten home towns of ruling 1, the upkeep is a quarter drachma a man rounded to
// whole drachmae, a payment keeps the men it pays for, and desertion thins
// every row. The numbers come from content.
// ---------------------------------------------------------------------------

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const raw = JSON.parse(readFileSync(resolve(root, "content/military/league-army.json"), "utf8"));
const army = parseLeagueArmy(raw);
const townMilitary = JSON.parse(readFileSync(resolve(root, "content/map/town-military.json"), "utf8")) as { towns: Record<string, { owner: string; garrison: number }> };
const RATE = army.upkeepPerManPerSeason;

// The army as rows, town by town and type by type, as it is raised.
const rows = (): DesertionRow[] => army.towns.flatMap((t) => LEAGUE_UNIT_IDS.map((unitId) => ({ basedAt: t.townId, unitId, count: t.units[unitId] })));
const kept = (deserters: number) => {
  const all = rows();
  const lose = desertionPlan(all, deserters);
  return all.map((r, i) => ({ ...r, count: r.count - lose[i]!, lost: lose[i]! }));
};
const byTown = (list: { basedAt: string; count: number }[]) => Object.fromEntries(army.towns.map((t) => [t.townId, list.filter((r) => r.basedAt === t.townId).reduce((n, r) => n + r.count, 0)]));
const byType = (list: { unitId: string; count: number }[]) => Object.fromEntries(LEAGUE_UNIT_IDS.map((id) => [id, list.filter((r) => r.unitId === id).reduce((n, r) => n + r.count, 0)]));

describe("league-army.json", () => {
  it("is the ten home towns of ruling 1: 2,050 men, 1,030 hoplites, 510 peltasts, 305 ekdromoi, 205 hippeis", () => {
    expect(army.upkeepPerManPerSeason).toBe(0.25);
    expect(army.fleetAt).toBe("massalia");
    expect(army.towns.map((t) => [t.townId, leagueUnitsMen(t.units)])).toEqual([
      ["massalia", 1000],
      ["emporion", 250],
      ["nikaia", 150],
      ["olbia-provence", 150],
      ["rhoda", 120],
      ["agathe", 100],
      ["antipolis", 100],
      ["arelate", 100],
      ["athinopolis", 50],
      ["monoikos", 30],
    ]);
    expect(byType(rows())).toEqual({ hoplite: 1030, peltast: 510, ekdromos: 305, hippeis: 205 });
    expect(rows().reduce((n, r) => n + r.count, 0)).toBe(2050);
  });

  it("each town is a home town of town-military.json, split 50/25/15/10 rounded down with the remainder to the hoplites", () => {
    const home = Object.entries(townMilitary.towns).filter(([, t]) => t.owner === "massalia");
    expect(army.towns.map((t) => t.townId).sort()).toEqual(home.map(([id]) => id).sort());
    for (const t of army.towns) {
      const men = townMilitary.towns[t.townId]!.garrison;
      const peltast = Math.floor(men * 0.25);
      const ekdromos = Math.floor(men * 0.15);
      const hippeis = Math.floor(men * 0.1);
      expect(t.units, t.townId).toEqual({ hoplite: men - peltast - ekdromos - hippeis, peltast, ekdromos, hippeis });
    }
  });

  it("rejects a town twice, a fleet at no town, a fifth unit type, a fraction of a man and an extra key", () => {
    expect(() => parseLeagueArmy({ ...raw, towns: [raw.towns[0], raw.towns[0]] })).toThrow(/twice/);
    expect(() => parseLeagueArmy({ ...raw, fleetAt: "atlantis" })).toThrow(/fleetAt/);
    expect(() => parseLeagueArmy({ ...raw, towns: [{ townId: "massalia", units: { ...raw.towns[0].units, archer: 5 } }] })).toThrow();
    expect(() => parseLeagueArmy({ ...raw, towns: [{ townId: "massalia", units: { ...raw.towns[0].units, hoplite: 1.5 } }] })).toThrow();
    expect(() => parseLeagueArmy({ ...raw, extra: 1 })).toThrow();
    expect(() => parseLeagueArmy({ ...raw, upkeepPerManPerSeason: 0 })).toThrow();
    // The harvest ban is whole seasons, never negative; the content's is a year of four.
    expect(army.harvestBanSeasons).toBe(4);
    expect(() => parseLeagueArmy({ ...raw, harvestBanSeasons: -1 })).toThrow();
    expect(() => parseLeagueArmy({ ...raw, harvestBanSeasons: 1.5 })).toThrow();
  });
});

describe("the upkeep", () => {
  it("a quarter drachma a man, in whole drachmae: 513 for 2,050 men", () => {
    expect(armyUpkeep(2050, RATE)).toBe(513);
    expect(armyUpkeep(2049, RATE)).toBe(512);
    expect(armyUpkeep(400, RATE)).toBe(100);
    expect(armyUpkeep(0, RATE)).toBe(0);
  });

  it("a payment keeps the men it pays for: 512 keeps 2,048, 100 keeps 400", () => {
    expect(menPaidFor(512, RATE)).toBe(2048);
    expect(menPaidFor(100, RATE)).toBe(400);
    expect(menPaidFor(0, RATE)).toBe(0);
    // A rate that is no binary fraction loses no man to the division.
    expect(menPaidFor(30, 0.3)).toBe(100);
  });
});

describe("desertionPlan", () => {
  it("a treasury of 100 keeps 400 men, every town and every type thinned", () => {
    const left = kept(2050 - menPaidFor(100, RATE));
    expect(left.reduce((n, r) => n + r.count, 0)).toBe(400);
    expect(byTown(left)).toEqual({ massalia: 193, emporion: 48, nikaia: 29, "olbia-provence": 29, rhoda: 24, agathe: 19, antipolis: 19, arelate: 19, athinopolis: 12, monoikos: 8 });
    expect(byType(left)).toEqual({ hoplite: 197, peltast: 100, ekdromos: 62, hippeis: 41 });
  });

  it("a payment of 512 keeps 2,048: Massalia's hoplites and peltasts lose one man each", () => {
    const left = kept(2050 - menPaidFor(512, RATE));
    expect(left.filter((r) => r.lost > 0).map((r) => [r.basedAt, r.unitId, r.lost])).toEqual([["massalia", "hoplite", 1], ["massalia", "peltast", 1]]);
    expect(left.reduce((n, r) => n + r.count, 0)).toBe(2048);
  });

  it("the men still owed come from the largest rows first, ties by town then type", () => {
    // Four rows of 10 and three deserters: floor(10 × 3 / 40) is 0 each, so one
    // each from the first three in order of town, then type.
    const tied: DesertionRow[] = [
      { basedAt: "b", unitId: "peltast", count: 10 },
      { basedAt: "a", unitId: "peltast", count: 10 },
      { basedAt: "b", unitId: "hoplite", count: 10 },
      { basedAt: "a", unitId: "hoplite", count: 10 },
    ];
    expect(desertionPlan(tied, 3)).toEqual([0, 1, 1, 1]);
    // A larger row gives its man before a smaller one.
    expect(desertionPlan([{ basedAt: "a", unitId: "x", count: 3 }, { basedAt: "z", unitId: "x", count: 5 }], 1)).toEqual([0, 1]);
  });

  it("when the deserters are the whole army, or more, every row goes; none, and no row loses a man", () => {
    expect(desertionPlan(rows(), 2050)).toEqual(rows().map((r) => r.count));
    expect(desertionPlan(rows(), 9999)).toEqual(rows().map((r) => r.count));
    expect(desertionPlan(rows(), 0)).toEqual(rows().map(() => 0));
    expect(desertionPlan(rows(), -5)).toEqual(rows().map(() => 0));
    expect(desertionPlan([], 10)).toEqual([]);
  });

  it("never takes more men than a row holds, nor more than the deserters in all", () => {
    const all = [...rows(), { basedAt: "empty", unitId: "hoplite", count: 0 }];
    for (let deserters = 0; deserters <= 2050; deserters += 7) {
      const lose = desertionPlan(all, deserters);
      expect(lose.reduce((n, x) => n + x, 0), `${deserters} deserters`).toBe(deserters);
      for (let i = 0; i < all.length; i++) {
        expect(lose[i]!).toBeGreaterThanOrEqual(0);
        expect(lose[i]!).toBeLessThanOrEqual(all[i]!.count);
      }
    }
  });
});

describe("leagueUnitsLine", () => {
  it("names the types a town holds, in the army's order, and leaves out a type with no men", () => {
    expect(leagueUnitsLine(army.towns[0]!.units)).toBe("500 hoplites, 250 peltasts, 150 ekdromoi, 100 hippeis");
    expect(leagueUnitsLine({ hoplite: 1, peltast: 0, ekdromos: 1, hippeis: 1 })).toBe("1 hoplite, 1 ekdromos, 1 hippeis");
    expect(leagueUnitsLine({ hoplite: 1030, peltast: 510, ekdromos: 305, hippeis: 205 })).toBe("1,030 hoplites, 510 peltasts, 305 ekdromoi, 205 hippeis");
    expect(leagueUnitsLine({ hoplite: 0, peltast: 0, ekdromos: 0, hippeis: 0 })).toBe("no men");
  });
});
