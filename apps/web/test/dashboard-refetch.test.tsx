// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayerState } from "../src/api.js";

// The dashboard refetches itself on two triggers (dashboard refetch prompt,
// Sept 2026): a return to the tab (visibilitychange to visible, or window focus)
// when the last fetch is more than 60 s old, and one timer at the season
// boundary armed from the payload's own clock. Fake timers drive both the
// throttle clock and the timer; the API is a mock whose other calls stay pending.
const state = vi.fn();
const dailyEvents = vi.fn();

vi.mock("../src/api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/api.js")>();
  const known: Record<string, unknown> = { state, dailyEvents };
  const pending = () => new Promise<never>(() => {});
  const api = new Proxy(known, { get: (target, key) => (typeof key === "string" && key in target ? target[key] : pending) });
  return { ...actual, api };
});

const { Dashboard } = await import("../src/dashboard/Dashboard.js");

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 8, 22, 12, 0, 0);

const payload = (): PlayerState =>
  ({
    now: new Date(T0).toISOString(),
    seasonEndsAt: new Date(T0 + HOUR).toISOString(),
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

let visibility: DocumentVisibilityState = "visible";
Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });

const noop = () => {};
const mount = () => render(<Dashboard onExit={noop} onRequireLogin={noop} onRequireCharacter={noop} />);
// Let the mocked fetch resolve and React commit, without advancing the clock.
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const fire = (target: EventTarget, type: string) => act(async () => { target.dispatchEvent(new Event(type)); await Promise.resolve(); });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  visibility = "visible";
  state.mockReset();
  state.mockImplementation(() => Promise.resolve(payload()));
  dailyEvents.mockReset();
  dailyEvents.mockImplementation(() => Promise.resolve({ withdrawn: false, remaining: 0, cards: [] }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("dashboard refetch triggers", () => {
  it("a visibilitychange to visible after 60 s refetches once; a second within 60 s does not, nor does a focus", async () => {
    mount();
    await settle();
    expect(state).toHaveBeenCalledTimes(1);

    // Too soon: nothing.
    await advance(30_000);
    await fire(document, "visibilitychange");
    expect(state).toHaveBeenCalledTimes(1);

    // Past the minute: one refetch.
    await advance(31_000);
    await fire(document, "visibilitychange");
    expect(state).toHaveBeenCalledTimes(2);

    // A second event within 60 s of that fetch is throttled, and so is a focus:
    // both share the one timestamp.
    await advance(1_000);
    await fire(document, "visibilitychange");
    await fire(window, "focus");
    expect(state).toHaveBeenCalledTimes(2);

    // Hidden never refetches, however stale.
    visibility = "hidden";
    await advance(120_000);
    await fire(document, "visibilitychange");
    await fire(window, "focus");
    expect(state).toHaveBeenCalledTimes(2);
  });

  it("the rollover timer fires once at seasonEndsAt + 5 s, armed from the payload's clock", async () => {
    mount();
    await settle();
    expect(state).toHaveBeenCalledTimes(1);

    await advance(HOUR + 4_000);
    expect(state).toHaveBeenCalledTimes(1);
    await advance(2_000);
    expect(state).toHaveBeenCalledTimes(2);
  });

  it("unmount clears the rollover timer", async () => {
    const view = mount();
    await settle();
    expect(state).toHaveBeenCalledTimes(1);

    view.unmount();
    await advance(2 * HOUR);
    expect(state).toHaveBeenCalledTimes(1);
  });
});
