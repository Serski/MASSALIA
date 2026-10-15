// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { BarracksRosterRow, BaseView, ReachEntry } from "../src/api.js";
import { holdingLine } from "../src/map/World2Map.js";

// ---------------------------------------------------------------------------
// The League's army on the map (government prompt 5b). A sitting Archon or
// Strategos (the server's `commander` on GET /api/map/reach) sees a switch,
// "Your house" or "The League's army". In the League's mode a band across the
// map says so, the map reads GET /api/map/league, a place's buttons open the
// League's own order sheet (never the house's force picker), Attack and Raid
// are greyed with the war gate's sentence on a nation at peace, SEND MEN HERE
// shows on a League town, and a place's panel shows the League's last sighting
// in the place of the house's own scouting. The house's mode is as it was.
// Network is mocked; the stage is given a size so the camera initialises (jsdom
// measures nothing), as in world2map-cards.test.tsx.
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
const POLITICS = { polities: { saluvii: { name: "Saluvii", color: "#123" }, massalia: { name: "Massalia", color: "#e0a33c", culture: "greek" } }, owners: { R060: "massalia", R046: "unclaimed", R047: "saluvii" } };
const entry = (base: string): ReachEntry => ({ landSteps: 1, seaSteps: null, byBase: { [base]: { landSteps: 1, seaSteps: null } }, attack: { ok: true }, raid: { ok: true }, colonise: { ok: true } });
const iso = (ms: number) => new Date(ms).toISOString();
const row = (id: string, unitId: string, label: string, count: number, basedAt: string): BarracksRosterRow => ({
  id, source: "trained", unitId, label, plural: `${label}s`, icon: `${unitId.toUpperCase()}.webp`, count, startCount: count, recruitedSeason: 0,
  readyAt: iso(Date.now() - 3_600_000), contractEndAt: null, basedAt, movingTo: null, arrivesAt: null, mission: null, createdAt: iso(Date.now() - 7_200_000),
  stats: { atk: 7, def: 8, msl: 0, mor: 7, spd: 6, space: 1 }, active: true, canDisband: false,
});

// The house's reach: its base is the Massalia region.
const HOUSE_REACH = {
  campaign: { season: "Spring", open: true, opensAt: null },
  bases: [{ id: "R060", regionId: "R060", townId: null, kind: "massalia", name: "Massalia", holding: null }],
  force: { men: 20, space: 20 },
  fleet: { ships: {}, labels: {}, range: 0, space: 0, tiers: [] },
  reach: { R046: entry("R060"), R047: entry("R060") },
  moveTargets: [{ id: "R060", regionId: "R060", townId: null, kind: "massalia", name: "Massalia", byBase: {} }],
};
const HOUSE_ROSTER = [row("h-1", "peltast", "Peltast", 20, "R060")];
// The League's: its base is the Massalia town, its rows the army's, and the war
// gate refuses Reii (a nation at peace) and the Salyes' land (no nation); Album
// passes it.
const LEAGUE_ROSTER = [row("l-1", "hoplite", "Hoplite", 500, "massalia"), row("l-2", "peltast", "Peltast", 250, "massalia")];
const LEAGUE_VIEW = {
  campaign: { season: "Spring", open: true, opensAt: null },
  bases: [{ id: "massalia", regionId: "R060", townId: "massalia", kind: "home", name: "Massalia", holding: null }],
  force: { men: 750, space: 750 },
  fleet: { ships: {}, labels: {}, range: 0, space: 0, tiers: [] },
  reach: { R046: entry("massalia"), R047: entry("massalia") },
  moveTargets: [{ id: "massalia", regionId: "R060", townId: "massalia", kind: "home", name: "Massalia", byBase: {} }],
  roster: LEAGUE_ROSTER,
  treasury: { balance: 5000 },
  supplyPrice: 14,
  gate: { towns: { reii: "The League is not at war with the Saluvii." }, regions: { R046: "The League makes war only on nations, and no nation holds this land." } },
  // What the League's own parties last saw: Album's garrison and ships, the Salyes' warband.
  sightings: { towns: { album: { garrison: 80, pentekonters: 2, triremes: 0, scoutedGameDate: "Spring, 298 BC" } }, regions: { R046: { warband: 100, scoutedGameDate: "Winter, 298 BC" } } },
  orderedBy: { name: "Seskios", office: "archon", side: "dynatoi" },
};
const SET_OUT = {
  type: "setout", action: "raid", marchId: "m-1", regionId: "R047", regionName: "Vocontii", townId: "album", townName: "Album", base: "massalia", route: "land", steps: 1, minutes: 30,
  departedAt: iso(Date.now()), arrivesAt: iso(Date.now() + 1_800_000), ships: {}, men: 500, rows: [{ id: "l-1", unitId: "hoplite", label: "Hoplite", icon: "HOPLITE.webp", count: 500 }], line: "500 hoplites set out to raid Album, arriving in 00:30:00.",
};
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

// `commander`: what GET /api/map/reach says of the seat (absent on an older
// server). `leagueStatus`: what GET /api/map/league answers with.
// `leagueView` and `houseReach` are laid over the fixtures' (holdings prompt 4).
async function mountMap(opts: { commander?: boolean; military?: Record<string, unknown>; leagueStatus?: number; harvest?: { towns: Record<string, string>; regions: Record<string, string> }; leagueView?: Record<string, unknown>; houseReach?: Record<string, unknown> } = {}) {
  const posts: { url: string; body: unknown }[] = [];
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/map2/world2.json")) return jsonResponse(WORLD);
    if (url.endsWith("/map2/politics2.json")) return jsonResponse(POLITICS);
    if (url.endsWith("/map2/names2.json")) return jsonResponse({ version: 1, names: { R060: "Massalia", R046: "Salyes", R047: "Vocontii" } });
    if (url.endsWith("/map2/townstats.json")) return jsonResponse({ version: 1, towns: {} });
    if (url.includes("/api/map/military")) return jsonResponse(opts.military ?? { towns: {}, regions: {} });
    if (init?.method === "POST") {
      posts.push({ url, body: JSON.parse(String(init.body)) });
      if (url.includes("/api/map/league/act")) return jsonResponse({ report: SET_OUT, reach: { ...LEAGUE_VIEW, now: iso(Date.now()), treasury: { balance: 4972 } }, force: LEAGUE_VIEW.force, fleet: LEAGUE_VIEW.fleet, roster: LEAGUE_ROSTER });
      if (url.includes("/api/map/act")) return jsonResponse({ report: { ...SET_OUT, base: "R060" }, reach: { ...HOUSE_REACH, now: iso(Date.now()) }, force: HOUSE_REACH.force, fleet: HOUSE_REACH.fleet, roster: HOUSE_ROSTER });
    }
    if (url.includes("/api/map/league")) return (opts.leagueStatus ?? 200) === 200 ? jsonResponse({ ...LEAGUE_VIEW, ...opts.leagueView, now: iso(Date.now()) }) : jsonResponse({ error: "Only a sitting Archon or Strategos commands the League's army." }, opts.leagueStatus);
    if (url.includes("/api/map/reach")) return jsonResponse({ ...HOUSE_REACH, ...opts.houseReach, now: iso(Date.now()), ...(opts.commander === undefined ? {} : { commander: opts.commander }), ...(opts.harvest ? { harvest: opts.harvest } : {}) });
    if (url.includes("/api/barracks")) return jsonResponse({ roster: HOUSE_ROSTER });
    return jsonResponse({ error: "not found" }, 404);
  });
  const { World2Map } = await import("../src/map/World2Map.js");
  const view = render(<World2Map />);
  await vi.waitFor(() => expect(view.container.querySelector("svg.w2map-svg")).not.toBeNull());
  const svg = view.container.querySelector("svg.w2map-svg") as SVGSVGElement;
  const calls = (part: string) => fetchSpy.mock.calls.filter((c) => String(c[0]).includes(part)).length;
  const modeButtons = () => [...view.container.querySelectorAll<HTMLButtonElement>(".w2map-mode-btn")];
  const q = <T extends Element = HTMLElement>(sel: string) => view.container.querySelector<T>(sel);
  // The switch to the League's army, and the League's map read and on screen.
  const toLeague = async () => {
    await vi.waitFor(() => expect(modeButtons()).toHaveLength(2));
    await act(async () => {
      fireEvent.click(modeButtons()[1]!);
    });
    await vi.waitFor(() => expect(calls("/api/map/league")).toBeGreaterThan(0));
    await act(async () => { await Promise.resolve(); });
  };
  return { view, svg, calls, posts, modeButtons, q, toLeague };
}
type Mounted = Awaited<ReturnType<typeof mountMap>>;

function tap(svg: SVGSVGElement, rid: string) {
  document.elementFromPoint = () => svg.querySelector(`[data-rid="${rid}"]`);
  fireEvent.pointerDown(svg, { pointerId: 1, clientX: 100, clientY: 100, timeStamp: 0 });
  fireEvent.pointerUp(svg, { pointerId: 1, clientX: 100, clientY: 100 });
}
// Open a town's card through its region's town list.
async function openTown(m: Mounted, regionId: string, townId: string) {
  await act(async () => tap(m.svg, regionId));
  const card = m.q(`[role="dialog"][data-region="${regionId}"]`)!;
  const entries = [...card.querySelectorAll<HTMLButtonElement>(".w2map-town-entry")];
  const index = WORLD.provinces.find((p) => p.id === regionId)!.towns.indexOf(townId);
  await act(async () => {
    fireEvent.click(entries[index]!);
  });
  return m.q(`[role="dialog"][data-town-id="${townId}"]`)!;
}
const actionsOf = (card: Element) => {
  const buttons = [...card.querySelectorAll<HTMLButtonElement>(".w2map-action")];
  return (label: string) => buttons.find((b) => b.textContent === label)!;
};

describe("the map's switch", () => {
  it("shows for a commander, with the house's men chosen; never for anyone else, nor from an older server", async () => {
    const commander = await mountMap({ commander: true });
    await vi.waitFor(() => expect(commander.modeButtons()).toHaveLength(2));
    expect(commander.modeButtons().map((b) => [b.textContent, b.getAttribute("aria-pressed")])).toEqual([["Your house", "true"], ["The League's army", "false"]]);
    expect(commander.q(".w2map-mode")!.getAttribute("data-mode")).toBe("house");
    // Until he switches, the League's map is not read.
    expect(commander.calls("/api/map/league")).toBe(0);
    cleanup();
    vi.restoreAllMocks();

    for (const seat of [false, undefined]) {
      const other = await mountMap({ commander: seat });
      await vi.waitFor(() => expect(other.calls("/api/map/reach")).toBe(1));
      await act(async () => { await Promise.resolve(); });
      expect(other.modeButtons()).toHaveLength(0);
      expect(other.calls("/api/map/league")).toBe(0);
      cleanup();
      vi.restoreAllMocks();
    }
  });

  it("a refusal from the League's map (the seat is gone) puts the map back on the house's men", async () => {
    const m = await mountMap({ commander: true, leagueStatus: 403 });
    await m.toLeague();
    await vi.waitFor(() => expect(m.q(".w2map-mode")!.getAttribute("data-mode")).toBe("house"));
    expect(m.modeButtons()[0]!.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("the League's mode", () => {
  const sheet = (m: Mounted) => m.q('.w2map-order[role="dialog"]')!;
  const give = (m: Mounted) => sheet(m).querySelector<HTMLButtonElement>(".w2map-order-give")!;
  const men = (m: Mounted, label: string) => sheet(m).querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  // Album passes the war gate: Raid opens the League's order sheet.
  const openRaidOnAlbum = async (m: Mounted) => {
    const town = await openTown(m, "R047", "album");
    await vi.waitFor(() => expect(actionsOf(town)("Raid").disabled).toBe(false));
    await act(async () => {
      fireEvent.click(actionsOf(m.q('[role="dialog"][data-town-id="album"]')!)("Raid"));
    });
    await vi.waitFor(() => expect(sheet(m).querySelectorAll(".w2map-order-place .w2map-pick-row")).toHaveLength(2));
  };

  it("a band across the map says the League's mode is on, in the League's colour; the house's mode has none", async () => {
    const m = await mountMap({ commander: true });
    await vi.waitFor(() => expect(m.modeButtons()).toHaveLength(2));
    expect(m.q(".w2map-league-band")).toBeNull();
    await m.toLeague();
    await vi.waitFor(() => expect(m.q(".w2map-league-band")).not.toBeNull());
    const band = m.q(".w2map-league-band")!;
    expect(band.textContent).toBe("You command the League's army. Every order here is the League's.");
    expect(band.style.background).toBe("rgb(224, 163, 60)"); // Massalia's colour on the map, #e0a33c
    await act(async () => {
      fireEvent.click(m.modeButtons()[0]!);
    });
    expect(m.q(".w2map-league-band")).toBeNull();
  });

  it("a place's buttons open the League's own order sheet, never the house's force picker: its colour and crest, who orders, the League's men by type and number, the cost, and the order it gives", async () => {
    const m = await mountMap({ commander: true });
    await m.toLeague();
    await vi.waitFor(() => expect(m.q(".w2map-mode")!.getAttribute("data-mode")).toBe("league"));
    expect(m.modeButtons()[1]!.getAttribute("aria-pressed")).toBe("true");
    await openRaidOnAlbum(m);

    expect(sheet(m).getAttribute("aria-label")).toBe("The League's order: Raid on Album");
    // The League's colour and crest at its head.
    const banner = sheet(m).querySelector<HTMLElement>(".w2map-order-banner")!;
    expect(banner.style.background).toBe("rgb(224, 163, 60)");
    expect(banner.querySelector(".w2map-order-whose")!.textContent).toBe("The League's army");
    expect(banner.querySelector<HTMLImageElement>("img.w2map-order-crest")!.getAttribute("src")).toContain("MASSALIA");
    expect(sheet(m).querySelector(".w2map-order-title")!.textContent).toBe("Raid on Album");
    expect(sheet(m).querySelector(".w2map-order-by")!.textContent).toBe("Ordered by Seskios, Archon (Dynatoi)");
    // The League's men standing in its place, by type; none of the house's own twenty peltasts.
    expect([...sheet(m).querySelectorAll(".w2map-order-place")].map((g) => g.querySelector(".w2map-pick-base")!.textContent)).toEqual(["Massalia"]);
    expect([...sheet(m).querySelectorAll(".w2map-order-place .w2map-pick-label")].map((l) => l.textContent)).toEqual(["Hoplites · 500 standing", "Peltasts · 250 standing"]);
    expect(sheet(m).textContent).not.toContain("Peltast · 20");
    // It is not the house's picker: no row to tick, no "Go".
    expect(sheet(m).querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect([...sheet(m).querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Close", "Give the order", "Cancel"]);
    // Nothing chosen: no order to give, and the treasury's line is already there.
    expect(give(m).disabled).toBe(true);
    expect(sheet(m).querySelector(".w2map-verdict")!.textContent).toContain("Choose the men by type and number.");
    expect(sheet(m).querySelector('[data-testid="order-cost"]')!.textContent).toBe("No cost to the treasury · 5,000 drachmae in the treasury");

    // Sixty hoplites, by number.
    await act(async () => {
      fireEvent.change(men(m, "Hoplites from Massalia"), { target: { value: "60" } });
    });
    await vi.waitFor(() => expect(give(m).disabled).toBe(false));
    expect(sheet(m).querySelector(".w2map-verdict")!.textContent).toContain("60 men from Massalia");
    expect(sheet(m).querySelector(".w2map-verdict")!.textContent).toContain("by land · 1 step · arrives in 00:30:00");
    await act(async () => {
      fireEvent.click(give(m));
    });
    await vi.waitFor(() => expect(m.posts).toHaveLength(1));
    expect(m.posts[0]!.url).toContain("/api/map/league/act");
    expect(m.posts[0]!.body).toEqual({ type: "raid", townId: "album", rows: [{ rowId: "l-1", count: 60 }] });
    // The set-out card replaces the sheet.
    await vi.waitFor(() => expect(m.view.container.textContent).toContain("500 hoplites set out to raid Album"));
    expect(m.q('.w2map-order[role="dialog"]')).toBeNull();
  });

  it("switching modes closes an open sheet and drops its choice", async () => {
    const m = await mountMap({ commander: true });
    await m.toLeague();
    await openRaidOnAlbum(m);
    await act(async () => {
      fireEvent.change(men(m, "Peltasts from Massalia"), { target: { value: "40" } });
    });
    expect(men(m, "Peltasts from Massalia").value).toBe("40");
    // To the house's men: the sheet is gone, and so is the card under it.
    await act(async () => {
      fireEvent.click(m.modeButtons()[0]!);
    });
    expect(m.q('.w2map-order[role="dialog"]')).toBeNull();
    expect(m.q('.w2map-modal[role="dialog"]')).toBeNull();
    expect(m.q('[role="dialog"]')).toBeNull();
    // Back to the League: a sheet opened again starts from nothing.
    await m.toLeague();
    await openRaidOnAlbum(m);
    expect(men(m, "Peltasts from Massalia").value).toBe("0");
    expect(give(m).disabled).toBe(true);
    expect(m.posts).toHaveLength(0);
  });

  it("a place's panel shows the League's last sighting with its date, in the place of the house's own scouting", async () => {
    // The house scouted Album itself, and the Salyes, some time ago.
    const military = { towns: { album: { garrison: 75, pentekonters: 1, triremes: 1, source: "intel", scoutedGameDate: "Autumn, 299 BC" } }, regions: { R046: { warband: 60, source: "intel", scoutedGameDate: "Autumn, 299 BC" } } };
    const m = await mountMap({ commander: true, military });
    await vi.waitFor(() => expect(m.modeButtons()).toHaveLength(2));
    // In the house's mode: the house's own numbers and their date.
    let town = await openTown(m, "R047", "album");
    expect(town.querySelector('[data-testid="town-intel"]')!.textContent).toBe("Garrison75Fleet1 pentekonters · 1 triremes");
    expect(town.querySelector(".w2map-stat-asof")!.textContent).toBe("as of Autumn, 299 BC");
    // In the League's mode: what the League's own party saw, and that it is the League's.
    await m.toLeague();
    await vi.waitFor(() => expect(m.q(".w2map-league-band")).not.toBeNull());
    town = await openTown(m, "R047", "album");
    await vi.waitFor(() => expect(town.querySelector(".w2map-stat-asof")).not.toBeNull());
    expect(town.querySelector('[data-testid="town-intel"]')!.textContent).toBe("Garrison80Fleet2 pentekonters · 0 triremes");
    expect(town.querySelector(".w2map-stat-asof")!.textContent).toBe("The League's last sighting · Spring, 298 BC");
    // A town the League has not seen shows no survey, whatever the house knows of it.
    await act(async () => {
      fireEvent.click(m.q<HTMLButtonElement>(".w2map-back")!);
    });
    await act(async () => {
      fireEvent.click([...m.q('[role="dialog"][data-region="R047"]')!.querySelectorAll<HTMLButtonElement>(".w2map-town-entry")][0]!);
    });
    expect(m.q('[role="dialog"][data-town-id="reii"] [data-testid="town-intel"]')!.textContent).toBe("GarrisonNo survey yetFleetNo survey yet");
    // A land: the League's sighting of the Salyes' warband.
    await act(async () => tap(m.svg, "R047"));
    await act(async () => tap(m.svg, "R046"));
    const land = m.q('[role="dialog"][data-region="R046"]')!;
    expect(land.textContent).toContain("100");
    expect(land.querySelector(".w2map-stat-asof")!.textContent).toBe("The League's last sighting · Winter, 298 BC");
  });

  it("Attack and Raid are greyed with the war gate's words on a nation at peace and on land of no nation; Scout is not", async () => {
    const m = await mountMap({ commander: true });
    await m.toLeague();
    const town = await openTown(m, "R047", "reii");
    await vi.waitFor(() => expect(actionsOf(town)("Attack").disabled).toBe(true));
    const reii = actionsOf(m.q('[role="dialog"][data-town-id="reii"]')!);
    expect(reii("Attack").getAttribute("title")).toBe("The League is not at war with the Saluvii.");
    expect(reii("Raid").disabled).toBe(true);
    expect(reii("Raid").getAttribute("title")).toBe("The League is not at war with the Saluvii.");
    expect(reii("Scout").disabled).toBe(false);

    await act(async () => tap(m.svg, "R047")); // a tap on the map closes the card
    await act(async () => tap(m.svg, "R046"));
    const land = actionsOf(m.q('[role="dialog"][data-region="R046"]')!);
    expect(land("Attack").disabled).toBe(true);
    expect(land("Attack").getAttribute("title")).toBe("The League makes war only on nations, and no nation holds this land.");
    expect(land("Raid").getAttribute("title")).toBe("The League makes war only on nations, and no nation holds this land.");
    expect(land("Scout").disabled).toBe(false);
  });

  it("SEND MEN HERE shows on a League town, with the League's men standing there", async () => {
    const m = await mountMap({ commander: true });
    await m.toLeague();
    const town = await openTown(m, "R060", "massalia");
    await vi.waitFor(() => expect(town.querySelectorAll(".w2map-action-move")).toHaveLength(1));
    expect(town.querySelectorAll(".w2map-action")).toHaveLength(1);
    expect(town.querySelector(".w2map-action-move")!.textContent).toBe("Send men here");
    expect(town.querySelector(".w2map-your-men")!.textContent).toBe("The League's men here: 500 hoplites and 250 peltasts");
  });
});

describe("the house's mode, for a commander", () => {
  it("is unchanged: no war gate on Reii, the house's own rows in the picker, and the order posted as the house's", async () => {
    const m = await mountMap({ commander: true });
    await vi.waitFor(() => expect(m.modeButtons()).toHaveLength(2));
    const town = await openTown(m, "R047", "reii");
    const reii = actionsOf(town);
    expect(reii("Attack").disabled).toBe(false);
    expect(reii("Attack").getAttribute("title")).toBeNull();
    expect(reii("Raid").disabled).toBe(false);
    await act(async () => {
      fireEvent.click(reii("Raid"));
    });
    const picker = () => m.q('.w2map-modal[role="dialog"]')!;
    await vi.waitFor(() => expect(picker().querySelectorAll(".w2map-pick-group .w2map-pick-row")).toHaveLength(1));
    expect(picker().querySelector(".w2map-pick-whose")).toBeNull();
    expect(picker().querySelector(".w2map-pick-label")!.textContent).toBe("Peltast · 20");
    await act(async () => {
      fireEvent.click(picker().querySelector<HTMLInputElement>('.w2map-pick-group input[type="checkbox"]')!);
    });
    const go = () => [...picker().querySelectorAll<HTMLButtonElement>(".w2map-modal-footer .w2map-action")].find((b) => b.textContent === "Go")!;
    await vi.waitFor(() => expect(go().disabled).toBe(false));
    await act(async () => {
      fireEvent.click(go());
    });
    await vi.waitFor(() => expect(m.posts).toHaveLength(1));
    expect(m.posts[0]!.url).toContain("/api/map/act");
    expect(m.posts[0]!.url).not.toContain("/league");
    expect(m.posts[0]!.body).toEqual({ type: "raid", townId: "reii", rows: [{ rowId: "h-1", count: 20 }] });
    expect(m.calls("/api/map/league")).toBe(0);
  });

  // Ruling 3 at STOP 1: no harvest of the League's work.
  it("where the League's army fought within the year, a commander's own Raid and Attack are greyed with the server's sentence; Scout is not, and the next town is untouched", async () => {
    const sentence = "The League's army fought at Reii. No Archon or Strategos may raid or attack it with his own men until Summer, 297 BC.";
    const m = await mountMap({ commander: true, harvest: { towns: { reii: sentence }, regions: {} } });
    await vi.waitFor(() => expect(m.modeButtons()).toHaveLength(2));
    const reii = actionsOf(await openTown(m, "R047", "reii"));
    expect(reii("Attack").disabled).toBe(true);
    expect(reii("Attack").getAttribute("title")).toBe(sentence);
    expect(reii("Raid").disabled).toBe(true);
    expect(reii("Raid").getAttribute("title")).toBe(sentence);
    expect(reii("Scout").disabled).toBe(false);
    await act(async () => {
      fireEvent.click(m.q<HTMLButtonElement>(".w2map-back")!);
    });
    await act(async () => {
      fireEvent.click([...m.q('[role="dialog"][data-region="R047"]')!.querySelectorAll<HTMLButtonElement>(".w2map-town-entry")][1]!);
    });
    const album = actionsOf(m.q('[role="dialog"][data-town-id="album"]')!);
    expect(album("Attack").disabled).toBe(false);
    expect(album("Raid").disabled).toBe(false);
  });

  it("a League holding reads as the League's to every house: its line, its town entry, and Attack and Raid greyed with the server's sentence", async () => {
    const leagueHolder = { playerId: "p-league", characterName: "The League", houseName: null, league: true };
    const m = await mountMap({ commander: false, military: { towns: {}, regions: {}, holdings: { towns: { reii: leagueHolder }, regions: {} } } });
    await act(async () => tap(m.svg, "R047"));
    const card = m.q('[role="dialog"][data-region="R047"]')!;
    expect([...card.querySelectorAll(".w2map-town-entry")].map((e) => e.textContent?.replace("›", "").trim())).toEqual(["Reii · held by the League", "Album"]);
    await act(async () => {
      fireEvent.click(card.querySelector<HTMLButtonElement>(".w2map-town-entry")!);
    });
    const town = m.q('[role="dialog"][data-town-id="reii"]')!;
    expect(town.querySelector(".w2map-held")!.textContent).toBe("Held by the League");
    const reii = actionsOf(town);
    expect(reii("Attack").disabled).toBe(true);
    expect(reii("Attack").getAttribute("title")).toBe("The League holds this town.");
    expect(reii("Raid").getAttribute("title")).toBe("The League holds this town.");
    expect(reii("Scout").disabled).toBe(false);
  });
});

describe("the League's order sheet and the treasury", () => {
  // Two seas out: 40 peltasts take two pentekonters, a naval supply each.
  const seaEntry: ReachEntry = { landSteps: null, seaSteps: 2, byBase: { massalia: { landSteps: null, seaSteps: 2 } }, attack: { ok: true }, raid: { ok: true }, colonise: { ok: true } };
  const fleet = { ships: { "trade-ship": 29, galley: 40 }, labels: { "trade-ship": "Pentekonter", galley: "Trireme" }, range: 7, space: 740, tiers: [{ range: 7, space: 580 }, { range: 4, space: 160 }], hulls: [{ id: "trade-ship", label: "Pentekonter", role: "transport", count: 29, troopSpace: 20, range: 7, naval: 1, suppliesPerTrip: 1 }, { id: "galley", label: "Trireme", role: "warship", count: 40, troopSpace: 4, range: 4, naval: 5, suppliesPerTrip: 1 }], supplies: 0 };
  const places: BaseView[] = [{ id: "massalia", regionId: "R060", townId: "massalia", kind: "home", name: "Massalia", holding: null }, { id: "nikaia", regionId: "R061", townId: "nikaia", kind: "home", name: "Nikaia", holding: null }];
  const mountSheet = async (treasury: { balance: number; supplyPrice: number }, roster: BarracksRosterRow[] = [row("l-2", "peltast", "Peltast", 250, "massalia")], onOrdered = () => {}) => {
    const { LeagueOrderSheet } = await import("../src/map/LeagueOrderSheet.js");
    const view = render(
      <LeagueOrderSheet type="raid" target={{ kind: "town", id: "thapsus", regionId: "R135", name: "Thapsus" }} entry={seaEntry} places={places} fleet={fleet as never} roster={roster} orderedBy={{ name: "Kleon", office: "strategos", side: null }} treasury={treasury} color="#e0a33c" onClose={() => {}} onOrdered={onOrdered} />,
    );
    const input = (label: string) => view.container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    const set = async (label: string, value: string) => {
      await act(async () => {
        fireEvent.change(input(label), { target: { value } });
      });
    };
    const give = () => view.container.querySelector<HTMLButtonElement>(".w2map-order-give")!;
    const text = (sel: string) => view.container.querySelector(sel)?.textContent ?? "";
    return { view, input, set, give, text };
  };

  it("before he gives it, the sheet shows the hulls, what the voyage's naval supplies cost the treasury, and the treasury's balance", async () => {
    const { set, give, text, input } = await mountSheet({ balance: 5000, supplyPrice: 14 });
    expect(text(".w2map-order-by")).toBe("Ordered by Kleon, Strategos");
    await set("Peltasts from Massalia", "40");
    expect(text('[data-testid="order-cost"]')).toBe("Cost to the treasury: 28 drachmae for 2 naval supplies · 5,000 drachmae in the treasury");
    expect(text(".w2map-verdict")).toContain("40 men from Massalia");
    expect(text(".w2map-verdict")).toContain("by sea · 2 seas · 2 pentekonters carry 40 of 40 · arrives in");
    // The League's hulls, the two that sail by the server's own assembly, his to change.
    expect(text('[data-testid="order-hulls"] .w2map-pick-base')).toBe("The League's hulls");
    expect(input("Pentekonters to sail").value).toBe("2");
    expect(input("Triremes to sail").value).toBe("0");
    expect(give().disabled).toBe(false);
    // An escort of three triremes: five hulls, five supplies.
    await set("Triremes to sail", "3");
    expect(text('[data-testid="order-cost"]')).toBe("Cost to the treasury: 70 drachmae for 5 naval supplies · 5,000 drachmae in the treasury");
    expect(text(".w2map-verdict")).toContain("3 triremes escort");
  });

  it("a voyage the treasury cannot pay for is refused in the server's sentence, and the order cannot be given", async () => {
    const { set, give, text } = await mountSheet({ balance: 27, supplyPrice: 14 });
    await set("Peltasts from Massalia", "40");
    expect(text('[data-testid="order-cost"]')).toBe("Cost to the treasury: 28 drachmae for 2 naval supplies · 27 drachmae in the treasury");
    expect(text(".w2map-verdict")).toContain("The treasury cannot pay for the voyage: 28 drachmae of naval supplies, 27 in the treasury.");
    expect(give().disabled).toBe(true);
  });

  it("men of one type in two rows are one line, and the number is spread over the rows; an order marches from one place", async () => {
    const posts: unknown[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      posts.push(JSON.parse(String(init?.body)));
      return jsonResponse({ report: SET_OUT, reach: { ...LEAGUE_VIEW, now: iso(Date.now()) }, force: LEAGUE_VIEW.force, fleet: LEAGUE_VIEW.fleet, roster: LEAGUE_ROSTER });
    });
    const two = [{ ...row("l-a", "hoplite", "Hoplite", 300, "massalia"), createdAt: iso(1000) }, { ...row("l-b", "hoplite", "Hoplite", 200, "massalia"), createdAt: iso(2000) }, row("l-n", "hoplite", "Hoplite", 76, "nikaia")];
    const { view, set, give, input, text } = await mountSheet({ balance: 5000, supplyPrice: 14 }, two);
    expect([...view.container.querySelectorAll(".w2map-order-place")].map((g) => [g.querySelector(".w2map-pick-base")!.textContent, [...g.querySelectorAll(".w2map-pick-label")].map((l) => l.textContent)])).toEqual([
      ["Massalia", ["Hoplites · 500 standing"]],
      ["Nikaia", ["Hoplites · 76 standing"]],
    ]);
    // A number at Nikaia, then one at Massalia: Nikaia's is cleared, and the sheet says why.
    await set("Hoplites from Nikaia", "10");
    await set("Hoplites from Massalia", "350");
    expect(input("Hoplites from Nikaia").value).toBe("0");
    expect(text(".w2map-pick-scroll")).toContain("An order marches from one place.");
    // More than stand there is held to what stands.
    await set("Hoplites from Massalia", "900");
    expect(input("Hoplites from Massalia").value).toBe("500");
    await set("Hoplites from Massalia", "350");
    await act(async () => {
      fireEvent.click(give());
    });
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ type: "raid", townId: "thapsus", rows: [{ rowId: "l-a", count: 300 }, { rowId: "l-b", count: 50 }] });
  });

  it("the house's force picker is as it was: no treasury line, its own stock checked, its own words", async () => {
    const { ForcePicker } = await import("../src/map/World2Map.js");
    const view = render(<ForcePicker type="raid" target={{ kind: "town", id: "thapsus", regionId: "R135", name: "Thapsus" }} names={{ massalia: "Massalia" }} entry={seaEntry} fleet={fleet as never} roster={[row("h-9", "peltast", "Peltast", 40, "massalia")]} onClose={() => {}} onActed={() => {}} />);
    await act(async () => {
      fireEvent.click(view.container.querySelector<HTMLInputElement>('.w2map-pick-group input[type="checkbox"]')!);
    });
    expect(view.container.querySelector('[data-testid="order-cost"]')).toBeNull();
    expect(view.container.querySelector(".w2map-order-banner")).toBeNull();
    expect(view.container.querySelector(".w2map-verdict")!.textContent).toContain("Not enough naval supplies: 2 needed, 0 in store.");
    expect([...view.container.querySelectorAll<HTMLButtonElement>(".w2map-modal-footer .w2map-action")].map((b) => [b.textContent, b.disabled])).toEqual([["Go", true], ["Cancel", false]]);
  });
});

describe("holdingLine in the League's mode", () => {
  const town: BaseView = { id: "reii", regionId: "R047", townId: "reii", kind: "conquest", name: "Reii", holding: { garrison: 47, minGarrison: 15, perDay: { drachmae: 120, grain: 0, timber: 0 }, levyPerYear: 0 } };
  const land: BaseView = { id: "R046", regionId: "R046", townId: null, kind: "conquest", name: "Salyes", holding: { garrison: 5, minGarrison: 1, perDay: { drachmae: 0, grain: 15, timber: 8 }, levyPerYear: 0 } };
  it("names the League as the holder, and a land holding adds no levy", () => {
    expect(holdingLine(town, true)).toBe("Held by the League · tribute 120 dr a day");
    expect(holdingLine({ ...town, holding: { ...town.holding!, garrison: 3 } }, true)).toBe("Held by the League · garrison too small for tribute (15 men needed)");
    expect(holdingLine(land, true)).toBe("Held by the League · 15 grain, 8 timber a day");
  });
  it("a house's lines are as they were", () => {
    expect(holdingLine(town)).toBe("Held by your house · tribute 120 dr a day");
    expect(holdingLine({ ...land, holding: { ...land.holding!, levyPerYear: 5 } })).toBe("Held by your house · 15 grain, 8 timber a day · +5 levy a year");
  });
});

// Holdings prompt 4: the League's men may stand in a house's holding. In the
// League's mode a house's town or land holding is among the League's move
// targets (kind "guest"): SEND MEN HERE stands beside its actions, which keep
// the holder's refusals, and opens the League's own order sheet for a move. In
// the house's mode the same place opens the house's picker, as before.
describe("a house's holding, for the League's men", () => {
  const KONRAD = { playerId: "p-konrad", characterName: "Konrad Curze", houseName: "Leonidas" };
  const AJAX = { playerId: "p-ajax", characterName: "Ajax Marius", houseName: "Kleitos" };
  const HELD = { towns: {}, regions: {}, holdings: { towns: { reii: KONRAD }, regions: { R046: AJAX } } };
  const guest = (base: string) => [
    { id: "reii", regionId: "R047", townId: "reii", kind: "guest", name: "Reii", byBase: { [base]: { landSteps: 1, seaSteps: null } } },
    { id: "R046", regionId: "R046", townId: null, kind: "guest", name: "Salyes", byBase: { [base]: { landSteps: 1, seaSteps: null } } },
  ];
  const labels = (card: Element) => [...card.querySelectorAll<HTMLButtonElement>(".w2map-action")].map((b) => [b.textContent, b.disabled, b.getAttribute("title")]);
  const sheet = (m: Mounted) => m.q('.w2map-order[role="dialog"]');

  it("in the League's mode a house's town holding shows SEND MEN HERE beside its actions, and it opens the League's order sheet for a move", async () => {
    const m = await mountMap({ commander: true, military: HELD, leagueView: { moveTargets: [...LEAGUE_VIEW.moveTargets, ...guest("massalia")] } });
    await m.toLeague();
    const town = await openTown(m, "R047", "reii");
    await vi.waitFor(() => expect(town.querySelectorAll(".w2map-action-move")).toHaveLength(1));
    expect(town.querySelector(".w2map-held")!.textContent).toBe("Held by House Leonidas · Konrad Curze");
    expect(labels(town)).toEqual([
      ["Attack", true, "Another house holds this town."],
      ["Raid", true, "Another house holds this town."],
      ["Scout", false, null],
      ["Colonise", true, "Colonies are founded in open country"],
      ["Send men here", false, null],
    ]);
    await act(async () => {
      fireEvent.click(town.querySelector<HTMLButtonElement>(".w2map-action-move")!);
    });
    await vi.waitFor(() => expect(sheet(m)).not.toBeNull());
    expect(sheet(m)!.getAttribute("aria-label")).toBe("The League's order: Move to Reii");
    expect(m.q(".w2map-modal:not(.w2map-order)")).toBeNull();
  });

  it("in the League's mode a house's land holding does the same", async () => {
    const m = await mountMap({ commander: true, military: HELD, leagueView: { moveTargets: [...LEAGUE_VIEW.moveTargets, ...guest("massalia")] } });
    await m.toLeague();
    await act(async () => tap(m.svg, "R046"));
    const card = m.q('[role="dialog"][data-region="R046"]')!;
    await vi.waitFor(() => expect(card.querySelectorAll(".w2map-action-move")).toHaveLength(1));
    expect(card.querySelector(".w2map-held")!.textContent).toBe("Held by House Kleitos · Ajax Marius");
    expect(labels(card).map(([label]) => label)).toEqual(["Attack", "Raid", "Scout", "Colonise", "Send men here"]);
    expect(labels(card).slice(0, 2)).toEqual([["Attack", true, "Another house holds this land."], ["Raid", true, "Another house holds this land."]]);
    await act(async () => {
      fireEvent.click(card.querySelector<HTMLButtonElement>(".w2map-action-move")!);
    });
    await vi.waitFor(() => expect(sheet(m)).not.toBeNull());
    expect(sheet(m)!.getAttribute("aria-label")).toBe("The League's order: Move to Salyes");
  });

  it("in the house's mode nothing changes: the same holding opens the house's own picker, never the League's sheet", async () => {
    const m = await mountMap({ commander: true, military: HELD, houseReach: { moveTargets: [...HOUSE_REACH.moveTargets, ...guest("R060")] }, leagueView: { moveTargets: [...LEAGUE_VIEW.moveTargets, ...guest("massalia")] } });
    await vi.waitFor(() => expect(m.modeButtons()).toHaveLength(2));
    const town = await openTown(m, "R047", "reii");
    await vi.waitFor(() => expect(town.querySelectorAll(".w2map-action-move")).toHaveLength(1));
    await act(async () => {
      fireEvent.click(town.querySelector<HTMLButtonElement>(".w2map-action-move")!);
    });
    await vi.waitFor(() => expect(m.q('.w2map-modal[role="dialog"]')).not.toBeNull());
    expect(m.q('.w2map-modal[role="dialog"]')!.getAttribute("aria-label")).toBe("Send men to Reii");
    expect(sheet(m)).toBeNull();
    expect(m.calls("/api/map/league")).toBe(0);
  });
});
