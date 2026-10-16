import { describe, expect, it } from "vitest";
import { armyDayShort, supplyPlan, SUPPLY_WARN_DAYS, type SupplyInputs } from "./supply.js";

// The supply plan's arithmetic: harvest first, then the store, then the market;
// the household before the army on a good they share; drachmae is pay, never a
// line; a store running down is called out only while it covers today and
// lasts SUPPLY_WARN_DAYS or fewer; tomorrow's purse follows the settle's clamps.

const base: SupplyInputs = { household: {}, army: {}, harvest: {}, store: {}, price: { grain: 3, oliveoil: 5, wine: 4 } };

describe("supplyPlan", () => {
  it("feeds the household first, then the army, each from the harvest, then the store, then the market", () => {
    const p = supplyPlan({
      ...base,
      household: { grain: 16 },
      army: { grain: 99, oliveoil: 99, drachmae: 125 },
      harvest: { grain: 35, timber: 4 },
      store: { grain: 80, oliveoil: 40 },
    });
    expect(p.household).toEqual([{ good: "grain", need: 16, fromHarvest: 16, fromStore: 0, bought: 0, price: 3, cost: 0 }]);
    expect(p.army).toEqual([
      { good: "grain", need: 99, fromHarvest: 19, fromStore: 80, bought: 0, price: 3, cost: 0 },
      { good: "oliveoil", need: 99, fromHarvest: 0, fromStore: 40, bought: 59, price: 5, cost: 295 },
    ]);
    expect(p.armyPay).toBe(125);
    expect(p.householdCost).toBe(0);
    expect(p.armyGoodsCost).toBe(295);
  });

  it("buys the household's whole need when there is no harvest and no store", () => {
    const p = supplyPlan({ ...base, household: { grain: 16 } });
    expect(p.household[0]).toMatchObject({ fromHarvest: 0, fromStore: 0, bought: 16, cost: 48 });
    expect(p.householdCost).toBe(48);
    expect(p.army).toEqual([]);
    expect(p.armyPay).toBe(0);
  });

  it("drops zero needs and never makes a line of drachmae", () => {
    const p = supplyPlan({ ...base, household: { grain: 0 }, army: { wine: 0, drachmae: 40 } });
    expect(p.household).toEqual([]);
    expect(p.army).toEqual([]);
    expect(p.armyPay).toBe(40);
  });

  it("warns while the store covers today and lasts the threshold or fewer, in whole days, priced at today's shortfall", () => {
    const need = { household: { grain: 16 }, army: { grain: 99 } };
    // The ruling's example: 500 wheat against 115 a day lasts 4 more days, then 345 dr a day.
    expect(supplyPlan({ ...base, ...need, store: { grain: 500 } }).warnings).toEqual([{ good: "grain", days: 4, costPerDay: 345 }]);
    // A harvest shortens the drain: 115 − 35 = 80 a day.
    expect(supplyPlan({ ...base, ...need, harvest: { grain: 35 }, store: { grain: 500 } }).warnings).toEqual([{ good: "grain", days: 6, costPerDay: 240 }]);
    // Exactly the threshold warns; one day more does not.
    expect(SUPPLY_WARN_DAYS).toBe(7);
    expect(supplyPlan({ ...base, ...need, store: { grain: 115 * 7 } }).warnings).toEqual([{ good: "grain", days: 7, costPerDay: 345 }]);
    expect(supplyPlan({ ...base, ...need, store: { grain: 115 * 8 } }).warnings).toEqual([]);
    // Just enough for today: one day.
    expect(supplyPlan({ ...base, ...need, store: { grain: 115 } }).warnings).toEqual([{ good: "grain", days: 1, costPerDay: 345 }]);
  });

  it("does not warn once the store is short today, when the harvest feeds the need, or with no store at all", () => {
    expect(supplyPlan({ ...base, army: { grain: 99 }, store: { grain: 50 } }).warnings).toEqual([]);
    expect(supplyPlan({ ...base, army: { grain: 30 }, harvest: { grain: 30 }, store: { grain: 10 } }).warnings).toEqual([]);
    expect(supplyPlan({ ...base, army: { grain: 30 } }).warnings).toEqual([]);
  });

  it("warns per good, each on its own pool", () => {
    const p = supplyPlan({ ...base, army: { grain: 10, oliveoil: 10, wine: 3 }, store: { grain: 25, oliveoil: 500, wine: 3 } });
    expect(p.warnings).toEqual([
      { good: "grain", days: 2, costPerDay: 30 },
      { good: "wine", days: 1, costPerDay: 12 },
    ]);
  });
});

describe("armyDayShort", () => {
  const day = { purse: 0, income: 0, buildingUpkeep: 0, grants: 0, wages: 0, householdCost: 0, armyCost: 0 };

  it("is short only when the army's day exceeds what is left", () => {
    expect(armyDayShort({ ...day, purse: 100, armyCost: 100 })).toBe(false);
    expect(armyDayShort({ ...day, purse: 100, armyCost: 101 })).toBe(true);
    expect(armyDayShort({ ...day, purse: 50, income: 30, grants: 20, wages: 10, householdCost: 5, buildingUpkeep: 15, armyCost: 70 })).toBe(false);
    expect(armyDayShort({ ...day, purse: 50, income: 30, grants: 20, wages: 10, householdCost: 5, buildingUpkeep: 15, armyCost: 71 })).toBe(true);
    expect(armyDayShort({ ...day })).toBe(false);
  });

  it("clamps the purse at zero after building upkeep and again after the household, as the settle does", () => {
    // Upkeep 50 against a purse of 10 leaves 0, not −40; the grant then gives 30.
    expect(armyDayShort({ ...day, purse: 10, buildingUpkeep: 50, grants: 30, armyCost: 30 })).toBe(false);
    // Wages beyond the purse leave 0: any army cost is short.
    expect(armyDayShort({ ...day, purse: 10, wages: 50, armyCost: 1 })).toBe(true);
  });

  it("rounds each step as the settle's writes do", () => {
    // round(−(2 + 0.5)) is −2, so 10 leaves 8.
    expect(armyDayShort({ ...day, purse: 10, wages: 2, householdCost: 0.5, armyCost: 8 })).toBe(false);
    expect(armyDayShort({ ...day, purse: 10, wages: 2, householdCost: 0.5, armyCost: 8.4 })).toBe(false);
    expect(armyDayShort({ ...day, purse: 10, wages: 2, householdCost: 0.5, armyCost: 8.5 })).toBe(true);
  });
});
