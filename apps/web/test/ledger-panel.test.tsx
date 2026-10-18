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

// ---------------------------------------------------------------------------
// The shipbuilder's yard in the class-section slot: one slip per hull the yard
// holds (two at T4), a hull on the slip with its build bar and clock, an empty
// slip, and the ships with their gates (tier, a free slip, the recipe).
// ---------------------------------------------------------------------------

const yardTier = (n: number): CatalogTier => tier(n, { name: ["Boat Shed", "Slipway", "Small Shipyard", "Great Shipyard"][n - 1], yields: [{ good: "naval-supplies", perDay: n }], staffing: { freeman: 1 } });
const yardCatalog = {
  ...catalog,
  classBuilding: { id: "slipway", kind: "class", name: "Boat Shed", category: "yearround", tiers: [yardTier(1), yardTier(2), yardTier(3), yardTier(4)] },
  commons: [],
  classSectionLabel: "Commissions",
  goodLabels: { "naval-supplies": "Naval Supplies", timber: "Wood", leather: "Leather", iron: "Iron", "trade-ship": "Pentekonter", galley: "Trireme" },
  craft: {
    "trade-ship": { building: "slipway", tier: 3, buildHours: 24, recipe: { "naval-supplies": 2, timber: 5, leather: 1 } },
    galley: { building: "slipway", tier: 4, buildHours: 24, recipe: { "naval-supplies": 3, timber: 8, iron: 3 } },
  },
} as unknown as BuildingsCatalog;
const yardMine = (yard: NonNullable<BuildingsMine["shipyard"]>, idle = false): BuildingsMine => ({
  ...mine(),
  buildings: [owned({ id: "slipway", kind: "class", name: "Great Shipyard", tier: yard.tier, status: "active", startedAt: null, completesAt: null, idle })],
  classSection: { label: "Commissions", comingSoon: true, entries: [] },
  pops: { freeman: 3 },
  shipyard: yard,
});
const shipbuilder = { profession: { name: "Shipbuilder", tiers: [] }, professionSlug: "shipbuilder", drachmae: 500, balances: { "naval-supplies": 6, timber: 20, leather: 2, iron: 1 } } as never;
const craftButton = (row: Element | undefined) => row?.querySelector("button") as HTMLButtonElement | null;
const shipRow = (container: HTMLElement, title: string) => [...container.querySelectorAll(".panel-row")].find((r) => r.querySelector(".pr-t")?.textContent === title && r.querySelector("button"));

describe("the Ledger's shipyard", () => {
  it("a T4 yard shows two slips — a hull with its clock and an empty one — and gates each ship on its recipe", async () => {
    vi.spyOn(api, "buildingsCatalog").mockResolvedValue(yardCatalog);
    const mineSpy = vi.spyOn(api, "buildingsMine").mockResolvedValue(yardMine({ tier: 4, slots: 2, builds: [{ id: "b1", good: "galley", startedAt: iso(-12 * H), readyAt: iso(12 * H) }] }));
    const craft = vi.spyOn(api, "craftGood").mockResolvedValue({ ok: true, good: "trade-ship", consumed: {}, build: { id: "b2", good: "trade-ship", startedAt: iso(0), readyAt: iso(24 * H) } });

    const { container } = render(<LedgerPanel player={shipbuilder} onRefresh={() => {}} />);
    await waitFor(() => expect(container.querySelectorAll(".shipyard-slips .panel-row")).toHaveLength(2));

    const labels = [...container.querySelectorAll(".panel-label")].map((l) => l.textContent);
    expect(labels).toContain("Commissions");
    expect(labels).not.toContain("Shipwright's Craft");
    const [onSlip, empty] = [...container.querySelectorAll(".shipyard-slips .panel-row")];
    expect(onSlip!.querySelector(".pr-t")?.textContent).toBe("Trireme");
    expect(onSlip!.querySelector(".build-progress-head span")?.textContent).toBe("On the slip");
    expect(onSlip!.querySelector(".build-clock")?.textContent).toMatch(/^(12:00:00|11:59:5\d)$/);
    expect(onSlip!.querySelector(".barracks-bar-fill")?.getAttribute("style")).toContain("width: 50%");
    expect(empty!.querySelector(".pr-t")?.textContent).toBe("Empty slip");

    // The Pentekonter's recipe is in the stores; the Trireme is short of iron.
    const pentekonter = shipRow(container, "Pentekonter");
    const trireme = shipRow(container, "Trireme");
    expect(pentekonter?.querySelector(".pr-s")?.textContent).toBe("2 Naval Supplies · 5 Wood · 1 Leather · 24h on the slip · needs Tier 3 (Small Shipyard)");
    expect(trireme?.querySelector(".pr-s")?.textContent).toContain("short 2 Iron");
    expect(craftButton(trireme)?.disabled).toBe(true);
    expect(craftButton(pentekonter)?.disabled).toBe(false);
    craftButton(pentekonter)!.click();
    await waitFor(() => expect(craft).toHaveBeenCalledWith("trade-ship"));
    await waitFor(() => expect(container.querySelector('[role="status"]')?.textContent).toBe("A Pentekonter is on the slip — ready in 24h."));
    // Twelve hours out, the launch refetch has not fired: the one load and the one after the craft.
    expect(mineSpy).toHaveBeenCalledTimes(2);
  });

  it("a T3 yard with its one slip taken lays no second keel, and the Trireme waits for Tier 4", async () => {
    vi.spyOn(api, "buildingsCatalog").mockResolvedValue(yardCatalog);
    vi.spyOn(api, "buildingsMine").mockResolvedValue(yardMine({ tier: 3, slots: 1, builds: [{ id: "b1", good: "trade-ship", startedAt: iso(-H), readyAt: iso(23 * H) }] }));

    const { container } = render(<LedgerPanel player={shipbuilder} onRefresh={() => {}} />);
    await waitFor(() => expect(container.querySelectorAll(".shipyard-slips .panel-row")).toHaveLength(1));

    const pentekonter = shipRow(container, "Pentekonter");
    const trireme = shipRow(container, "Trireme");
    expect(pentekonter?.querySelector(".pr-s")?.textContent).toContain("· no free slip");
    expect(trireme?.querySelector(".pr-s")?.textContent).toContain("· yours works at Tier 3");
    expect(craftButton(pentekonter)?.disabled).toBe(true);
    expect(craftButton(trireme)?.disabled).toBe(true);
  });

  it("an idle yard greys out Craft and says why, while the hull on its slip keeps its clock", async () => {
    vi.spyOn(api, "buildingsCatalog").mockResolvedValue(yardCatalog);
    vi.spyOn(api, "buildingsMine").mockResolvedValue(yardMine({ tier: 4, slots: 2, builds: [{ id: "b1", good: "galley", startedAt: iso(-12 * H), readyAt: iso(12 * H) }] }, true));

    const { container } = render(<LedgerPanel player={shipbuilder} onRefresh={() => {}} />);
    await waitFor(() => expect(container.querySelectorAll(".shipyard-slips .panel-row")).toHaveLength(2));

    // The Pentekonter has its recipe and a free slip: only the idle yard holds it back.
    const pentekonter = shipRow(container, "Pentekonter");
    expect(craftButton(pentekonter)?.disabled).toBe(true);
    expect(pentekonter?.querySelector(".pr-s")?.textContent).toBe("2 Naval Supplies · 5 Wood · 1 Leather · 24h on the slip · needs Tier 3 (Small Shipyard)Your yard stands idle: staff it before you lay a keel.");
    expect(craftButton(shipRow(container, "Trireme"))?.disabled).toBe(true);
    const onSlip = container.querySelector(".shipyard-slips .panel-row")!;
    expect(onSlip.querySelector(".build-clock")?.textContent).toMatch(/^(12:00:00|11:59:5\d)$/);
  });

  it("a yard below Tier 3 has no slip yet", async () => {
    vi.spyOn(api, "buildingsCatalog").mockResolvedValue(yardCatalog);
    vi.spyOn(api, "buildingsMine").mockResolvedValue(yardMine({ tier: 2, slots: 0, builds: [] }));

    const { container } = render(<LedgerPanel player={shipbuilder} onRefresh={() => {}} />);
    await waitFor(() => expect(container.querySelectorAll(".shipyard-slips .panel-row")).toHaveLength(1));
    const row = container.querySelector(".shipyard-slips .panel-row")!;
    expect(row.querySelector(".pr-t")?.textContent).toBe("No slip yet");
    expect(row.querySelector(".pr-s")?.textContent).toBe("Your yard lays its first keel at Tier 3 (Small Shipyard).");
  });
});
