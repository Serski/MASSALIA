// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type CityView } from "../src/api.js";
import { CitiesView, buildingsLine } from "../src/dashboard/panels/CitiesView.js";

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

async function mount() {
  vi.spyOn(api, "leagueCities").mockResolvedValue({ cities: CITIES });
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
