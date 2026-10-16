// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayerState } from "../src/api.js";

// Discord under Lobby in the game (Discord 1): the sidebar's Lobby button has a
// Discord link right under it, and the phone's More sheet has Discord right
// after its Lobby. Both open the one invite in a new tab. The API is a mock
// whose other calls stay pending.
const state = vi.fn();

vi.mock("../src/api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/api.js")>();
  const known: Record<string, unknown> = { state, dailyEvents: () => Promise.resolve({ withdrawn: false, remaining: 0, cards: [] }) };
  const pending = () => new Promise<never>(() => {});
  const api = new Proxy(known, { get: (target, key) => (typeof key === "string" && key in target ? target[key] : pending) });
  return { ...actual, api };
});

const { Dashboard } = await import("../src/dashboard/Dashboard.js");

const INVITE = "https://discord.gg/wPUJCJNSpN";
const T0 = Date.UTC(2026, 9, 16, 12, 0, 0);

const payload = (): PlayerState =>
  ({
    now: new Date(T0).toISOString(),
    seasonEndsAt: new Date(T0 + 3_600_000).toISOString(),
    user: { id: "u", email: "p@t", newsletterOptIn: false, emailVerified: true },
    world: { id: "w", name: "W", gameDate: { seasonIndex: 0, yearBC: 300, seasonOfYear: 0, seasonName: "Winter" }, gameDateLabel: "Winter, 300 BC", seasonEndsIn: 180 },
    character: {
      id: "c", name: "Kleon", professionSlug: "trader", professionName: "Trader", professionRank: "Merchant", houseSlug: "iason", houseName: "Iason", houseStance: "s",
      faceId: null, party: "none", ideology: 0, composure: 100, withdrawn: false, drachmae: 150, censured: false, censureExpiresAt: null, origin: "citizen",
      avatarId: null, startAge: 30, currentAge: 30, lifeStage: "prime", portrait: null, deceased: false, decaying: [], regent: null,
    },
    succession: null, festival: null, stories: [], olympiad: null, scandal: null, familyPending: 0, manumission: null, introSeen: true, sheetSeen: true,
    resources: { drachmae: 150, prestige: 0, influence: 0, classResource: null, balances: {} },
    stats: { prestige: 0, devotion: 0, militia: 0, intelligence: 0 },
  }) as unknown as PlayerState;

const noop = () => {};
const mount = () => render(<Dashboard onExit={noop} onRequireLogin={noop} onRequireCharacter={noop} />);
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

const expectNewTab = (a: Element | null | undefined) => {
  expect(a?.tagName).toBe("A");
  expect(a!.getAttribute("href")).toBe(INVITE);
  expect(a!.getAttribute("target")).toBe("_blank");
  expect(a!.getAttribute("rel")).toBe("noopener noreferrer");
};

beforeEach(() => {
  state.mockReset();
  state.mockImplementation(() => Promise.resolve(payload()));
});
afterEach(cleanup);

describe("Discord under Lobby in the game", () => {
  it("the sidebar's Discord link sits right after its Lobby button, in the same style", async () => {
    const { container } = mount();
    await settle();
    const lobby = container.querySelector(".dashboard-sidebar .sidebar-lobby")!;
    expect(lobby.textContent!.trim()).toBe("Lobby");
    const discord = lobby.nextElementSibling;
    expectNewTab(discord);
    expect(discord!.textContent!.trim()).toBe("Discord");
    expect(discord!.classList.contains("sidebar-guide")).toBe(true);
    expect(discord!.nextElementSibling).toBeNull();
  });

  it("the More sheet's Discord sits right after its Lobby", async () => {
    const { container } = mount();
    await settle();
    fireEvent.click(container.querySelector<HTMLButtonElement>('.dashboard-mobile-tabs button[aria-controls="dashboard-mobile-more"]')!);
    const items = [...container.querySelector(".mobile-more-sheet")!.children];
    const at = items.findIndex((el) => el.textContent!.trim() === "Lobby");
    expect(at).toBeGreaterThan(-1);
    const discord = items[at + 1];
    expectNewTab(discord);
    expect(discord!.textContent!.trim()).toBe("Discord");
    expect(items[at + 2]).toBeUndefined();
  });
});
