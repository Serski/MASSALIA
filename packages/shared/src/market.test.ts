import { describe, expect, it } from "vitest";
import { MARKET_PRICE_MAX, MARKET_QTY_MAX, MARKET_STALL_CAP, MARKET_TAX_EXEMPT_CLASS, marketTax } from "./market.js";

describe("player market rules", () => {
  it("takes a tenth of the total, rounded down", () => {
    expect(marketTax(9, false)).toBe(0);
    expect(marketTax(10, false)).toBe(1);
    expect(marketTax(19, false)).toBe(1);
    expect(marketTax(20, false)).toBe(2);
    expect(marketTax(45, false)).toBe(4);
  });

  it("takes nothing from an exempt seller", () => {
    expect(marketTax(45, true)).toBe(0);
    expect(marketTax(10_000, true)).toBe(0);
  });

  it("pins the stall cap, bounds and exempt class", () => {
    expect(MARKET_STALL_CAP).toBe(10);
    expect(MARKET_PRICE_MAX).toBe(10_000);
    expect(MARKET_QTY_MAX).toBe(1_000);
    expect(MARKET_TAX_EXEMPT_CLASS).toBe("trader");
  });
});
