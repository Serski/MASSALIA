import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { REAL_MS_PER_SEASON } from "./calendar.js";
import {
  accrueService,
  contractDef,
  foreignIncomeAccrual,
  gateShortfall,
  meetsGate,
  MS_PER_GAME_DAY,
  nextRankId,
  parseContractsContent,
  parseRanksContent,
  rankDef,
  RANK_ORDER,
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
