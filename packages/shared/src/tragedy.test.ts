import { describe, expect, it } from "vitest";
import { clytemnestraSuccessChance, tragedyArchetype } from "./tragedy.js";

describe("tragedyArchetype", () => {
  const medea = { personalityId: "ruthless", loverPlotWasRun: true, hasLivingChildren: true };

  it("medea: the hard triple gate — ruthless AND plot AND living children", () => {
    expect(tragedyArchetype(medea)).toBe("medea");
  });

  it("clytemnestra: a ruthless wife who fails either half of Medea's gate", () => {
    expect(tragedyArchetype({ ...medea, hasLivingChildren: false })).toBe("clytemnestra"); // no children
    expect(tragedyArchetype({ ...medea, loverPlotWasRun: false })).toBe("clytemnestra"); // no plot
  });

  it("clytemnestra: each of the other dangerous personalities", () => {
    for (const p of ["hotblooded", "ambitious", "cunning", "greedy"]) {
      expect(tragedyArchetype({ personalityId: p, loverPlotWasRun: false, hasLivingChildren: false })).toBe("clytemnestra");
    }
  });

  it("phaedra: everyone else, a null personality included", () => {
    expect(tragedyArchetype({ personalityId: "pious", loverPlotWasRun: true, hasLivingChildren: true })).toBe("phaedra");
    expect(tragedyArchetype({ personalityId: null, loverPlotWasRun: true, hasLivingChildren: true })).toBe("phaedra");
  });
});

describe("clytemnestraSuccessChance", () => {
  it("base 0.30 (0.25 + estranged +0.05), eroded 0.03/militia, floored at 0.05", () => {
    expect(clytemnestraSuccessChance(0)).toBeCloseTo(0.3, 10);
    expect(clytemnestraSuccessChance(5)).toBeCloseTo(0.15, 10);
    expect(clytemnestraSuccessChance(9)).toBeCloseTo(0.05, 10); // 0.03 → floored to 0.05
  });

  it("derives the swing from the modifier — a different modifier moves the chance (no hardcoded 5)", () => {
    expect(clytemnestraSuccessChance(0, 0)).toBeCloseTo(0.25, 10); // no swing
    expect(clytemnestraSuccessChance(0, -5)).toBeCloseTo(0.3, 10); // the real estranged value
    expect(clytemnestraSuccessChance(0, -10)).toBeCloseTo(0.35, 10); // double the swing → +0.10
  });
});
