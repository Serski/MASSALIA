import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { leagueDocket, parseCitiesContent, parseLeagueBuildings, parseProjectMotionId, projectKey, projectMotion, projectMotionId, type DocketPolis } from "./index.js";

// ---------------------------------------------------------------------------
// The League's building projects (government prompt 2a), pure rules: the
// content parses, the docket is every project the League can still build and
// afford in order, and the project ids round-trip. Numbers come from content.
// ---------------------------------------------------------------------------

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const content = parseLeagueBuildings(JSON.parse(readFileSync(resolve(root, "content/politics/league-buildings.json"), "utf8")));
const buildings = content.buildings;
const cities = parseCitiesContent(JSON.parse(readFileSync(resolve(root, "content/cities/cities.json"), "utf8"))).cities;
const startPoleis: DocketPolis[] = cities.map((c) => ({ id: c.id, name: c.name, population: c.start.population }));
const none = new Set<string>();

describe("league-buildings.json", () => {
  it("parses: five buildings in order with their costs, seasons and floors", () => {
    expect(buildings.map((b) => b.id)).toEqual(["temple", "bazaar", "granary", "walls", "port"]);
    expect(buildings.map((b) => [b.cost, b.seasons, b.populationAbove, b.fortifications])).toEqual([
      [1000, 4, 2000, 0],
      [1500, 4, 2000, 0],
      [1200, 4, 2000, 0],
      [2000, 8, null, 1],
      [2000, 8, null, 0],
    ]);
  });

  it("rejects a duplicate id and an unknown key", () => {
    const dup = { buildings: [buildings[0], buildings[0]] };
    expect(() => parseLeagueBuildings(dup)).toThrow(/Duplicate league building/);
    expect(() => parseLeagueBuildings({ buildings: [{ ...buildings[0], extra: 1 }] })).toThrow();
  });
});

describe("leagueDocket", () => {
  it("at the start populations and 60,000 the docket is 36 projects, polis order first then the buildings", () => {
    const docket = leagueDocket(buildings, startPoleis, none, 60_000);
    expect(docket).toHaveLength(36);
    const above = startPoleis.filter((p) => p.population > 2000);
    expect(above.map((p) => p.id)).toEqual(["massalia", "nikaia", "olbia", "agathe", "emporion", "rhoda"]);
    // Six poleis above 2,000 take all five buildings; the other three take the Walls and the Port.
    expect(docket.filter((m) => ["temple", "bazaar", "granary"].includes(m.buildingId))).toHaveLength(18);
    expect(docket.filter((m) => ["walls", "port"].includes(m.buildingId))).toHaveLength(18);
    // Order: the first polis's projects, in the buildings' order, come first.
    expect(docket.slice(0, 5).map((m) => m.id)).toEqual(["temple", "bazaar", "granary", "walls", "port"].map((b) => projectMotionId("massalia", b)));
    expect(docket[0]).toEqual({
      id: "project:massalia:temple",
      cityId: "massalia",
      buildingId: "temple",
      polis: "Massalia",
      title: "A Temple of Artemis at Massalia",
      description: buildings[0]!.description,
      cost: 1000,
      seasons: 4,
      partyLean: "palaioi",
    });
  });

  it("a polis of exactly 2,000 gets only the Walls and the Port", () => {
    const antipolis = startPoleis.find((p) => p.id === "antipolis")!;
    expect(antipolis.population).toBe(2000);
    expect(leagueDocket(buildings, [antipolis], none, 60_000).map((m) => m.buildingId)).toEqual(["walls", "port"]);
  });

  it("a taken pair is left out", () => {
    const taken = new Set([projectKey("massalia", "walls")]);
    const docket = leagueDocket(buildings, startPoleis, taken, 60_000);
    expect(docket).toHaveLength(35);
    expect(docket.some((m) => m.id === "project:massalia:walls")).toBe(false);
    expect(docket.some((m) => m.id === "project:nikaia:walls")).toBe(true);
  });

  it("a balance of 1,499 leaves only the Temple and the Granary", () => {
    const docket = leagueDocket(buildings, startPoleis, none, 1_499);
    expect(new Set(docket.map((m) => m.buildingId))).toEqual(new Set(["temple", "granary"]));
    expect(docket).toHaveLength(12);
    expect(leagueDocket(buildings, startPoleis, none, 999)).toEqual([]);
  });
});

describe("the project ids", () => {
  it("round-trip", () => {
    expect(projectMotionId("nikaia", "walls")).toBe("project:nikaia:walls");
    expect(parseProjectMotionId("project:nikaia:walls")).toEqual({ cityId: "nikaia", buildingId: "walls" });
  });

  it("a League card id, a bare prefix and a malformed id parse to null", () => {
    expect(parseProjectMotionId("league-sea-wall")).toBeNull();
    expect(parseProjectMotionId("project:")).toBeNull();
    expect(parseProjectMotionId("project:nikaia")).toBeNull();
    expect(parseProjectMotionId("project:nikaia:walls:extra")).toBeNull();
  });

  it("projectMotion resolves a project with no eligibility check, and null otherwise", () => {
    const m = projectMotion("project:antipolis:temple", buildings, cities);
    expect(m?.title).toBe("A Temple of Artemis at Antipolis");
    expect(m?.polis).toBe("Antipolis");
    expect(projectMotion("project:atlantis:temple", buildings, cities)).toBeNull();
    expect(projectMotion("project:massalia:lighthouse", buildings, cities)).toBeNull();
    expect(projectMotion("league-sea-wall", buildings, cities)).toBeNull();
  });
});
