import { describe, expect, it } from "vitest";
import {
  assassinateSuccessChance,
  bodyguardDefense,
  parseInteractionsConfig,
  poisonSuccessChance,
  type AssassinateConfig,
  type PoisonConfig,
} from "./interactions.js";

const cfg: PoisonConfig = {
  hostile: true,
  respectsPrestigeFloor: true,
  baseChance: 0.5,
  statScale: 40,
  clampMin: 0.05,
  clampMax: 0.95,
  physicianMod: 15,
  illnessChance: 0.6,
};

const acfg: AssassinateConfig = {
  hostile: true,
  respectsPrestigeFloor: true,
  costDrachmae: 200,
  baseChance: 0.45,
  statScale: 40,
  clampMin: 0.05,
  clampMax: 0.95,
  bodyguardModMax: 24,
  bodyguardDecay: 0.5,
};

// The spymaster guard mod the caller resolves and passes in (guardMod, or 0).
const GUARD = 10;

describe("poisonSuccessChance", () => {
  it("is baseChance when attacker and defender are evenly matched (no defenders)", () => {
    expect(poisonSuccessChance(50, 50, false, 0, cfg)).toBeCloseTo(0.5, 10);
  });

  it("rises with the attacker's intelligence edge, falls with the target's", () => {
    // +40 attacker edge → +40/40 = +1.0 before clamp → clamped to 0.95.
    expect(poisonSuccessChance(90, 50, false, 0, cfg)).toBeCloseTo(0.95, 10);
    // 20-point attacker deficit → 0.5 − 0.5 = 0.0 raw → clamped to 0.05.
    expect(poisonSuccessChance(30, 50, false, 0, cfg)).toBeCloseTo(0.05, 10);
  });

  it("a physician lowers the success chance (raises the target's defense)", () => {
    const without = poisonSuccessChance(50, 50, false, 0, cfg);
    const withPhysician = poisonSuccessChance(50, 50, true, 0, cfg);
    expect(withPhysician).toBeLessThan(without);
    // 50 vs (50 + 15) → 0.5 + (−15/40) = 0.125.
    expect(withPhysician).toBeCloseTo(0.125, 10);
  });

  it("the clamp floor holds at clampMin even against a maximally-defended target", () => {
    // A feeble attacker vs a genius with a physician: raw p is deeply negative, but
    // the elite is never fully untouchable — the floor guarantees clampMin.
    expect(poisonSuccessChance(0, 100, true, 0, cfg)).toBe(0.05);
    expect(poisonSuccessChance(1, 100, true, GUARD, cfg)).toBe(cfg.clampMin);
  });

  it("the clamp ceiling holds at clampMax for a lopsided attacker", () => {
    expect(poisonSuccessChance(100, 0, false, 0, cfg)).toBe(0.95);
  });
});

describe("bodyguardDefense (diminishing returns)", () => {
  it("matches the curve at n = 0, 1, 2, 3 with the shipped defaults", () => {
    expect(bodyguardDefense(0, acfg)).toBeCloseTo(0, 10);
    expect(bodyguardDefense(1, acfg)).toBeCloseTo(12, 10);
    expect(bodyguardDefense(2, acfg)).toBeCloseTo(18, 10);
    expect(bodyguardDefense(3, acfg)).toBeCloseTo(21, 10);
  });

  it("is monotonically increasing but never exceeds bodyguardModMax (the asymptote)", () => {
    let prev = -1;
    for (let n = 0; n <= 50; n++) {
      const d = bodyguardDefense(n, acfg);
      expect(d).toBeGreaterThan(prev);
      expect(d).toBeLessThan(acfg.bodyguardModMax);
      prev = d;
    }
    // Even at an absurd count it asymptotes just under the max.
    expect(bodyguardDefense(1000, acfg)).toBeLessThanOrEqual(acfg.bodyguardModMax);
    expect(bodyguardDefense(1000, acfg)).toBeCloseTo(acfg.bodyguardModMax, 6);
  });
});

describe("assassinateSuccessChance", () => {
  it("is baseChance when evenly matched with no defenders", () => {
    expect(assassinateSuccessChance(50, 50, 0, 0, acfg)).toBeCloseTo(0.45, 10);
  });

  it("more bodyguards lower the odds, with diminishing effect", () => {
    const g0 = assassinateSuccessChance(50, 50, 0, 0, acfg);
    const g1 = assassinateSuccessChance(50, 50, 1, 0, acfg);
    const g2 = assassinateSuccessChance(50, 50, 2, 0, acfg);
    expect(g1).toBeLessThan(g0);
    expect(g2).toBeLessThan(g1);
    // The 1st guard removes more chance than the 2nd (diminishing returns).
    expect(g0 - g1).toBeGreaterThan(g1 - g2);
  });

  it("the clamp floor holds at clampMin vs max intel + many guards + a spymaster (untouchable-elite guard)", () => {
    expect(assassinateSuccessChance(0, 100, 50, 0, acfg)).toBe(acfg.clampMin);
    expect(assassinateSuccessChance(1, 100, 1000, GUARD, acfg)).toBe(0.05);
  });
});

describe("spymaster guard (Prompt 4)", () => {
  it("raises D in the POISON channel — the guard mod lowers the success chance", () => {
    const without = poisonSuccessChance(50, 50, false, 0, cfg);
    const withGuard = poisonSuccessChance(50, 50, false, GUARD, cfg);
    expect(withGuard).toBeLessThan(without);
    // 50 vs (50 + 10) → 0.5 + (−10/40) = 0.25.
    expect(withGuard).toBeCloseTo(0.25, 10);
  });

  it("raises D in the ASSASSINATE channel — the guard mod lowers the success chance", () => {
    const without = assassinateSuccessChance(50, 50, 0, 0, acfg);
    const withGuard = assassinateSuccessChance(50, 50, 0, GUARD, acfg);
    expect(withGuard).toBeLessThan(without);
    // 50 vs (50 + 10) → 0.45 + (−10/40) = 0.20.
    expect(withGuard).toBeCloseTo(0.2, 10);
  });

  it("stacks with the channel's own unit (physician + guard in poison)", () => {
    // 50 vs (50 + 15 physician + 10 guard = 75) → 0.5 + (−25/40) = −0.125 → floor 0.05.
    expect(poisonSuccessChance(50, 50, true, GUARD, cfg)).toBeCloseTo(0.05, 10);
  });
});

describe("cross-channel isolation", () => {
  it("a physician does NOT affect the assassinate channel (only bodyguards + the spymaster do)", () => {
    // assassinateSuccessChance has no physician input at all — its unit is bodyguards.
    const noGuards = assassinateSuccessChance(50, 50, 0, 0, acfg);
    expect(assassinateSuccessChance(50, 50, 2, 0, acfg)).not.toBe(noGuards);
  });

  it("bodyguards do NOT affect the poison channel (only a physician + the spymaster do)", () => {
    // poisonSuccessChance has no bodyguard-count input — its unit is the physician flag.
    const noPhysician = poisonSuccessChance(50, 50, false, 0, cfg);
    const withPhysician = poisonSuccessChance(50, 50, true, 0, cfg);
    expect(withPhysician).toBeLessThan(noPhysician);
  });

  it("the SPYMASTER guard is the sanctioned exception — present in BOTH channels", () => {
    // The same guard mod moves both functions (the cross-channel generalist).
    expect(poisonSuccessChance(50, 50, false, GUARD, cfg)).toBeLessThan(poisonSuccessChance(50, 50, false, 0, cfg));
    expect(assassinateSuccessChance(50, 50, 0, GUARD, acfg)).toBeLessThan(assassinateSuccessChance(50, 50, 0, 0, acfg));
  });

  it("each function's own unit is exclusive: physician lever exists only on poison, bodyguard only on assassinate", () => {
    // Signatures: poison (actorIntel, targetIntel, hasPhysician, spymasterGuard, cfg);
    // assassinate (actorIntel, targetIntel, bodyguardCount, spymasterGuard, cfg).
    expect(poisonSuccessChance.length).toBe(5);
    expect(assassinateSuccessChance.length).toBe(5);
    // Physician is a boolean flag unique to poison; a physician cannot be expressed on
    // the assassinate signature, and a bodyguard count cannot be expressed on poison.
    expect(poisonSuccessChance(50, 50, true, 0, cfg)).not.toBe(poisonSuccessChance(50, 50, false, 0, cfg));
    expect(assassinateSuccessChance(50, 50, 3, 0, acfg)).not.toBe(assassinateSuccessChance(50, 50, 0, 0, acfg));
  });
});

describe("parseInteractionsConfig", () => {
  it("parses the shipped config with give + poison + assassinate + spymaster", () => {
    const parsed = parseInteractionsConfig({
      prestigeFloor: 10,
      actions: {
        give: { hostile: false, respectsPrestigeFloor: false, minAmount: 1, maxAmount: 10000 },
        poison: { hostile: true, respectsPrestigeFloor: true, baseChance: 0.5, statScale: 40, clampMin: 0.05, clampMax: 0.95, physicianMod: 15, illnessChance: 0.6 },
        assassinate: { hostile: true, respectsPrestigeFloor: true, costDrachmae: 200, baseChance: 0.45, statScale: 40, clampMin: 0.05, clampMax: 0.95, bodyguardModMax: 24, bodyguardDecay: 0.5 },
      },
      spymaster: { guardMod: 10, huntMod: 10, postureCooldownHours: 24 },
    });
    expect(parsed.actions.poison.illnessChance).toBe(0.6);
    expect(parsed.actions.assassinate.costDrachmae).toBe(200);
    expect(parsed.spymaster).toEqual({ guardMod: 10, huntMod: 10, postureCooldownHours: 24 });
    // deathChance is derived (1 − illnessChance), never stored.
    expect(parsed.actions.poison).not.toHaveProperty("deathChance");
  });
});
