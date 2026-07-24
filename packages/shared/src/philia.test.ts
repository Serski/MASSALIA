import { describe, expect, it } from "vitest";
import { philiaBand, philiaFertilityMultiplier, philiaModifiers, clampPhilia } from "./philia.js";

describe("philiaBand — boundaries", () => {
  it("estranged ≤ 10, cold begins at 11", () => {
    expect(philiaBand(0)).toBe("estranged");
    expect(philiaBand(10)).toBe("estranged");
    expect(philiaBand(11)).toBe("cold");
  });
  it("cold ≤ 30, dutiful begins at 31", () => {
    expect(philiaBand(30)).toBe("cold");
    expect(philiaBand(31)).toBe("dutiful");
  });
  it("dutiful ≤ 70, warm begins at 71", () => {
    expect(philiaBand(70)).toBe("dutiful");
    expect(philiaBand(71)).toBe("warm");
  });
  it("warm ≤ 80, devoted begins at 81", () => {
    expect(philiaBand(80)).toBe("warm");
    expect(philiaBand(81)).toBe("devoted");
    expect(philiaBand(100)).toBe("devoted");
  });
});

describe("philiaModifiers", () => {
  it("estranged: -5 assassination defense, 0 recovery", () => {
    expect(philiaModifiers(5)).toEqual({ assassinationDefenseMod: -5, composureRecoveryBonus: 0 });
  });
  it("devoted: 0 assassination defense, +2 recovery", () => {
    expect(philiaModifiers(90)).toEqual({ assassinationDefenseMod: 0, composureRecoveryBonus: 2 });
  });
  it("all middle bands: both zero", () => {
    for (const p of [20, 50, 75]) {
      expect(philiaModifiers(p)).toEqual({ assassinationDefenseMod: 0, composureRecoveryBonus: 0 });
    }
  });
});

describe("philiaFertilityMultiplier — min(philia/50, 1.2)", () => {
  it("0 → 0×", () => expect(philiaFertilityMultiplier(0)).toBe(0));
  it("25 → 0.5×", () => expect(philiaFertilityMultiplier(25)).toBe(0.5));
  it("50 → 1.0× (today's neutral)", () => expect(philiaFertilityMultiplier(50)).toBe(1));
  it("100 → 1.2× (capped)", () => expect(philiaFertilityMultiplier(100)).toBe(1.2));
});

describe("clampPhilia (moved from family.ts)", () => {
  it("clamps to 0..100", () => {
    expect(clampPhilia(-3)).toBe(0);
    expect(clampPhilia(103)).toBe(100);
    expect(clampPhilia(50)).toBe(50);
  });
});
