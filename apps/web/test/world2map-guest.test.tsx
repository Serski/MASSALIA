// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { BarracksRosterRow, BaseView, MoveTargetView } from "../src/api.js";

// ---------------------------------------------------------------------------
// Holdings prompt 3: another house's holding is a place to send men. On it the
// panel keeps its holder line and its actions (Scout; Raid and Attack greyed
// with the server's sentences) and adds SEND MEN HERE beside them; the guest's
// own men there read "Your men here". A guest base is never painted or read as
// the viewer's own holding, and the viewer's own holding is as it was. The
// stage is given a size so the camera initialises (jsdom measures nothing), as
// in world2map-cards.test.tsx; network is mocked.
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
const KONRAD = { playerId: "p-konrad", characterName: "Konrad Curze", houseName: "Leonidas" };
const AJAX = { playerId: "p-ajax", characterName: "Ajax Marius", houseName: "Kleitos" };
const MILITARY = { towns: {}, regions: {}, holdings: { towns: { reii: KONRAD }, regions: { R046: AJAX } } };
const steps = { R060: { landSteps: 1, seaSteps: null } };
const entry = { landSteps: 1, seaSteps: null, byBase: steps, attack: { ok: true }, raid: { ok: true }, colonise: { ok: true } };
const MASSALIA: BaseView = { id: "R060", regionId: "R060", townId: null, kind: "massalia", name: "Massalia", holding: null };
const targetsBase: MoveTargetView[] = [{ id: "R060", regionId: "R060", townId: null, kind: "massalia", name: "Massalia", byBase: {} }];
// Another house's holdings, as the server lists them among the places to send men (kind "guest").
const GUEST_TARGETS: MoveTargetView[] = [
  { id: "reii", regionId: "R047", townId: "reii", kind: "guest", name: "Reii", byBase: steps },
  { id: "R046", regionId: "R046", townId: null, kind: "guest", name: "Salyes", byBase: steps },
];
const iso = (ms: number) => new Date(ms).toISOString();
const row = (id: string, count: number, basedAt: string): BarracksRosterRow => ({
  id, source: "trained", unitId: "peltast", label: "Peltast", plural: "Peltasts", icon: "PELTAST.webp", count, startCount: count, recruitedSeason: 0,
  readyAt: iso(Date.now() - 3_600_000), contractEndAt: null, basedAt, movingTo: null, arrivesAt: null, mission: null, createdAt: iso(Date.now() - 7_200_000),
  stats: { atk: 3, def: 2, msl: 5, mor: 4, spd: 8, space: 1 }, active: true, canDisband: true,
});
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

async function mountMap(opts: { bases?: BaseView[]; moveTargets?: MoveTargetView[]; roster?: BarracksRosterRow[]; military?: Record<string, unknown>; focus?: { regionId: string; townId: string | null; key: number } } = {}) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/map2/world2.json")) return jsonResponse(WORLD);
    if (url.endsWith("/map2/politics2.json")) return jsonResponse(POLITICS);
    if (url.endsWith("/map2/names2.json")) return jsonResponse({ version: 1, names: { R060: "Massalia", R046: "Salyes", R047: "Vocontii" } });
    if (url.endsWith("/map2/townstats.json")) return jsonResponse({ version: 1, towns: {} });
    if (url.includes("/api/map/military")) return jsonResponse(opts.military ?? MILITARY);
    if (url.includes("/api/map/reach")) {
      const bases = opts.bases ?? [MASSALIA];
      return jsonResponse({ now: iso(Date.now()), campaign: { season: "Spring", open: true, opensAt: null }, bases, force: { men: 20, space: 20 }, fleet: { ships: {}, labels: {}, range: 0, space: 0, tiers: [] }, reach: { R046: entry, R047: entry }, moveTargets: opts.moveTargets ?? [...targetsBase, ...GUEST_TARGETS] });
    }
    if (url.includes("/api/barracks")) return jsonResponse({ roster: opts.roster ?? [row("p-1", 20, "R060")] });
    return jsonResponse({ error: "not found" }, 404);
  });
  const { World2Map } = await import("../src/map/World2Map.js");
  const view = render(<World2Map focus={opts.focus ?? null} />);
  await vi.waitFor(() => expect(view.container.querySelector("svg.w2map-svg")).not.toBeNull());
  // The reach (and with it the move targets) has answered.
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
async function openReii(m: Mounted) {
  await act(async () => tap(m.svg, "R047"));
  await act(async () => {
    fireEvent.click(m.q('[role="dialog"][data-region="R047"] .w2map-town-entry')!);
  });
  return m.q('[role="dialog"][data-town-id="reii"]')!;
}
const buttons = (card: Element) => [...card.querySelectorAll<HTMLButtonElement>(".w2map-action")].map((b) => [b.textContent, b.disabled, b.getAttribute("title")]);

describe("another house's holding on the map", () => {
  it("a town: the holder line and the actions stay, with Raid and Attack greyed in the server's words, and SEND MEN HERE stands beside them", async () => {
    const m = await mountMap();
    const card = await openReii(m);
    expect(card.querySelector(".w2map-held")!.textContent).toBe("Held by House Leonidas · Konrad Curze");
    expect(buttons(card)).toEqual([
      ["Attack", true, "Another house holds this town."],
      ["Raid", true, "Another house holds this town."],
      ["Scout", false, null],
      ["Colonise", true, "Colonies are founded in open country"],
      ["Send men here", false, null],
    ]);
    // SEND MEN HERE opens the house's own picker, a move to Reii.
    await act(async () => {
      fireEvent.click(card.querySelector<HTMLButtonElement>(".w2map-action-move")!);
    });
    await vi.waitFor(() => expect(m.q('.w2map-modal[role="dialog"]')).not.toBeNull());
    expect(m.q('.w2map-modal[role="dialog"]')!.getAttribute("aria-label")).toBe("Send men to Reii");
  });

  it("a land: the same, beside its action row", async () => {
    const m = await mountMap();
    await act(async () => tap(m.svg, "R046"));
    const card = m.q('[role="dialog"][data-region="R046"]')!;
    expect(card.querySelector(".w2map-held")!.textContent).toBe("Held by House Kleitos · Ajax Marius");
    // Colonise stays as the matrix leaves it on open country (not yet a live action, as before).
    expect(buttons(card)).toEqual([
      ["Attack", true, "Another house holds this land."],
      ["Raid", true, "Another house holds this land."],
      ["Scout", false, null],
      ["Colonise", false, null],
      ["Send men here", false, null],
    ]);
  });

  it("with the guest's men standing there it is his guest base: \"Your men here\", never \"Held by your house\", never Massalia's legality", async () => {
    const guestBase: BaseView = { id: "reii", regionId: "R047", townId: "reii", kind: "guest", name: "Reii", holding: null };
    const m = await mountMap({ bases: [MASSALIA, guestBase], roster: [row("p-1", 20, "R060"), row("p-2", 30, "reii")] });
    const card = await openReii(m);
    expect(card.querySelector(".w2map-your-men")!.textContent).toBe("Your men here: 30 peltasts");
    expect(card.textContent).not.toContain("Held by your house");
    expect(card.querySelector(".w2map-held")!.textContent).toBe("Held by House Leonidas · Konrad Curze");
    // Still the holder's: Attack and Raid greyed with the holder's sentence, not "Massalia does not act against her own".
    expect(buttons(card).slice(0, 2)).toEqual([["Attack", true, "Another house holds this town."], ["Raid", true, "Another house holds this town."]]);
    expect(card.textContent).not.toContain("Massalia does not act against her own");
    // The paint is as without him: one Massalia fill, the Salyes (Ajax's own land holding). Vocontii keeps
    // the Saluvii's colour, since one held town of two does not flip it and a guest base paints nothing.
    expect(m.svg.querySelectorAll('path[fill="#e0a33c"]')).toHaveLength(1);
    cleanup();
    vi.restoreAllMocks();
    const without = await mountMap();
    expect(without.svg.querySelectorAll('path[fill="#e0a33c"]')).toHaveLength(1);
  });

  it("the viewer's own holding is as it was: its tribute line, and SEND MEN HERE alone", async () => {
    const own: BaseView = { id: "reii", regionId: "R047", townId: "reii", kind: "conquest", name: "Reii", holding: { garrison: 47, minGarrison: 15, perDay: { drachmae: 120, grain: 0, timber: 0 }, levyPerYear: 0 } };
    const ownTargets: MoveTargetView[] = [...targetsBase, { id: "reii", regionId: "R047", townId: "reii", kind: "conquest", name: "Reii", byBase: steps }];
    const mine = { playerId: "p-me", characterName: "Kleon", houseName: "Test" };
    const m = await mountMap({ bases: [MASSALIA, own], moveTargets: ownTargets, military: { towns: {}, regions: {}, holdings: { towns: { reii: mine }, regions: {} } } });
    const card = await openReii(m);
    expect(card.querySelector(".w2map-held")!.textContent).toBe("Held by your house · tribute 120 dr a day");
    expect(buttons(card)).toEqual([["Send men here", false, null]]);
  });

  it("the house's picker refuses a place it may not send men to in the server's new words", async () => {
    const { ForcePicker } = await import("../src/map/World2Map.js");
    const view = render(<ForcePicker type="move" target={{ kind: "region", id: "R047", regionId: "R047", name: "Vocontii" }} names={{ R060: "Massalia" }} moveTargets={targetsBase} fleet={{ ships: {}, range: 0, space: 0 }} roster={[row("p-1", 20, "R060")]} onClose={() => {}} onActed={() => {}} />);
    expect(view.container.querySelector(".w2map-pick-why")!.textContent).toBe("Men may only be sent to Massalia's own ground or to a house's holding.");
  });
});

// Strikes prompt 1: a nation's march, and how it ended, on the target's panel for everyone.
describe("a nation's strike on the map", () => {
  const march = { nation: "the Saluvii", status: "marching", mode: "attack", trigger: "war", about: 160, strikesAt: iso(Date.now() + 3_600_000), line: "The Saluvii march on Reii with about 160 men. They strike at 12:00 UTC.", dateLabel: "Autumn, 291 BC" };
  const ended = { nation: "the Volcae", status: "struck", mode: "raid", trigger: "raids", about: 200, strikesAt: iso(Date.now() - 3_600_000), line: "The Volcae broke into Salyes and carried off 20 drachmae from House Kleitos.", dateLabel: "Summer, 291 BC" };
  const withStrikes = { ...MILITARY, strikes: { towns: { reii: march }, regions: { R046: ended } } };
  it("a town's panel shows the march on the road; a land's panel how one ended, dated; a place without, nothing", async () => {
    const m = await mountMap({ military: withStrikes });
    const card = await openReii(m);
    expect(card.querySelector(".w2map-strike")!.textContent).toBe(march.line);
    expect(card.querySelector(".w2map-strike")!.getAttribute("data-strike")).toBe("marching");
    cleanup();
    vi.restoreAllMocks();
    const again = await mountMap({ military: withStrikes });
    await act(async () => tap(again.svg, "R046"));
    const land = again.q('[role="dialog"][data-region="R046"]')!;
    expect(land.querySelector(".w2map-strike")!.textContent).toBe(`${ended.line} · Summer, 291 BC`);
    cleanup();
    vi.restoreAllMocks();
    const plain = await mountMap();
    const town = await openReii(plain);
    expect(town.querySelector(".w2map-strike")).toBeNull();
  });
});

// Strikes prompt 2: the Barracks' "Show on map" opens the Atlas on the place.
describe("the Atlas opened on a place", () => {
  it("a town opens on its own panel, a land on its region's", async () => {
    const town = await mountMap({ focus: { regionId: "R047", townId: "reii", key: 1 } });
    await vi.waitFor(() => expect(town.q('[role="dialog"][data-town-id="reii"]')).not.toBeNull());
    cleanup();
    vi.restoreAllMocks();
    const land = await mountMap({ focus: { regionId: "R046", townId: null, key: 2 } });
    await vi.waitFor(() => expect(land.q('[role="dialog"][data-region="R046"]')).not.toBeNull());
    expect(land.q('[role="dialog"][data-town-id]')).toBeNull();
  });
});
