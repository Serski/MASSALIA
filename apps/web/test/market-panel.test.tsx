// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type BuildingsCatalog, type BuildingsMine, type MarketListing, type MarketView, type PeopleView, type PlayerState } from "../src/api.js";
import MarketPanel from "../src/dashboard/panels/MarketPanel.js";

// ---------------------------------------------------------------------------
// The Market panel's Player market tab (market prompt 1) mounted against a mocked
// API: the Sell form offers only goods held in whole units and clamps its stepper
// to the floored holding; at ten stalls List is disabled with the reason; another
// player's stall buys N clamped to what remains and to the wallet; the viewer's
// own stall shows Cancel and no Buy; a mocked buy re-renders with the new
// remaining. No hook-order warning across every render.
// ---------------------------------------------------------------------------

const catalog = {
  season: "Spring",
  seasonMultiplier: { agricultural: 1, yearround: 1 },
  classBuilding: null,
  commons: [],
  classSectionLabel: null,
  vendor: [
    { good: "wine", buy: 14, sell: 8 },
    { good: "grain", buy: 4, sell: 2 },
    { good: "iron", buy: 20, sell: 12 },
    { good: "galley", buy: 900, sell: 600 },
  ],
  goodLabels: { grain: "Wheat", galley: "Trireme" },
  craft: { galley: {} },
} as unknown as BuildingsCatalog;
const mine = { pops: {} } as unknown as BuildingsMine;
const people = { pops: [], foodGood: "grain", spymaster: { posture: "guard", cooldownRemainingMs: 0 } } as unknown as PeopleView;
const state = (drachmae: number) => ({ resources: { drachmae, balances: { wine: 7.8, grain: 3, iron: 0.5 } } }) as unknown as PlayerState;

const seller = (name: string, houseSlug: string) => ({ playerId: `p-${name}`, name, houseSlug, houseName: houseSlug[0]!.toUpperCase() + houseSlug.slice(1), professionSlug: null, faceId: null, portrait: null });
const stall = (over: Partial<MarketListing> & { id: string }): MarketListing => ({
  good: "wine", remaining: 5, price: 30, createdAt: new Date(0).toISOString(), mine: false, seller: seller("Kallias", "xanthippos"), ...over,
});
const wineStall = stall({ id: "wine-kallias" }); // 5 at 30dr: the wallet (100) covers 3
const grainStall = stall({ id: "grain-deon", good: "grain", remaining: 2, price: 10, seller: seller("Deon", "timon") }); // remaining binds
const dearStall = stall({ id: "galley-deon", good: "galley", remaining: 1, price: 200, seller: seller("Deon", "timon") }); // unaffordable
const ownStall = stall({ id: "wine-mine", remaining: 4, price: 12, mine: true, seller: seller("Nikias", "iason") });

const view = (over: Partial<MarketView> = {}): MarketView => ({ listings: [wineStall, ownStall, grainStall, dearStall], open: 1, cap: 10, taxExempt: false, ...over });

let hookWarnings: string[] = [];
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const buttons = (el: Element) => [...el.querySelectorAll("button")];
const rowOf = (c: HTMLElement, id: string) => c.querySelector(`[data-listing="${id}"]`) as HTMLElement;

async function mount(market: MarketView, wallet = 100) {
  hookWarnings = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    const text = args.map(String).join(" ");
    if (/order of Hooks|Rendered more hooks|Rendered fewer hooks/.test(text)) hookWarnings.push(text);
  });
  vi.spyOn(api, "buildingsCatalog").mockResolvedValue(catalog);
  vi.spyOn(api, "buildingsMine").mockResolvedValue(mine);
  vi.spyOn(api, "people").mockResolvedValue(people);
  vi.spyOn(api, "state").mockResolvedValue(state(wallet));
  const marketSpy = vi.spyOn(api, "market").mockResolvedValue(market);
  const utils = render(<MarketPanel player={{} as never} onRefresh={() => {}} />);
  await flush();
  fireEvent.click(utils.getByRole("tab", { name: "Player market" }));
  await flush();
  return { ...utils, marketSpy };
}

describe("MarketPanel · Player market", () => {
  it("shows the copy line; the Sell select offers only held goods and the stepper clamps to the floored holding", async () => {
    const { container } = await mount(view());
    expect(container.textContent).toContain("Citizens sell to citizens here, at their own price. The city takes one drachma in ten from every sale; Traders pay nothing.");
    const sell = container.querySelector('[data-testid="market-sell"]') as HTMLElement;
    expect(within(sell).getByTestId("market-stalls").textContent).toBe("Your stalls: 1 of 10");

    const picker = within(sell).getByRole("button", { name: "good to list" });
    expect(picker.getAttribute("aria-haspopup")).toBe("listbox");
    expect(picker.getAttribute("aria-expanded")).toBe("false");
    expect(picker.querySelector(".choice-picker-text")!.textContent).toBe("Wheat · own 3"); // the first held good
    fireEvent.click(picker);
    expect(picker.getAttribute("aria-expanded")).toBe("true");
    // Wine 7.8 → 7, Wheat 3; iron (0.5) and the trireme (none) are not offered.
    const options = within(within(sell).getByRole("listbox")).getAllByRole("option");
    expect(options.map((o) => o.querySelector(".choice-picker-text")!.textContent)).toEqual(["Wheat · own 3", "Wine · own 7"]);
    expect(options.map((o) => o.getAttribute("aria-selected"))).toEqual(["true", "false"]);

    fireEvent.click(options[1]!);
    expect(within(sell).queryByRole("listbox")).toBeNull();
    expect(picker.getAttribute("aria-expanded")).toBe("false");
    expect(picker.querySelector(".choice-picker-text")!.textContent).toBe("Wine · own 7");
    expect(sell.textContent).toContain("The agora pays 8dr · charges 14dr");
    const plus = within(sell).getByLabelText("increase quantity");
    for (let i = 0; i < 10; i++) fireEvent.click(plus);
    expect((within(sell).getByLabelText("quantity") as HTMLInputElement).value).toBe("7");
    fireEvent.change(within(sell).getByLabelText("price per unit"), { target: { value: "9" } });
    const list = buttons(sell).find((b) => b.textContent?.startsWith("List"))!;
    expect(list.textContent).toBe("List 7 · 9dr each");
    expect(list.disabled).toBe(false);

    fireEvent.click(picker);
    fireEvent.click(within(within(sell).getByRole("listbox")).getAllByRole("option")[0]!);
    expect(within(sell).queryByRole("listbox")).toBeNull();
    expect(buttons(sell).find((b) => b.textContent?.startsWith("List"))!.textContent).toBe("List 3 · 9dr each");
    expect(hookWarnings).toEqual([]);
  });

  it("the good picker by keyboard: ArrowDown opens, arrows move the highlight, Enter selects; Escape, Tab and a click outside close", async () => {
    const { container } = await mount(view());
    const sell = container.querySelector('[data-testid="market-sell"]') as HTMLElement;
    const picker = within(sell).getByRole("button", { name: "good to list" });
    const highlighted = () => sell.querySelector(".choice-picker-option.highlighted")?.querySelector(".choice-picker-text")?.textContent;

    fireEvent.keyDown(picker, { key: "ArrowDown" });
    expect(picker.getAttribute("aria-expanded")).toBe("true");
    expect(highlighted()).toBe("Wheat · own 3"); // opens on the current choice
    fireEvent.keyDown(picker, { key: "ArrowDown" });
    expect(highlighted()).toBe("Wine · own 7");
    fireEvent.keyDown(picker, { key: "ArrowDown" }); // stays on the last
    expect(highlighted()).toBe("Wine · own 7");
    expect(picker.getAttribute("aria-activedescendant")).toBe(sell.querySelector(".choice-picker-option.highlighted")!.id);
    fireEvent.keyDown(picker, { key: "Enter" });
    expect(within(sell).queryByRole("listbox")).toBeNull();
    expect(picker.querySelector(".choice-picker-text")!.textContent).toBe("Wine · own 7");
    expect(sell.textContent).toContain("The agora pays 8dr · charges 14dr");

    fireEvent.keyDown(picker, { key: " " });
    fireEvent.keyDown(picker, { key: "ArrowUp" });
    expect(highlighted()).toBe("Wheat · own 3");
    fireEvent.keyDown(picker, { key: "Escape" });
    expect(within(sell).queryByRole("listbox")).toBeNull();
    expect(picker.querySelector(".choice-picker-text")!.textContent).toBe("Wine · own 7"); // Escape selects nothing

    fireEvent.keyDown(picker, { key: "Enter" });
    expect(within(sell).queryByRole("listbox")).not.toBeNull();
    fireEvent.keyDown(picker, { key: "Tab" });
    expect(within(sell).queryByRole("listbox")).toBeNull();

    fireEvent.click(picker);
    expect(within(sell).queryByRole("listbox")).not.toBeNull();
    fireEvent.mouseDown(container.querySelector('[data-testid="market-stalls-list"]')!);
    expect(within(sell).queryByRole("listbox")).toBeNull();
    expect(hookWarnings).toEqual([]);
  });

  it("at ten open stalls List is disabled with the reason", async () => {
    const { container } = await mount(view({ open: 10 }));
    const sell = container.querySelector('[data-testid="market-sell"]') as HTMLElement;
    expect(within(sell).getByTestId("market-stalls").textContent).toBe("Your stalls: 10 of 10");
    expect(buttons(sell).find((b) => b.textContent?.startsWith("List"))!.disabled).toBe(true);
    expect(sell.textContent).toContain("Ten stalls is the most one house may keep.");
    expect(hookWarnings).toEqual([]);
  });

  it("another player's stall: Buy with the stepper clamped to the wallet and to what remains; the seller, their house and the groups", async () => {
    const { container } = await mount(view());
    const stalls = container.querySelector('[data-testid="market-stalls-list"]') as HTMLElement;
    expect([...stalls.querySelectorAll(".panel-label")].map((l) => l.textContent)).toEqual(["Goods", "Naval & ships"]);

    const wine = rowOf(container, "wine-kallias");
    expect(wine.textContent).toContain("Wine · 5 at 30dr");
    expect(wine.textContent).toContain("Kallias of House Xanthippos");
    expect(wine.querySelector(".lobby-portrait")).not.toBeNull();
    expect(wine.textContent).not.toContain("Cancel");
    const winePlus = within(wine).getByLabelText("increase quantity");
    for (let i = 0; i < 6; i++) fireEvent.click(winePlus);
    expect((within(wine).getByLabelText("quantity") as HTMLInputElement).value).toBe("3"); // floor(100 / 30)
    expect(buttons(wine).find((b) => b.textContent?.startsWith("Buy"))!.textContent).toBe("Buy 3 · 90dr");

    const grain = rowOf(container, "grain-deon");
    const grainPlus = within(grain).getByLabelText("increase quantity");
    for (let i = 0; i < 6; i++) fireEvent.click(grainPlus);
    expect((within(grain).getByLabelText("quantity") as HTMLInputElement).value).toBe("2"); // remaining binds
    expect(buttons(grain).find((b) => b.textContent?.startsWith("Buy"))!.textContent).toBe("Buy 2 · 20dr");

    const dear = rowOf(container, "galley-deon");
    expect(dear.textContent).toContain("Trireme · 1 at 200dr");
    expect(buttons(dear).find((b) => b.textContent?.startsWith("Buy"))!.disabled).toBe(true);
    expect(hookWarnings).toEqual([]);
  });

  it("the player's own stall shows the tag and Cancel, and no Buy", async () => {
    const { container } = await mount(view());
    const own = rowOf(container, "wine-mine");
    expect(own.textContent).toContain("Your stall");
    expect(buttons(own).map((b) => b.textContent)).toEqual(["Cancel"]);
    expect(own.querySelector(".qty-stepper")).toBeNull();
    expect(hookWarnings).toEqual([]);
  });

  it("a mocked buy re-renders the stall with the new remaining and notes the purchase", async () => {
    const { container, marketSpy } = await mount(view());
    const buy = vi.spyOn(api, "marketBuy").mockResolvedValue({ ok: true, qty: 2, total: 60, tax: 6, wallet: 40, balance: 2, remaining: 3 });
    marketSpy.mockResolvedValue(view({ listings: [stall({ id: "wine-kallias", remaining: 3 }), ownStall, grainStall, dearStall] }));
    vi.spyOn(api, "state").mockResolvedValue(state(40));

    const wine = rowOf(container, "wine-kallias");
    fireEvent.click(within(wine).getByLabelText("increase quantity"));
    fireEvent.click(buttons(wine).find((b) => b.textContent === "Buy 2 · 60dr")!);
    await flush();

    expect(buy).toHaveBeenCalledWith("wine-kallias", 2);
    const after = rowOf(container, "wine-kallias");
    expect(after.textContent).toContain("Wine · 3 at 30dr");
    // The wallet is now 40: one unit at 30dr is all it covers.
    expect(buttons(after).find((b) => b.textContent?.startsWith("Buy"))!.textContent).toBe("Buy 1 · 30dr");
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Bought 2 Wine for 60dr.");
    expect(hookWarnings).toEqual([]);
  });

  it("with no stalls the list reads No stalls yet.", async () => {
    const { container } = await mount(view({ listings: [], open: 0 }));
    expect((container.querySelector('[data-testid="market-stalls-list"]') as HTMLElement).textContent).toContain("No stalls yet.");
    expect(hookWarnings).toEqual([]);
  });
});
