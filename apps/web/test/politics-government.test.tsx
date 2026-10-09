// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type AgendaScopeView, type AgendaView, type GovernmentView } from "../src/api.js";
import PoliticsPanel from "../src/dashboard/panels/PoliticsPanel.js";

// ---------------------------------------------------------------------------
// The Government tab (government prompt 1), mounted against mocked agenda and
// government calls as politics-chamber.test.tsx mounts the council: a citizen
// sees five tabs and the League treasury's amount alone; an Archon sees the
// Government tab second with their seat, the books and the docket, and a draft
// reloads the view; a Strategos sees the cards with neither control. The
// chamber, offices and elections calls never settle, so those sections stay
// loading.
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const player = () =>
  ({ party: "Dynatoi", professionSlug: "trader", censured: false, censureExpiresAt: null, house: { name: "Herakleides" }, koinonPending: 0 }) as unknown as Parameters<typeof PoliticsPanel>[0]["player"];

const never = () => new Promise<never>(() => {});
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const text = (c: HTMLElement, sel: string) => c.querySelector(sel)?.textContent ?? "";

const card = (id: string, title: string) => ({ id, title, description: `About ${title.toLowerCase()}.`, cost: 0, partyLean: "palaioi" });
const CARDS = [card("league-sea-wall", "The Sea Wall"), card("league-founders-shrine", "The Founders' Shrine"), card("league-grain-dole", "The Grain Dole")];
const BALANCE = 60_930;

function scope(scopeName: AgendaScopeView["scope"], over: Partial<AgendaScopeView> = {}): AgendaScopeView {
  return {
    scope: scopeName,
    phase: "drafting",
    gameYear: 0,
    cards: [],
    draftedCardId: null,
    vetoedCardId: null,
    treasury: { owner: scopeName, balance: scopeName === "league" ? BALANCE : 100, ledger: [] },
    youMayDraft: false,
    youMayVeto: false,
    ...over,
  };
}
// What GET /api/agenda sends everyone: the League's balance, no ledger, no cards while drafting.
const agendaView: AgendaView = { league: scope("league"), palaioi: scope("palaioi"), dynatoi: scope("dynatoi"), leaders: [] };

const LEDGER = [
  { delta: 910, label: "Taxes of the poleis", dateLabel: "Winter, 300 BC", createdAt: "2026-10-09T12:00:01.000Z" },
  { delta: 60_000, label: "Opening balance", dateLabel: "Winter, 300 BC", createdAt: "2026-10-09T12:00:00.000Z" },
];
const member = (seats: Extract<GovernmentView, { member: true }>["seats"], league: AgendaScopeView): GovernmentView => ({
  member: true,
  seats,
  treasury: { balance: BALANCE, taxPerSeason: 910, ledger: LEDGER },
  league,
});

async function mount(government: GovernmentView) {
  vi.spyOn(api, "oligarchyChamber").mockImplementation(never);
  vi.spyOn(api, "chamberVotes").mockImplementation(never);
  vi.spyOn(api, "offices").mockImplementation(never);
  vi.spyOn(api, "elections").mockImplementation(never);
  vi.spyOn(api, "agenda").mockResolvedValue(agendaView);
  const gov = vi.spyOn(api, "government").mockResolvedValue(government);
  const utils = render(<PoliticsPanel player={player()} onRefresh={() => {}} />);
  await flush();
  return { ...utils, gov };
}
const tabs = (c: HTMLElement) => [...c.querySelectorAll<HTMLButtonElement>(".cs-tab")].map((t) => t.textContent!.trim().split(" ")[0]);

describe("the Government tab", () => {
  it("a citizen sees five tabs, and the Council's league card shows the balance alone", async () => {
    const { container } = await mount({ member: false });
    expect(tabs(container)).toEqual(["Oligarchy", "Your", "Koinon", "Cities", "Diplomacy"]);

    const league = container.querySelector(".agenda-card .treasury-card")!;
    expect(league).not.toBeNull();
    expect(text(league as HTMLElement, ".dashboard-label")).toBe("League treasury");
    expect(text(league as HTMLElement, ".treasury-balance")).toBe(`${BALANCE.toLocaleString()} drachmae`);
    expect(league.querySelector(".treasury-ledger")).toBeNull();
    expect(league.textContent).not.toContain("The books are empty.");
  });

  it("an Archon sees the Government tab second; it shows the seat, the books, the docket, and a draft reloads it", async () => {
    const draft = vi.spyOn(api, "draftAgenda").mockResolvedValue({ ok: true });
    const { container, gov } = await mount(member([{ office: "archon", side: "palaioi" }], scope("league", { cards: CARDS, youMayDraft: true })));
    expect(tabs(container)).toEqual(["Oligarchy", "Government", "Your", "Koinon", "Cities", "Diplomacy"]);
    expect(gov).toHaveBeenCalledTimes(1);

    const tab = container.querySelectorAll<HTMLButtonElement>(".cs-tab")[1]!;
    expect(tab.textContent).toBe("Government");
    fireEvent.click(tab);
    expect(tab.getAttribute("aria-selected")).toBe("true");

    expect(text(container, ".government-seat-line")).toBe("You sit as Archon (Palaioi).");
    const treasury = container.querySelector(".government-treasury")!;
    expect(text(treasury as HTMLElement, ".dashboard-label")).toBe("League treasury");
    expect(text(treasury as HTMLElement, ".treasury-balance")).toBe(`${BALANCE.toLocaleString()} drachmae`);
    expect(text(treasury as HTMLElement, ".government-tax-line")).toBe("The poleis pay 910 drachmae a season.");
    const rows = [...treasury.querySelectorAll(".treasury-ledger li")].map((li) => li.textContent);
    expect(rows).toEqual([`+910 Taxes of the poleis · Winter, 300 BC`, `+${(60_000).toLocaleString()} Opening balance · Winter, 300 BC`]);

    // The docket, without a second treasury card under it.
    const docket = container.querySelector(".agenda-card")!;
    expect([...docket.querySelectorAll(".agenda-choice .dashboard-label")].map((l) => l.textContent)).toEqual(CARDS.map((c) => c.title));
    expect(docket.querySelector(".treasury-card")).toBeNull();
    const buttons = [...docket.querySelectorAll<HTMLButtonElement>(".event-choice-button")];
    expect(buttons).toHaveLength(3);
    expect(buttons[0]!.textContent).toBe("Put forward");

    fireEvent.click(buttons[0]!);
    await flush();
    expect(draft).toHaveBeenCalledWith("league", "league-sea-wall");
    expect(gov).toHaveBeenCalledTimes(2);
  });

  it("a Strategos sees the cards with no Put forward and no veto", async () => {
    const { container } = await mount(member([{ office: "strategos", side: null }], scope("league", { cards: CARDS, draftedCardId: "league-sea-wall" })));
    fireEvent.click(container.querySelectorAll<HTMLButtonElement>(".cs-tab")[1]!);
    expect(text(container, ".government-seat-line")).toBe("You sit as Strategos.");
    expect(container.querySelectorAll(".agenda-choice")).toHaveLength(3);
    expect(container.querySelector(".event-choice-button")).toBeNull();
    expect(container.querySelector(".agenda-veto-btn")).toBeNull();
  });
});
