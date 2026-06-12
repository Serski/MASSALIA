import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyStatGrowth } from "./events.js";
import {
  applyClassMods,
  ladderProgress,
  nextLadderThreshold,
  parseRoutineFile,
  parseRoutinesConfig,
  roundHalfUp,
  routinesForClass,
  type LadderDef,
  type RoutineCard,
  type RoutinesConfig,
} from "./routines.js";

const config: RoutinesConfig = {
  dailyPicks: 1,
  repeatPenalty: 0.5,
  poolByClass: {
    landowner: "citizen",
    trader: "citizen",
    philosopher: "citizen",
    hoplite: "citizen",
    shipbuilder: "citizen",
    priest: "citizen",
    hetaira: "hetaira",
    slave: "slave",
  },
  ladders: {
    rhetoric: { stat: "prestige", tiers: [{ xp: 8, trait: "rhetoric-1" }, { xp: 20, trait: "rhetoric-2" }, { xp: 40, trait: "rhetoric-3" }] },
    gymnasium: { stat: "militia", tiers: [{ xp: 8, trait: "gymnasium-1" }, { xp: 20, trait: "gymnasium-2" }, { xp: 40, trait: "gymnasium-3" }] },
  },
};

const gymnasium: RoutineCard = {
  id: "routine-gymnasium",
  pool: "citizen",
  label: "Train at the gymnasium",
  scene: "...",
  tags: ["labor"],
  effects: [{ type: "change_stat", stat: "militia", amount: 1 }],
  feedsLadder: "gymnasium",
  ladderXp: 2,
  classMods: { hoplite: { amountMult: 1.5, xpMult: 1.5, composure: 2 }, philosopher: { composure: -2 } },
};

const holdings: RoutineCard = {
  id: "routine-holdings",
  pool: "citizen",
  label: "Oversee your holdings",
  scene: "...",
  tags: ["labor"],
  effects: [{ type: "change_drachmae", amount: 10 }],
  classMods: {
    trader: { amountMult: 1.5 },
    landowner: { amountMult: 1.3, extra: [{ type: "change_stat", stat: "prestige", amount: 1 }] },
    shipbuilder: { amountMult: 1.2, extra: [{ type: "change_stat", stat: "intelligence", amount: 1 }] },
  },
};

describe("applyClassMods", () => {
  it("boosts an aligned class (hoplite gymnasium): +1 -> +2 stat, xp 2 -> 3, +2 composure bonus", () => {
    const r = applyClassMods(gymnasium, "hoplite", config);
    expect(r.effects).toEqual([{ type: "change_stat", stat: "militia", amount: 2 }]); // round(1*1.5)=2
    expect(r.ladderXp).toBe(3); // round(2*1.5)=3
    expect(r.composureBonus).toBe(2);
  });

  it("gives an off-fit class a flat composure cost but no stat change (philosopher gymnasium)", () => {
    const r = applyClassMods(gymnasium, "philosopher", config);
    expect(r.effects).toEqual([{ type: "change_stat", stat: "militia", amount: 1 }]); // amountMult default 1
    expect(r.ladderXp).toBe(2);
    expect(r.composureBonus).toBe(-2);
  });

  it("leaves a neutral class unchanged (landowner gymnasium — not named)", () => {
    const r = applyClassMods(gymnasium, "landowner", config);
    expect(r.effects).toEqual([{ type: "change_stat", stat: "militia", amount: 1 }]);
    expect(r.ladderXp).toBe(2);
    expect(r.composureBonus).toBe(0);
  });

  it("differentiates the holdings card across classes", () => {
    expect(applyClassMods(holdings, "trader", config).effects).toEqual([
      { type: "change_drachmae", amount: 15 }, // round(10*1.5)
    ]);
    expect(applyClassMods(holdings, "landowner", config).effects).toEqual([
      { type: "change_drachmae", amount: 13 }, // round(10*1.3)
      { type: "change_stat", stat: "prestige", amount: 1 }, // extra appended
    ]);
    expect(applyClassMods(holdings, "shipbuilder", config).effects).toEqual([
      { type: "change_drachmae", amount: 12 }, // round(10*1.2)
      { type: "change_stat", stat: "intelligence", amount: 1 },
    ]);
    // A class not named in classMods uses the base card unchanged.
    expect(applyClassMods(holdings, "priest", config).effects).toEqual([{ type: "change_drachmae", amount: 10 }]);
  });

  it("growthMultiplier still applies to positive stat gains AFTER classMods", () => {
    // hoplite gymnasium: +1 -> classMods 1.5 -> +2, then growthMultiplier applies.
    const scaled = applyClassMods(gymnasium, "hoplite", config).effects[0]!;
    expect(scaled).toEqual({ type: "change_stat", stat: "militia", amount: 2 });
    expect(applyStatGrowth(scaled.amount, 1.0)).toBe(2); // neutral growth
    expect(applyStatGrowth(scaled.amount, 1.5)).toBe(3); // round(2 * 1.5)
  });

  it("rounds scaled amounts half up", () => {
    const card: RoutineCard = { id: "x", pool: "citizen", label: "x", scene: "x", tags: [], effects: [{ type: "change_drachmae", amount: 3 }], classMods: { trader: { amountMult: 1.5 } } };
    expect(applyClassMods(card, "trader", config).effects).toEqual([{ type: "change_drachmae", amount: 5 }]); // round(4.5)=5
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(-7.5)).toBe(-7);
  });
});

describe("ladderProgress", () => {
  const ladder: LadderDef = config.ladders.rhetoric!;

  it("grants nothing below the first threshold", () => {
    const r = ladderProgress(0, 2, ladder);
    expect(r.newXp).toBe(2);
    expect(r.traitToGrant).toBeUndefined();
    expect(r.traitToRemove).toBeUndefined();
  });

  it("grants tier 1 when crossing the first threshold (8)", () => {
    const r = ladderProgress(6, 2, ladder); // -> 8
    expect(r.newXp).toBe(8);
    expect(r.traitToGrant).toBe("rhetoric-1");
    expect(r.traitToRemove).toBeUndefined();
  });

  it("grants tier 2 and removes tier 1 when crossing the second threshold (20)", () => {
    const r = ladderProgress(19, 2, ladder); // -> 21
    expect(r.newXp).toBe(21);
    expect(r.traitToGrant).toBe("rhetoric-2");
    expect(r.traitToRemove).toBe("rhetoric-1");
  });

  it("grants tier 3 and removes tier 2 when crossing the third threshold (40)", () => {
    const r = ladderProgress(39, 2, ladder); // -> 41
    expect(r.traitToGrant).toBe("rhetoric-3");
    expect(r.traitToRemove).toBe("rhetoric-2");
  });

  it("skips a tier in one jump: grants the highest reached, removes the previously held", () => {
    const r = ladderProgress(8, 35, ladder); // 8 (tier1) -> 43 (tier3)
    expect(r.traitToGrant).toBe("rhetoric-3");
    expect(r.traitToRemove).toBe("rhetoric-1");
  });

  it("no grant when staying within the same tier", () => {
    const r = ladderProgress(8, 2, ladder); // 8 -> 10, still tier 1
    expect(r.traitToGrant).toBeUndefined();
    expect(r.traitToRemove).toBeUndefined();
  });

  it("reports the next threshold (null at the top)", () => {
    expect(nextLadderThreshold(0, ladder)).toBe(8);
    expect(nextLadderThreshold(8, ladder)).toBe(20);
    expect(nextLadderThreshold(40, ladder)).toBeNull();
  });
});

describe("pool routing + content parsing", () => {
  it("routes classes to their pool", () => {
    const cards: RoutineCard[] = [
      { id: "c1", pool: "citizen", label: "c1", scene: "", tags: [], effects: [] },
      { id: "h1", pool: "hetaira", label: "h1", scene: "", tags: [], effects: [] },
      { id: "s1", pool: "slave", label: "s1", scene: "", tags: [], effects: [] },
    ];
    expect(routinesForClass(cards, "hoplite", config).map((c) => c.id)).toEqual(["c1"]);
    expect(routinesForClass(cards, "hetaira", config).map((c) => c.id)).toEqual(["h1"]);
    expect(routinesForClass(cards, "slave", config).map((c) => c.id)).toEqual(["s1"]);
  });

  it("parses the shipped content files (18 routines; pools 10/6/1 + 1 campaign)", () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    const routinesJson = JSON.parse(readFileSync(resolve(root, "content/routines/routines.json"), "utf8"));
    const configJson = JSON.parse(readFileSync(resolve(root, "content/routines/routines-config.json"), "utf8"));
    const cards = parseRoutineFile(routinesJson);
    const cfg = parseRoutinesConfig(configJson);
    // 17 class-pool routines + the off-pool "campaign" card (Politics Prompt 2).
    expect(cards).toHaveLength(18);
    expect(routinesForClass(cards, "trader", cfg)).toHaveLength(10);
    expect(routinesForClass(cards, "hetaira", cfg)).toHaveLength(6);
    expect(routinesForClass(cards, "slave", cfg)).toHaveLength(1);
    // The campaign card belongs to no class pool — it is gated on candidacy.
    expect(cards.filter((c) => c.pool === "campaign")).toHaveLength(1);
  });
});
