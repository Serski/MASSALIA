// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { BarracksRosterRow, BaseView, ReachEntry } from "../src/api.js";
import { holdingLine } from "../src/map/World2Map.js";

// ---------------------------------------------------------------------------
// The League's army on the map (government prompt 5b). A sitting Archon or
// Strategos (the server's `commander` on GET /api/map/reach) sees a switch,
// "Your house" or "The League's army". In the League's mode the map reads GET
// /api/map/league, the picker lists the League's rows and posts the League's
// order, Attack and Raid are greyed with the war gate's sentence on a nation
// at peace, SEND MEN HERE shows on a League town, and a voyage shows what its
// naval supplies cost the treasury. The house's mode is as it was. Network is
// mocked; the stage is given a size so the camera initialises (jsdom measures
// nothing), as in world2map-cards.test.tsx.
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
async function mountMap(opts: { commander?: boolean; military?: Record<string, unknown>; leagueStatus?: number; harvest?: { towns: Record<string, string>; regions: Record<string, string> } } = {}) {
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
    if (url.includes("/api/map/league")) return (opts.leagueStatus ?? 200) === 200 ? jsonResponse({ ...LEAGUE_VIEW, now: iso(Date.now()) }) : jsonResponse({ error: "Only a sitting Archon or Strategos commands the League's army." }, opts.leagueStatus);
    if (url.includes("/api/map/reach")) return jsonResponse({ ...HOUSE_REACH, now: iso(Date.now()), ...(opts.commander === undefined ? {} : { commander: opts.commander }), ...(opts.harvest ? { harvest: opts.harvest } : {}) });
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
  it("the picker lists the League's rows and posts the League's order", async () => {
    const m = await mountMap({ commander: true });
    await m.toLeague();
    await vi.waitFor(() => expect(m.q(".w2map-mode")!.getAttribute("data-mode")).toBe("league"));
    expect(m.modeButtons()[1]!.getAttribute("aria-pressed")).toBe("true");

    // Album passes the war gate: Raid opens the picker.
    const town = await openTown(m, "R047", "album");
    await vi.waitFor(() => expect(actionsOf(town)("Raid").disabled).toBe(false));
    await act(async () => {
      fireEvent.click(actionsOf(m.q('[role="dialog"][data-town-id="album"]')!)("Raid"));
    });
    const picker = () => m.q('.w2map-modal[role="dialog"]')!;
    await vi.waitFor(() => expect(picker().querySelectorAll(".w2map-pick-group .w2map-pick-row")).toHaveLength(2));
    expect(picker().getAttribute("aria-label")).toBe("Raid Album");
    expect(picker().querySelector(".w2map-pick-whose")!.textContent).toBe("The League's army");
    expect(picker().querySelector(".w2map-pick-base")!.textContent).toBe("From Massalia");
    expect([...picker().querySelectorAll(".w2map-pick-group .w2map-pick-label")].map((l) => l.textContent)).toEqual(["Hoplite · 500", "Peltast · 250"]);
    // The house's own twenty peltasts are not in it.
    expect(picker().textContent).not.toContain("Peltast · 20");

    await act(async () => {
      fireEvent.click(picker().querySelector<HTMLInputElement>('.w2map-pick-group input[type="checkbox"]')!);
    });
    const go = () => [...picker().querySelectorAll<HTMLButtonElement>(".w2map-modal-footer .w2map-action")].find((b) => b.textContent === "Go")!;
    await vi.waitFor(() => expect(go().disabled).toBe(false));
    await act(async () => {
      fireEvent.click(go());
    });
    await vi.waitFor(() => expect(m.posts).toHaveLength(1));
    expect(m.posts[0]!.url).toContain("/api/map/league/act");
    expect(m.posts[0]!.body).toEqual({ type: "raid", townId: "album", rows: [{ rowId: "l-1", count: 500 }] });
    // The set-out card replaces the picker.
    await vi.waitFor(() => expect(m.view.container.textContent).toContain("500 hoplites set out to raid Album"));
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

describe("the League's picker and the treasury", () => {
  // Two seas out: 40 peltasts take two pentekonters, a naval supply each.
  const seaEntry: ReachEntry = { landSteps: null, seaSteps: 2, byBase: { massalia: { landSteps: null, seaSteps: 2 } }, attack: { ok: true }, raid: { ok: true }, colonise: { ok: true } };
  const fleet = { ships: { "trade-ship": 29 }, labels: { "trade-ship": "Pentekonter" }, range: 7, space: 580, tiers: [{ range: 7, space: 580 }], hulls: [{ id: "trade-ship", label: "Pentekonter", role: "transport", count: 29, troopSpace: 20, range: 7, naval: 1, suppliesPerTrip: 1 }], supplies: 0 };
  const mountPicker = async (league: { balance: number; supplyPrice: number } | null) => {
    const { ForcePicker } = await import("../src/map/World2Map.js");
    const view = render(
      <ForcePicker type="raid" target={{ kind: "town", id: "thapsus", regionId: "R135", name: "Thapsus" }} names={{ massalia: "Massalia" }} entry={seaEntry} fleet={fleet as never} roster={[row("l-2", "peltast", "Peltast", 40, "massalia")]} league={league} onClose={() => {}} onActed={() => {}} />,
    );
    await act(async () => {
      fireEvent.click(view.container.querySelector<HTMLInputElement>('.w2map-pick-group input[type="checkbox"]')!);
    });
    const go = [...view.container.querySelectorAll<HTMLButtonElement>(".w2map-modal-footer .w2map-action")].find((b) => b.textContent === "Go")!;
    return { view, go, verdict: () => view.container.querySelector(".w2map-verdict")!.textContent ?? "" };
  };

  it("before he sends, the picker shows the naval supplies the voyage takes, what they cost the treasury, and the treasury's balance", async () => {
    const { view, go, verdict } = await mountPicker({ balance: 5000, supplyPrice: 14 });
    expect(view.container.querySelector('[data-testid="league-supplies"]')!.textContent).toBe("2 naval supplies · 28 drachmae from the treasury · 5,000 in the treasury");
    expect(verdict()).toContain("Within reach.");
    expect(go.disabled).toBe(false);
  });

  it("a voyage the treasury cannot pay for is refused in the server's sentence, and Go is greyed", async () => {
    const { view, go, verdict } = await mountPicker({ balance: 27, supplyPrice: 14 });
    expect(view.container.querySelector('[data-testid="league-supplies"]')!.textContent).toBe("2 naval supplies · 28 drachmae from the treasury · 27 in the treasury");
    expect(verdict()).toContain("The treasury cannot pay for the voyage: 28 drachmae of naval supplies, 27 in the treasury.");
    expect(go.disabled).toBe(true);
  });

  it("a house's picker shows no treasury line and checks its own stock, as before", async () => {
    const { view, go, verdict } = await mountPicker(null);
    expect(view.container.querySelector('[data-testid="league-supplies"]')).toBeNull();
    expect(verdict()).toContain("Not enough naval supplies: 2 needed, 0 in store.");
    expect(go.disabled).toBe(true);
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
