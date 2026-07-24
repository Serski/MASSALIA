import { describe, expect, it } from "vitest";
import {
  applyComposureRecovery,
  clampComposure,
  computeComposureDelta,
  describeComposureDelta,
  isWithdrawn,
  nextUtcDayBoundary,
  recoveryPerDay,
  resolveBreak,
  scoreTraitTags,
  type ComposureConfig,
} from "./composure.js";
import { spouseReactionPhiliaDelta } from "./family.js";
import type { Trait } from "./traits.js";

const config: ComposureConfig = {
  costPerConflict: 15,
  gainPerEmbrace: 8,
  driftCostFactor: 0.5,
  maxGainPerAction: 20,
  baseRecoveryPerDay: 10,
  breakResetValue: 40,
  maxCopingTraits: 3,
  copingPool: ["stoic", "resilient", "philosophical", "hardened"],
};

const honest: Trait = { id: "honest", name: "Honest", description: "x", category: "personality", opposes: ["deceit", "bribery"] };
const zealot: Trait = { id: "zealot", name: "Zealot", description: "x", category: "personality", embraces: ["piety", "war"] };
const both: Trait = { id: "both", name: "Both", description: "x", category: "personality", opposes: ["war"], embraces: ["war"] };
const traditionalist: Trait = { id: "traditionalist", name: "Traditionalist", description: "x", category: "personality" };
const syncretist: Trait = { id: "syncretist", name: "Syncretist", description: "x", category: "personality" };
const stoic: Trait = { id: "stoic", name: "Stoic", description: "x", category: "coping", recoveryBonus: 2 };
const resilient: Trait = { id: "resilient", name: "Resilient", description: "x", category: "coping", recoveryBonus: 1 };

describe("computeComposureDelta — conflict / embrace", () => {
  it("no traits, no tags -> 0", () => {
    expect(computeComposureDelta([], [], 0, config)).toBe(0);
  });
  it("conflict: opposing trait intersects a tag -> -costPerConflict", () => {
    expect(computeComposureDelta([honest], ["bribery"], 0, config)).toBe(-15);
  });
  it("embrace: embracing trait intersects a tag -> +gainPerEmbrace", () => {
    expect(computeComposureDelta([zealot], ["war"], 0, config)).toBe(8);
  });
  it("no intersection -> 0", () => {
    expect(computeComposureDelta([honest], ["valor"], 0, config)).toBe(0);
  });
  it("stacks across multiple traits", () => {
    // honest conflicts (-15), zealot embraces (+8) => -7
    expect(computeComposureDelta([honest, zealot], ["bribery", "war"], 0, config)).toBe(-7);
  });
  it("a single trait both opposing and embracing a tag nets cost+gain", () => {
    expect(computeComposureDelta([both], ["war"], 0, config)).toBe(-15 + 8);
  });
});

describe("computeComposureDelta — ideology drift", () => {
  it("traditionalist penalised for reformist (positive) drift", () => {
    // -ideologyDelta * driftCostFactor = -(10 * 0.5) = -5
    expect(computeComposureDelta([traditionalist], [], 10, config)).toBe(-5);
  });
  it("traditionalist unaffected by traditionalist (negative) drift", () => {
    expect(computeComposureDelta([traditionalist], [], -10, config)).toBe(0);
  });
  it("syncretist penalised for traditionalist (negative) drift", () => {
    expect(computeComposureDelta([syncretist], [], -20, config)).toBe(-10);
  });
  it("syncretist unaffected by reformist (positive) drift", () => {
    expect(computeComposureDelta([syncretist], [], 20, config)).toBe(0);
  });
  it("combines tag conflict with drift cost", () => {
    // honest conflict (-15) + traditionalist drift (-(8*0.5)=-4) = -19
    expect(computeComposureDelta([honest, traditionalist], ["bribery"], 8, config)).toBe(-19);
  });
});

describe("computeComposureDelta — clamp", () => {
  it("clamps the positive total at maxGainPerAction", () => {
    // three embraces => +24, clamped to 20
    expect(computeComposureDelta([zealot, zealot, zealot], ["war"], 0, config)).toBe(20);
  });
  it("does not clamp losses", () => {
    expect(computeComposureDelta([honest, honest], ["bribery"], 0, config)).toBe(-30);
  });
});

describe("computeComposureDelta — spouse personality (family pack)", () => {
  // config has no spouseWeight -> the SPOUSE_WEIGHT_DEFAULT (0.45) applies.
  it("married + conflicting tag: her nature costs, at reduced weight", () => {
    // -costPerConflict * 0.45 = -15 * 0.45 = -6.75 -> round -7
    expect(computeComposureDelta([], ["bribery"], 0, config, [honest])).toBe(-7);
  });

  it("married + embraced tag: her nature gains, at reduced weight", () => {
    // +gainPerEmbrace * 0.45 = 8 * 0.45 = 3.6 -> round 4
    expect(computeComposureDelta([], ["war"], 0, config, [zealot])).toBe(4);
  });

  it("unmarried (empty spouse array) adds nothing — held-only, unchanged", () => {
    expect(computeComposureDelta([honest], ["bribery"], 0, config, [])).toBe(-15);
    // and the 4-arg call still behaves identically (backward compatible)
    expect(computeComposureDelta([honest], ["bribery"], 0, config)).toBe(-15);
  });

  it("spouse traits are excluded from the ideology-drift clause", () => {
    // A held traditionalist pays drift on positive shift (-5); a SPOUSE
    // traditionalist does not — drift models the player's own convictions.
    expect(computeComposureDelta([traditionalist], [], 10, config)).toBe(-5);
    expect(computeComposureDelta([], [], 10, config, [traditionalist])).toBe(0);
  });

  it("the clamp applies to the COMBINED total, not per source", () => {
    // held 2 zealots = +16, spouse 2 zealots = +7.2 -> combined 23.2, clamped to 20.
    // Neither source alone reaches the cap, so this proves the clamp is on the sum.
    expect(computeComposureDelta([zealot, zealot], ["war"], 0, config, [zealot, zealot])).toBe(20);
  });

  it("weight asymmetry: the same conflicting tag costs STRICTLY less via a spouse trait", () => {
    const heldCost = computeComposureDelta([honest], ["bribery"], 0, config); // -15
    const spouseCost = computeComposureDelta([], ["bribery"], 0, config, [honest]); // -7
    expect(spouseCost).toBeGreaterThan(heldCost); // -7 > -15 => strictly less cost
    expect(Math.abs(spouseCost)).toBeLessThan(Math.abs(heldCost));
  });
});

describe("scoreTraitTags — the shared matching source of truth (no divergence)", () => {
  it("reports the per-trait opposed/embraced tags of a choice", () => {
    const r = scoreTraitTags([honest, zealot], ["bribery", "war"]);
    expect(r[0]).toMatchObject({ conflictTags: ["bribery"], embraceTags: [] });
    expect(r[1]).toMatchObject({ conflictTags: [], embraceTags: ["war"] });
  });

  it("composure scoring and philia coupling never disagree on conflict/embrace", () => {
    // For each (trait, tags) pair, whenever scoreTraitTags marks a conflict the
    // composure delta drops AND philia goes negative; an embrace lifts both.
    const cases: { trait: Trait; tags: string[] }[] = [
      { trait: honest, tags: ["bribery"] }, // conflict
      { trait: zealot, tags: ["war"] }, // embrace
      { trait: honest, tags: ["valor"] }, // neither
    ];
    for (const { trait, tags } of cases) {
      const [reaction] = scoreTraitTags([trait], tags);
      const conflicted = reaction!.conflictTags.length > 0;
      const embraced = reaction!.embraceTags.length > 0;
      // composure as a HELD trait
      const composure = computeComposureDelta([trait], tags, 0, config);
      // philia as a SPOUSE trait
      const philia = spouseReactionPhiliaDelta([trait], tags);
      expect(composure < 0).toBe(conflicted);
      expect(philia < 0).toBe(conflicted);
      expect(composure > 0).toBe(embraced);
      expect(philia > 0).toBe(embraced);
    }
  });
});

describe("describeComposureDelta — spouse attribution", () => {
  it("names her separately for a conflict", () => {
    const { delta, reason } = describeComposureDelta([], ["bribery"], 0, config, [honest]);
    expect(delta).toBe(-7);
    expect(reason).toContain("troubles your wife's Honest nature");
  });

  it("names her separately for an embrace (verb: 'suits', mirroring held traits)", () => {
    const { reason } = describeComposureDelta([], ["war"], 0, config, [zealot]);
    expect(reason).toContain("suits your wife's Zealot nature");
  });

  it("distinguishes the player's own nature from his wife's in one reason", () => {
    // honest is HELD (troubles you), zealot is the WIFE (suits her).
    const { reason } = describeComposureDelta([honest], ["bribery", "war"], 0, config, [zealot]);
    expect(reason).toContain("troubles your Honest nature");
    expect(reason).toContain("suits your wife's Zealot nature");
    expect(reason).not.toContain("suits your wife's Honest");
  });

  it("no wife line when she does not move the number", () => {
    const { reason } = describeComposureDelta([honest], ["bribery"], 0, config, [zealot]);
    expect(reason).not.toContain("wife");
  });
});

describe("recoveryPerDay", () => {
  it("base with no coping traits", () => {
    expect(recoveryPerDay([honest], config)).toBe(10);
  });
  it("adds coping traits' recoveryBonus", () => {
    expect(recoveryPerDay([stoic, resilient], config)).toBe(10 + 2 + 1);
  });
});

describe("applyComposureRecovery — lazy accrual", () => {
  const t0 = new Date("2026-06-01T00:00:00Z");
  it("null lastUpdate just stamps now, no change", () => {
    const r = applyComposureRecovery(50, null, t0, 10);
    expect(r).toEqual({ composure: 50, lastUpdate: t0 });
  });
  it("recovers across whole days", () => {
    const r = applyComposureRecovery(40, t0, new Date("2026-06-03T00:00:00Z"), 10);
    expect(r.composure).toBe(60); // +2 days * 10
  });
  it("caps at 100", () => {
    const r = applyComposureRecovery(80, t0, new Date("2026-06-10T00:00:00Z"), 10);
    expect(r.composure).toBe(100);
  });
  it("does not advance lastUpdate when less than a full point accrued", () => {
    const soon = new Date(t0.getTime() + 3600_000); // 1 hour -> 10/24 ≈ 0.41 pts
    const r = applyComposureRecovery(40, t0, soon, 10);
    expect(r.composure).toBe(40);
    expect(r.lastUpdate).toEqual(t0); // preserved so accrual continues
  });
  it("accrues correctly across multiple partial reads totalling a day", () => {
    // half a day twice = +10
    let comp = 40;
    let last: Date = t0;
    const mid = new Date(t0.getTime() + 12 * 3600_000);
    const end = new Date(t0.getTime() + 24 * 3600_000);
    let r = applyComposureRecovery(comp, last, mid, 10);
    comp = r.composure; last = r.lastUpdate; // 45, mid
    r = applyComposureRecovery(comp, last, end, 10);
    expect(r.composure).toBe(50);
  });
});

describe("resolveBreak", () => {
  const now = new Date("2026-06-08T15:00:00Z");
  it("grants a coping trait the character lacks and resets composure", () => {
    const out = resolveBreak({ now, breaksCount: 0, heldCopingIds: [], config, pick: (c) => c[0]! });
    expect(out.grantedTrait).toBe("stoic");
    expect(out.composure).toBe(40);
    expect(out.breaksCount).toBe(1);
    expect(out.breakUntil).toEqual(new Date("2026-06-09T00:00:00Z"));
  });
  it("never grants a coping trait already held", () => {
    const out = resolveBreak({ now, breaksCount: 1, heldCopingIds: ["stoic"], config, pick: (c) => c[0]! });
    expect(out.grantedTrait).toBe("resilient");
  });
  it("at the cap, the break only costs the locked day (no trait)", () => {
    const out = resolveBreak({ now, breaksCount: 2, heldCopingIds: ["stoic", "resilient", "philosophical"], config });
    expect(out.grantedTrait).toBeNull();
    expect(out.composure).toBe(40);
    expect(out.breakUntil).toEqual(new Date("2026-06-09T00:00:00Z"));
  });
});

describe("isWithdrawn / boundaries / clamp", () => {
  it("withdrawn while breakUntil is in the future", () => {
    const now = new Date("2026-06-08T15:00:00Z");
    expect(isWithdrawn(new Date("2026-06-09T00:00:00Z"), now)).toBe(true);
    expect(isWithdrawn(new Date("2026-06-08T00:00:00Z"), now)).toBe(false);
    expect(isWithdrawn(null, now)).toBe(false);
  });
  it("nextUtcDayBoundary is the following UTC midnight", () => {
    expect(nextUtcDayBoundary(new Date("2026-06-08T23:59:00Z"))).toEqual(new Date("2026-06-09T00:00:00Z"));
  });
  it("clampComposure keeps 0..100", () => {
    expect(clampComposure(-5)).toBe(0);
    expect(clampComposure(140)).toBe(100);
    expect(clampComposure(72.6)).toBe(73);
  });
});
