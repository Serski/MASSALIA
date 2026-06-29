import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CITY_GROUPS,
  CITY_STABILITY_BASELINE,
  FACTION_GROUPS,
  OPINION_MAX,
  OPINION_MIN,
  STANCE_IDS,
  STANCE_SCALE,
  applyOpinion,
  driftCity,
  opinionBand,
  parseCitiesContent,
  parseFactionsContent,
  stanceMeta,
  stanceToOpinion,
  stanceValue,
  type CitiesContent,
  type CityDriftStats,
  type FactionsContent,
} from "./league.js";

// A baseline city for drift tests (stats chosen so growth is easy to eyeball).
function city(over: Partial<CityDriftStats & { lastGrowthYear: number | null }> = {}) {
  return { population: 1000, tax: 100, stability: 60, fortifications: 3, garrison: 50, lastGrowthYear: null, ...over };
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const cities: CitiesContent = parseCitiesContent(
  JSON.parse(readFileSync(resolve(root, "content/cities/cities.json"), "utf8")),
);
const factions: FactionsContent = parseFactionsContent(
  JSON.parse(readFileSync(resolve(root, "content/diplomacy/factions.json"), "utf8")),
);

describe("the stance scale (7 rungs, war .. allied)", () => {
  it("orders war(-3) .. allied(+3) with neutral at 0", () => {
    expect(STANCE_SCALE.map((s) => s.value)).toEqual([-3, -2, -1, 0, 1, 2, 3]);
    expect(stanceValue("neutral")).toBe(0);
    expect(stanceValue("war")).toBe(-3);
    expect(stanceValue("allied")).toBe(3);
  });

  it("exposes id/value/label per rung and rejects unknown ids", () => {
    expect(stanceMeta("cordial")).toEqual({ id: "cordial", value: 2, label: "Cordial" });
    expect(STANCE_IDS).toContain("hostile");
    // @ts-expect-error — an id outside the scale is a type error and throws at runtime.
    expect(() => stanceValue("vassalized")).toThrow();
  });
});

describe("content/cities/cities.json", () => {
  it("parses and has the nine colonies with unique ids", () => {
    expect(cities.cities).toHaveLength(9);
    const ids = cities.cities.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("massalia");
  });

  it("uses only known groups and in-range stats", () => {
    for (const c of cities.cities) {
      expect(CITY_GROUPS).toContain(c.group);
      expect(c.start.fortifications).toBeGreaterThanOrEqual(1);
      expect(c.start.fortifications).toBeLessThanOrEqual(5);
      expect(c.start.stability).toBeGreaterThanOrEqual(0);
      expect(c.start.stability).toBeLessThanOrEqual(100);
    }
  });

  it("rejects a duplicate id", () => {
    const dupe = { cities: [...cities.cities, cities.cities[0]] };
    expect(() => parseCitiesContent(dupe)).toThrow(/Duplicate city id/);
  });

  it("rejects an out-of-range fortifications level", () => {
    const bad = { cities: [{ ...cities.cities[0]!, start: { ...cities.cities[0]!.start, fortifications: 6 } }] };
    expect(() => parseCitiesContent(bad)).toThrow();
  });
});

describe("content/diplomacy/factions.json", () => {
  it("parses and has the nineteen factions with unique ids", () => {
    expect(factions.factions).toHaveLength(19);
    const ids = factions.factions.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every opinion is within the −200..+200 bar and every group is known", () => {
    for (const f of factions.factions) {
      expect(f.start.opinion).toBeGreaterThanOrEqual(OPINION_MIN);
      expect(f.start.opinion).toBeLessThanOrEqual(OPINION_MAX);
      expect(Number.isInteger(f.start.opinion)).toBe(true);
      expect(FACTION_GROUPS).toContain(f.group);
    }
  });

  it("all factions start un-vassalized and with war/allied flags unset (D1)", () => {
    expect(factions.factions.every((f) => f.start.vassal === false)).toBe(true);
    expect(factions.factions.every((f) => f.start.atWar === false)).toBe(true);
    expect(factions.factions.every((f) => f.start.allied === false)).toBe(true);
  });

  it("seeds the expected anchors (Carthage hostile, Rome cordial)", () => {
    const byId = new Map(factions.factions.map((f) => [f.id, f]));
    expect(opinionBand(byId.get("carthage")!.start.opinion).id).toBe("hostile");
    expect(opinionBand(byId.get("rome")!.start.opinion).id).toBe("cordial");
  });

  it("rejects an out-of-range opinion and a missing flag", () => {
    const base = factions.factions[0]!;
    expect(() => parseFactionsContent({ factions: [{ ...base, start: { ...base.start, opinion: 999 } }] })).toThrow();
    expect(() => parseFactionsContent({ factions: [{ ...base, start: { opinion: 0, atWar: false, vassal: false } }] })).toThrow();
  });
});

describe("the opinion bar (Diplomacy D1)", () => {
  it("computes the display band at every boundary", () => {
    const band = (n: number) => opinionBand(n).id;
    expect(band(-200)).toBe("hostile");
    expect(band(-151)).toBe("hostile");
    expect(band(-76)).toBe("hostile");
    expect(band(-75)).toBe("unfriendly");
    expect(band(-16)).toBe("unfriendly");
    expect(band(-15)).toBe("neutral");
    expect(band(0)).toBe("neutral");
    expect(band(15)).toBe("neutral");
    expect(band(16)).toBe("friendly");
    expect(band(75)).toBe("friendly");
    expect(band(76)).toBe("cordial");
    expect(band(151)).toBe("cordial");
    expect(band(200)).toBe("cordial");
  });

  it("clamps out-of-range opinion into the extreme bands", () => {
    expect(opinionBand(-500).id).toBe("hostile");
    expect(opinionBand(500).id).toBe("cordial");
  });

  it("applyOpinion adds points and clamps to ±200", () => {
    expect(applyOpinion(0, 40)).toBe(40);
    expect(applyOpinion(40, -40)).toBe(0);
    expect(applyOpinion(180, 40)).toBe(200);
    expect(applyOpinion(-180, -40)).toBe(-200);
    expect(applyOpinion(200, 50)).toBe(200);
    expect(applyOpinion(0, 1.6)).toBe(2); // integer-rounded
  });

  it("stanceToOpinion maps each legacy rung to its band midpoint / extreme", () => {
    expect(stanceToOpinion("war")).toBe(-200);
    expect(stanceToOpinion("hostile")).toBe(-137);
    expect(stanceToOpinion("unfriendly")).toBe(-45);
    expect(stanceToOpinion("neutral")).toBe(0);
    expect(stanceToOpinion("friendly")).toBe(45);
    expect(stanceToOpinion("cordial")).toBe(137);
    expect(stanceToOpinion("allied")).toBe(200);
    // the five middle rungs land back in their own display band
    for (const id of ["hostile", "unfriendly", "neutral", "friendly", "cordial"] as const) {
      expect(opinionBand(stanceToOpinion(id)).id).toBe(id);
    }
  });
});

describe("driftCity (once-per-game-year city growth)", () => {
  it("grows population +2% and garrison +2% (rounded), stamping the year", () => {
    const { changed, next } = driftCity(city({ population: 1000, garrison: 50 }), 1);
    expect(changed).toBe(true);
    expect(next.population).toBe(1020); // round(1000 * 1.02)
    expect(next.garrison).toBe(51); // round(50 * 1.02)
    expect(next.lastGrowthYear).toBe(1);
  });

  it("small cities still creep up by at least 1 (rounding)", () => {
    const { next } = driftCity(city({ population: 500, garrison: 30 }), 1);
    expect(next.population).toBe(510); // round(510)
    expect(next.garrison).toBe(31); // round(30.6)
  });

  it("is idempotent on re-run within the same year (no double-grow)", () => {
    const first = driftCity(city(), 1);
    const second = driftCity({ ...first.next }, 1);
    expect(second.changed).toBe(false);
    expect(second.next).toEqual(first.next); // unchanged
  });

  it("grows again once the year advances", () => {
    const y1 = driftCity(city({ population: 1000 }), 1);
    const y2 = driftCity({ ...y1.next }, 2);
    expect(y2.changed).toBe(true);
    expect(y2.next.population).toBe(1040); // round(1020 * 1.02)
    expect(y2.next.lastGrowthYear).toBe(2);
  });

  it("catches up with a single step when several years behind (no replay)", () => {
    const { changed, next } = driftCity(city({ population: 1000, lastGrowthYear: 1 }), 5);
    expect(changed).toBe(true);
    expect(next.population).toBe(1020); // ONE step, not four
    expect(next.lastGrowthYear).toBe(5);
  });

  it("drifts stability toward the baseline from above and below, then settles", () => {
    expect(driftCity(city({ stability: 90 }), 1).next.stability).toBe(89); // above → -1
    expect(driftCity(city({ stability: 60 }), 1).next.stability).toBe(61); // below → +1
    expect(driftCity(city({ stability: CITY_STABILITY_BASELINE }), 1).next.stability).toBe(CITY_STABILITY_BASELINE); // at baseline → stays
    // never overshoots the baseline by the step
    expect(driftCity(city({ stability: CITY_STABILITY_BASELINE + 1 }), 1).next.stability).toBe(CITY_STABILITY_BASELINE);
    expect(driftCity(city({ stability: CITY_STABILITY_BASELINE - 1 }), 1).next.stability).toBe(CITY_STABILITY_BASELINE);
  });

  it("never changes fortifications and leaves tax flat", () => {
    const { next } = driftCity(city({ fortifications: 4, tax: 320 }), 1);
    expect(next.fortifications).toBe(4);
    expect(next.tax).toBe(320);
  });
});
