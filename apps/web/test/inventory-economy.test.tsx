// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { BuildingsCatalog, BuildingsMine, PeopleView, SupplyLineView, SupplyPlanView } from "../src/api.js";
import { InventoryEconomy } from "../src/dashboard/sheets.js";

// ---------------------------------------------------------------------------
// The inventory's Economy view lists the army under Expenses. A payload without
// the supply plan (an old server) falls back to `army.perDay`: one line per good
// drawn a day and band pay in drachmae, folded into the net; nothing when the
// army eats nothing.
// ---------------------------------------------------------------------------

afterEach(cleanup);

const catalog = { season: "Spring", seasonMultiplier: { agricultural: 1, yearround: 1 }, classBuilding: null, commons: [], classSectionLabel: null, vendor: [], goodLabels: { grain: "Grain", oliveoil: "Olive oil" }, craft: {} } as unknown as BuildingsCatalog;
const people: PeopleView = { foodGood: "grain", pops: [], spymaster: { posture: "guard", cooldownRemainingMs: 0 } };
const mine = (army: Record<string, number>): BuildingsMine =>
  ({ now: new Date().toISOString(), season: "Spring", buildings: [], pendingIncomeTotal: 0, upkeepOwed: 0, pendingGoods: {}, storageCap: 100, classSection: { label: null, comingSoon: false, entries: [] }, pops: {}, army: { perDay: army } }) as unknown as BuildingsMine;

const rows = (container: HTMLElement) => [...container.querySelectorAll(".res-row, [class*=\"res-row\"]")].map((el) => el.textContent?.replace(/\s+/g, " ").trim());

describe("InventoryEconomy · army", () => {
  it("lists one line per good drawn and the pay, and folds the pay into the net", () => {
    const { container } = render(<InventoryEconomy data={{ mine: mine({ grain: 194, oliveoil: 97, drachmae: 130 }), people, catalog }} goodLabels={catalog.goodLabels} />);
    const text = container.textContent!;
    expect(text).toContain("Army · grain");
    expect(text).toContain("−194/day");
    expect(text).toContain("Army · olive oil");
    expect(text).toContain("−97/day");
    expect(text).toContain("Army pay");
    expect(text).toContain("−130 dr");
    expect(text).not.toContain("No wages, food, or upkeep yet.");
    expect(container.querySelector(".econ-net")!.textContent).toContain("−130 dr");
    // Goods before pay, in the payload's order.
    const all = rows(container).join(" | ");
    expect(all.indexOf("Army · grain")).toBeLessThan(all.indexOf("Army · olive oil"));
    expect(all.indexOf("Army · olive oil")).toBeLessThan(all.indexOf("Army pay"));
  });

  it("shows nothing for the army when it draws nothing, and survives a payload without the field", () => {
    const { container } = render(<InventoryEconomy data={{ mine: mine({}), people, catalog }} goodLabels={catalog.goodLabels} />);
    expect(container.textContent).not.toContain("Army");
    expect(container.textContent).toContain("No wages, food, or upkeep yet.");
    const legacy = { ...mine({}), army: undefined } as unknown as BuildingsMine;
    const view = render(<InventoryEconomy data={{ mine: legacy, people, catalog }} goodLabels={catalog.goodLabels} />);
    expect(view.container.textContent).toContain("No wages, food, or upkeep yet.");
  });
});

describe("InventoryEconomy · the League's grants", () => {
  const grant = { title: "A Temple of Artemis at Massalia", perDay: 20, until: new Date(Date.now() + 86_400_000).toISOString(), throughLabel: "Summer, 299 BC" };

  it("lists a grant under the income with its through-date, folds it into the net, and drops the no-income line", () => {
    const { container } = render(<InventoryEconomy data={{ mine: { ...mine({}), leagueGrants: [grant] }, people, catalog }} goodLabels={catalog.goodLabels} />);
    const text = container.textContent!;
    expect(text).toContain("A Temple of Artemis at Massalia");
    expect(text).toContain("League grant · through Summer, 299 BC");
    expect(text).toContain("+20 dr");
    expect(text).not.toContain("No drachmae income yet");
    expect(container.querySelector(".econ-net")!.textContent).toContain("+20 dr");
  });

  it("a payload without the field renders as before", () => {
    const { container } = render(<InventoryEconomy data={{ mine: mine({}), people, catalog }} goodLabels={catalog.goodLabels} />);
    expect(container.textContent).toContain("No drachmae income yet");
    expect(container.textContent).not.toContain("League grant");
  });
});


// ---------------------------------------------------------------------------
// The supply plan (economy supply-plan prompt 1): the server's day of food and
// army upkeep, each line saying where it comes from in the ruling's words, its
// bought part priced and folded into Net / day, and the forward lines under it.
// ---------------------------------------------------------------------------

describe("InventoryEconomy · the supply plan", () => {
  const labels = { grain: "Wheat", oliveoil: "Olive Oil", wine: "Wine" };
  const line = (good: string, need: number, fromHarvest: number, fromStore: number, bought: number, price: number): SupplyLineView => ({ good, need, fromHarvest, fromStore, bought, price, cost: bought * price });
  const plan = (over: Partial<SupplyPlanView>): SupplyPlanView => ({ household: [], army: [], armyPay: 0, householdCost: 0, armyGoodsCost: 0, warnings: [], armyShort: null, training: null, ...over });
  const show = (supply: SupplyPlanView, army: Record<string, number> = {}) =>
    render(<InventoryEconomy data={{ mine: { ...mine(army), supply }, people, catalog }} goodLabels={labels} />).container;
  // A row's text from its name on (an emoji icon, when there is one, comes first).
  const rowText = (container: HTMLElement, name: string) => {
    const t = rows(container).find((r) => r?.includes(name));
    return t?.slice(t.indexOf(name));
  };

  it("one source reads plainly, the bought part is priced, and Net / day carries it", () => {
    const c = show(
      plan({
        household: [line("grain", 16, 16, 0, 0, 3)],
        army: [line("grain", 99, 0, 99, 0, 3), line("oliveoil", 99, 0, 0, 99, 5)],
        armyPay: 125,
        armyGoodsCost: 495,
      }),
      { grain: 99, oliveoil: 99, drachmae: 125 },
    );
    expect(rowText(c, "Wheat · household")).toBe("Wheat · household · 16/day · from your harvest0 dr");
    expect(rowText(c, "Army · wheat")).toBe("Army · wheat · 99/day · from your store0 dr");
    expect(rowText(c, "Army · olive oil")).toBe("Army · olive oil · 99/day · bought at 5 dr each−495 dr");
    expect(rowText(c, "Army pay")).toBe("Army pay−125 dr");
    expect(c.querySelector(".econ-net")!.textContent).toContain("−620 dr");
    // Food before the army, goods before pay; no unpriced "/day" amounts are left.
    const all = rows(c).join(" | ");
    expect(all.indexOf("Wheat · household")).toBeLessThan(all.indexOf("Army · wheat"));
    expect(all.indexOf("Army · olive oil")).toBeLessThan(all.indexOf("Army pay"));
    expect(c.textContent).not.toContain("−99/day");
  });

  it("several sources list each share, and a float's remainder is not a source", () => {
    const c = show(
      plan({
        household: [line("grain", 115, 35, 80, 0, 3)],
        army: [line("oliveoil", 99, 0, 40, 59, 5), line("wine", 4, 0, 4, 1e-12, 4)],
        householdCost: 0,
        armyGoodsCost: 295,
      }),
    );
    expect(rowText(c, "Wheat · household")).toBe("Wheat · household · 115/day · 35 from your harvest · 80 from your store0 dr");
    expect(rowText(c, "Army · olive oil")).toBe("Army · olive oil · 99/day · 40 from your store · 59 bought at 5 dr each−295 dr");
    expect(rowText(c, "Army · wine")).toBe("Army · wine · 4/day · from your store0 dr");
    expect(c.querySelector(".econ-net")!.textContent).toContain("−295 dr");
  });

  it("a household that buys its food carries the cost into the net", () => {
    const c = show(plan({ household: [line("grain", 16, 0, 0, 16, 3)], householdCost: 48 }));
    expect(rowText(c, "Wheat · household")).toBe("Wheat · household · 16/day · bought at 3 dr each−48 dr");
    expect(c.querySelector(".econ-net")!.textContent).toContain("−48 dr");
  });

  it("under the net: a store running out, a purse short of the army's day, and the men in training", () => {
    const c = show(
      plan({
        army: [line("grain", 99, 0, 99, 0, 3)],
        warnings: [
          { good: "grain", days: 4, costPerDay: 345 },
          { good: "oliveoil", days: 1, costPerDay: 495 },
        ],
        armyShort: { cost: 620 },
        training: {
          men: [
            { unitId: "peltast", label: "Peltast", plural: "Peltasts", count: 30 },
            { unitId: "ekdromos", label: "Ekdromos", plural: "Ekdromoi", count: 10 },
            { unitId: "hoplite", label: "Hoplite", plural: "Hoplites", count: 1 },
          ],
          addsPerDay: 372,
        },
      }),
    );
    const notes = [...c.querySelectorAll(".econ-net ~ p")].map((p) => p.textContent);
    expect(notes).toEqual([
      "Your wheat lasts 4 more days. Then it costs 345 dr a day at today's price.",
      "Your olive oil lasts 1 more day. Then it costs 495 dr a day at today's price.",
      "Your purse won't cover tomorrow's army upkeep (620 dr). Units will leave until it can, mercenaries first.",
      "When training ends: 30 peltasts, 10 ekdromoi and 1 hoplite add 372 dr a day at today's price.",
    ]);
  });

  it("one man in training adds; with nothing to say there are no lines under the net", () => {
    const one = show(plan({ training: { men: [{ unitId: "peltast", label: "Peltast", plural: "Peltasts", count: 1 }], addsPerDay: 8 } }));
    expect([...one.querySelectorAll(".econ-net ~ p")].map((p) => p.textContent)).toEqual(["When training ends: 1 peltast adds 8 dr a day at today's price."]);
    cleanup();
    const quiet = show(plan({}));
    expect(quiet.querySelectorAll(".econ-net ~ p")).toHaveLength(0);
    expect(quiet.textContent).toContain("No wages, food, or upkeep yet.");
  });
});
