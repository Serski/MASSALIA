// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Military 6a. A place on alert (at or below half its strength) carries a flag
// on the map and its line on its panel, for every viewer (GET /military's
// flags); the reach's lines grey Raid there with the server's sentence, and
// Scout and Attack stay open. A house that holds all it may has Attack greyed
// everywhere with the cap's line. The stage is given a size so the camera
// initialises (jsdom measures nothing), as in world2map-guest.test.tsx;
// network is mocked.
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
const POLITICS = { polities: { saluvii: { name: "Saluvii", color: "#123" }, massalia: { name: "Massalia", color: "#e0a33c", culture: "greek" } }, owners: { R046: "unclaimed", R047: "saluvii" } };
const REII_LINE = "Reii is on alert, gates are shut.";
const SALYES_LINE = "Salyes is on alert, the herds are driven into the hills.";
const CAP_LINE = "Your house holds all it can: 2 places.";
const ON_ALERT = { towns: { reii: true }, regions: { R046: true } };
const LINES = { towns: { reii: REII_LINE }, regions: { R046: SALYES_LINE } };
const steps = { R060: { landSteps: 1, seaSteps: null } };
const entry = { landSteps: 1, seaSteps: null, byBase: steps, attack: { ok: true }, raid: { ok: true }, colonise: { ok: true } };
const iso = (ms: number) => new Date(ms).toISOString();
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeAll(() => {
  class RO { observe() {} unobserve() {} disconnect() {} }
  (globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0)) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as typeof cancelAnimationFrame;
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 600 });
  Element.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}) }) as DOMRect;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// `alert` and `cap` ride on the reach as the server sends them; absent, as an older server sends it.
async function mountMap(opts: { military?: Record<string, unknown>; reachExtra?: Record<string, unknown> } = {}) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/map2/world2.json")) return jsonResponse(WORLD);
    if (url.endsWith("/map2/politics2.json")) return jsonResponse(POLITICS);
    if (url.endsWith("/map2/names2.json")) return jsonResponse({ version: 1, names: { R060: "Massalia", R046: "Salyes", R047: "Vocontii" } });
    if (url.endsWith("/map2/townstats.json")) return jsonResponse({ version: 1, towns: {} });
    if (url.includes("/api/map/military")) return jsonResponse(opts.military ?? { towns: {}, regions: {}, alert: ON_ALERT });
    if (url.includes("/api/map/reach")) {
      const bases = [{ id: "R060", regionId: "R060", townId: null, kind: "massalia", name: "Massalia", holding: null }];
      return jsonResponse({ now: iso(Date.now()), campaign: { season: "Spring", open: true, opensAt: null }, bases, force: { men: 20, space: 20 }, fleet: { ships: {}, labels: {}, range: 0, space: 0, tiers: [] }, reach: { R046: entry, R047: entry }, moveTargets: [], ...(opts.reachExtra ?? { alert: LINES, cap: null }) });
    }
    if (url.includes("/api/barracks")) return jsonResponse({ roster: [] });
    return jsonResponse({ error: "not found" }, 404);
  });
  const { World2Map } = await import("../src/map/World2Map.js");
  const view = render(<World2Map />);
  await vi.waitFor(() => expect(view.container.querySelector("svg.w2map-svg")).not.toBeNull());
  // The military read and the reach have answered.
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  const svg = view.container.querySelector("svg.w2map-svg") as SVGSVGElement;
  const q = (sel: string) => view.container.querySelector(sel);
  return { view, svg, q };
}
type Mounted = Awaited<ReturnType<typeof mountMap>>;
function tap(svg: SVGSVGElement, rid: string) {
  document.elementFromPoint = () => svg.querySelector(`[data-rid="${rid}"]`);
  fireEvent.pointerDown(svg, { pointerId: 1, clientX: 100, clientY: 100, timeStamp: 0 });
  fireEvent.pointerUp(svg, { pointerId: 1, clientX: 100, clientY: 100 });
}
// A tap on the map while a card is open closes it: tap once more to open the region's.
async function select(m: Mounted, rid: string) {
  if (m.q('[role="dialog"]')) await act(async () => tap(m.svg, rid));
  await act(async () => tap(m.svg, rid));
}
async function openTown(m: Mounted, townId: "reii" | "album") {
  await select(m, "R047");
  const entries = [...m.view.container.querySelectorAll<HTMLButtonElement>('[role="dialog"][data-region="R047"] .w2map-town-entry')];
  const entryButton = entries.find((b) => b.textContent?.startsWith(townId === "reii" ? "Reii" : "Album"))!;
  await act(async () => {
    fireEvent.click(entryButton);
  });
  return m.q(`[role="dialog"][data-town-id="${townId}"]`)!;
}
async function openSalyes(m: Mounted) {
  await select(m, "R046");
  return m.q('[role="dialog"][data-region="R046"]')!;
}
const buttons = (card: Element) => [...card.querySelectorAll<HTMLButtonElement>(".w2map-action")].map((b) => [b.textContent, b.disabled, b.getAttribute("title")]);

describe("the alert on the map (Military 6a)", () => {
  it("a town and a land on alert carry the flag on the map and the line on their panels; a place not on alert carries neither", async () => {
    const m = await mountMap();
    expect([...m.svg.querySelectorAll("[data-alert-flag]")].map((f) => f.getAttribute("data-alert-flag")).sort()).toEqual(["R046", "reii"]);
    const salyes = await openSalyes(m);
    expect(salyes.querySelector('.w2map-alert[data-alert="land"]')!.textContent).toBe(SALYES_LINE);
    const reii = await openTown(m, "reii");
    expect(reii.querySelector('.w2map-alert[data-alert="town"]')!.textContent).toBe(REII_LINE);
    const album = await openTown(m, "album");
    expect(album.querySelector(".w2map-alert")).toBeNull();
  });

  it("Raid is greyed with each place's line; Scout and Attack stay open", async () => {
    const m = await mountMap();
    expect(buttons(await openSalyes(m))).toEqual([
      ["Attack", false, null],
      ["Raid", true, SALYES_LINE],
      ["Scout", false, null],
      ["Colonise", false, null],
    ]);
    expect(buttons(await openTown(m, "reii"))).toEqual([
      ["Attack", false, null],
      ["Raid", true, REII_LINE],
      ["Scout", false, null],
      ["Colonise", true, "Colonies are founded in open country"],
    ]);
    // Album is not on alert: its Raid is open.
    expect(buttons(await openTown(m, "album"))[1]).toEqual(["Raid", false, null]);
  });

  it("a house at its cap of two places has Attack greyed with the cap's line everywhere; below the cap, nothing", async () => {
    const m = await mountMap({ reachExtra: { alert: LINES, cap: CAP_LINE } });
    expect(buttons(await openSalyes(m)).slice(0, 2)).toEqual([
      ["Attack", true, CAP_LINE],
      ["Raid", true, SALYES_LINE],
    ]);
    expect(buttons(await openTown(m, "album")).slice(0, 2)).toEqual([
      ["Attack", true, CAP_LINE],
      ["Raid", false, null],
    ]);
  });

  it("the flags and lines are for every viewer, from the military read; a reach without lines (an older server) greys nothing, and no flag shows without the read's", async () => {
    const m = await mountMap({ reachExtra: {} });
    expect(m.svg.querySelectorAll("[data-alert-flag]")).toHaveLength(2);
    const salyes = await openSalyes(m);
    expect(salyes.querySelector(".w2map-alert")!.textContent).toBe(SALYES_LINE);
    expect(buttons(salyes).slice(0, 2)).toEqual([
      ["Attack", false, null],
      ["Raid", false, null],
    ]);
    cleanup();
    vi.restoreAllMocks();
    const older = await mountMap({ military: { towns: {}, regions: {} }, reachExtra: {} });
    expect(older.svg.querySelectorAll("[data-alert-flag]")).toHaveLength(0);
    expect((await openSalyes(older)).querySelector(".w2map-alert")).toBeNull();
  });
});
