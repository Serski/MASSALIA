import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  adoptionWomenOnly,
  canMarry,
  childAge,
  childRoll,
  defaultChildName,
  generateCandidates,
  isFamilyLocked,
  isOfAge,
  marriagePenalty,
  parseFamilyConfig,
  type FamilyConfig,
} from "./index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const cfg: FamilyConfig = parseFamilyConfig(JSON.parse(readFileSync(resolve(root, "content/family/family-config.json"), "utf8")));

const HOUSES = [
  { slug: "leonidas", ideology: -80 },
  { slug: "kleitos", ideology: 60 },
  { slug: "xanthippos", ideology: 0 },
];

// A deterministic rng cycling through fixed values.
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

describe("generateCandidates", () => {
  it("rolls stats inside cfg.candidates.statRanges", () => {
    const cands = generateCandidates(Math.random, "marriage", 200, cfg, HOUSES);
    const r = cfg.candidates.statRanges;
    for (const c of cands) {
      expect(c.prestige).toBeGreaterThanOrEqual(r.prestige[0]);
      expect(c.prestige).toBeLessThanOrEqual(r.prestige[1]);
      expect(c.devotion).toBeGreaterThanOrEqual(r.devotion[0]);
      expect(c.devotion).toBeLessThanOrEqual(r.devotion[1]);
      expect(c.militia).toBeGreaterThanOrEqual(r.militia[0]);
      expect(c.militia).toBeLessThanOrEqual(r.militia[1]);
      expect(c.intelligence).toBeGreaterThanOrEqual(r.intelligence[0]);
      expect(c.intelligence).toBeLessThanOrEqual(r.intelligence[1]);
    }
  });

  it("marriage candidates are female within the 18-30 age band, with house ideology", () => {
    const cands = generateCandidates(Math.random, "marriage", 100, cfg, HOUSES);
    for (const c of cands) {
      expect(c.sex).toBe("female");
      expect(c.age).toBeGreaterThanOrEqual(18);
      expect(c.age).toBeLessThanOrEqual(30);
      expect(c.purpose).toBe("marriage");
      expect(c.ideology).toBe(HOUSES.find((h) => h.slug === c.houseSlug)!.ideology);
    }
  });

  it("adoption candidates use the adopted age range and may be either sex", () => {
    const cands = generateCandidates(Math.random, "adoption", 200, cfg, HOUSES);
    const [lo, hi] = cfg.succession.adoptedStartAgeRange;
    for (const c of cands) {
      expect(c.age).toBeGreaterThanOrEqual(lo);
      expect(c.age).toBeLessThanOrEqual(hi);
    }
    expect(cands.some((c) => c.sex === "male")).toBe(true);
    expect(cands.some((c) => c.sex === "female")).toBe(true);
  });

  it("women-only forces every adoption candidate female (the hetaira rule)", () => {
    const cands = generateCandidates(Math.random, "adoption", 100, cfg, HOUSES, true);
    expect(cands.every((c) => c.sex === "female")).toBe(true);
  });

  it("respects traitChance (none when the roll is always above the chance)", () => {
    // rng = 0.99 for the trait roll -> never below traitChance (0.45) -> no trait.
    const cands = generateCandidates(() => 0.99, "marriage", 20, cfg, HOUSES);
    expect(cands.every((c) => c.traitId === null)).toBe(true);
  });

  it("assigns a trait from the pool when the roll is below traitChance", () => {
    // rng = 0 -> trait roll passes; picks pool[0]; house[0]; min ages/stats.
    const cands = generateCandidates(seqRng([0]), "marriage", 5, cfg, HOUSES);
    for (const c of cands) {
      expect(c.traitId).not.toBeNull();
      expect(cfg.candidates.traitPool).toContain(c.traitId);
    }
  });
});

describe("marriagePenalty", () => {
  const threshold = cfg.marriage.crossIdeologyPenalty.threshold; // 30
  const shift = cfg.marriage.crossIdeologyPenalty.ideologyShift; // 4
  const favor = cfg.marriage.crossIdeologyPenalty.partyFavorLoss; // 2

  it("is zero below the threshold", () => {
    expect(marriagePenalty(0, threshold - 1, cfg)).toEqual({ ideologyShift: 0, partyFavorLoss: 0 });
    expect(marriagePenalty(10, 10 - (threshold - 1), cfg)).toEqual({ ideologyShift: 0, partyFavorLoss: 0 });
  });

  it("applies exactly at the threshold (>=)", () => {
    // candidate more reformist by exactly the threshold -> shift +toward reformist.
    expect(marriagePenalty(0, threshold, cfg)).toEqual({ ideologyShift: shift, partyFavorLoss: favor });
  });

  it("pulls the character toward the candidate's side (sign follows the gap)", () => {
    expect(marriagePenalty(-50, 60, cfg).ideologyShift).toBe(shift); // candidate reformist -> +
    expect(marriagePenalty(50, -60, cfg).ideologyShift).toBe(-shift); // candidate traditionalist -> -
  });
});

describe("class rules", () => {
  it("slave is fully family-locked; cannot marry", () => {
    expect(isFamilyLocked("slave", cfg)).toBe(true);
    expect(canMarry("slave", cfg)).toBe(false);
  });
  it("hetaira cannot marry but uses women-only adoption", () => {
    expect(canMarry("hetaira", cfg)).toBe(false);
    expect(adoptionWomenOnly("hetaira", cfg)).toBe(true);
  });
  it("citizen classes may marry", () => {
    for (const c of cfg.marriage.eligibleClasses) expect(canMarry(c, cfg)).toBe(true);
    expect(adoptionWomenOnly("trader", cfg)).toBe(false);
    expect(isFamilyLocked("trader", cfg)).toBe(false);
  });
});

const YEAR = 4 * 86_400_000; // 4 real days = 1 game year

describe("childAge", () => {
  it("ages one game year per 4 real days, floored", () => {
    expect(childAge(0, 0, YEAR)).toBe(0);
    expect(childAge(0, YEAR - 1, YEAR)).toBe(0);
    expect(childAge(0, YEAR, YEAR)).toBe(1);
    expect(childAge(0, 15 * YEAR, YEAR)).toBe(15);
    expect(childAge(5 * YEAR, 20 * YEAR, YEAR)).toBe(15);
  });
  it("coming of age flips at exactly 15", () => {
    expect(isOfAge(14, cfg)).toBe(false);
    expect(isOfAge(15, cfg)).toBe(true);
    expect(isOfAge(childAge(0, 15 * YEAR, YEAR), cfg)).toBe(true);
    expect(isOfAge(childAge(0, 15 * YEAR - 1, YEAR), cfg)).toBe(false);
  });
});

describe("childRoll", () => {
  // rng sequence: [chance, sex, deathRisk]
  const seq = (vals: number[]) => {
    let i = 0;
    return () => vals[i++]!;
  };
  const married = { active: true };

  it("no child when not married or at the max", () => {
    expect(childRoll(() => 0, { active: false }, 0, null, cfg).born).toBe(false);
    expect(childRoll(() => 0, married, cfg.children.maxChildren, null, cfg).born).toBe(false);
  });

  it("births when the chance roll passes; sex follows sexRatioBoys", () => {
    // chance 0 (< yearlyChildChance), sex 0 (< sexRatioBoys -> boy), death 0.99 (survives)
    const boy = childRoll(seq([0, 0, 0.99]), married, 0, null, cfg);
    expect(boy).toEqual({ born: true, sex: "male", motherDied: false });
    // sex roll 0.99 (>= 0.5) -> girl
    const girl = childRoll(seq([0, 0.99, 0.99]), married, 0, null, cfg);
    expect(girl.born && girl.sex).toBe("female");
  });

  it("no birth when the chance roll is above the chance", () => {
    // base yearlyChildChance 0.4; roll 0.5 -> no child
    expect(childRoll(seq([0.5]), married, 0, null, cfg).born).toBe(false);
  });

  it("3rd+ child uses the lower chance", () => {
    // count 2 -> thirdPlusChildChance 0.15. roll 0.2 -> no child (would have been a child at 0.4).
    expect(childRoll(seq([0.2]), married, 2, null, cfg).born).toBe(false);
    // roll 0.14 (< 0.15) -> child.
    expect(childRoll(seq([0.14, 0, 0.99]), married, 2, null, cfg).born).toBe(true);
  });

  it("Fertile raises the chance (+0.15) and lowers death risk", () => {
    const fertile = { childChanceBonus: 0.15, birthDeathRiskMod: -0.04 };
    // count 0 -> 0.4 + 0.15 = 0.55; roll 0.5 would NOT birth without fertile but DOES with it.
    expect(childRoll(seq([0.5, 0, 0.99]), married, 0, fertile, cfg).born).toBe(true);
    // death risk = 0.07 - 0.04 = 0.03; roll 0.05 -> survives.
    const r = childRoll(seq([0, 0, 0.05]), married, 0, fertile, cfg);
    expect(r.born && r.motherDied).toBe(false);
  });

  it("Frail lowers the chance (-0.05) and raises death risk", () => {
    const frail = { childChanceBonus: -0.05, birthDeathRiskMod: 0.05 };
    // count 0 -> 0.4 - 0.05 = 0.35; roll 0.37 -> no child.
    expect(childRoll(seq([0.37]), married, 0, frail, cfg).born).toBe(false);
    // death risk = 0.07 + 0.05 = 0.12; roll 0.1 -> mother dies (child survives).
    const r = childRoll(seq([0, 0, 0.1]), married, 0, frail, cfg);
    expect(r).toEqual({ born: true, sex: "male", motherDied: true });
  });

  it("birth-death: mother dies but the roll still reports a surviving child", () => {
    const r = childRoll(seq([0, 0, 0.0]), married, 0, null, cfg); // death roll 0 < risk -> dies
    expect(r.born).toBe(true);
    expect(r.born && r.motherDied).toBe(true);
  });
});

describe("defaultChildName", () => {
  it("returns a Greek name for the child's sex", () => {
    expect(typeof defaultChildName("male", () => 0)).toBe("string");
    expect(defaultChildName("female", () => 0).length).toBeGreaterThan(0);
  });
});
