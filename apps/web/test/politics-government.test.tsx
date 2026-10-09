// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type AgendaScopeView, type AgendaView, type GovernmentProjectView, type GovernmentView } from "../src/api.js";
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
const PROJECTS: GovernmentProjectView[] = [
  { cityId: "nikaia", polis: "Nikaia", buildingId: "walls", title: "The Walls of Nikaia", status: "building", completesAt: "2026-10-17T00:00:00.000Z", completesLabel: "Summer, 292 BC" },
  { cityId: "olbia", polis: "Olbia", buildingId: "port", title: "The Port of Olbia", status: "built", completesAt: "2026-10-01T00:00:00.000Z", completesLabel: "Autumn, 299 BC" },
];
// `projects: null` leaves the field out, as an old server would.
const member = (seats: Extract<GovernmentView, { member: true }>["seats"], league: AgendaScopeView, projects: GovernmentProjectView[] | null = PROJECTS): GovernmentView => ({
  member: true,
  seats,
  treasury: { balance: BALANCE, taxPerSeason: 910, ledger: LEDGER },
  ...(projects ? { projects } : {}),
  league,
});
// A docket of building projects (government prompt 2a): two poleis, in docket order.
const project = (cityId: string, polis: string, buildingId: string, title: string, cost: number, seasons: number) => ({
  id: `project:${cityId}:${buildingId}`,
  title,
  description: `About ${title.toLowerCase()}.`,
  cost,
  partyLean: "palaioi",
  group: polis,
  seasons,
});
const DOCKET = [
  project("massalia", "Massalia", "temple", "A Temple of Artemis at Massalia", 1000, 4),
  project("massalia", "Massalia", "walls", "The Walls of Massalia", 2000, 8),
  project("nikaia", "Nikaia", "port", "The Port of Nikaia", 2000, 8),
];

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

  it("a docket of projects shows each polis's name above its cards, with the build time and the cost with its separator", async () => {
    const { container } = await mount(member([{ office: "archon", side: "palaioi" }], scope("league", { cards: DOCKET, youMayDraft: true })));
    fireEvent.click(container.querySelectorAll<HTMLButtonElement>(".cs-tab")[1]!);
    const docket = container.querySelector(".agenda-card")!;
    expect([...docket.querySelectorAll(".agenda-group-label")].map((l) => l.textContent)).toEqual(["Massalia", "Nikaia"]);
    const groups = [...docket.querySelectorAll(".agenda-group")];
    expect(groups.map((g) => g.querySelectorAll(".agenda-choice").length)).toEqual([2, 1]);
    expect([...docket.querySelectorAll(".agenda-choice .dashboard-label")].map((l) => l.textContent)).toEqual(DOCKET.map((p) => p.title));
    expect([...docket.querySelectorAll(".agenda-seasons")].map((c) => c.textContent)).toEqual(["4 seasons", "8 seasons", "8 seasons"]);
    expect([...docket.querySelectorAll(".cost-negative")].map((c) => c.textContent)).toEqual([`${(1000).toLocaleString()} dr.`, `${(2000).toLocaleString()} dr.`, `${(2000).toLocaleString()} dr.`]);
    expect(docket.querySelectorAll(".event-choice-button")).toHaveLength(3);
  });

  it("the Projects card lists the ones under way and the ones built", async () => {
    const { container } = await mount(member([{ office: "ephor", side: "dynatoi" }], scope("league", { cards: DOCKET })));
    fireEvent.click(container.querySelectorAll<HTMLButtonElement>(".cs-tab")[1]!);
    const card = container.querySelector(".government-projects")!;
    expect(text(card as HTMLElement, ".dashboard-label")).toBe("Projects");
    expect([...card.querySelectorAll(".government-projects-head")].map((h) => h.textContent)).toEqual(["Under way", "Built"]);
    expect([...card.querySelectorAll(".government-projects-building li")].map((li) => li.textContent)).toEqual(["The Walls of Nikaia · stands Summer, 292 BC"]);
    expect([...card.querySelectorAll(".government-projects-built li")].map((li) => li.textContent)).toEqual(["The Port of Olbia"]);
    expect(card.textContent).not.toContain("No project yet.");
  });

  it("a member view without projects still renders, with no project yet", async () => {
    const { container } = await mount(member([{ office: "strategos", side: null }], scope("league", { cards: CARDS }), null));
    fireEvent.click(container.querySelectorAll<HTMLButtonElement>(".cs-tab")[1]!);
    expect(text(container, ".government-seat-line")).toBe("You sit as Strategos.");
    const card = container.querySelector(".government-projects")!;
    expect(card.textContent).toContain("No project yet.");
    expect(card.querySelectorAll("li")).toHaveLength(0);
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
