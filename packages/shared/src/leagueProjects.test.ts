import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildingEffects,
  leagueClassGrants,
  leagueClassPay,
  leagueDocket,
  leagueDues,
  leagueMorale,
  leagueStabilityBonus,
  parseCitiesContent,
  parseLeagueBuildings,
  parseProjectMotionId,
  projectKey,
  projectMotion,
  projectMotionId,
  REAL_MS_PER_SEASON,
  type DocketPolis,
  type ProjectTiming,
} from "./index.js";

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

  it("carries what each building does: the grant, the morale, the stability and the dues", () => {
    expect(buildings.map((b) => [b.classBonus, b.morale, b.stabilityPerYear, b.treasuryPerSeason])).toEqual([
      [{ class: "priest", perSeason: 20, seasons: 4 }, { amount: 3, seasons: 8 }, 3, 0],
      [{ class: "trader", perSeason: 20, seasons: 4 }, null, 0, 100],
      [{ class: "landowner", perSeason: 20, seasons: 4 }, null, 0, 0],
      [null, null, 0, 0],
      [{ class: "shipbuilder", perSeason: 20, seasons: 4 }, null, 0, 50],
    ]);
  });

  it("rejects a grant to an unknown class and a morale of 0 seasons", () => {
    expect(() => parseLeagueBuildings({ buildings: [{ ...buildings[0], classBonus: { class: "sailor", perSeason: 20, seasons: 4 } }] })).toThrow();
    expect(() => parseLeagueBuildings({ buildings: [{ ...buildings[0], morale: { amount: 3, seasons: 0 } }] })).toThrow();
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

// --- What a standing building does (government prompt 2b) ---------------------
// A world started at 0: "season n" is n × REAL_MS_PER_SEASON.
const S = REAL_MS_PER_SEASON;
const season = (n: number) => n * S;
const timing = (cityId: string, buildingId: string, standsAtSeason: number): ProjectTiming => ({ cityId, buildingId, completesAt: season(standsAtSeason) });
const templeMassalia = timing("massalia", "temple", 4);

describe("leagueClassPay", () => {
  it("a Temple standing at season 4 pays a Priest 20 for each of seasons 4 to 7, and a Trader nothing", () => {
    const pay = (from: number, to: number, classId = "priest") => leagueClassPay([templeMassalia], buildings, classId, 0, from, to);
    expect(pay(0, 3)).toBe(0);
    expect(pay(4, 7)).toBe(80);
    expect(pay(4, 4)).toBe(20);
    expect(pay(7, 9)).toBe(20);
    expect(pay(8, 20)).toBe(0);
    expect(pay(4, 7, "trader")).toBe(0);
    expect(pay(5, 4)).toBe(0);
  });

  it("each Temple pays on its own: a second one at Nikaia standing at season 6 doubles the overlap", () => {
    const two = [templeMassalia, timing("nikaia", "temple", 6)];
    expect(leagueClassPay(two, buildings, "priest", 0, 4, 9)).toBe(160);
    expect(leagueClassPay(two, buildings, "priest", 0, 6, 7)).toBe(80);
  });
});

describe("leagueClassGrants", () => {
  it("lists the grant running for the class, with the motion's title and the span's end", () => {
    const grant = { cityId: "massalia", buildingId: "temple", title: "A Temple of Artemis at Massalia", perSeason: 20, untilMs: season(8) };
    expect(leagueClassGrants([templeMassalia], buildings, cities, "priest", season(4))).toEqual([grant]);
    expect(leagueClassGrants([templeMassalia], buildings, cities, "priest", season(5))).toEqual([grant]);
    expect(leagueClassGrants([templeMassalia], buildings, cities, "priest", season(8))).toEqual([]);
    expect(leagueClassGrants([templeMassalia], buildings, cities, "trader", season(5))).toEqual([]);
  });
});

describe("leagueMorale", () => {
  it("a Temple standing at season 4 blesses every army for 8 seasons", () => {
    expect(leagueMorale([templeMassalia], buildings, season(3))).toBeNull();
    expect(leagueMorale([templeMassalia], buildings, season(4))).toEqual({ amount: 3, untilMs: season(12) });
    expect(leagueMorale([templeMassalia], buildings, season(12))).toBeNull();
  });

  it("a second Temple that stands before the first one's years run out carries the blessing on, never adding to it", () => {
    const at10 = [templeMassalia, timing("nikaia", "temple", 10)];
    expect(leagueMorale(at10, buildings, season(5))).toEqual({ amount: 3, untilMs: season(18) });
    expect(leagueMorale(at10, buildings, season(11))).toEqual({ amount: 3, untilMs: season(18) });
    const at12 = [templeMassalia, timing("nikaia", "temple", 12)];
    expect(leagueMorale(at12, buildings, season(5))).toEqual({ amount: 3, untilMs: season(20) });
    const at13 = [templeMassalia, timing("nikaia", "temple", 13)];
    expect(leagueMorale(at13, buildings, season(5))).toEqual({ amount: 3, untilMs: season(12) });
    expect(leagueMorale(at13, buildings, season(12.5))).toBeNull();
  });
});

describe("leagueDues and leagueStabilityBonus", () => {
  it("the standing Bazaars and Ports pay their dues; a Temple pays none", () => {
    const projects = [timing("massalia", "bazaar", 4), timing("nikaia", "port", 8), timing("olbia", "temple", 4)];
    expect(leagueDues(projects, buildings, season(3))).toBe(0);
    expect(leagueDues(projects, buildings, season(4))).toBe(100);
    expect(leagueDues(projects, buildings, season(8))).toBe(150);
  });

  it("a standing Temple steadies its own polis", () => {
    expect(leagueStabilityBonus([templeMassalia], buildings, "massalia", season(4))).toBe(3);
    expect(leagueStabilityBonus([templeMassalia], buildings, "massalia", season(3))).toBe(0);
    expect(leagueStabilityBonus([templeMassalia], buildings, "nikaia", season(4))).toBe(0);
  });
});

describe("buildingEffects", () => {
  it("one line per effect, in order, for Massalia", () => {
    const by = (id: string) => buildingEffects(buildings.find((b) => b.id === id)!, "Massalia");
    expect(by("temple")).toEqual(["Priests +20 dr a season for 4 seasons", "Every army +3 morale for 2 years", "Massalia +3 stability a year"]);
    expect(by("bazaar")).toEqual(["Traders +20 dr a season for 4 seasons", "League treasury +100 dr a season"]);
    expect(by("granary")).toEqual(["Landowners +20 dr a season for 4 seasons"]);
    expect(by("walls")).toEqual(["Massalia's fortifications +1"]);
    expect(by("port")).toEqual(["Shipbuilders +20 dr a season for 4 seasons", "League treasury +50 dr a season"]);
  });

  it("the span reads 1 season, N seasons, or N years for a multiple of four from eight up", () => {
    const temple = buildings.find((b) => b.id === "temple")!;
    expect(buildingEffects({ ...temple, classBonus: { class: "priest", perSeason: 5, seasons: 1 }, morale: { amount: 1, seasons: 4 } }, "Olbia")).toEqual([
      "Priests +5 dr a season for 1 season",
      "Every army +1 morale for 4 seasons",
      "Olbia +3 stability a year",
    ]);
    expect(buildingEffects({ ...temple, classBonus: null, morale: { amount: 2, seasons: 12 }, stabilityPerYear: 0 }, "Olbia")).toEqual(["Every army +2 morale for 3 years"]);
  });
});
