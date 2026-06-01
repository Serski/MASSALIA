import { describe, expect, it } from "vitest";
import { accrueResource, completionDelayMs, secondsBetween } from "./tick.js";

describe("tick math", () => {
  it("floors elapsed seconds and ignores negative time", () => {
    expect(secondsBetween(1_000, 3_900)).toBe(2);
    expect(secondsBetween(3_900, 1_000)).toBe(0);
  });

  it("lazily accrues resources from rate and elapsed time", () => {
    expect(accrueResource({ amount: 10, ratePerSecond: 2, lastUpdatedAt: 0 }, 5_500)).toEqual({
      amount: 20,
      ratePerSecond: 2,
      lastUpdatedAt: 5_500,
    });
  });

  it("respects caps", () => {
    expect(accrueResource({ amount: 9, ratePerSecond: 4, lastUpdatedAt: 0, cap: 12 }, 3_000).amount).toBe(12);
  });

  it("computes non-negative job delay", () => {
    expect(completionDelayMs(10, 15)).toBe(5);
    expect(completionDelayMs(15, 10)).toBe(0);
  });
});
