// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { BarracksRosterRow } from "../src/api.js";

// ---------------------------------------------------------------------------
// Region cards on the Atlas: a region with towns lists each town as an entry
// that opens the town card and shows no action row; a townless region keeps
// its action row; and while a card is open the map ignores a drag and a tap
// on it closes the card. The stage is given a size (jsdom measures nothing)
// so the camera initialises and the SVG renders; elementFromPoint is stubbed
// to the region under test. Network is mocked.
// ---------------------------------------------------------------------------

const WORLD = {
  width: 100,
  height: 100,
  provinces: [
    { id: "R060", type: "land", path: "M0,0 L50,0 L50,50 L0,50 Z", towns: ["massalia"], neighbors: ["R046", "R047"], coastal: true },
    { id: "R046", type: "land", path: "M50,0 L100,0 L100,50 L50,50 Z", towns: [], neighbors: ["R060", "R047"], coastal: false },
    { id: "R047", type: "land", path: "M0,50 L100,50 L100,100 L0,100 Z", towns: ["reii", "album"], neighbors: ["R060", "R046"], coastal: false },
  ],
  towns: [
    { id: "massalia", name: "Massalia", x: 25, y: 25 },
    { id: "reii", name: "Reii", x: 30, y: 75 },
    { id: "album", name: "Album", x: 70, y: 75 },
  ],
};
const entry = (landSteps: number | null) => ({ landSteps, seaSteps: null, byBase: { R060: { landSteps, seaSteps: null } }, attack: { ok: true }, raid: { ok: true }, colonise: { ok: true } });
const REACH = {
  now: new Date().toISOString(),
  campaign: { season: "Spring", open: true, opensAt: null },
  bases: [{ id: "R060", regionId: "R060", townId: null, kind: "massalia", name: "Massalia", holding: null }],
  force: { men: 20, space: 20 },
  fleet: { ships: {}, labels: {}, range: 0, space: 0, tiers: [] },
  reach: { R046: entry(1), R047: entry(1) },
  moveTargets: [{ id: "R060", regionId: "R060", townId: null, kind: "massalia", name: "Massalia", byBase: {} }],
};
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeAll(() => {
  class RO { observe() {} unobserve() {} disconnect() {} }
  (globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0)) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as typeof cancelAnimationFrame;
  // The stage measures 800×600 and every box reads the same, so the camera initialises and drags have a scale.
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 600 });
  Element.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}) }) as DOMRect;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 40)); });

// The roster /api/barracks answers (a party on the march, for the arrival case),
// and the reach's `now` taken when it answers, so the clock offset is nil.
async function mountMap(roster: BarracksRosterRow[] = []) {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/map2/world2.json")) return jsonResponse(WORLD);
    if (url.endsWith("/map2/politics2.json")) return jsonResponse({ polities: { boii: { name: "Boii", color: "#123" } }, owners: { R046: "boii", R047: "boii" } });
    if (url.endsWith("/map2/names2.json")) return jsonResponse({ version: 1, names: { R060: "Massalia", R046: "Salyes", R047: "Vocontii" } });
    if (url.endsWith("/map2/townstats.json")) return jsonResponse({ version: 1, towns: {} });
    if (url.includes("/api/map/military")) return jsonResponse({ towns: {}, regions: {} });
    if (url.includes("/api/map/reach")) return jsonResponse({ ...REACH, now: new Date().toISOString() });
    if (url.includes("/api/barracks")) return jsonResponse({ roster });
    return jsonResponse({ error: "not found" }, 404);
  });
  const { World2Map } = await import("../src/map/World2Map.js");
  const view = render(<World2Map />);
  await flush();
  const svg = view.container.querySelector("svg.w2map-svg") as SVGSVGElement;
  expect(svg).not.toBeNull();
  const calls = (part: string) => fetchSpy.mock.calls.filter((c) => String(c[0]).includes(part)).length;
  return { view, svg, fetchSpy, calls };
}

// A tap on the region: the hit-test reads elementFromPoint, which jsdom lacks.
function tap(svg: SVGSVGElement, rid: string | null, x = 100, y = 100) {
  document.elementFromPoint = () => (rid ? svg.querySelector(`[data-rid="${rid}"]`) : svg);
  fireEvent.pointerDown(svg, { pointerId: 1, clientX: x, clientY: y, timeStamp: 0 });
  fireEvent.pointerUp(svg, { pointerId: 1, clientX: x, clientY: y });
}
function drag(svg: SVGSVGElement) {
  fireEvent.pointerDown(svg, { pointerId: 2, clientX: 100, clientY: 100, timeStamp: 5000 });
  fireEvent.pointerMove(svg, { pointerId: 2, clientX: 300, clientY: 260 });
  fireEvent.pointerUp(svg, { pointerId: 2, clientX: 300, clientY: 260 });
}

describe("World2Map region cards", () => {
  it("a party bound for the open region: nothing is read again when it is chosen, the roster and the military numbers once when it gets there", async () => {
    const iso = (ms: number) => new Date(ms).toISOString();
    const arrives = Date.now() + 1500;
    const party: BarracksRosterRow = {
      id: "p1", source: "trained", unitId: "peltast", label: "Peltast", plural: "Peltasts", icon: "PELTAST.webp", count: 20, startCount: 20, recruitedSeason: 1,
      readyAt: iso(Date.now() - 3_600_000), contractEndAt: null, basedAt: "R060", movingTo: "R046", arrivesAt: iso(arrives),
      mission: { kind: "raid", regionId: "R046", departedAt: iso(Date.now() - 60_000), marchId: "m-1" }, createdAt: iso(Date.now() - 7_200_000), stats: { spd: 8, space: 1 }, active: true, canDisband: false,
    };
    const { view, svg, fetchSpy, calls } = await mountMap([party]);
    expect(calls("/api/barracks")).toBe(1);
    expect(calls("/api/map/military")).toBe(1);
    await act(async () => tap(svg, "R046"));
    expect(view.container.querySelector('[role="dialog"][data-region="R046"]')).not.toBeNull();
    // Chosen before the party gets there: nothing is read again.
    await flush();
    expect(calls("/api/barracks")).toBe(1);
    expect(calls("/api/map/military")).toBe(1);
    // When it gets there: the roster once, then the military numbers once.
    await vi.waitFor(() => expect(calls("/api/map/military")).toBe(2), { timeout: 5000, interval: 50 });
    expect(calls("/api/barracks")).toBe(2);
    const barracksCalls = fetchSpy.mock.calls.map((c, i) => [i, String(c[0])] as const).filter(([, u]) => u.includes("/api/barracks") || u.includes("/api/map/military"));
    expect(barracksCalls.at(-2)![1]).toContain("/api/barracks");
    expect(barracksCalls.at(-1)![1]).toContain("/api/map/military");
    await flush();
    expect(calls("/api/barracks")).toBe(2);
    expect(calls("/api/map/military")).toBe(2);
  });

  it("a region with towns lists each town as an entry that opens the town card, with the note and no action buttons", async () => {
    const { view, svg } = await mountMap();
    await act(async () => tap(svg, "R047"));
    const card = view.container.querySelector('[role="dialog"][data-region="R047"]')!;
    expect(card).not.toBeNull();
    const entries = [...card.querySelectorAll('[data-testid="town-entries"] .w2map-town-entry')];
    expect(entries.map((e) => e.textContent?.replace("›", "").trim())).toEqual(["Reii", "Album"]);
    expect(card.textContent).toContain("This land answers to its towns.");
    expect(card.querySelectorAll(".w2map-action")).toHaveLength(0);
    expect(card.textContent).not.toContain("Actions");
    await act(async () => {
      fireEvent.click(entries[1]!);
    });
    const town = view.container.querySelector('[role="dialog"][data-town-id="album"]')!;
    expect(town).not.toBeNull();
    expect(town.querySelector(".w2map-state-name")!.textContent).toBe("Album");
  });

  it("a townless region keeps its action row, and Massalia's own region shows Send Men Here", async () => {
    const { view, svg } = await mountMap();
    await act(async () => tap(svg, "R046"));
    // The selection outline is drawn in the bright accent.
    expect(document.querySelector('path[stroke="#d6873f"]')).not.toBeNull();
    const card = view.container.querySelector('[role="dialog"][data-region="R046"]')!;
    expect([...card.querySelectorAll(".w2map-action")].map((b) => b.textContent)).toEqual(["Attack", "Raid", "Scout", "Colonise"]);
    expect(card.textContent).toContain("No towns in this region.");
    expect(card.textContent).not.toContain("answers to its towns");
    // Tapping the map outside the card closes it; a second tap selects again.
    await act(async () => tap(svg, "R047", 700, 500));
    expect(view.container.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => tap(svg, "R060"));
    const home = view.container.querySelector('[role="dialog"][data-region="R060"]')!;
    expect(home.querySelectorAll(".w2map-action-move")).toHaveLength(1);
    expect(home.querySelectorAll(".w2map-action")).toHaveLength(1);
  });

  it("the map ignores a drag while a card is open, and pans again once it is closed", async () => {
    const { view, svg } = await mountMap();
    const before = svg.getAttribute("viewBox");
    await act(async () => tap(svg, "R046"));
    expect(view.container.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => drag(svg));
    await flush();
    // The drag neither panned the map nor closed the card (it was not a tap).
    expect(svg.getAttribute("viewBox")).toBe(before);
    expect(view.container.querySelector('[role="dialog"]')).not.toBeNull();
    expect((view.container.querySelector('button[aria-label="Zoom in"]') as HTMLButtonElement).disabled).toBe(true);
    // Close with a tap on the map, then the same drag pans.
    await act(async () => tap(svg, null, 700, 500));
    expect(view.container.querySelector('[role="dialog"]')).toBeNull();
    expect((view.container.querySelector('button[aria-label="Zoom in"]') as HTMLButtonElement).disabled).toBe(false);
    await act(async () => drag(svg));
    await flush();
    expect(svg.getAttribute("viewBox")).not.toBe(before);
  });
});
