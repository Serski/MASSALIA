// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type ChamberSeat, type ChamberView } from "../src/api.js";
import PoliticsPanel, { hemicycleLayout, hemicycleRows } from "../src/dashboard/panels/PoliticsPanel.js";

// ---------------------------------------------------------------------------
// The Oligarchy chamber (politics prompt 1): the row split, the bench layout,
// and the council tab mounted against a mocked chamber: tabs, header, seat
// fills and rings, the focus label on hover, tap and leave, the party tiles.
// The agenda and offices calls never settle, so those sections stay loading.
// ---------------------------------------------------------------------------

const YOU = 112;
const PLAYERS: { index: number; party: "palaioi" | "dynatoi" | "independent" }[] = [
  { index: 110, party: "palaioi" },
  { index: 111, party: "dynatoi" },
  { index: YOU, party: "dynatoi" },
  { index: 113, party: "independent" },
  { index: 114, party: "palaioi" },
  { index: 115, party: "dynatoi" },
  { index: 116, party: "palaioi" },
  { index: 117, party: "dynatoi" },
];

function seats(): ChamberSeat[] {
  const out: ChamberSeat[] = [];
  for (let i = 0; i < 300; i++) {
    const npcParty = i < 50 ? "palaioi" : i < 100 ? "dynatoi" : i < 110 ? "independent" : null;
    const player = PLAYERS.find((p) => p.index === i);
    if (npcParty) out.push({ seatIndex: i, holderType: "npc", party: npcParty, holderName: null, characterId: null });
    else if (player) out.push({ seatIndex: i, holderType: "player", party: player.party, holderName: `Citizen ${i}`, characterId: `char-${i}` });
    else out.push({ seatIndex: i, holderType: "empty", party: null, holderName: null, characterId: null });
  }
  return out;
}

function chamber(holdsSeat: boolean): ChamberView {
  return {
    capacity: 300,
    seatPrice: 200,
    seats: seats(),
    composition: { npc: { palaioi: 50, dynatoi: 50, independent: 10 }, players: { palaioi: 3, dynatoi: 4, independent: 1 }, playersTotal: 8, empty: 182 },
    you: holdsSeat ? { holdsSeat: true, seatIndex: YOU, canBuy: false, reason: null } : { holdsSeat: false, seatIndex: null, canBuy: true, reason: null },
  };
}

const player = (party: "Dynatoi" | "Unaligned") =>
  ({ party, professionSlug: "trader", censured: false, censureExpiresAt: null, house: { name: "Herakleides" } }) as unknown as Parameters<typeof PoliticsPanel>[0]["player"];

const never = () => new Promise<never>(() => {});
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const EMOJI = /\p{Extended_Pictographic}/u;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function mount(view: ChamberView, party: "Dynatoi" | "Unaligned") {
  vi.spyOn(api, "oligarchyChamber").mockResolvedValue(view);
  vi.spyOn(api, "chamberVotes").mockResolvedValue({ open: null, past: [] } as unknown as Awaited<ReturnType<typeof api.chamberVotes>>);
  vi.spyOn(api, "agenda").mockImplementation(never);
  vi.spyOn(api, "offices").mockImplementation(never);
  vi.spyOn(api, "elections").mockImplementation(never);
  const utils = render(<PoliticsPanel player={player(party)} onRefresh={() => {}} />);
  await flush();
  return utils;
}

const text = (c: HTMLElement, sel: string) => c.querySelector(sel)?.textContent ?? "";
const focusLabel = (c: HTMLElement) => [".chamber-focus-kicker", ".chamber-focus-number", ".chamber-focus-sub"].map((s) => text(c, s));

describe("chamber layout", () => {
  it("splits 300 seats 22/27/31/35/40/44/48/53 and any count exactly", () => {
    expect(hemicycleRows(300)).toEqual([22, 27, 31, 35, 40, 44, 48, 53]);
    for (const n of [1, 7, 120, 301]) expect(hemicycleRows(n).reduce((a, b) => a + b, 0)).toBe(n);
  });

  it("places every seat once, NPC Palaioi leftmost and NPC Dynatoi rightmost", () => {
    const dots = hemicycleLayout(seats());
    expect(new Set(dots.map((d) => d.seat.seatIndex)).size).toBe(300);
    expect(dots.slice(0, 50).every((d) => d.seat.holderType === "npc" && d.seat.party === "palaioi")).toBe(true);
    expect(dots.slice(-50).every((d) => d.seat.holderType === "npc" && d.seat.party === "dynatoi")).toBe(true);
  });
});

describe("council tab", () => {
  it("renders the pottery tabs, the chamber and the tiles for a seated Dynatoi", async () => {
    const { container } = await mount(chamber(true), "Dynatoi");

    expect(container.querySelector(".cs-tabs.pottery")).not.toBeNull();
    expect(container.querySelectorAll(".cs-tab").length).toBe(4);
    expect(text(container, ".chamber-head-label")).toBe("Seats · 300 · 118 filled");
    expect(container.querySelectorAll(".meander").length).toBe(2);

    expect(container.querySelectorAll(".hemicycle .seat").length).toBe(300);
    expect(container.querySelectorAll(".seat-ring").length).toBe(8);
    expect(container.querySelectorAll(".seat-ring-you").length).toBe(1);
    const mine = container.querySelector(`[data-seat="${YOU}"]`)!;
    expect(mine.classList.contains("seat-dynatoi")).toBe(true);
    expect(mine.querySelector(".seat-ring-you")).not.toBeNull();

    expect(focusLabel(container)).toEqual(["Your seat", "112", "House Herakleides · Dynatoi"]);

    const tiles = container.querySelectorAll(".chamber-tile");
    expect(tiles.length).toBe(4);
    expect([...tiles].map((t) => t.querySelector(".chamber-tile-count")!.textContent)).toEqual(["53/300", "54/300", "11/300", "182/300"]);
    expect(text(container, ".chamber-tile.is-yours .chamber-tile-name")).toBe("Dynatoi");
    expect(text(container, ".chamber-ringed")).toContain("8 held by living dynasties");

    expect(EMOJI.test(text(container, ".cs-tabs"))).toBe(false);
    expect(EMOJI.test(text(container, ".pol-page"))).toBe(false);
  });

  it("hover, tap and leave move the focus label", async () => {
    const { container } = await mount(chamber(true), "Dynatoi");
    const svg = container.querySelector(".hemicycle")!;

    fireEvent.mouseEnter(container.querySelector('[data-seat="200"]')!);
    expect(focusLabel(container)).toEqual(["Seat", "200", "Empty · 200 dr."]);
    fireEvent.mouseLeave(svg);
    expect(text(container, ".chamber-focus-number")).toBe("112");

    fireEvent.click(container.querySelector('[data-seat="3"]')!);
    expect(focusLabel(container)).toEqual(["Seat", "3", "Palaioi bench"]);

    fireEvent.mouseEnter(container.querySelector('[data-seat="115"]')!);
    expect(focusLabel(container)).toEqual(["Seat", "115", "Citizen 115 · Dynatoi"]);
  });

  it("with no seat and no party the label shows the chamber's fill and no tile is yours", async () => {
    const { container } = await mount(chamber(false), "Unaligned");
    expect(focusLabel(container)).toEqual(["The Three Hundred", "118", "seats filled"]);
    expect(container.querySelector(".seat-ring-you")).toBeNull();
    expect(container.querySelector(".chamber-tile.is-yours")).toBeNull();
    expect(text(container, ".party-tab-lock")).toBe("· Unaligned");
  });
});
