import { describe, expect, it } from "vitest";
import { commandSeat, heldByLeagueLine, holderRefusal, LEAGUE_COMMAND_REFUSAL, LEAGUE_MOVE_REFUSAL, leagueAtWarWith, leaguePeaceLine, leagueSuppliesRefusal, leagueWarRefusal } from "./index.js";

// ---------------------------------------------------------------------------
// The League's orders (government prompt 5b), pure rules and words: who
// commands, when the League is at war with a nation, and every sentence an
// order can be refused or turned back with.
// ---------------------------------------------------------------------------

const SEASON = 86_400_000;

describe("commandSeat", () => {
  it("a sitting Archon or Strategos commands; an Ephor, a party office and a citizen do not", () => {
    expect(commandSeat([{ office: "archon", side: "dynatoi" }])).toEqual({ office: "archon", side: "dynatoi" });
    expect(commandSeat([{ office: "strategos", side: null }])).toEqual({ office: "strategos", side: null });
    expect(commandSeat([{ office: "ephor", side: "palaioi" }])).toBeNull();
    expect(commandSeat([{ office: "party_archon", side: "palaioi" }, { office: "party_ephor", side: "palaioi" }])).toBeNull();
    expect(commandSeat([])).toBeNull();
    // The Archon's seat is named before a Strategos's when a man holds both.
    expect(commandSeat([{ office: "strategos", side: null }, { office: "archon", side: "palaioi" }])).toEqual({ office: "archon", side: "palaioi" });
    expect(LEAGUE_COMMAND_REFUSAL).toBe("Only a sitting Archon or Strategos commands the League's army.");
  });
});

describe("leagueAtWarWith", () => {
  const wars = [{ factionId: "carthage", startsAt: 11 * SEASON, endsAt: 19 * SEASON }];
  it("from the instant the war starts until peace comes, the end excluded, and with that nation alone", () => {
    expect(leagueAtWarWith(wars, "carthage", 11 * SEASON - 1)).toBe(false);
    expect(leagueAtWarWith(wars, "carthage", 11 * SEASON)).toBe(true);
    expect(leagueAtWarWith(wars, "carthage", 19 * SEASON - 1)).toBe(true);
    expect(leagueAtWarWith(wars, "carthage", 19 * SEASON)).toBe(false);
    expect(leagueAtWarWith(wars, "saluvii", 12 * SEASON)).toBe(false);
    expect(leagueAtWarWith([], "carthage", 12 * SEASON)).toBe(false);
  });
});

describe("the refusals, verbatim", () => {
  it("the war gate: a nation at peace by its name, and land that answers to no nation", () => {
    expect(leagueWarRefusal({ name: "Saluvii", group: "celto-ligurian" })).toBe("The League is not at war with the Saluvii.");
    expect(leagueWarRefusal({ name: "Carthage", group: "major-powers" })).toBe("The League is not at war with Carthage.");
    expect(leagueWarRefusal(null)).toBe("The League makes war on nations alone, and this land answers to none.");
  });

  it("a holding: the League's to a house, another house's to anyone", () => {
    expect(holderRefusal("league", "town")).toBe("The League holds this town.");
    expect(holderRefusal("league", "land")).toBe("The League holds this land.");
    expect(holderRefusal("house", "town")).toBe("Another house holds this town.");
    expect(holderRefusal("house", "land")).toBe("Another house holds this land.");
  });

  it("a move off the League's own ground, and a voyage the treasury cannot pay for", () => {
    expect(LEAGUE_MOVE_REFUSAL).toBe("The League's men move only between its towns and its holdings.");
    expect(leagueSuppliesRefusal(1568, 912)).toBe("The treasury cannot pay for the voyage: 1,568 drachmae of naval supplies, 912 in the treasury.");
  });
});

describe("a party that turned back", () => {
  const force = [{ label: "hoplites", count: 40 }];
  it("the League's, arriving after the peace; and a house's, finding the place the League's", () => {
    expect(leaguePeaceLine(force, "Reii", { name: "Saluvii", group: "celto-ligurian" })).toBe("40 hoplites reached Reii after the peace with the Saluvii and turned back.");
    expect(leaguePeaceLine([], "Karalis", { name: "Carthage", group: "major-powers" })).toBe("The League's men reached Karalis after the peace with Carthage and turned back.");
    expect(heldByLeagueLine(force, "Reii")).toBe("40 hoplites found Reii held by the League and turned back.");
    expect(heldByLeagueLine([], "Reii")).toBe("Our men found Reii held by the League and turned back.");
  });
});
