import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { REAL_MS_PER_SEASON } from "./calendar.js";
import {
  accrueService,
  ageRiskScale,
  contractDef,
  foreignIncomeAccrual,
  gateShortfall,
  injuryTrait,
  meetsGate,
  MS_PER_GAME_DAY,
  nextRankId,
  parseContractsContent,
  canReclass,
  isReclassTarget,
  parseRanksContent,
  rankDef,
  RANK_ORDER,
  RECLASS_AGE,
  RECLASS_TARGETS,
  reclassReason,
  resolveRisk,
  riskProbabilities,
  seasonsElapsed,
  type ContractsContent,
  type RanksContent,
} from "./military.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const content: RanksContent = parseRanksContent(JSON.parse(readFileSync(resolve(root, "content/military/ranks.json"), "utf8")));
const recruit = rankDef(content, "recruit")!;
const veteran = rankDef(content, "veteran")!;
const contracts: ContractsContent = parseContractsContent(JSON.parse(readFileSync(resolve(root, "content/military/contracts.json"), "utf8")));
const tradeShip = contractDef(contracts, "trade-ship")!;
const ptolemy = contractDef(contracts, "ptolemy")!;

describe("rank ladder", () => {
  it("progresses none → recruit → veteran → lochagos → archilochagos, one at a time", () => {
    expect(RANK_ORDER).toEqual(["none", "recruit", "veteran", "lochagos", "archilochagos"]);
    expect(nextRankId("none")).toBe("recruit");
    expect(nextRankId("veteran")).toBe("lochagos");
    expect(nextRankId("archilochagos")).toBeNull(); // top of the ladder
  });

  it("the salary curve is a slightly-better-than-passive path that requires standing", () => {
    expect(content.ranks.map((r) => r.salaryPerDay)).toEqual([8, 16, 28, 45]);
    expect(content.ranks.map((r) => r.militiaPerDay)).toEqual([0, 1, 1, 2]);
    // Gates climb on both militia and prestige.
    expect(veteran.gate).toEqual({ militia: 15, prestige: 10 });
  });

  it("gates check militia AND prestige, with a readable shortfall", () => {
    expect(meetsGate(veteran.gate, 15, 10)).toBe(true);
    expect(meetsGate(veteran.gate, 14, 10)).toBe(false);
    expect(meetsGate(veteran.gate, 15, 9)).toBe(false);
    expect(gateShortfall(veteran.gate, 11, 5)).toEqual({ militia: 4, prestige: 5 });
    expect(gateShortfall(veteran.gate, 99, 99)).toEqual({ militia: 0, prestige: 0 });
  });
});

describe("lazy salary accrual (same clock as building income / age)", () => {
  it("pays salaryPerDay × in-game days; recruit's militia trickle is zero", () => {
    const a = accrueService(recruit, 0, 3 * MS_PER_GAME_DAY);
    expect(a.drachmae).toBe(24); // 8/day × 3
    expect(a.militia).toBe(0);
    expect(a.consumedMs).toBe(3 * MS_PER_GAME_DAY);
  });

  it("holds the anchor (pays nothing) until a whole drachma is earned — no collect-spam leak", () => {
    // Recruit earns 1dr every 1/8 day; less than that pays nothing and consumes nothing.
    const tiny = accrueService(recruit, 0, MS_PER_GAME_DAY / 16);
    expect(tiny).toEqual({ drachmae: 0, militia: 0, consumedMs: 0 });
  });

  it("advances the anchor only by the consumed whole-unit time so remainders carry", () => {
    // Veteran: 16dr/day + 1 militia/day. After 2.5 days, militia (slower) gates to 2
    // whole points → 2 days consumed; the half-day of salary remainder carries.
    const a = accrueService(veteran, 0, 2.5 * MS_PER_GAME_DAY);
    expect(a.militia).toBe(2);
    expect(a.drachmae).toBe(32); // 16 × 2 consumed days (not 40) — the 0.5d carries
    expect(a.consumedMs).toBe(2 * MS_PER_GAME_DAY);
  });
});

describe("mercenary contracts (Step 2)", () => {
  it("foreign income pays MORE than home rank salary (the wealth path)", () => {
    // Lowest contract (12/season) already tops the recruit's 8/day home salary.
    expect(tradeShip.dailyDrachmae).toBeGreaterThan(recruit.salaryPerDay);
    expect(contracts.contracts.map((c) => c.dailyDrachmae)).toEqual([12, 16, 22, 30, 42]);
  });

  it("validates minCancelSeasons never exceeds the term", () => {
    for (const c of contracts.contracts) expect(c.minCancelSeasons).toBeLessThanOrEqual(c.termSeasons);
  });

  it("counts whole seasons elapsed from the contract start anchor", () => {
    expect(seasonsElapsed(0, 0.9 * REAL_MS_PER_SEASON)).toBe(0);
    expect(seasonsElapsed(0, 1 * REAL_MS_PER_SEASON)).toBe(1);
    expect(seasonsElapsed(0, 4.2 * REAL_MS_PER_SEASON)).toBe(4);
  });

  it("accrues foreign income per season, CAPPED at the term end", () => {
    const termEnd = tradeShip.termSeasons * REAL_MS_PER_SEASON; // term 1
    // Half a season → floor(12 × 0.5) = 6.
    expect(foreignIncomeAccrual(tradeShip.dailyDrachmae, 0, 0.5 * REAL_MS_PER_SEASON, termEnd).drachmae).toBe(6);
    // Past the term, income is capped at the full term (12 × 1), never more.
    expect(foreignIncomeAccrual(tradeShip.dailyDrachmae, 0, 99 * REAL_MS_PER_SEASON, termEnd).drachmae).toBe(12);
    // The Ptolemaic guard over its full 4-season term: 42 × 4 = 168.
    const ptEnd = ptolemy.termSeasons * REAL_MS_PER_SEASON;
    expect(foreignIncomeAccrual(ptolemy.dailyDrachmae, 0, 99 * REAL_MS_PER_SEASON, ptEnd).drachmae).toBe(168);
  });
});

describe("mercenary risk + age scaling (Step 4)", () => {
  const cfg = contracts.risk;

  it("ageScale: under 30 → ×0.5; 40 → ×1.0; 50 → ×1.5 (linear, continuing past 40)", () => {
    expect(ageRiskScale(25, cfg.ageScale)).toBeCloseTo(0.5, 6); // floor below rampStart
    expect(ageRiskScale(30, cfg.ageScale)).toBeCloseTo(0.5, 6);
    expect(ageRiskScale(35, cfg.ageScale)).toBeCloseTo(0.75, 6); // halfway up the ramp
    expect(ageRiskScale(40, cfg.ageScale)).toBeCloseTo(1.0, 6);
    expect(ageRiskScale(50, cfg.ageScale)).toBeCloseTo(1.5, 6); // same slope past 40
  });

  it("under-30 death rate is exactly half the over-30 (×1.0 at 40) rate", () => {
    const at30 = riskProbabilities(ptolemy.risk, 30, cfg).death; // ×0.5
    const at40 = riskProbabilities(ptolemy.risk, 40, cfg).death; // ×1.0
    expect(at30).toBeCloseTo(at40 / 2, 6);
    expect(at40).toBeCloseTo(ptolemy.risk.death, 6); // full over-30 rate at age 40
  });

  it("scare is FLAT (never age-scaled)", () => {
    expect(riskProbabilities(ptolemy.risk, 25, cfg).scare).toBe(ptolemy.risk.scare);
    expect(riskProbabilities(ptolemy.risk, 60, cfg).scare).toBe(ptolemy.risk.scare);
  });

  it("clamps the final probability to clampMax", () => {
    const huge = { death: 5, careerInjury: 5, scare: 0.1 };
    const p = riskProbabilities(huge, 50, cfg);
    expect(p.death).toBe(cfg.clampMax);
    expect(p.injury).toBe(cfg.clampMax);
  });

  it("resolveRisk picks the branch from the seeded rng, highest-severity first", () => {
    const seq = (...v: number[]) => { let i = 0; return () => v[Math.min(i++, v.length - 1)]!; };
    // syracuse @30: pDeath=0.015, pInjury=0.01, pScare=0.07.
    expect(resolveRisk(contractDef(contracts, "syracuse")!.risk, 30, cfg, seq(0))).toBe("death");
    expect(resolveRisk(contractDef(contracts, "syracuse")!.risk, 30, cfg, seq(0.9, 0))).toBe("injury");
    expect(resolveRisk(contractDef(contracts, "syracuse")!.risk, 30, cfg, seq(0.9, 0.9, 0))).toBe("scare");
    expect(resolveRisk(contractDef(contracts, "syracuse")!.risk, 30, cfg, seq(0.9, 0.9, 0.9))).toBe("clean");
  });

  it("trade-ship has zero career-injury by design", () => {
    expect(tradeShip.risk.careerInjury).toBe(0);
    expect(riskProbabilities(tradeShip.risk, 50, cfg).injury).toBe(0);
  });

  it("injuryTrait is a seeded coin between one-eyed and lamed", () => {
    expect(injuryTrait(() => 0)).toBe("one-eyed");
    expect(injuryTrait(() => 0.99)).toBe("lamed");
  });
});

describe("re-class rules (Step 5 capstone)", () => {
  it("only the curated four trades are re-class targets", () => {
    expect([...RECLASS_TARGETS]).toEqual(["landowner", "trader", "philosopher", "priest"]);
    expect(isReclassTarget("landowner")).toBe(true);
    for (const no of ["hetaira", "shipbuilder", "slave", "hoplite"]) expect(isReclassTarget(no)).toBe(false);
  });

  it("a living hoplite may re-class iff wounded OR aged out", () => {
    expect(canReclass("hoplite", "alive", 40, true)).toBe(true); // wounded, young
    expect(canReclass("hoplite", "alive", RECLASS_AGE, false)).toBe(true); // aged out, unwounded
    expect(canReclass("hoplite", "alive", 40, false)).toBe(false); // unwounded, <50
    expect(canReclass("hoplite", "deceased", 60, true)).toBe(false); // dead
    expect(canReclass("trader", "alive", 60, true)).toBe(false); // not a hoplite
  });

  it("reclassReason prefers wound over age", () => {
    expect(reclassReason(true, 40)).toBe("wound");
    expect(reclassReason(false, 55)).toBe("retirement");
    expect(reclassReason(false, 40)).toBeNull();
  });
});
