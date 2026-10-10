// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type CityView, type LeagueWorksView } from "../src/api.js";
import { CitiesView, buildingsLine, whereLabel } from "../src/dashboard/panels/CitiesView.js";

// ---------------------------------------------------------------------------
// The Cities tab (government prompt 2a): under each polis's row, one muted line
// with the League's buildings standing there and the ones under way with the
// date they stand. A polis without buildings shows no line, and a city sent by
// an old server, without the field, still renders.
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

const city = (id: string, name: string, group: CityView["group"], buildings?: CityView["buildings"]): CityView => ({
  id,
  name,
  group,
  population: 20_000,
  tax: 400,
  stability: 70,
  fortifications: 3,
  garrison: 500,
  ...(buildings ? { buildings } : {}),
});

const CITIES: CityView[] = [
  city("massalia", "Massalia", "metropolis", [
    { buildingId: "temple", name: "Temple of Artemis", status: "built", completesLabel: null },
    { buildingId: "walls", name: "Walls", status: "building", completesLabel: "Summer, 292 BC" },
    { buildingId: "port", name: "Port", status: "building", completesLabel: "Winter, 291 BC" },
  ]),
  city("nikaia", "Nikaia", "eastern", []),
  city("olbia", "Olbia", "eastern"),
];

async function mount(works?: LeagueWorksView) {
  vi.spyOn(api, "leagueCities").mockResolvedValue(works ? { cities: CITIES, works } : { cities: CITIES });
  const utils = render(<CitiesView />);
  await flush();
  return utils;
}

describe("the Cities tab's buildings", () => {
  it("buildingsLine names the standing ones, then each one under way with the date it stands", () => {
    expect(buildingsLine(CITIES[0]!.buildings)).toBe("Temple of Artemis · Walls (stands Summer, 292 BC) · Port (stands Winter, 291 BC)");
    expect(buildingsLine([])).toBe("");
    expect(buildingsLine(undefined)).toBe("");
  });

  it("a polis with buildings shows them on one line under its row; one without shows none; one without the field renders", async () => {
    const { container } = await mount();
    const rows = [...container.querySelectorAll(".atlas-row")];
    expect(rows.map((r) => r.querySelector("span")!.textContent)).toEqual(["Massalia", "Nikaia", "Olbia"]);
    const lines = [...container.querySelectorAll(".atlas-row-buildings")];
    expect(lines).toHaveLength(1);
    expect(lines[0]!.textContent).toBe("Temple of Artemis · Walls (stands Summer, 292 BC) · Port (stands Winter, 291 BC)");
    // The line sits right under Massalia's row.
    expect(rows[0]!.nextElementSibling).toBe(lines[0]);
    expect(rows[1]!.nextElementSibling).toBeNull();
    expect(container.textContent).toContain("Olbia");
  });
});

// The League's plans, in advance (government prompt 3b): three cards after the cities.
describe("the League's plans on the Cities tab", () => {
  const works = (over: Partial<LeagueWorksView> = {}): LeagueWorksView => ({
    buildings: [
      { id: "temple", name: "Temple of Artemis", cost: 1000, seasons: 4, populationAbove: 2000, partyLean: "palaioi", effects: ["Priests +20 dr a season for 4 seasons", "Every army +3 morale for 2 years", "The city +3 stability a year"] },
      { id: "walls", name: "Walls", cost: 2000, seasons: 8, populationAbove: null, partyLean: "palaioi", effects: ["The city's fortifications +1"] },
    ],
    projects: {
      opensAt: "2026-10-13T00:00:00.000Z", opensLabel: "Winter, 293 BC", drafting: false,
      items: [
        { id: "project:massalia:temple", cityId: "massalia", polis: "Massalia", buildingId: "temple", name: "Temple of Artemis" },
        { id: "project:massalia:walls", cityId: "massalia", polis: "Massalia", buildingId: "walls", name: "Walls" },
        { id: "project:nikaia:port", cityId: "nikaia", polis: "Nikaia", buildingId: "port", name: "Port" },
      ],
    },
    festivals: {
      opensAt: "2026-10-11T00:00:00.000Z", opensLabel: "Summer, 294 BC", drafting: false, year: 7, yearLabel: "293 BC",
      items: [{ id: "festival:dionysia:y7", name: "Dionysia", cost: 500, partyLean: "dynatoi", effects: ["Hetairai and Philosophers +10 dr a season for the year"] }],
    },
    ...over,
  });
  const texts = (c: HTMLElement, sel: string) => [...c.querySelectorAll(sel)].map((el) => el.textContent);

  it("whereLabel", () => {
    expect(whereLabel(2000)).toBe("Cities of more than 2,000 people");
    expect(whereLabel(null)).toBe("Any city");
  });

  it("shows the buildings, the building docket and the festival docket, in that order, with every line", async () => {
    const { container } = await mount(works());
    const cards = [...container.querySelectorAll<HTMLElement>(".works-buildings, .works-projects, .works-festivals")];
    expect(cards.map((c) => c.className.replace("dashboard-card ", ""))).toEqual(["works-buildings", "works-projects", "works-festivals"]);
    expect(texts(container, ".panel-label").slice(-3)).toEqual(["The League's buildings", "The building docket", "The festival docket"]);

    const b = cards[0]!;
    expect(texts(b, ".works-note")).toEqual(["One of each per city. Each Winter the Archons put one project to the chamber; it votes in Spring."]);
    expect(texts(b, ".works-item .dashboard-label")).toEqual(["Temple of Artemis", "Walls"]);
    expect(texts(b, ".works-facts")).toEqual(["1,000 dr · built in 4 seasons · Cities of more than 2,000 people · Palaioi lean", "2,000 dr · built in 8 seasons · Any city · Palaioi lean"]);
    expect(texts(b, ".agenda-effects")).toEqual(["When it stands: Priests +20 dr a season for 4 seasons · Every army +3 morale for 2 years · The city +3 stability a year", "When it stands: The city's fortifications +1"]);

    const p = cards[1]!;
    expect(texts(p, ".works-note")).toEqual(["Opens Winter, 293 BC. Shown as it would open today; city sizes change at each new year."]);
    expect(texts(p, ".works-row")).toEqual(["MassaliaTemple of Artemis · Walls", "NikaiaPort"]);

    const f = cards[2]!;
    expect(texts(f, ".works-note")).toEqual(["Opens Summer, 294 BC, for the year 293 BC. Shown as it would open today."]);
    expect(texts(f, ".works-item .dashboard-label")).toEqual(["Dionysia"]);
    expect(texts(f, ".works-facts")).toEqual(["500 dr · Dynatoi lean"]);
    expect(texts(f, ".agenda-effects")).toEqual(["If it passes: Hetairai and Philosophers +10 dr a season for the year"]);
  });

  it("while a docket is open its note says so", async () => {
    const w = works();
    const { container } = await mount({ ...w, projects: { ...w.projects, drafting: true }, festivals: { ...w.festivals, drafting: true } });
    expect(texts(container, ".works-projects .works-note")).toEqual(["Open now. The Archons choose one this season; the chamber votes next season."]);
    expect(texts(container, ".works-festivals .works-note")).toEqual(["Open now, for the year 293 BC. The Archons choose one this season; the chamber votes next season."]);
  });

  it("empty dockets say nothing can go on them today", async () => {
    const w = works();
    const { container } = await mount({ ...w, projects: { ...w.projects, items: [] }, festivals: { ...w.festivals, items: [] } });
    expect(texts(container, ".works-projects .works-note")).toEqual(["Opens Winter, 293 BC. Shown as it would open today; city sizes change at each new year.", "No project can go on it today."]);
    expect(texts(container, ".works-festivals .works-note")).toEqual(["Opens Summer, 294 BC, for the year 293 BC. Shown as it would open today.", "No festival can go on it today."]);
  });

  it("a payload without works shows none of the cards and the cities as before", async () => {
    const { container } = await mount();
    expect(container.querySelector(".works-buildings, .works-projects, .works-festivals")).toBeNull();
    expect([...container.querySelectorAll(".atlas-row")].map((r) => r.querySelector("span")!.textContent)).toEqual(["Massalia", "Nikaia", "Olbia"]);
  });
});

