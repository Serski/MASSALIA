import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  accruedUnits,
  buildingBuildDays,
  buildingCost,
  buildingUpkeep,
  buildingYield,
  classBuildingRoi,
  coeffFor,
  commonBuildingRoi,
  goodPerDay,
  isGuarded,
  parseBuildingsContent,
  productionMultiplier,
  seasonAt,
  vendorUnitPrice,
  type BuildingsContent,
} from "./buildings.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const content: BuildingsContent = parseBuildingsContent(
  JSON.parse(readFileSync(resolve(root, "content/buildings/buildings.json"), "utf8")),
);
const DAY = 86_400_000;
const estate = content.classBuildings.landowner!;
const vendor = content.vendor;
const seasonal = content.seasonal;

describe("the building curve (one curve, not hand rows)", () => {
  it("cost(t) = round(100 × 2.5^(t-1)) → 100 / 250 / 625 / 1563", () => {
    // The formula is the source of truth (constants, not hand rows); 625/1563
    // are its exact values (the design note's 600/1500 were a rough annotation).
    expect([1, 2, 3, 4].map(buildingCost)).toEqual([100, 250, 625, 1563]);
  });

  it("buildDays(t) = [1, 2, 4, 7] real days (≥1 season floor)", () => {
    expect([1, 2, 3, 4].map(buildingBuildDays)).toEqual([1, 2, 4, 7]);
  });

  it("upkeep(t) is gentle and scales with tier → 0 / 1 / 3 / 6", () => {
    expect([1, 2, 3, 4].map(buildingUpkeep)).toEqual([0, 1, 3, 6]);
  });

  it("yield(base, t) = base × 1.8^(t-1)", () => {
    expect(buildingYield(6, 1)).toBe(6);
    expect(buildingYield(6, 2)).toBeCloseTo(10.8, 6);
    expect(buildingYield(6, 3)).toBeCloseTo(19.44, 6);
  });

  it("the estate's olive oil is dormant below tier 3, then scales from its own base", () => {
    const oil = estate.yields.find((y) => y.good === "oliveoil")!;
    expect(goodPerDay(oil, 2)).toBe(0);
    expect(goodPerDay(oil, 3)).toBeCloseTo(2, 6);
    expect(goodPerDay(oil, 4)).toBeCloseTo(3.6, 6);
  });
});

describe("the vendor band (economy can never deadlock; ceiling ≈ 2× floor)", () => {
  it("sells to the player at the ceiling and buys from the player at the ~50% floor", () => {
    for (const [, band] of Object.entries(vendor)) {
      expect(band.sell).toBeGreaterThan(band.buy);
      // Ceiling ≈ 2× floor, leaving room for a future player market. Cheap goods
      // (grain/chicken) round to a floor of 1, so their ratio reads 3× — the
      // integer-coin limit, not a wider band.
      expect(band.sell / band.buy).toBeGreaterThanOrEqual(1.6);
      expect(band.sell / band.buy).toBeLessThanOrEqual(3);
    }
  });

  it("a player BUYS at the ceiling and SELLS at the floor (Spring ≈ flat)", () => {
    const buy = vendorUnitPrice(vendor.grain!, "buy", seasonal, "agricultural", "Spring");
    const sell = vendorUnitPrice(vendor.grain!, "sell", seasonal, "agricultural", "Spring");
    expect(buy).toBeGreaterThan(sell);
  });
});

describe("seasonal multipliers (shallow; agriculture swings, trades barely move)", () => {
  it("winter lowers crop output (~0.65) but raises stored-crop prices", () => {
    expect(coeffFor(seasonal, "agricultural", "Winter").production).toBeCloseTo(0.65, 6);
    expect(coeffFor(seasonal, "agricultural", "Winter").price).toBeGreaterThan(1);
  });

  it("winter is shallow, not punishing (≥ 0.6)", () => {
    expect(coeffFor(seasonal, "agricultural", "Winter").production).toBeGreaterThanOrEqual(0.6);
  });

  it("year-round trades barely move across seasons", () => {
    for (const s of ["Winter", "Spring", "Summer", "Autumn"] as const) {
      expect(Math.abs(coeffFor(seasonal, "yearround", s).production - 1)).toBeLessThanOrEqual(0.1);
    }
  });
});

describe("the new-player guard (winter joiners aren't punished)", () => {
  it("runs a building at full output for its first ~3 days regardless of season", () => {
    const completesAt = 10 * DAY;
    // 2 days into the guard window, in Winter — still full output, not 0.65.
    const within = productionMultiplier(seasonal, "agricultural", "Winter", completesAt, completesAt + 2 * DAY);
    expect(within).toBe(1);
    expect(isGuarded(seasonal, completesAt, completesAt + 2 * DAY)).toBe(true);
    // After the window, the winter penalty applies.
    const after = productionMultiplier(seasonal, "agricultural", "Winter", completesAt, completesAt + 5 * DAY);
    expect(after).toBeCloseTo(0.65, 6);
  });
});

describe("BALANCE GUARDRAIL — the day-1 landowner path", () => {
  // 100dr start → build Estate T1 (cost 100) → wallet 0 → constructs in 1 day.
  it("Estate T1 costs exactly the starting purse", () => {
    expect(buildingCost(1)).toBe(100);
    expect(buildingBuildDays(1)).toBe(1);
  });

  it("the first collect within a day yields grain, and vendor chicken is affordable by day 2", () => {
    const t0 = 0; // world start = opening Winter
    const completesAt = t0 + 1 * DAY; // constructs in 1 day
    const collectAt = t0 + 2 * DAY; // collect on day 2
    const season = seasonAt(collectAt, t0); // still the opening Winter
    // Guarded (first 3 days) → full output despite winter.
    const mult = productionMultiplier(seasonal, "agricultural", season, completesAt, collectAt);
    const grain = accruedUnits({ perDay: 6, lastMs: completesAt, completesAtMs: completesAt, nowMs: collectAt, productionMult: mult });
    expect(grain).toBeCloseTo(6, 6); // ~6 grain after one day active

    // Sell that grain to the vendor at the seasonal floor → enough for a chicken.
    const grainFloor = vendorUnitPrice(vendor.grain!, "sell", seasonal, "agricultural", season);
    const purse = Math.floor(grain) * grainFloor;
    const chickenCeiling = vendorUnitPrice(vendor.chicken!, "buy", seasonal, "yearround", season);
    expect(purse).toBeGreaterThanOrEqual(chickenCeiling);
  });
});

describe("BALANCE GUARDRAIL — class ROI beats commons for the owner", () => {
  const commons = content.commonBuildings.filter((b) => b.yields.length > 0);
  const classT1 = classBuildingRoi(estate, 1, vendor);

  it("the class line out-returns every common at the owner's tiers (1–3)", () => {
    for (const tier of [1, 2, 3]) {
      const classRoi = classBuildingRoi(estate, tier, vendor);
      for (const common of commons) {
        expect(classRoi).toBeGreaterThan(commonBuildingRoi(common, vendor));
      }
    }
  });

  it("commons sit at ~55–60% of the class line (band 40–70%; never beating it)", () => {
    for (const common of commons) {
      const ratio = commonBuildingRoi(common, vendor) / classT1;
      expect(ratio).toBeGreaterThanOrEqual(0.4);
      expect(ratio).toBeLessThan(0.7);
    }
  });

  it("the full T1→T4 grind costs ~2450dr (a multi-week, late-game push)", () => {
    // The curve sums to 2538 — the ≈2450 design target, late-game by intent.
    const total = [1, 2, 3, 4].reduce((sum, t) => sum + buildingCost(t), 0);
    expect(total).toBe(2538);
    expect(total).toBeGreaterThan(2400);
  });
});

describe("upkeep is a tax, not a treadmill", () => {
  it("tier-1 (the entry point) is free, and even tier 4 is a small daily flat", () => {
    expect(buildingUpkeep(1)).toBe(0);
    // A day of T2 income (≈10.8 grain ≈ 10dr) dwarfs its 1dr/day upkeep.
    expect(buildingUpkeep(2)).toBeLessThan(buildingYield(6, 2) * vendor.grain!.buy);
  });
});
