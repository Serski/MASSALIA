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
  highestStatKey,
  inheritance,
  isFamilyLocked,
  isFertile,
  isOfAge,
  isSpouseDeceased,
  marriagePenalty,
  parseFamilyConfig,
  rollSpouseDeathAge,
  spouseCurrentAge,
  successionPlan,
  type ChildInfo,
  type FamilyConfig,
} from "./index.js";

// One game year = 4 real days (the season clock); used for the lazy spouse-age math.
const GAME_YEAR_MS = 4 * 86_400_000;

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

const child = (id: string, age: number, name = id): ChildInfo => ({ id, age, sex: "male", name });

describe("successionPlan — the ladder", () => {
  it("a. eldest of-age living child -> blood", () => {
    const plan = successionPlan({ classId: "trader" }, [child("a", 17), child("b", 16), child("c", 9)], false, cfg);
    expect(plan.kind).toBe("blood");
    expect(plan.heirChildId).toBe("a"); // eldest of-age
  });
  it("b. no of-age child but an adopted heir -> adopted", () => {
    expect(successionPlan({ classId: "trader" }, [child("c", 9)], true, cfg).kind).toBe("adopted");
  });
  it("c. only a minor child, no adopted heir -> regency for the eldest minor", () => {
    const plan = successionPlan({ classId: "trader" }, [child("c", 9), child("d", 12)], false, cfg);
    expect(plan.kind).toBe("regency");
    expect(plan.regentForChildId).toBe("d");
  });
  it("d. no heirs: slave -> fresh; citizen/hetaira -> forced_adoption", () => {
    expect(successionPlan({ classId: "slave" }, [], false, cfg).kind).toBe("fresh");
    expect(successionPlan({ classId: "trader" }, [], false, cfg).kind).toBe("forced_adoption");
    expect(successionPlan({ classId: "hetaira" }, [], false, cfg).kind).toBe("forced_adoption");
  });
  it("blood outranks adopted, adopted outranks regency", () => {
    expect(successionPlan({ classId: "trader" }, [child("a", 16), child("c", 9)], true, cfg).kind).toBe("blood");
    expect(successionPlan({ classId: "trader" }, [child("c", 9)], true, cfg).kind).toBe("adopted");
  });
});

describe("inheritance — carryover, always-inherited, bloodline nudge", () => {
  const dead = { prestige: 80, devotion: 40, militia: 60, intelligence: 30 };

  it("prestige carries over at 50/35/30 per kind, floored", () => {
    // blood: floor(80*.50)=40, +1 bloodline nudge (prestige is the dead's highest) = 41.
    expect(inheritance(dead, "blood", cfg, { rng: () => 0 }).prestige).toBe(41);
    expect(inheritance(dead, "adopted", cfg, { candidate: dead }).prestige).toBe(28); // floor(80*.35), no nudge
    expect(inheritance(dead, "regent", cfg, { candidate: dead }).prestige).toBe(24); // floor(80*.30), no nudge
  });

  it("always-inherited set comes from config", () => {
    expect(inheritance(dead, "blood", cfg, { rng: () => 0 }).alwaysInherited).toEqual(cfg.succession.alwaysInherited);
    expect(inheritance(dead, "blood", cfg, { rng: () => 0 }).alwaysInherited).toContain("oligarchSeat");
  });

  it("blood: rolls the other three in range + a +1 nudge to the dead's highest stat", () => {
    // rng=0 -> each rolled stat = its range minimum. Dead's highest is prestige -> nudge prestige.
    const h = inheritance(dead, "blood", cfg, { rng: () => 0 });
    const r = cfg.candidates.statRanges;
    expect(h.devotion).toBe(r.devotion[0]);
    expect(h.militia).toBe(r.militia[0]);
    expect(h.intelligence).toBe(r.intelligence[0]);
    expect(h.prestige).toBe(40 + 1); // carryover 40 + bloodline nudge (prestige is highest)
  });

  it("blood nudge lands on a rolled stat when that is the dead's highest", () => {
    const bodyDead = { prestige: 10, devotion: 5, militia: 70, intelligence: 5 };
    const h = inheritance(bodyDead, "blood", cfg, { rng: () => 0 });
    expect(highestStatKey(bodyDead)).toBe("militia");
    expect(h.militia).toBe(cfg.candidates.statRanges.militia[0] + 1); // nudge on militia
  });

  it("adopted/regent keep the candidate's own rolled stats", () => {
    const cand = { prestige: 3, devotion: 2, militia: 4, intelligence: 5 };
    const a = inheritance(dead, "adopted", cfg, { candidate: cand });
    expect({ d: a.devotion, m: a.militia, i: a.intelligence }).toEqual({ d: 2, m: 4, i: 5 });
    expect(a.prestige).toBe(28); // still carryover, not the candidate's
  });
});

// --- Wife lifespan & fertility window --------------------------------------

describe("config: spouse block", () => {
  it("parses spouse.deathAge and spouse.fertilityWindow from the shipped config", () => {
    expect(cfg.spouse.deathAge).toEqual({ min: 60, max: 70 });
    expect(cfg.spouse.fertilityWindow).toEqual({ from: 18, to: 35 });
  });
});

describe("spouseCurrentAge", () => {
  it("is the rolled age before any game year elapses", () => {
    expect(spouseCurrentAge(22, 0, 0, GAME_YEAR_MS)).toBe(22);
    // Just under one game year — still the rolled age (floors).
    expect(spouseCurrentAge(22, 0, GAME_YEAR_MS - 1, GAME_YEAR_MS)).toBe(22);
  });

  it("adds one year exactly at each game-year boundary", () => {
    expect(spouseCurrentAge(22, 0, GAME_YEAR_MS, GAME_YEAR_MS)).toBe(23);
    expect(spouseCurrentAge(22, 0, 2 * GAME_YEAR_MS, GAME_YEAR_MS)).toBe(24);
    expect(spouseCurrentAge(22, 0, 13 * GAME_YEAR_MS + 5, GAME_YEAR_MS)).toBe(35);
  });

  it("never goes below the rolled age for a now before generation", () => {
    expect(spouseCurrentAge(30, GAME_YEAR_MS, 0, GAME_YEAR_MS)).toBe(30);
  });

  it("defaults to the real 4-day game year when no interval is passed", () => {
    expect(spouseCurrentAge(40, 0, GAME_YEAR_MS)).toBe(41); // 1 game year elapsed
  });
});

describe("isSpouseDeceased", () => {
  it("death fires exactly at the rolled death age, not a year early", () => {
    expect(isSpouseDeceased(64, 65)).toBe(false);
    expect(isSpouseDeceased(65, 65)).toBe(true); // exactly at
    expect(isSpouseDeceased(66, 65)).toBe(true);
  });
});

describe("isFertile (window 18–35 inclusive)", () => {
  it("blocks just below the window and opens exactly at the lower bound", () => {
    expect(isFertile(17, cfg)).toBe(false);
    expect(isFertile(18, cfg)).toBe(true); // boundary 17/18
  });

  it("stays fertile through the upper bound and closes just past it", () => {
    expect(isFertile(35, cfg)).toBe(true); // boundary 35/36
    expect(isFertile(36, cfg)).toBe(false);
  });

  it("is fertile across the interior of the window", () => {
    for (let age = 18; age <= 35; age++) expect(isFertile(age, cfg)).toBe(true);
  });
});

describe("childRoll is unchanged inside the window", () => {
  // The fertility GATE lives in the DB roll (rollChildrenDue); the pure childRoll
  // itself is unaffected — a guaranteed-chance roll still produces a birth.
  it("still bears a child when chance passes (gate is applied upstream)", () => {
    const rng = seqRng([0, 0.99, 0.99]); // born; boy; mother survives
    const outcome = childRoll(rng, { active: true }, 0, null, cfg);
    expect(outcome.born).toBe(true);
  });
});

describe("rollSpouseDeathAge", () => {
  it("always lands within [deathAge.min, deathAge.max] (backfill band)", () => {
    for (let i = 0; i < 500; i++) {
      const age = rollSpouseDeathAge(cfg, Math.random);
      expect(age).toBeGreaterThanOrEqual(cfg.spouse.deathAge.min);
      expect(age).toBeLessThanOrEqual(cfg.spouse.deathAge.max);
    }
  });

  it("covers both ends of the band (uniform, inclusive)", () => {
    expect(rollSpouseDeathAge(cfg, () => 0)).toBe(60); // min
    expect(rollSpouseDeathAge(cfg, () => 0.9999)).toBe(70); // max
  });
});
