// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type AgendaScopeView, type AgendaView, type PartyLeaderView } from "../src/api.js";
import { GUIDE_SECTIONS } from "../src/dashboard/guideContent.js";
import PoliticsPanel from "../src/dashboard/panels/PoliticsPanel.js";

// ---------------------------------------------------------------------------
// A party leader may stand for league office (politics prompt 3b): the Party
// tab's leader rows no longer call a leader barred, and the Guide's Politics
// entry says the opposite of what it said. Mounted against a mocked agenda, as
// politics-government.test.tsx mounts the Government tab; the chamber, offices,
// elections and government calls never settle.
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const player = () =>
  ({ party: "Palaioi", professionSlug: "trader", censured: false, censureExpiresAt: null, house: { name: "Herakleides" }, koinonPending: 0 }) as unknown as Parameters<typeof PoliticsPanel>[0]["player"];

const never = () => new Promise<never>(() => {});
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function scope(scopeName: AgendaScopeView["scope"]): AgendaScopeView {
  return { scope: scopeName, phase: "drafting", gameYear: 0, cards: [], draftedCardId: null, vetoedCardId: null, treasury: { owner: scopeName, balance: 100, ledger: [] }, youMayDraft: false, youMayVeto: false };
}
const LEADERS: PartyLeaderView[] = [
  { office: "party_archon", party: "palaioi", holder: { characterId: "c-ajax", name: "Ajax Marius" }, youHold: false },
  { office: "party_ephor", party: "palaioi", holder: null, youHold: false },
  { office: "party_archon", party: "dynatoi", holder: { characterId: "c-seskios", name: "Seskios" }, youHold: false },
];
const agenda: AgendaView = { league: scope("league"), palaioi: scope("palaioi"), dynatoi: scope("dynatoi"), leaders: LEADERS };

async function mountPartyTab() {
  vi.spyOn(api, "oligarchyChamber").mockImplementation(never);
  vi.spyOn(api, "chamberVotes").mockImplementation(never);
  vi.spyOn(api, "offices").mockImplementation(never);
  vi.spyOn(api, "elections").mockImplementation(never);
  vi.spyOn(api, "government").mockImplementation(never);
  vi.spyOn(api, "agenda").mockResolvedValue(agenda);
  const utils = render(<PoliticsPanel player={player()} onRefresh={() => {}} />);
  await flush();
  const tab = [...utils.container.querySelectorAll<HTMLButtonElement>(".cs-tab")].find((t) => t.textContent!.startsWith("Your Party"))!;
  fireEvent.click(tab);
  await flush();
  return utils;
}

describe("a party leader may stand (politics prompt 3b)", () => {
  it("the Party tab's leader rows read 'For life' for a leader who is not you, with no 'barred'", async () => {
    const { container } = await mountPartyTab();
    const rows = [...container.querySelectorAll(".party-leaders .person-row")];
    expect(rows).toHaveLength(2); // the Palaioi's two seats only
    expect(rows.map((r) => r.querySelector(".person-name")!.textContent)).toEqual(["Ajax Marius · Party Archon", "— vacant — · Party Ephor"]);
    for (const row of rows) {
      expect(row.querySelector(".person-role")!.textContent).toBe("For life");
      expect(row.textContent!.toLowerCase()).not.toContain("barred");
    }
  });

  it("the Guide's Politics entry says a party's leaders may stand, and no longer that they may never", () => {
    const politics = GUIDE_SECTIONS.find((s) => s.id === "politics")!;
    const text = politics.paragraphs.join(" ");
    expect(text).toContain("A party's for-life leaders may stand for the city's offices too.");
    expect(text).not.toContain("may never stand");
    expect(text).not.toContain("not both");
  });
});
