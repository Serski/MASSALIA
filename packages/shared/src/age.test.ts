import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyDecay,
  avatarById,
  capStat,
  currentAge,
  decayBandFor,
  isDeceased,
  lifeStage,
  parseAgeConfig,
  portraitFor,
  rollDeathAge,
  stageFor,
  startAgeForAvatar,
  startBonusForAge,
  type AgeConfig,
  type CharacterStats,
} from "./index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const cfg: AgeConfig = parseAgeConfig(
  JSON.parse(readFileSync(resolve(root, "content/age/age-config.json"), "utf8")),
);

const YEAR = cfg.realMsPerGameYear; // 4 real days
const stats = (p: number, d: number, m: number, i: number): CharacterStats => ({ prestige: p, devotion: d, militia: m, intelligence: i });

describe("currentAge", () => {
  it("starts at startAge and rises one year every realMsPerGameYear", () => {
    expect(currentAge(30, 0, 0, cfg)).toBe(30);
    expect(currentAge(30, 0, YEAR - 1, cfg)).toBe(30); // just before the boundary
    expect(currentAge(30, 0, YEAR, cfg)).toBe(31); // exactly one game year (4 real days)
    expect(currentAge(20, 0, 10 * YEAR, cfg)).toBe(30);
    expect(currentAge(20, 5 * YEAR, 9 * YEAR, cfg)).toBe(24); // 4 years elapsed
  });
  it("never goes below startAge for clock skew", () => {
    expect(currentAge(20, 10 * YEAR, 0, cfg)).toBe(20);
  });
});

describe("lifeStage boundaries (40 / 55 / 65)", () => {
  it("picks the right stage at each edge", () => {
    expect(lifeStage(39, cfg)).toBe("Prime");
    expect(lifeStage(40, cfg)).toBe("Middle Age");
    expect(lifeStage(54, cfg)).toBe("Middle Age");
    expect(lifeStage(55, cfg)).toBe("Old");
    expect(lifeStage(64, cfg)).toBe("Old");
    expect(lifeStage(65, cfg)).toBe("Venerable");
  });
});

describe("decayBandFor boundaries", () => {
  it("Prime has no decay; bands kick in at 40 / 55 / 65", () => {
    expect(decayBandFor(39, cfg)).toEqual({});
    expect(decayBandFor(40, cfg)).toEqual({ militia: 2 });
    expect(decayBandFor(54, cfg)).toEqual({ militia: 2 });
    expect(decayBandFor(55, cfg)).toEqual({ militia: 4, intelligence: 2, devotion: 2 });
    expect(decayBandFor(64, cfg)).toEqual({ militia: 4, intelligence: 2, devotion: 2 });
    expect(decayBandFor(65, cfg)).toEqual({ militia: 6, intelligence: 4, devotion: 4 });
  });
  it("PRESTIGE appears in no band", () => {
    for (const band of cfg.decayBands) expect(band.perYear.prestige).toBeUndefined();
  });
});

describe("applyDecay", () => {
  it("Prime decays nothing", () => {
    expect(applyDecay(stats(50, 50, 50, 50), 30, 5, cfg)).toEqual(stats(50, 50, 50, 50));
  });
  it("subtracts perYear * elapsed years per stat (Middle Age: militia only)", () => {
    expect(applyDecay(stats(80, 80, 80, 80), 40, 3, cfg)).toEqual(stats(80, 80, 80 - 6, 80)); // militia -2*3
  });
  it("scales with fractional elapsed years", () => {
    expect(applyDecay(stats(80, 80, 80, 80), 55, 0.5, cfg)).toEqual(stats(80, 80 - 1, 80 - 2, 80 - 1)); // militia -2, int/dev -1
  });
  it("clamps at the floor (never below 0)", () => {
    expect(applyDecay(stats(10, 1, 1, 1), 65, 5, cfg)).toEqual(stats(10, 0, 0, 0)); // huge decay -> floor
  });
  it("PRESTIGE never decays at any age", () => {
    for (const age of [30, 40, 55, 65, 80]) {
      expect(applyDecay(stats(100, 100, 100, 100), age, 10, cfg).prestige).toBe(100);
    }
  });
  it("a Venerable character at all-100 loses militia fastest while prestige holds", () => {
    const d = applyDecay(stats(100, 100, 100, 100), 65, 1, cfg);
    expect(d).toEqual(stats(100, 96, 94, 96)); // prestige 100, dev 96, militia 94, int 96
    expect(100 - d.militia).toBeGreaterThan(100 - d.intelligence); // militia drop > intelligence drop
    expect(100 - d.militia).toBeGreaterThan(100 - d.devotion);
    expect(d.prestige).toBe(100);
  });
});

describe("capStat", () => {
  it("clamps to [0, 100]", () => {
    expect(capStat(150, cfg)).toBe(100);
    expect(capStat(-5, cfg)).toBe(0);
    expect(capStat(73, cfg)).toBe(73);
  });
  it("creation start bonus applied then capped (30 head-start cannot exceed 100)", () => {
    const bonus = startBonusForAge(30, cfg);
    expect(bonus).toEqual({ prestige: 3, intelligence: 2 });
    const base = stats(99, 0, 0, 99);
    const boosted = stats(
      capStat(base.prestige + (bonus.prestige ?? 0), cfg),
      capStat(base.devotion + (bonus.devotion ?? 0), cfg),
      capStat(base.militia + (bonus.militia ?? 0), cfg),
      capStat(base.intelligence + (bonus.intelligence ?? 0), cfg),
    );
    expect(boosted).toEqual(stats(100, 0, 0, 100)); // 99+3 and 99+2 both cap at 100
  });
});

describe("avatar -> startAge + start bonus", () => {
  it("avatar-20-* map to 20 (no bonus), avatar-30-* map to 30 (+3 prestige, +2 intelligence)", () => {
    for (const n of [1, 2, 3, 4, 5]) {
      expect(startAgeForAvatar(`avatar-20-${n}`, cfg)).toBe(20);
      expect(startAgeForAvatar(`avatar-30-${n}`, cfg)).toBe(30);
    }
    expect(startBonusForAge(20, cfg)).toEqual({});
    expect(startBonusForAge(30, cfg)).toEqual({ prestige: 3, intelligence: 2 });
    expect(startAgeForAvatar("nope", cfg)).toBeNull();
  });
  it("has 10 male start-age avatars (5 per age) + the female wife pool", () => {
    expect(cfg.avatars.filter((a) => a.sex === "male" && a.startAge === 20)).toHaveLength(5);
    expect(cfg.avatars.filter((a) => a.sex === "male" && a.startAge === 30)).toHaveLength(5);
    expect(cfg.avatars.filter((a) => a.sex === "female")).toHaveLength(34);
  });
});

describe("stageFor / portraitFor", () => {
  it("swaps stage at 30 (prime) and 50 (old)", () => {
    expect(stageFor(29, cfg)).toBe("young");
    expect(stageFor(30, cfg)).toBe("prime");
    expect(stageFor(49, cfg)).toBe("prime");
    expect(stageFor(50, cfg)).toBe("old");
  });
  it("returns the stage portrait path for the avatar", () => {
    expect(portraitFor("avatar-20-1", 20, cfg)).toBe("avatars/avatar-20-1-young.png");
    expect(portraitFor("avatar-20-1", 35, cfg)).toBe("avatars/avatar-20-1-prime.png");
    expect(portraitFor("avatar-20-1", 60, cfg)).toBe("avatars/avatar-20-1-old.png");
    expect(portraitFor("missing", 30, cfg)).toBeNull();
    // A wife ages through the same stage machinery to her real .webp art.
    expect(portraitFor("wife-01", 20, cfg)).toBe("avatars/wife-01-young.webp");
    expect(portraitFor("wife-01", 35, cfg)).toBe("avatars/wife-01-prime.webp");
    expect(portraitFor("wife-01", 55, cfg)).toBe("avatars/wife-01-old.webp");
  });
  it("falls back to the nearest earlier available stage when art is missing", () => {
    // A synthetic avatar whose 'old' stage has no image -> should fall back to 'prime'.
    const partial: AgeConfig = {
      ...cfg,
      avatars: [{ id: "a-x", sex: "male", startAge: 30, label: "x", portraits: { young: "y.png", prime: "p.png" } }],
    };
    expect(portraitFor("a-x", 60, partial)).toBe("p.png"); // old missing -> prime
    const youngOnly: AgeConfig = { ...cfg, avatars: [{ id: "a-y", sex: "male", startAge: 30, label: "y", portraits: { young: "y.png" } }] };
    expect(portraitFor("a-y", 60, youngOnly)).toBe("y.png"); // old + prime missing -> young
  });
});

describe("death age + isDeceased (helper only)", () => {
  it("rolls within [min, max] inclusive", () => {
    expect(rollDeathAge(cfg, () => 0)).toBe(cfg.deathAge.min); // 55
    expect(rollDeathAge(cfg, () => 0.9999)).toBe(cfg.deathAge.max); // 68
    for (let i = 0; i < 50; i++) {
      const d = rollDeathAge(cfg, () => i / 50);
      expect(d).toBeGreaterThanOrEqual(cfg.deathAge.min);
      expect(d).toBeLessThanOrEqual(cfg.deathAge.max);
    }
  });
  it("isDeceased true at and after death age", () => {
    expect(isDeceased(54, 55)).toBe(false);
    expect(isDeceased(55, 55)).toBe(true);
    expect(isDeceased(70, 55)).toBe(true);
  });
});

describe("config sanity", () => {
  it("config loaded, 44 avatars (10 male + 34 female), all 3 portrait slots each", () => {
    expect(cfg.avatars).toHaveLength(44);
    const refs = cfg.avatars.flatMap((a) => Object.values(a.portraits));
    expect(refs).toHaveLength(132);
    expect(avatarById("avatar-30-1", cfg)?.startAge).toBe(30);
    // The wife pool is sex-tagged female (males default to "male" with no field).
    expect(avatarById("wife-01", cfg)?.sex).toBe("female");
    expect(avatarById("avatar-20-1", cfg)?.sex).toBe("male");
  });
});
