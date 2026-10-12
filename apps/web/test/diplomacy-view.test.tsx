// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type FactionView } from "../src/api.js";
import { DiplomacyView } from "../src/dashboard/panels/DiplomacyView.js";

// ---------------------------------------------------------------------------
// The Diplomacy tab's War badge (government prompt 4): a nation the League is
// at war with shows the season its war runs through; a server that sends no
// label shows the badge alone; a nation at peace shows none.
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

const faction = (id: string, name: string, over: Partial<FactionView> = {}): FactionView => ({
  id,
  name,
  group: "gauls",
  blurb: `About the ${name}.`,
  opinion: -45,
  band: "unfriendly",
  bandLabel: "Unfriendly",
  bandValue: -1,
  atWar: false,
  allied: false,
  vassal: false,
  governance: "institutional",
  institutionLabel: "A council of elders",
  rivals: [],
  allies: [],
  ...over,
});

async function mount(factions: FactionView[]) {
  vi.spyOn(api, "diplomacy").mockResolvedValue({ factions });
  const utils = render(<DiplomacyView />);
  await flush();
  return utils;
}

// The War badge of each listed nation, by name; null where a row has none.
const warBadges = (c: HTMLElement) =>
  Object.fromEntries([...c.querySelectorAll<HTMLElement>("button.atlas-row")].map((row) => [row.querySelector("span span span")!.textContent, row.querySelector('[title="At war with Massalia"]')?.textContent ?? null]));

describe("the Diplomacy tab's War badge", () => {
  it("a nation at war shows the season its war runs through; without the label, the badge alone; at peace, none", async () => {
    const { container } = await mount([
      faction("volcae", "Volcae", { atWar: true, opinion: -200, band: "hostile", bandLabel: "Hostile", bandValue: -2, warThroughLabel: "Summer, 291 BC" }),
      faction("cadurci", "Cadurci", { atWar: true, opinion: -200, band: "hostile", bandLabel: "Hostile", bandValue: -2 }),
      faction("allobroges", "Allobroges", { atWar: true, opinion: -200, band: "hostile", bandLabel: "Hostile", bandValue: -2, warThroughLabel: null }),
      faction("ruteni", "Ruteni"),
    ]);
    expect(warBadges(container)).toEqual({
      Volcae: "⚔ War through Summer, 291 BC",
      Cadurci: "⚔ War",
      Allobroges: "⚔ War",
      Ruteni: null,
    });
  });
});
