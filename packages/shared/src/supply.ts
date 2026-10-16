// ---------------------------------------------------------------------------
// The supply plan (economy supply-plan prompt 1): one day of the household's
// food and the army's upkeep, in the settle's own order. The day's harvest is
// banked first, then the household eats (settleStaffing), then the army
// (settleBarracks). Each good is taken from the harvest first, then from the
// store, and the rest is bought at today's price. Pure: the server fills the
// inputs for the Economy view, and the settle charges the same arithmetic
// over whole days.
// ---------------------------------------------------------------------------

// A store running down is called out while it lasts this many days or fewer.
export const SUPPLY_WARN_DAYS = 7;

export type SupplyInputs = {
  household: Record<string, number>; // food a day, by good
  army: Record<string, number>; // upkeep a day, by good; `drachmae` is band pay
  harvest: Record<string, number>; // what the buildings yield a day, by good
  store: Record<string, number>; // what is in store now, by good
  price: Record<string, number>; // today's price to buy one, by good
};

// One eater's day of one good: how much it needs, where it comes from, and
// what the bought part costs (bought × price, unrounded).
export type SupplyLine = { good: string; need: number; fromHarvest: number; fromStore: number; bought: number; price: number; cost: number };

// A good whose store covers today's need but runs out within SUPPLY_WARN_DAYS:
// the whole days it lasts, and what the daily shortfall costs at today's price
// once it is gone.
export type SupplyWarning = { good: string; days: number; costPerDay: number };

export type SupplyPlan = {
  household: SupplyLine[];
  army: SupplyLine[];
  armyPay: number; // band pay a day, in drachmae
  householdCost: number; // drachmae for the household's bought food
  armyGoodsCost: number; // drachmae for the army's bought goods
  warnings: SupplyWarning[];
};

export function supplyPlan(inputs: SupplyInputs): SupplyPlan {
  const harvest = { ...inputs.harvest };
  const store = { ...inputs.store };
  const take = (good: string, need: number): SupplyLine => {
    const fromHarvest = Math.min(need, Math.max(0, harvest[good] ?? 0));
    harvest[good] = (harvest[good] ?? 0) - fromHarvest;
    const fromStore = Math.min(need - fromHarvest, Math.max(0, store[good] ?? 0));
    store[good] = (store[good] ?? 0) - fromStore;
    const bought = need - fromHarvest - fromStore;
    const price = inputs.price[good] ?? 0;
    return { good, need, fromHarvest, fromStore, bought, price, cost: bought * price };
  };
  const lines = (needs: Record<string, number>) =>
    Object.entries(needs)
      .filter(([good, need]) => good !== "drachmae" && need > 0)
      .map(([good, need]) => take(good, need));
  const household = lines(inputs.household);
  const army = lines(inputs.army);

  const warnings: SupplyWarning[] = [];
  const goods = [...new Set([...household, ...army].map((l) => l.good))];
  for (const good of goods) {
    const need = [...household, ...army].filter((l) => l.good === good).reduce((s, l) => s + l.need, 0);
    const drain = need - Math.max(0, inputs.harvest[good] ?? 0);
    const held = Math.max(0, inputs.store[good] ?? 0);
    if (drain <= 0 || held < drain) continue; // the harvest feeds it, or the store is already short today
    const days = Math.floor(held / drain);
    if (days <= SUPPLY_WARN_DAYS) warnings.push({ good, days, costPerDay: drain * (inputs.price[good] ?? 0) });
  }

  return {
    household,
    army,
    armyPay: Math.max(0, inputs.army.drachmae ?? 0),
    householdCost: household.reduce((s, l) => s + l.cost, 0),
    armyGoodsCost: army.reduce((s, l) => s + l.cost, 0),
    warnings,
  };
}

// The money side of tomorrow, in the settle's order and with its clamps: the
// purse takes the day's income less building upkeep (settleWallet, never below
// zero), then the League's grants, then wages and the household's bought food
// (settleStaffing, never below zero). What is left is set against the army's
// day, pay plus bought goods; settleBarracks disbands rows when it is short.
export type ArmyDayInputs = { purse: number; income: number; buildingUpkeep: number; grants: number; wages: number; householdCost: number; armyCost: number };

export function armyDayShort(i: ArmyDayInputs): boolean {
  const afterWallet = Math.max(0, i.purse + Math.round(i.income - i.buildingUpkeep));
  const afterStaff = Math.max(0, afterWallet + i.grants + Math.round(-(i.wages + i.householdCost)));
  return Math.round(i.armyCost) > afterStaff;
}
