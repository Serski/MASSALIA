import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  accrueService,
  gateShortfall,
  meetsGate,
  MS_PER_GAME_DAY,
  nextRankId,
  parseRanksContent,
  rankDef,
  RANK_ORDER,
  type RanksContent,
} from "./military.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const content: RanksContent = parseRanksContent(JSON.parse(readFileSync(resolve(root, "content/military/ranks.json"), "utf8")));
const recruit = rankDef(content, "recruit")!;
const veteran = rankDef(content, "veteran")!;

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
