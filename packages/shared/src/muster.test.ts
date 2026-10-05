import { describe, expect, it } from "vitest";
import { seededRoll } from "./barracks.js";
import type { KoinonContent } from "./koinon.js";
import { loadMusterHulls, musterLaunch, musterShares, musterWinter, renderMusterLine, renderMusterReportLine, splitByShares, type MusterChronicle, type MusterHull, type MusterReportLine } from "./muster.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const content = { muster: { minLeadMinutes: 30, maxLeadHours: 24 } } as KoinonContent;
// One season is one real day, and a world opens in Winter: day 0 is Winter,
// day 1 Spring, day 3 Autumn, day 4 Winter again.
const WORLD = Date.UTC(2000, 0, 1);

describe("musterLaunch", () => {
  const spring = WORLD + DAY + HOUR;

  it("holds the lead to the content's bounds", () => {
    expect(musterLaunch(spring, 29, WORLD, content)).toEqual({ ok: false, reason: "lead" });
    expect(musterLaunch(spring, 24 * 60 + 1, WORLD, content)).toEqual({ ok: false, reason: "lead" });
    expect(musterLaunch(spring, 30, WORLD, content)).toEqual({ ok: true, launchAtMs: spring + 30 * MIN });
    expect(musterLaunch(spring, 24 * 60, WORLD, content)).toEqual({ ok: true, launchAtMs: spring + DAY });
  });

  it("refuses a lead that is not a whole number", () => {
    for (const bad of [45.5, "60", null, undefined, Number.NaN]) expect(musterLaunch(spring, bad, WORLD, content)).toEqual({ ok: false, reason: "lead" });
  });

  it("refuses a launch that lands in Winter, and allows one opened in Winter for a Spring instant", () => {
    const autumn = WORLD + 3 * DAY + 20 * HOUR; // four hours of Autumn left
    expect(musterLaunch(autumn, 3 * 60, WORLD, content)).toEqual({ ok: true, launchAtMs: autumn + 3 * HOUR });
    expect(musterLaunch(autumn, 5 * 60, WORLD, content)).toEqual({ ok: false, reason: "winter" });
    const winter = WORLD + 20 * HOUR; // four hours of Winter left
    expect(musterLaunch(winter, 60, WORLD, content)).toEqual({ ok: false, reason: "winter" });
    expect(musterLaunch(winter, 5 * 60, WORLD, content)).toEqual({ ok: true, launchAtMs: winter + 5 * HOUR });
  });
});

describe("loadMusterHulls", () => {
  const pentekonter = (ownerId: string, count: number, pledgedAtMs: number): MusterHull => ({ ownerId, shipId: "trade-ship", count, range: 7, troopSpace: 20, naval: 1, pledgedAtMs });
  const trireme = (ownerId: string, count: number, pledgedAtMs: number): MusterHull => ({ ownerId, shipId: "galley", count, range: 4, troopSpace: 4, naval: 5, pledgedAtMs });

  it("fills hulls in order of pledge time: a trireme pledged first fills before a later pentekonter", () => {
    const load = loadMusterHulls(10, 3, [pentekonter("b", 1, 2000), trireme("a", 1, 1000)]);
    expect(load.seats).toEqual({ a: 4, b: 6 });
    expect(load).toMatchObject({ naval: 6, space: 24, filled: 10, short: 0 });
    expect(load.sailing.map((h) => h.ownerId)).toEqual(["a", "b"]);
  });

  it("a hull out of range neither sails nor adds naval power", () => {
    const load = loadMusterHulls(10, 5, [trireme("a", 3, 1000), pentekonter("b", 1, 2000)]);
    expect(load.sailing.map((h) => h.shipId)).toEqual(["trade-ship"]);
    expect(load).toMatchObject({ naval: 1, space: 20, filled: 10, short: 0, seats: { b: 10 } });
  });

  it("the same pledge time breaks to the lower id, and within one owner the roomier hull loads first", () => {
    expect(loadMusterHulls(20, 2, [pentekonter("b", 1, 1000), pentekonter("a", 1, 1000)]).seats).toEqual({ a: 20 });
    expect(loadMusterHulls(22, 2, [trireme("a", 1, 1000), pentekonter("a", 1, 1000), pentekonter("b", 1, 1000)]).seats).toEqual({ a: 22 });
  });

  it("space short of the force fills every seat and reports the shortfall", () => {
    const load = loadMusterHulls(50, 2, [pentekonter("a", 1, 1000), trireme("b", 2, 2000)]);
    expect(load).toMatchObject({ space: 28, filled: 28, short: 22, seats: { a: 20, b: 8 } });
  });

  it("with no force nobody is carried, and a zero count is no hull", () => {
    expect(loadMusterHulls(0, 2, [pentekonter("a", 2, 1000)])).toMatchObject({ filled: 0, short: 0, seats: {}, naval: 2 });
    expect(loadMusterHulls(5, 2, [pentekonter("a", 0, 1000)])).toMatchObject({ sailing: [], space: 0, short: 5 });
  });
});

describe("musterShares and splitByShares", () => {
  it("20 men and 20 seats give 20 shares each", () => {
    expect(musterShares({ a: 20 }, { b: 20 })).toEqual({ a: 20, b: 20 });
    expect(musterShares({ a: 20, b: 5 }, { b: 20, c: 0 })).toEqual({ a: 20, b: 25 });
  });

  it("splits by largest remainder, ties to the lower id", () => {
    expect(splitByShares(100, { a: 1, b: 1, c: 1 })).toEqual({ a: 34, b: 33, c: 33 });
    expect(splitByShares(101, { a: 1, b: 1, c: 1 })).toEqual({ a: 34, b: 34, c: 33 });
    expect(splitByShares(480, { a: 20, b: 20 })).toEqual({ a: 240, b: 240 });
    expect(splitByShares(10, { a: 1, b: 3 })).toEqual({ a: 3, b: 7 }); // 2.5 and 7.5: the tie goes to a
  });

  it("a total of 0, and no shares, give nothing", () => {
    expect(splitByShares(0, { a: 3, b: 1 })).toEqual({ a: 0, b: 0 });
    expect(splitByShares(50, {})).toEqual({});
    expect(splitByShares(50, { a: 0 })).toEqual({});
  });

  it("every split sums to its total and never strays a whole unit from the exact part, over 200 seeded cases", () => {
    for (let i = 0; i < 200; i++) {
      const roll = (k: string, max: number) => Math.floor(seededRoll(["split", String(i), k]) * max);
      const owners = 1 + roll("owners", 12);
      const shares: Record<string, number> = {};
      for (let o = 0; o < owners; o++) shares[`p${String(o).padStart(2, "0")}`] = 1 + roll(`share${o}`, 400);
      const total = roll("total", 20_000);
      const parts = splitByShares(total, shares);
      const sum = Object.values(shares).reduce((n, s) => n + s, 0);
      expect(Object.values(parts).reduce((n, p) => n + p, 0), `case ${i}`).toBe(total);
      for (const [id, part] of Object.entries(parts)) expect(Math.abs(part - (total * shares[id]!) / sum), `case ${i} ${id}`).toBeLessThan(1);
    }
  });
});

describe("musterWinter", () => {
  it("is the Winter a launch could land in: the one running now, the one that starts within the longest lead, or none", () => {
    // Day 0 is Winter: it runs until day 1.
    expect(musterWinter(WORLD + 20 * HOUR, WORLD, content)).toEqual({ fromMs: WORLD, untilMs: WORLD + DAY });
    // Spring and Summer: no Winter within a day.
    expect(musterWinter(WORLD + DAY + HOUR, WORLD, content)).toBeNull();
    expect(musterWinter(WORLD + 2 * DAY + 23 * HOUR, WORLD, content)).toBeNull();
    // Autumn: the next Winter starts within the longest lead.
    expect(musterWinter(WORLD + 3 * DAY + HOUR, WORLD, content)).toEqual({ fromMs: WORLD + 4 * DAY, untilMs: WORLD + 5 * DAY });
    // It agrees with musterLaunch on both sides of the boundary.
    const autumn = WORLD + 3 * DAY + 20 * HOUR;
    const winter = musterWinter(autumn, WORLD, content)!;
    for (const lead of [3 * 60, 4 * 60 - 1, 4 * 60, 5 * 60, 24 * 60]) {
      const launch = musterLaunch(autumn, lead, WORLD, content);
      const inWinter = autumn + lead * MIN >= winter.fromMs && autumn + lead * MIN < winter.untilMs;
      expect(launch.ok, String(lead)).toBe(!inWinter);
    }
  });
});

describe("renderMusterLine", () => {
  const base: MusterChronicle = { koinonName: "The Sacred Band", regionId: "R047", regionName: "Vocontii", force: [{ count: 20, label: "Peltast", plural: "Peltasts", source: "trained" }], hulls: 0, winner: "attacker", killed: 12, lost: 3, share: { drachmae: 240, grain: 30 } };

  it("a won raid, with men only, hulls only, and both", () => {
    expect(renderMusterLine(base)).toBe("Raided Vocontii with the koinon The Sacred Band: sent 20 peltasts, 12 tribesmen slain, 3 of ours lost, 240 drachmae and 30 grain for our share.");
    expect(renderMusterLine({ ...base, force: [], hulls: 2, lost: 0 })).toBe("Raided Vocontii with the koinon The Sacred Band: sent 2 hulls, 12 tribesmen slain, none of ours lost, 240 drachmae and 30 grain for our share.");
    expect(renderMusterLine({ ...base, hulls: 1 })).toBe("Raided Vocontii with the koinon The Sacred Band: sent 20 peltasts and 1 hull, 12 tribesmen slain, 3 of ours lost, 240 drachmae and 30 grain for our share.");
  });

  it("driven off, against a town", () => {
    expect(renderMusterLine({ ...base, townId: "reii", townName: "Reii", winner: "defender", killed: 1, share: null })).toBe("Raided Reii with the koinon The Sacred Band and were driven off: sent 20 peltasts, 1 soldier slain, 3 of ours lost.");
  });

  it("repulsed at sea", () => {
    expect(renderMusterLine({ ...base, townId: "reii", townName: "Reii", winner: "repulsed", killed: 0, lost: 0, share: null })).toBe("Sailed against Reii with the koinon The Sacred Band and were driven off by its fleet before landing.");
  });
});

describe("renderMusterReportLine", () => {
  const base: MusterReportLine = { regionId: "R047", regionName: "Vocontii", townId: null, townName: null, outcome: "won", men: 60, killed: 12, lost: 3, plunder: { drachmae: 240, grain: 30 } };

  it("the army's line: won, driven off against a town, repulsed at sea", () => {
    expect(renderMusterReportLine(base)).toBe("Raided Vocontii: 60 men sent, 12 tribesmen slain, 3 lost, 240 drachmae and 30 grain taken.");
    expect(renderMusterReportLine({ ...base, men: 1, killed: 1, lost: 0 })).toBe("Raided Vocontii: 1 man sent, 1 tribesman slain, none lost, 240 drachmae and 30 grain taken.");
    expect(renderMusterReportLine({ ...base, townId: "reii", townName: "Reii", outcome: "driven_off", killed: 1, plunder: null })).toBe("Raided Reii and were driven off: 60 men sent, 1 soldier slain, 3 lost.");
    expect(renderMusterReportLine({ ...base, townId: "reii", townName: "Reii", outcome: "repulsed", killed: 0, lost: 0, plunder: null })).toBe("Sailed against Reii and were driven off by its fleet before landing.");
  });
});
