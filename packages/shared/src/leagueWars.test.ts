import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { nationName, parseFactionsContent, parseLeagueWar, parseWarMotionId, warDocket, warEffects, warMotion, warMotionId, type WarRelation } from "./index.js";

// ---------------------------------------------------------------------------
// The League's wars (government prompt 4), pure rules: the content parses, the
// Spring docket is the nations below the bar that are not at war while the
// treasury can pay, the ids round-trip and the effects read as the dockets
// show them. The numbers come from content.
// ---------------------------------------------------------------------------

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const raw = JSON.parse(readFileSync(resolve(root, "content/politics/league-war.json"), "utf8"));
const war = parseLeagueWar(raw);
const factions = parseFactionsContent(JSON.parse(readFileSync(resolve(root, "content/diplomacy/factions.json"), "utf8"))).factions;
const none = new Map<string, WarRelation>();

describe("league-war.json", () => {
  it("parses: 2,000 drachmae, 8 seasons, below 0, peace at −100, half again the plunder, a Palaioi lean", () => {
    expect(war).toEqual({
      cost: 2000,
      seasons: 8,
      opinionBelow: 0,
      peaceOpinion: -100,
      plunderMultiplier: 1.5,
      partyLean: "palaioi",
      title: "War on {nation}",
      description: "The League takes up arms against {nation}. Every raid on their land becomes an act of war, and pays like one.",
    });
  });

  it("rejects a missing key, an extra key, a multiplier under 1, a bar out of range and words without {nation}", () => {
    const { cost: _cost, ...missing } = raw;
    void _cost;
    expect(() => parseLeagueWar(missing)).toThrow();
    expect(() => parseLeagueWar({ ...raw, extra: 1 })).toThrow();
    expect(() => parseLeagueWar({ ...raw, plunderMultiplier: 0.9 })).toThrow();
    expect(() => parseLeagueWar({ ...raw, peaceOpinion: -201 })).toThrow();
    expect(() => parseLeagueWar({ ...raw, seasons: 0 })).toThrow();
    expect(() => parseLeagueWar({ ...raw, title: "War" })).toThrow();
  });
});

describe("nationName and the war ids", () => {
  it("a major power by its name, a people with the article", () => {
    expect(nationName(factions.find((f) => f.id === "carthage")!)).toBe("Carthage");
    expect(nationName(factions.find((f) => f.id === "cadurci")!)).toBe("the Cadurci");
  });

  it("the ids round-trip, and anything else parses to null", () => {
    expect(warMotionId("carthage", 7)).toBe("war:carthage:y7");
    expect(parseWarMotionId("war:carthage:y7")).toEqual({ factionId: "carthage", year: 7 });
    expect(parseWarMotionId("festival:dionysia:y7")).toBeNull();
    expect(parseWarMotionId("project:massalia:temple")).toBeNull();
    expect(parseWarMotionId("war:carthage")).toBeNull();
    expect(parseWarMotionId("war:carthage:7")).toBeNull();
  });
});

describe("warDocket", () => {
  it("at the content starts with 60,000: the six nations below 0, in content order", () => {
    const docket = warDocket(factions, none, war, 2, 60_000);
    expect(docket.map((m) => m.factionId)).toEqual(["cadurci", "volcae", "allobroges", "saluvii", "tarusates", "carthage"]);
    expect(docket[0]).toEqual({
      id: "war:cadurci:y2",
      factionId: "cadurci",
      name: "Cadurci",
      title: "War on the Cadurci",
      description: "The League takes up arms against the Cadurci. Every raid on their land becomes an act of war, and pays like one.",
      cost: 2000,
      partyLean: "palaioi",
      year: 2,
    });
    expect(docket[5]!.title).toBe("War on Carthage");
    expect(docket[5]!.description).toBe("The League takes up arms against Carthage. Every raid on their land becomes an act of war, and pays like one.");
  });

  it("a bar that fell adds a nation, one that rose to 0 drops it, and a nation at war is not on it", () => {
    const ids = (relations: Map<string, WarRelation>) => warDocket(factions, relations, war, 2, 60_000).map((m) => m.factionId);
    expect(ids(new Map([["ruteni", { opinion: -1, atWar: false }]]))).toEqual(["cadurci", "ruteni", "volcae", "allobroges", "saluvii", "tarusates", "carthage"]);
    expect(ids(new Map([["cadurci", { opinion: 0, atWar: false }]]))).toEqual(["volcae", "allobroges", "saluvii", "tarusates", "carthage"]);
    expect(ids(new Map([["carthage", { opinion: -200, atWar: true }]]))).toEqual(["cadurci", "volcae", "allobroges", "saluvii", "tarusates"]);
  });

  it("the balance bounds it: 2,000 pays for a war, 1,999 for none", () => {
    expect(warDocket(factions, none, war, 2, 2000)).toHaveLength(6);
    expect(warDocket(factions, none, war, 2, 1999)).toEqual([]);
  });

  it("warMotion resolves one id with no eligibility check", () => {
    expect(warMotion("war:rome:y5", factions, war)).toMatchObject({ factionId: "rome", name: "Rome", title: "War on Rome", year: 5 });
    expect(warMotion("war:atlantis:y5", factions, war)).toBeNull();
    expect(warMotion("festival:dionysia:y5", factions, war)).toBeNull();
  });
});

describe("warEffects", () => {
  it("two lines, verbatim", () => {
    expect(warEffects(war)).toEqual(["Raids on the enemy's land +50% plunder", "Peace after 2 years, at Hostile"]);
  });
});
