// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type BuildingsCatalog, type BuildingsMine, type CatalogTier, type OwnedBuilding } from "../src/api.js";
import LedgerPanel from "../src/dashboard/panels/LedgerPanel.js";

// ---------------------------------------------------------------------------
// The Ledger mounted against a mocked API with two buildings under construction:
// the class building mid-upgrade (the ladder) and a fresh Poultry Yard (the owned
// row). Each shows the build bar with its label and a live clock on the server
// anchor. No hook-order warning across the renders.
// ---------------------------------------------------------------------------

const H = 3_600_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

const tier = (n: number, over: Partial<CatalogTier> = {}): CatalogTier => ({ tier: n, name: `Estate ${n}`, cost: 25 * n, buildDays: n, upkeep: 0, income: 6, yields: [{ good: "grain", perDay: 6 }], materials: {}, staffing: { slave: 2 }, ...over });
const catalog = {
  season: "Spring",
  seasonMultiplier: { agricultural: 1, yearround: 1 },
  classBuilding: { id: "estate", kind: "class", name: "Estate", category: "agricultural", tiers: [tier(1), tier(2), tier(3), tier(4)] },
  commons: [{ id: "poultry-yard", kind: "common", name: "Poultry Yard", icon: "🐔", category: "yearround", tiers: [tier(1, { name: undefined, cost: 30, income: 0, yields: [{ good: "chicken", perDay: 6 }], staffing: { slave: 1 } })] }],
  classSectionLabel: null,
  vendor: [],
  goodLabels: { grain: "Wheat", chicken: "Chicken" },
  craft: {},
} as unknown as BuildingsCatalog;

const owned = (over: Partial<OwnedBuilding> & { id: string }): OwnedBuilding => ({
  kind: "common", name: over.id, tier: 1, status: "constructing", startedAt: iso(-H), completesAt: iso(H), category: "yearround",
  yields: [], income: 0, pendingIncome: 0, upkeepPerDay: 0, idle: false, upgrade: null, ...over,
});
const mine = (): BuildingsMine => ({
  now: iso(0),
  season: "Spring",
  buildings: [owned({ id: "estate", kind: "class", name: "Estate 2", tier: 2, category: "agricultural" }), owned({ id: "poultry-yard", name: "Poultry Yard", icon: "🐔" })],
  pendingIncomeTotal: 0,
  upkeepOwed: 0,
  pendingGoods: {},
  storageCap: 100,
  classSection: { label: null, comingSoon: false, entries: [] },
  pops: { slave: 3 },
  army: { perDay: {} },
});

const player = { profession: { name: "Landowner", tiers: [] }, professionSlug: "landowner", drachmae: 100, balances: {} } as never;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the Ledger's build bar", () => {
  it("the ladder shows the upgrade and the yard the fresh build, each with a live clock", async () => {
    const hookWarnings: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      const text = args.map(String).join(" ");
      if (/order of Hooks|Rendered more hooks|Rendered fewer hooks/.test(text)) hookWarnings.push(text);
    });
    vi.spyOn(api, "buildingsCatalog").mockResolvedValue(catalog);
    const mineSpy = vi.spyOn(api, "buildingsMine").mockResolvedValue(mine());

    const { container } = render(<LedgerPanel player={player} onRefresh={() => {}} />);
    await waitFor(() => expect(container.querySelectorAll(".build-progress")).toHaveLength(2));

    const ladder = container.querySelector(".tier-ladder .build-progress")!;
    const yard = container.querySelector(".panel-row .build-progress")!;
    expect(ladder.querySelector(".build-progress-head span")?.textContent).toBe("Upgrading to Tier 2");
    expect(yard.querySelector(".build-progress-head span")?.textContent).toBe("Under construction");
    for (const block of [ladder, yard]) {
      // The countdown rounds up, so an hour out reads 01:00:00 for its first second.
      expect(block.querySelector(".build-clock")?.textContent).toMatch(/^(01:00:00|00:59:5\d)$/);
      expect(block.querySelector(".barracks-bar-fill")?.getAttribute("style")).toContain("width: 50%");
    }
    // An hour out: the one-shot completion refetch has not fired, and nothing polls.
    expect(mineSpy).toHaveBeenCalledTimes(1);
    expect(hookWarnings).toEqual([]);
  });
});
