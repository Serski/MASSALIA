import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CITY_GROUPS,
  FACTION_GROUPS,
  STANCE_IDS,
  STANCE_SCALE,
  parseCitiesContent,
  parseFactionsContent,
  stanceMeta,
  stanceValue,
  type CitiesContent,
  type FactionsContent,
} from "./league.js";

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

  it("every stance is a valid scale member and every group is known", () => {
    for (const f of factions.factions) {
      expect(STANCE_IDS).toContain(f.start.stance);
      expect(FACTION_GROUPS).toContain(f.group);
    }
  });

  it("all factions start un-vassalized", () => {
    expect(factions.factions.every((f) => f.start.vassal === false)).toBe(true);
  });

  it("rejects an unknown stance id", () => {
    const bad = { factions: [{ ...factions.factions[0]!, start: { stance: "smitten", vassal: false } }] };
    expect(() => parseFactionsContent(bad)).toThrow();
  });
});
