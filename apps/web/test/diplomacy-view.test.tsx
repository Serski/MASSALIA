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

// Strikes prompt 1: a nation's march under the nation.
describe("a nation's strike on the Diplomacy page", () => {
  const marching = { status: "marching" as const, place: "Agathe", line: "The Volcae march on Agathe with about 470 men. They strike at 12:00 UTC.", dateLabel: "Autumn, 291 BC" };
  const ended = { status: "struck" as const, place: "Arelate", line: "The Cadurci struck at Arelate and were driven off. 30 of them fell, and 4 of the defenders.", dateLabel: "Summer, 291 BC" };
  it("a march on the road shows a badge in the list and its line in the nation's panel; how one ended shows dated in the panel alone; none without", async () => {
    const { container } = await mount([faction("volcae", "Volcae", { strike: marching }), faction("cadurci", "Cadurci", { strike: ended }), faction("ruteni", "Ruteni", { strike: null })]);
    const rows = [...container.querySelectorAll<HTMLButtonElement>("button.atlas-row")];
    const badge = (row: HTMLElement) => [...row.querySelectorAll("span")].find((x) => x.textContent?.startsWith("⚑"))?.textContent ?? null;
    expect(rows.map((r) => badge(r))).toEqual(["⚑ Marching on Agathe", null, null]);
    const open = async (i: number) => {
      await act(async () => {
        rows[i]!.click();
      });
      return container.querySelector<HTMLElement>(".diplomacy-strike");
    };
    expect((await open(0))!.textContent).toBe(marching.line);
    expect((await open(1))!.textContent).toBe(`${ended.line} · Summer, 291 BC`);
    expect(await open(2)).toBeNull();
  });
});
