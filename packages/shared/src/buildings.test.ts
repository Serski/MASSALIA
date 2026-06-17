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
  craftRawCost,
  materialCostForTier,
  staffCountForTier,
  staffDailyCost,
  parsePopsContent,
  type BuildingsContent,
  type PopsContent,
} from "./buildings.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const content: BuildingsContent = parseBuildingsContent(
  JSON.parse(readFileSync(resolve(root, "content/buildings/buildings.json"), "utf8")),
);
const pops: PopsContent = parsePopsContent(
  JSON.parse(readFileSync(resolve(root, "content/people/pops.json"), "utf8")),
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

describe("the priest's Sanctuary (a year-round, dual-yield class line on the same curve)", () => {
  const sanctuary = content.classBuildings.priest!;

  it("is wired into classBuildings with four tiers and priestly ranks", () => {
    expect(sanctuary.id).toBe("sanctuary");
    expect(sanctuary.tiers.map((t) => t.tier)).toEqual([1, 2, 3, 4]);
    expect(sanctuary.tiers.every((t) => t.rank?.startsWith("@"))).toBe(true);
  });

  it("yields BOTH offering drachmae (the income field → wallet) AND herbal (a good)", () => {
    // Drachmae rides the same income path as building_income (no second mechanism).
    expect(sanctuary.income).toBe(7.2); // +20% pass
    const herbal = sanctuary.yields.find((y) => y.good === "herbal")!;
    expect(herbal.base).toBe(4);
    // Both scale on the shared yield curve, tier over tier.
    expect(buildingYield(sanctuary.income!, 2)).toBeCloseTo(12.96, 6);
    expect(goodPerDay(herbal, 2)).toBeCloseTo(7.2, 6);
  });

  it("is a YEAR-ROUND trade — its output barely swings winter→summer (unlike the Estate)", () => {
    expect(sanctuary.category).toBe("yearround");
    const winter = coeffFor(seasonal, "yearround", "Winter").production;
    const summer = coeffFor(seasonal, "yearround", "Summer").production;
    expect(Math.abs(summer - winter)).toBeLessThan(0.11);
    // The Estate's agricultural swing is far deeper.
    const agSwing = Math.abs(
      coeffFor(seasonal, "agricultural", "Summer").production - coeffFor(seasonal, "agricultural", "Winter").production,
    );
    expect(agSwing).toBeGreaterThan(Math.abs(summer - winter));
  });

  it("herbal trades on a vendor band (can't deadlock, ~2× floor) and prices as a gentle year-round good", () => {
    const band = vendor.herbal!;
    expect(band.sell).toBeGreaterThan(band.buy);
    expect(band.sell / band.buy).toBeLessThanOrEqual(3);
    const buy = vendorUnitPrice(band, "buy", seasonal, "yearround", "Winter");
    const sell = vendorUnitPrice(band, "sell", seasonal, "yearround", "Winter");
    expect(buy).toBeGreaterThan(sell); // player buys at ceiling, sells at floor
  });
});

describe("the four remaining class lines (content-only, same generic frame)", () => {
  const trader = content.classBuildings.trader!;
  const philosopher = content.classBuildings.philosopher!;
  const hetaira = content.classBuildings.hetaira!;
  const shipbuilder = content.classBuildings.shipbuilder!;

  it("every class line has four tiers, four @ranks, and resolves on the shared curve", () => {
    for (const line of [trader, philosopher, hetaira, shipbuilder]) {
      expect(line.tiers.map((t) => t.tier)).toEqual([1, 2, 3, 4]);
      expect(line.tiers.every((t) => t.rank?.startsWith("@"))).toBe(true);
      // Tier-1 cost is the universal 100dr entry; nothing hand-rolled.
      expect(buildingCost(1)).toBe(100);
    }
  });

  it("trader: drachmae income 7 + wine stock from tier 2 (reuses the wine good, scales on the curve)", () => {
    expect(trader.id).toBe("emporion");
    expect(trader.category).toBe("yearround");
    expect(trader.income).toBe(9.6);
    const wine = trader.yields.find((y) => y.good === "wine")!;
    expect(wine.fromTier).toBe(2);
    expect(goodPerDay(wine, 1)).toBe(0); // dormant at tier 1
    expect(goodPerDay(wine, 2)).toBeCloseTo(2, 6); // scales from its own base at T2
    expect(vendor.wine).toBeTruthy(); // reused, already registered
  });

  it("philosopher & hetaira are income-only lines (no tradeable good); their STATS are never goods", () => {
    expect(philosopher.id).toBe("school");
    expect(hetaira.id).toBe("salon");
    expect(philosopher.income).toBe(10.8);
    expect(hetaira.income).toBe(10.8);
    expect(philosopher.yields).toEqual([]);
    expect(hetaira.yields).toEqual([]);
    // prestige / intelligence are STATS — never registered as tradeable goods.
    expect(vendor.prestige).toBeUndefined();
    expect(vendor.intelligence).toBeUndefined();
    expect(seasonal.goodCategory.prestige).toBeUndefined();
    expect(seasonal.goodCategory.intelligence).toBeUndefined();
  });

  it("shipbuilder (reworked): earns drachmae income + makes naval-supplies (no longer 'builds ships')", () => {
    expect(shipbuilder.id).toBe("slipway");
    expect(shipbuilder.income).toBe(8.4); // +20% pass; was 0
    const ns = shipbuilder.yields.find((y) => y.good === "naval-supplies")!;
    expect(ns.base).toBe(1);
    expect(shipbuilder.yields.find((y) => y.good === "ship")).toBeUndefined(); // ship yield retired
    expect(vendor.ship).toBeUndefined(); // 'ship' good removed; replaced by trade-ship/galley
  });

  it("trade-ship & galley are shop-standard goods with vendor bands (~2× floor)", () => {
    for (const g of ["trade-ship", "galley", "naval-supplies"]) {
      const band = vendor[g]!;
      expect(band.sell).toBeGreaterThan(band.buy);
      expect(band.sell / band.buy).toBeLessThanOrEqual(3);
    }
    expect(vendor["trade-ship"]!.sell).toBe(60);
    expect(vendor.galley!.sell).toBe(120);
    expect(seasonal.goodCategory["trade-ship"]).toBe("agricultural");
  });
});

describe("upkeep is a tax, not a treadmill", () => {
  it("tier-1 (the entry point) is free, and even tier 4 is a small daily flat", () => {
    expect(buildingUpkeep(1)).toBe(0);
    // A day of T2 income (≈10.8 grain ≈ 10dr) dwarfs its 1dr/day upkeep.
    expect(buildingUpkeep(2)).toBeLessThan(buildingYield(6, 2) * vendor.grain!.buy);
  });
});


describe("Economy v2.1 — materials, staffing, craft & pops", () => {
  it("every class building carries a material bill and a pop requirement", () => {
    for (const def of Object.values(content.classBuildings)) {
      expect(def.buildCost?.materials).toBeTruthy();
      expect(Object.keys(def.buildCost!.materials).length).toBeGreaterThan(0);
      expect(def.staffing).toBeTruthy();
      expect(Object.values(def.staffing!).reduce((a, b) => a + (b ?? 0), 0)).toBeGreaterThan(0);
    }
  });

  it("material bills track the yield curve; staffing adds a head at T3 and T4", () => {
    expect(materialCostForTier(8, 1)).toBe(8);
    expect(materialCostForTier(8, 2)).toBe(14); // 8 × 1.8
    expect(staffCountForTier(2, 1)).toBe(2);
    expect(staffCountForTier(2, 3)).toBe(3);
    expect(staffCountForTier(2, 4)).toBe(4);
  });

  it("CRAFT RULE — every craft recipe costs less than the good's own NPC sell price", () => {
    for (const [good, c] of Object.entries(content.craft!)) {
      expect(craftRawCost(c.recipe, vendor)).toBeLessThan(vendor[good]!.sell);
    }
    // shipbuilder-gated
    expect(content.craft!["trade-ship"]!.building).toBe("slipway");
    expect(content.craft!["trade-ship"]!.tier).toBe(3);
    expect(content.craft!.galley!.tier).toBe(4);
  });

  it("pops: hire cost is the -30% set, all pops draw food, only freeman/citizen are civic", () => {
    expect(pops.pops.slave.hireCost).toBe(49);
    expect(pops.pops.freeman.hireCost).toBe(28);
    expect(pops.pops.citizen.hireCost).toBe(84);
    expect([pops.pops.slave, pops.pops.freeman, pops.pops.citizen].every((p) => p.foodPerDay === 1)).toBe(true);
    expect(pops.pops.slave.civic).toBe(false);
    expect(pops.foodGood).toBe("grain"); // wheat (display label)
  });

  it("staff daily cost scales with tier (the rising payroll that bites T4 ROI)", () => {
    const estate = content.classBuildings.landowner!; // 2 slaves T1
    const t1 = staffDailyCost(estate.staffing, 1, pops);
    const t4 = staffDailyCost(estate.staffing, 4, pops);
    expect(t1.upkeep).toBe(2); // 2 slaves × 1
    expect(t1.food).toBe(2);
    expect(t4.upkeep).toBe(4); // 4 slaves × 1 at T4
    expect(t4.upkeep).toBeGreaterThan(t1.upkeep);
  });
});
