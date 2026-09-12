// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

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

async function mountMap() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/map2/world2.json")) return jsonResponse(WORLD);
    if (url.endsWith("/map2/politics2.json")) return jsonResponse({ polities: { boii: { name: "Boii", color: "#123" } }, owners: { R046: "boii", R047: "boii" } });
    if (url.endsWith("/map2/names2.json")) return jsonResponse({ version: 1, names: { R060: "Massalia", R046: "Salyes", R047: "Vocontii" } });
    if (url.endsWith("/map2/townstats.json")) return jsonResponse({ version: 1, towns: {} });
    if (url.includes("/api/map/military")) return jsonResponse({ towns: {}, regions: {} });
    if (url.includes("/api/map/reach")) return jsonResponse(REACH);
    if (url.includes("/api/barracks")) return jsonResponse({ roster: [] });
    return jsonResponse({ error: "not found" }, 404);
  });
  const { World2Map } = await import("../src/map/World2Map.js");
  const view = render(<World2Map />);
  await flush();
  const svg = view.container.querySelector("svg.w2map-svg") as SVGSVGElement;
  expect(svg).not.toBeNull();
  return { view, svg };
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
