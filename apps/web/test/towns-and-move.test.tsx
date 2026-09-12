// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type BarracksRosterRow, type BarracksView, type MapActReport, type MapReachView } from "../src/api.js";
import BarracksPanel from "../src/dashboard/panels/BarracksPanel.js";
import { BattleReport, ForcePicker, holdingLine, TownPanel } from "../src/map/World2Map.js";

// ---------------------------------------------------------------------------
// Towns and moves on the client (barracks prompt 3c, phase 2): the town panel
// with and without intel and when held; the report sheet for a repulsed sea
// assault and a taken town; the move picker opened from the map and from a
// Barracks row (one component, mounted from two places). Network is mocked.
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const H = 3_600_000;
const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const stats = { atk: 3, def: 2, msl: 5, mor: 4, spd: 8, space: 1 };
const row = (over: Partial<BarracksRosterRow> & { id: string }): BarracksRosterRow => ({
  source: "trained", unitId: "hoplite", label: "Hoplite", plural: "Hoplites", icon: "HOPLITE.webp", count: 20, startCount: 20, recruitedSeason: 9,
  readyAt: iso(NOW - 5 * H), contractEndAt: null, basedAt: "R060", movingTo: null, arrivesAt: null, mission: null, createdAt: iso(NOW - 29 * H),
  stats: { ...stats, spd: 4 }, active: true, canDisband: true, ...over,
});
const fleet = { ships: { "trade-ship": 1, galley: 0 }, range: 7, space: 20, tiers: [{ range: 7, space: 20 }] };
const actions = { buttons: [{ type: "attack" as const, label: "Attack", enabled: true }, { type: "raid" as const, label: "Raid", enabled: true }, { type: "scout" as const, label: "Scout", enabled: true }, { type: "colonise" as const, label: "Colonise", enabled: false, title: "Colonies are founded in open country" }], caption: null };
const noop = () => {};

describe("TownPanel", () => {
  const base = { town: { id: "vienna", name: "Vienna" }, regionName: "Allobroges", stateName: "Cavares", ownerId: "cavares", color: "#884", stats: { population: 3000, walls: 1 }, actions, canSendMen: false, isMobile: false, onClose: noop, onBack: noop, onSendMen: noop };

  it("without intel: the survey line, No survey yet for garrison and fleet, and the actions open the picker", () => {
    const onAction = vi.fn();
    const { container, getByTestId } = render(<TownPanel {...base} mil={undefined} held={null} yourMen={null} onAction={onAction} />);
    expect(getByTestId("town-survey").textContent).toContain("Walls 1 · Population 3,000");
    expect(getByTestId("town-intel").textContent).toContain("No survey yet");
    expect(container.textContent).not.toContain("as of");
    fireEvent.click(within(container).getByText("Scout"));
    expect(onAction).toHaveBeenCalledWith("scout");
    expect((within(container).getByText("Colonise") as HTMLButtonElement).disabled).toBe(true);
  });

  it("with intel: garrison and fleet with the date scouted; held: Massalia's crest and the tribute line, and SEND MEN HERE in place of the row", () => {
    const mil = { garrison: 120, pentekonters: 2, triremes: 1, source: "intel" as const, scoutedGameDate: "Spring, 298 BC" };
    const view = render(<TownPanel {...base} mil={mil} held={null} yourMen={null} onAction={noop} />);
    expect(view.getByTestId("town-intel").textContent).toContain("120");
    expect(view.getByTestId("town-intel").textContent).toContain("2 pentekonters · 1 triremes");
    expect(view.container.textContent).toContain("as of Spring, 298 BC");
    // Held, garrisoned: the tribute line and the move button.
    const held = { id: "vienna", regionId: "R032", townId: "vienna", kind: "conquest" as const, name: "Vienna", holding: { garrison: 30, minGarrison: 30, perDay: { drachmae: 120, grain: 0, timber: 0 }, levyPerYear: 0 } };
    const onSendMen = vi.fn();
    view.rerender(<TownPanel {...base} stateName="Massalia" ownerId="massalia" mil={mil} held={held} yourMen="Your men here: 30 hoplites" canSendMen onAction={noop} onSendMen={onSendMen} />);
    expect(view.container.querySelector(".w2map-held")!.textContent).toBe("Held by your house · tribute 120 dr a day");
    expect(view.container.querySelector(".w2map-your-men")!.textContent).toBe("Your men here: 30 hoplites");
    expect(view.container.textContent).toContain("Massalia · Allobroges");
    expect(view.queryByText("Attack")).toBeNull();
    fireEvent.click(view.getByText("Send men here"));
    expect(onSendMen).toHaveBeenCalled();
    // Under the minimum: the garrison line names the men needed.
    expect(holdingLine({ ...held, holding: { ...held.holding, garrison: 12 } })).toBe("Held by your house · garrison too small for tribute (30 men needed)");
    expect(holdingLine({ id: "R046", regionId: "R046", townId: null, kind: "conquest", name: "Salyes", holding: { garrison: 5, minGarrison: 1, perDay: { drachmae: 0, grain: 15, timber: 8 }, levyPerYear: 5 } })).toBe("Held by your house · 15 grain, 8 timber a day · +5 levy a year");
  });
});

describe("BattleReport · towns and moves", () => {
  const attackerRows = [{ id: "r1", unitId: "peltast", label: "Peltast", icon: "PELTAST.webp", start: 40, end: 40, broke: false }];
  const report = (over: Partial<MapActReport>): MapActReport => ({
    type: "attack", regionId: "R073", regionName: "Corsica", townId: "aleria", townName: "Aleria", town: { walls: 2, population: 2000, garrisonDef: 9 }, fleet: null,
    base: "R060", route: "sea", steps: 2, recoveryHours: 6, arrivesAt: iso(NOW + 6 * H), destination: "R060", ships: { "trade-ship": 2 }, winner: "attacker", rounds: 3,
    attacker: { rows: attackerRows, losses: 0 }, defender: { label: "Town garrison", start: 10, end: 0, losses: 10 }, plunder: null, conquest: null, intel: null, line: "", ...over,
  });

  it("a repulsed sea assault: the outcome line, the walls line, the fleet line that was driven off, no rows table", () => {
    const r = report({ winner: "repulsed", rounds: 0, fleet: { ships: { "trade-ship": 3 }, naval: 3, defender: { pentekonters: 2, triremes: 1, naval: 7 }, held: false }, defender: { label: "Town garrison", start: 150, end: 150, losses: 0 }, line: "Sailed against Aleria with 40 peltasts and were driven off by its fleet before landing." });
    const { container, getByTestId } = render(<BattleReport report={r} onClose={noop} />);
    expect(container.querySelector(".w2map-report-line")!.textContent).toBe(r.line);
    expect(getByTestId("walls-line").textContent).toBe("Walls 2, garrison defends at 9");
    expect(getByTestId("fleet-line").textContent).toBe("Your 3 pentekonters against 2 pentekonters and 1 trireme: the landing was driven off");
    expect(container.querySelector(".w2map-report-table")).toBeNull();
    expect(container.textContent).toContain("The party returns in 6h.");
  });

  it("a taken town: the landing held, the rows table, the conquest line, and the party settles in", () => {
    const r = report({ fleet: { ships: { "trade-ship": 2, galley: 5 }, naval: 27, defender: { pentekonters: 4, triremes: 4, naval: 24 }, held: true }, conquest: { regionId: "R073", townId: "aleria", previousOwner: "etruscans" }, destination: "aleria", line: "Took Aleria with 40 peltasts: 10 soldiers slain, none of ours lost. The town is ours." });
    const { container, getByTestId } = render(<BattleReport report={r} onClose={noop} />);
    expect(getByTestId("fleet-line").textContent).toBe("Your 2 pentekonters and 5 triremes against 4 pentekonters and 4 triremes: the landing held");
    expect(container.querySelector(".w2map-report-enemy")!.textContent).toBe("Town garrison100");
    expect(container.textContent).toContain("Aleria is yours. The survivors hold it.");
    expect(container.textContent).toContain("The party settles in in 6h.");
    // A move: one line.
    const move = render(<BattleReport report={{ type: "move", from: "R060", fromName: "Massalia", baseId: "nikaia", regionId: "R059", regionName: "Ligurians", townId: "nikaia", townName: "Nikaia", route: "land", steps: 1, minutes: 30, arrivesAt: iso(NOW + H / 2), ships: {}, men: 20, rows: [], line: "20 hoplites march from Massalia to Nikaia, arriving in 00:30:00." }} onClose={noop} />);
    expect(move.container.querySelector(".w2map-report-line")!.textContent).toBe("20 hoplites march from Massalia to Nikaia, arriving in 00:30:00.");
    expect(move.container.querySelector(".w2map-report-table")).toBeNull();
  });
});

const moveTargets = [
  { id: "R060", regionId: "R060", townId: null, kind: "massalia" as const, name: "Massalia", byBase: { R060: { landSteps: 0, seaSteps: 1 }, R046: { landSteps: 1, seaSteps: null } } },
  { id: "nikaia", regionId: "R059", townId: "nikaia", kind: "home" as const, name: "Nikaia", byBase: { R060: { landSteps: 1, seaSteps: 1 }, R046: { landSteps: 2, seaSteps: null } } },
  { id: "R046", regionId: "R046", townId: null, kind: "conquest" as const, name: "Salyes", byBase: { R060: { landSteps: 1, seaSteps: null }, R046: { landSteps: 0, seaSteps: null } } },
  { id: "emporion", regionId: "R065", townId: "emporion", kind: "home" as const, name: "Emporion", byBase: { R060: { landSteps: null, seaSteps: 1 }, R046: { landSteps: null, seaSteps: null } } },
];
const names = { R060: "Massalia", R046: "Salyes", nikaia: "Nikaia", emporion: "Emporion" };

describe("move picker", () => {
  it("from the map: rows grouped by base with the move verdict, the destination's own rows greyed, the march line, and Go sends the move", async () => {
    const roster = [row({ id: "home-1", count: 20 }), row({ id: "salyes-1", count: 5, basedAt: "R046" })];
    const mapMove = vi.spyOn(api, "mapMove").mockResolvedValue({ report: { type: "move", line: "" } as never, reach: {} as never, force: { men: 0, space: 0, fast: false }, fleet, roster });
    const onActed = vi.fn();
    const { container, getByText } = render(
      <ForcePicker type="move" target={{ kind: "town", id: "nikaia", regionId: "R059", name: "Nikaia" }} names={names} moveTargets={moveTargets} fleet={fleet} roster={roster} onClose={noop} onActed={onActed} />,
    );
    expect(container.querySelector(".w2map-info-label")!.textContent).toBe("Send men to · Nikaia");
    const groups = [...container.querySelectorAll(".w2map-pick-group")];
    expect(groups.map((g) => g.getAttribute("data-base"))).toEqual(["R060", "R046"]);
    // Salyes is two land steps from Nikaia and has no coast: no route.
    expect(groups[1]!.classList.contains("unreachable")).toBe(true);
    expect(groups[1]!.querySelector(".w2map-pick-why")!.textContent).toBe("No base within reach.");
    fireEvent.click(groups[0]!.querySelector("input[type=checkbox]")!);
    const verdict = container.querySelector(".w2map-verdict")!.textContent!;
    expect(verdict).toContain("20 men");
    expect(verdict).toContain("by land · 1 step · arrives in 00:30:00");
    expect(verdict).toContain("Ready to march.");
    await act(async () => {
      fireEvent.click(getByText("Go"));
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(mapMove).toHaveBeenCalledWith("nikaia", [{ rowId: "home-1", count: 20 }]);
    expect(onActed).toHaveBeenCalled();
  });

  it("a sea move short of hulls reads the hull reason; the destination base itself cannot be the origin", () => {
    const roster = [row({ id: "home-1", count: 40 })];
    const sea = render(<ForcePicker type="move" target={{ kind: "town", id: "emporion", regionId: "R065", name: "Emporion" }} names={names} moveTargets={moveTargets} fleet={fleet} roster={roster} onClose={noop} onActed={noop} />);
    fireEvent.click(sea.container.querySelector("input[type=checkbox]")!);
    expect(sea.container.querySelector(".w2map-verdict")!.textContent).toContain("Not enough hulls: 40 space needed, 20 aboard.");
    expect((sea.container.querySelector(".w2map-action") as HTMLButtonElement).disabled).toBe(true);
    sea.unmount();
    // The picker is mounted afresh per target: the men's own base is no origin.
    const home = render(<ForcePicker type="move" target={{ kind: "region", id: "R060", regionId: "R060", name: "Massalia" }} names={names} moveTargets={moveTargets} fleet={fleet} roster={roster} onClose={noop} onActed={noop} />);
    expect(home.container.querySelector(".w2map-pick-group")!.classList.contains("unreachable")).toBe(true);
    expect(home.container.querySelector(".w2map-pick-why")!.textContent).toBe("The men already stand there.");
  });

  it("from a Barracks row: MOVE opens the same picker with the row pre-ticked and a destination selector, Go runs the move, the report shows and the panel refetches", async () => {
    const hoplites = row({ id: "home-hoplites", count: 26 });
    const view: BarracksView = {
      gate: { stat: "militia", required: 20, current: 26, met: true },
      places: { R060: "Massalia" },
      season: 93,
      now: iso(NOW),
      levy: { men: 3 },
      config: { minServiceSeasons: 2, maxActiveBands: 2, termSeasons: 2 },
      units: [],
      roster: [hoplites],
      offers: [],
      activeBands: 0,
      upkeep: { perDay: {}, rows: {}, note: "" },
      summary: { underArms: 26, levyMen: 3, growthPerYear: 15, baseGrowthPerYear: 10, heldRegions: 1, seasonsPerYear: 4 },
    };
    const reach: MapReachView = { now: iso(NOW), campaign: { season: "Spring", open: true, opensAt: null }, bases: [], force: { men: 26, space: 26, fast: false }, fleet, reach: {}, moveTargets };
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ version: 1, names: { R060: "Massalia", R046: "Salyes" } }), { status: 200, headers: { "content-type": "application/json" } }));
    const barracks = vi.spyOn(api, "barracks").mockResolvedValue(view);
    vi.spyOn(api, "mapReach").mockResolvedValue(reach);
    const mapMove = vi.spyOn(api, "mapMove").mockResolvedValue({
      report: { type: "move", from: "R060", fromName: "Massalia", baseId: "R046", regionId: "R046", regionName: "Salyes", townId: null, townName: null, route: "land", steps: 1, minutes: 30, arrivesAt: iso(NOW + H / 2), ships: {}, men: 26, rows: [], line: "26 hoplites march from Massalia to Salyes, arriving in 00:30:00." },
      reach,
      force: { men: 0, space: 0, fast: false },
      fleet,
      roster: [{ ...hoplites, movingTo: "R046", arrivesAt: iso(NOW + H / 2), mission: { kind: "move", regionId: "R046", departedAt: iso(NOW) } }],
    });
    const player = { gameDateLabel: "Spring, 277 BC" } as unknown as Parameters<typeof BarracksPanel>[0]["player"];
    const { container, getByLabelText, getByText } = render(<BarracksPanel player={player} onRefresh={noop} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    // The COME OF AGE cell shows the total with the held region.
    expect(container.querySelector('[data-testid="summary"]')!.textContent).toContain("+15 each year");
    fireEvent.click(getByText("Move"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    const dialog = container.querySelector(".w2map-modal")!;
    expect(dialog).not.toBeNull();
    const box = dialog.querySelector("input[type=checkbox]") as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect((dialog.querySelector(".w2map-pick-count") as HTMLInputElement).value).toBe("26");
    // The selector: every place with its travel time from Massalia, the base
    // itself and the sea crossing short of hulls greyed with the reason.
    const select = getByLabelText("Destination") as HTMLSelectElement;
    const options = [...select.options].map((o) => ({ text: o.text, disabled: o.disabled }));
    expect(options).toEqual([
      { text: "Massalia · The men already stand there.", disabled: true },
      { text: "Nikaia · 00:30:00", disabled: false },
      { text: "Salyes · 00:30:00", disabled: false },
      { text: "Emporion · Not enough hulls: 26 space needed, 20 aboard.", disabled: true },
    ]);
    fireEvent.change(select, { target: { value: "R046" } });
    expect(dialog.querySelector(".w2map-info-label")!.textContent).toBe("Send men to · Salyes");
    expect(dialog.querySelector(".w2map-verdict")!.textContent).toContain("Ready to march.");
    await act(async () => {
      fireEvent.click(within(dialog as HTMLElement).getByText("Go"));
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(mapMove).toHaveBeenCalledWith("R046", [{ rowId: "home-hoplites", count: 26 }]);
    expect(container.querySelector(".w2map-report-line")!.textContent).toBe("26 hoplites march from Massalia to Salyes, arriving in 00:30:00.");
    expect(barracks).toHaveBeenCalledTimes(2); // the mount and the refetch after the march
  });
});
