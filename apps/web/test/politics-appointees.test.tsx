// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type OfficeAppointee, type OfficesView } from "../src/api.js";
import { GUIDE_SECTIONS } from "../src/dashboard/guideContent.js";
import PoliticsPanel from "../src/dashboard/panels/PoliticsPanel.js";

// ---------------------------------------------------------------------------
// Who may be Strategos (Strategoi prompt 1): the appointment picker lists the men
// the server sends, each with his party and his Militia, and the Guide's Politics
// entry says who the Strategoi are and how long they serve. Mounted against a
// mocked offices view with a vacant Strategos seat you may fill; the chamber,
// agenda, elections and government calls never settle.
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const player = () =>
  ({ party: "Palaioi", professionSlug: "trader", censured: false, censureExpiresAt: null, house: { name: "Herakleides" }, koinonPending: 0 }) as unknown as Parameters<typeof PoliticsPanel>[0]["player"];

const never = () => new Promise<never>(() => {});
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

const offices: OfficesView = {
  seats: [{ office: "strategos", side: null, seatSlot: 0, holder: null, acquiredVia: null, termEndsYear: null, youMayAppoint: true }],
  ledger: [],
  houseTallies: [],
};
const APPOINTEES: OfficeAppointee[] = [
  { characterId: "c-konrad", name: "Konrad", houseName: "Herakleides", party: "palaioi", militia: 84 },
  { characterId: "c-lykon", name: "Lykon", houseName: "Euxenids", party: "none", militia: 41 },
];

describe("the Strategos picker and the Guide (Strategoi prompt 1)", () => {
  it("the picker lists each man the server sends with his party and 'Militia N'", async () => {
    vi.spyOn(api, "oligarchyChamber").mockImplementation(never);
    vi.spyOn(api, "chamberVotes").mockImplementation(never);
    vi.spyOn(api, "agenda").mockImplementation(never);
    vi.spyOn(api, "elections").mockImplementation(never);
    vi.spyOn(api, "government").mockImplementation(never);
    vi.spyOn(api, "offices").mockResolvedValue(offices);
    const appointees = vi.spyOn(api, "officeAppointees").mockResolvedValue({ appointees: APPOINTEES });
    const { container } = render(<PoliticsPanel player={player()} onRefresh={() => {}} />);
    await flush();

    const open = [...container.querySelectorAll<HTMLButtonElement>(".office-seat .panel-btn")].find((b) => b.textContent === "Appoint a Strategos")!;
    fireEvent.click(open);
    await flush();
    expect(appointees).toHaveBeenCalledWith("");

    const rows = [...container.querySelectorAll(".appoint-picker .event-choice-button")];
    expect(rows.map((r) => r.querySelector("strong")!.textContent)).toEqual(["Konrad of House Herakleides", "Lykon of House Euxenids"]);
    expect(rows.map((r) => [...r.querySelectorAll(".cost-chip")].map((c) => c.textContent))).toEqual([
      ["Palaioi", "Militia 84"],
      ["Independent", "Militia 41"],
    ]);
  });

  it("the Guide's Politics entry says who the Strategoi are and that they serve until the term ends", () => {
    const text = GUIDE_SECTIONS.find((s) => s.id === "politics")!.paragraphs.join(" ");
    expect(text).toContain(
      "the Strategoi are appointed by them, from any citizen with a seat and a Militia above 40, of either party or none, and serve until the term ends.",
    );
    expect(text).not.toContain("the Strategoi are appointed.");
  });
});
