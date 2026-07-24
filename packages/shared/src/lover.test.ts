import { describe, expect, it } from "vitest";
import { LOVER_FALL_FLOOR, loverFallChance } from "./lover.js";

describe("loverFallChance — yearly fall odds", () => {
  it("base 25% for a neutral personality or none", () => {
    expect(loverFallChance("brave")).toBeCloseTo(0.25);
    expect(loverFallChance(null)).toBeCloseTo(0.25);
  });
  it("prone personalities +15 → 40%", () => {
    for (const p of ["hedonist", "hotblooded", "ambitious", "cunning", "greedy"]) {
      expect(loverFallChance(p)).toBeCloseTo(0.4);
    }
  });
  it("resistant personalities −15 → 10%", () => {
    for (const p of ["pious", "temperate", "honest", "patient", "humble"]) {
      expect(loverFallChance(p)).toBeCloseTo(0.1);
    }
  });
  it("never below the 5% floor", () => {
    for (const p of ["pious", "brave", "hedonist", null]) {
      expect(loverFallChance(p)).toBeGreaterThanOrEqual(LOVER_FALL_FLOOR);
    }
  });
});
