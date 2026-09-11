// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { BuildingsCatalog, BuildingsMine, PeopleView } from "../src/api.js";
import { InventoryEconomy } from "../src/dashboard/sheets.js";

// ---------------------------------------------------------------------------
// The inventory's Economy view lists the army under Expenses from the mine
// payload's `army.perDay`: one line per good drawn a day and band pay in
// drachmae, folded into the net; nothing when the army eats nothing.
// ---------------------------------------------------------------------------

afterEach(cleanup);

const catalog = { season: "Spring", seasonMultiplier: { agricultural: 1, yearround: 1 }, classBuilding: null, commons: [], classSectionLabel: null, vendor: [], goodLabels: { grain: "Grain", oliveoil: "Olive oil" }, craft: {} } as unknown as BuildingsCatalog;
const people: PeopleView = { foodGood: "grain", pops: [], spymaster: { posture: "guard", cooldownRemainingMs: 0 } };
const mine = (army: Record<string, number>): BuildingsMine =>
  ({ season: "Spring", buildings: [], pendingIncomeTotal: 0, upkeepOwed: 0, pendingGoods: {}, storageCap: 100, classSection: { label: null, comingSoon: false, entries: [] }, pops: {}, army: { perDay: army } }) as unknown as BuildingsMine;

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
