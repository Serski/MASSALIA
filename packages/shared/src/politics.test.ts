import { describe, expect, it } from "vitest";
import {
  censureExpiryOutcome,
  DEFECTION_TRAIT_ID,
  hasDriftedFromParty,
  meetsPartyIdeology,
} from "./politics.js";

describe("meetsPartyIdeology — join thresholds", () => {
  it("palaioi requires ideology <= -10", () => {
    expect(meetsPartyIdeology("palaioi", -10)).toBe(true);
    expect(meetsPartyIdeology("palaioi", -50)).toBe(true);
    expect(meetsPartyIdeology("palaioi", -9)).toBe(false);
    expect(meetsPartyIdeology("palaioi", 10)).toBe(false);
  });

  it("dynatoi requires ideology >= +10", () => {
    expect(meetsPartyIdeology("dynatoi", 10)).toBe(true);
    expect(meetsPartyIdeology("dynatoi", 80)).toBe(true);
    expect(meetsPartyIdeology("dynatoi", 9)).toBe(false);
    expect(meetsPartyIdeology("dynatoi", -10)).toBe(false);
  });

  it("'none' is always valid", () => {
    expect(meetsPartyIdeology("none", 0)).toBe(true);
  });
});

describe("hasDriftedFromParty — censure trigger", () => {
  it("flags a member who crossed back into the centre", () => {
    expect(hasDriftedFromParty("dynatoi", 5)).toBe(true); // was reformist, now centrist
    expect(hasDriftedFromParty("palaioi", -3)).toBe(true);
  });

  it("flags a member who crossed past the opposite side", () => {
    expect(hasDriftedFromParty("dynatoi", -20)).toBe(true);
    expect(hasDriftedFromParty("palaioi", 40)).toBe(true);
  });

  it("does not flag a member still in range", () => {
    expect(hasDriftedFromParty("dynatoi", 15)).toBe(false);
    expect(hasDriftedFromParty("palaioi", -15)).toBe(false);
  });

  it("never flags the unaligned", () => {
    expect(hasDriftedFromParty("none", 0)).toBe(false);
  });
});

describe("censureExpiryOutcome — worker resolution", () => {
  it("kicks when still out of range at expiry", () => {
    expect(censureExpiryOutcome("dynatoi", 5)).toBe("kick");
    expect(censureExpiryOutcome("palaioi", 0)).toBe("kick");
  });

  it("clears when ideology returned to range by expiry", () => {
    expect(censureExpiryOutcome("dynatoi", 15)).toBe("clear");
    expect(censureExpiryOutcome("palaioi", -25)).toBe("clear");
  });
});

it("uses the 'turncoat' trait for defection", () => {
  expect(DEFECTION_TRAIT_ID).toBe("turncoat");
});
