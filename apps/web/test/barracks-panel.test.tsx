// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type BarracksReport, type BarracksRosterRow, type BarracksView, type KoinonMusterReport, type MapActReport } from "../src/api.js";
import BarracksPanel, { countText } from "../src/dashboard/panels/BarracksPanel.js";

// ---------------------------------------------------------------------------
// The Barracks panel (ui-2) mounted against a mocked API: locked; unlocked with
// home rows of both kinds, an away row with a mission and one without, a
// training row, and offers hired / open / capped; then re-rendered after a mock
// cancel and a mock recruit. Section counts, mission lines, stepper bounds, and
// no hook-order warning across every render.
// ---------------------------------------------------------------------------

const H = 3_600_000;
const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const stats = { atk: 3, def: 2, msl: 5, mor: 4, spd: 8, space: 1 };

const row = (over: Partial<BarracksRosterRow> & { id: string }): BarracksRosterRow => ({
  source: "trained", unitId: "peltast", label: "Peltast", plural: "Peltasts", icon: "PELTAST.webp", count: 20, startCount: 20, recruitedSeason: 9,
  readyAt: iso(NOW - 5 * H), contractEndAt: null, basedAt: "R060", movingTo: null, arrivesAt: null, mission: null, createdAt: iso(NOW - 29 * H),
  stats, active: true, canDisband: true, ...over,
});
const homeLevy = row({ id: "home-hoplites", unitId: "hoplite", label: "Hoplite", plural: "Hoplites", icon: "HOPLITE.webp", count: 26, startCount: 30 });
const homeBand = row({ id: "home-band", source: "band", unitId: "volcae-irregulars", label: "Volcae irregulars", plural: "Volcae irregulars", icon: "BAND_VOLCAE.webp", count: 40, startCount: 40, readyAt: null, contractEndAt: iso(NOW + 40 * H), canDisband: false });
const awayRaid = row({ id: "away-raid", unitId: "hippeis", label: "Hippeis", plural: "Hippeis", count: 30, startCount: 30, movingTo: "R060", arrivesAt: iso(NOW + 2 * H), mission: { kind: "raid", regionId: "R046", departedAt: iso(NOW - H) } });
const awayNoMission = row({ id: "away-plain", count: 7, startCount: 7, movingTo: "R060", arrivesAt: iso(NOW + 5 * H), mission: null });
const trainingRow = row({ id: "training-ekdromoi", unitId: "ekdromos", label: "Ekdromos", plural: "Ekdromoi", count: 4, startCount: 4, active: false, readyAt: iso(NOW + 18 * H), createdAt: iso(NOW - 6 * H) });

const unit = (id: string, label: string, plural: string, trainSeasons: number, upkeepPerDay: Record<string, number> = { grain: 2, oliveoil: 1 }) => ({ id, label, plural, icon: `${id.toUpperCase()}.webp`, role: "line", trainSeasons, gear: { timber: 1, iron: 1 }, upkeepPerDay, stats });
const offer = (id: string, label: string, hired: boolean) => ({ id, label, icon: "BAND.webp", role: "line", men: 20, upkeepPerDay: { drachmae: 90, wine: 3, chicken: 3, herbal: 2 }, stats, hired });

function payload(over: Partial<BarracksView> = {}): BarracksView {
  const roster = over.roster ?? [homeLevy, homeBand, awayRaid, awayNoMission, trainingRow];
  return {
    gate: { met: true, reason: null },
    season: 93,
    now: iso(NOW),
    levy: { men: 3 },
    config: { minServiceSeasons: 2, maxActiveBands: 2, termSeasons: 2, altar: { seasons: 2, goods: { bull: 3, chicken: 1 } } },
    altar: null,
    units: [unit("peltast", "Peltast", "Peltasts", 1), unit("hoplite", "Hoplite", "Hoplites", 2, { grain: 1, chicken: 1, oliveoil: 1 })],
    roster,
    offers: [offer("etruscan-hoplites", "Etruscan hoplites", true), offer("syracusan-hoplites", "Syracusan hoplites", false), offer("volcae-irregulars", "Volcae irregulars", true)],
    activeBands: 2,
    upkeep: { perDay: { grain: 200, oliveoil: 114, wine: 7, chicken: 7, herbal: 4, drachmae: 130 }, rows: { "home-hoplites": { grain: 52, oliveoil: 26 }, "home-band": { drachmae: 40, wine: 4, chicken: 4, herbal: 2 } }, note: "Shortfalls are bought at the market's seasonal price." },
    summary: { underArms: 121, levyMen: 202, growthPerYear: 10, seasonsPerYear: 4 },
    fleet: { ships: [{ id: "trade-ship", label: "Pentekonter", role: "transport", count: 1, troopSpace: 20, range: 7, naval: 1 }, { id: "galley", label: "Trireme", role: "warship", count: 2, troopSpace: 4, range: 4, naval: 5 }], space: 28, range: 7 },
    ...over,
  };
}
const player = { gameDateLabel: "Spring, 277 BC", balances: { bull: 1, chicken: 0.5 } } as unknown as Parameters<typeof BarracksPanel>[0]["player"];

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const rowsIn = (c: HTMLElement, section: string) => within(c.querySelector(`[data-section="${section}"]`) as HTMLElement).queryAllByText((_, el) => el?.classList.contains("barracks-row") ?? false, { selector: ".barracks-row" });
const count = (c: HTMLElement, section: string) => (c.querySelector(`[data-section="${section}"]`) as HTMLElement).querySelectorAll(".barracks-row, .barracks-card").length;

let hookWarnings: string[] = [];
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// `then`: what the second /api/barracks read answers (the refetch a timer at zero asks for).
async function mount(view: BarracksView, then?: BarracksView) {
  hookWarnings = [];
  // The names file the mission lines read (restoreAllMocks clears it after each test).
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ version: 1, names: { R060: "Massalia", R046: "Salyes" } }), { status: 200, headers: { "content-type": "application/json" } }));
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    const text = args.map(String).join(" ");
    if (/order of Hooks|Rendered more hooks|Rendered fewer hooks/.test(text)) hookWarnings.push(text);
  });
  const barracks = vi.spyOn(api, "barracks").mockResolvedValue(then ?? view);
  barracks.mockResolvedValueOnce(view);
  vi.spyOn(api, "mapReach").mockResolvedValue({
    now: iso(NOW), campaign: { season: "Spring", open: true, opensAt: null }, force: { men: 0, space: 0 }, fleet: { ships: {}, range: 0, space: 0 }, reach: {}, moveTargets: [],
    bases: [
      { id: "R060", regionId: "R060", townId: null, kind: "massalia", name: "Massalia", holding: null },
      { id: "nikaia", regionId: "R059", townId: "nikaia", kind: "home", name: "Nikaia", holding: null },
      { id: "R046", regionId: "R046", townId: null, kind: "conquest", name: "Salyes", holding: null },
    ],
  });
  const utils = render(<BarracksPanel player={player} onRefresh={() => {}} />);
  await flush();
  return utils;
}

describe("BarracksPanel", () => {
  it("locked: the banner shows and every action is disabled, while the catalogue still renders", async () => {
    const { container } = await mount(payload({ gate: { met: false, reason: "The unfree may not raise an army." }, roster: [] }));
    expect(container.querySelector(".barracks-lock")?.textContent).toContain("The unfree may not raise an army.");
    expect(container.querySelector(".section-eyebrow")?.textContent).toBe("Barracks · Spring, 277 BC");
    const recruit = [...container.querySelectorAll("button")].filter((b) => /^Recruit \d+$/.test(b.textContent ?? ""));
    expect(recruit).toHaveLength(2);
    expect(recruit.every((b) => b.disabled)).toBe(true);
    expect([...container.querySelectorAll("button")].filter((b) => b.textContent === "Hire").every((b) => b.disabled)).toBe(true);
    expect(hookWarnings).toEqual([]);
  });

  it("unlocked: the strip, the three roster places, mission lines, tags, offers and the stepper bounds", async () => {
    const { container } = await mount(payload());
    const strip = container.querySelector('[data-testid="summary"]')!.textContent!;
    expect(strip).toContain("121 of 323 under arms");
    expect(strip).toContain("+10 each year");
    // FLEET: the ships in stock by their names, the troop space aboard and the farthest range.
    expect(container.querySelector('[data-testid="fleet-strip"]')).toBeNull(); // the fleet lives under Massalia only
    expect([...container.querySelectorAll('[data-testid="summary"] .barracks-k')].map((k) => k.textContent)).toEqual(["Levy", "Come of age", "Daily upkeep"]);
    // Daily upkeep: one item per good with its icon before the number, drachmae last with the coin.
    const items = [...container.querySelectorAll('[data-testid="upkeep-strip"] .barracks-upkeep-item')];
    expect(items.map((el) => el.getAttribute("title"))).toEqual(["200 grain", "114 oil", "7 wine", "7 chicken", "4 herbs", "130 drachmae"]);
    expect(items.map((el) => el.textContent?.trim())).toEqual(["200", "114", "7", "7", "4", "🪙 130 dr"]);
    expect(items.slice(0, 5).every((el) => el.querySelector("img, [aria-hidden]") !== null)).toBe(true);
    expect(container.textContent).not.toContain("Your men eat");

    // At home: the levy row and the band, with their counts and lines.
    const home = container.querySelector('[data-section="home"]')!;
    expect(home.querySelectorAll(".barracks-row:not(.barracks-ship)")).toHaveLength(2); // the men; the fleet's rows are counted below
    expect(home.textContent).toContain("At home");
    expect(home.textContent).toContain("66 men"); // 26 + 40
    expect(home.textContent).toContain("Levy · 26 men");
    expect(home.textContent).toContain("Mercenaries · 40 men");
    expect(home.textContent).toContain("Hoplite · 26"); // a levy row shows the plain count, never "of"
    expect(home.textContent).not.toContain("26 of 30");
    expect(home.textContent).toContain("1 grain · 1 oil · 1 chicken a day per man · 52 grain · 26 oil for the row");
    expect(home.textContent).toContain("May be released.");
    expect(home.textContent).toMatch(/4 wine · 4 chicken · 2 herbs · 40 drachmae a day · contract 1d 1[56]h/);
    expect(home.querySelectorAll("button").length).toBe(4); // Move and Disband on each row
    expect([...home.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Move", "Disband", "Move", "Disband"]);

    // Away: a raid with its mission line, tag and bar; a plain return without a tag or bar.
    const away = container.querySelector('[data-section="away"]')!;
    expect(away.querySelectorAll(".barracks-row")).toHaveLength(2);
    expect(away.textContent).toContain("37 men");
    expect(away.textContent).toContain("Returning from Salyes");
    expect(away.textContent).toContain("RAID");
    expect(away.textContent).toMatch(/Hippeis · 30(01|02):59:5\d|Hippeis · 3001:59|Hippeis · 30/);
    expect(away.querySelectorAll(".barracks-bar")).toHaveLength(1);
    expect(away.querySelector(".barracks-bar-fill")?.getAttribute("style")).toContain("width: 33%");
    const plain = away.querySelector('[data-row="away-plain"]')!;
    expect(plain.textContent).toContain("Returning");
    expect(plain.querySelector(".barracks-tag")).toBeNull();

    // In training: countdown, a 25% bar (6h of 24h), and Cancel.
    const training = container.querySelector('[data-section="training"]')!;
    expect(training.querySelectorAll(".barracks-row")).toHaveLength(1);
    expect(training.textContent).toContain("4 men");
    expect(training.textContent).toContain("Ekdromos · 4");
    expect(training.textContent).toMatch(/17:59:5\d|18:00:00/);
    expect(training.querySelector(".barracks-bar-fill")?.getAttribute("style")).toContain("width: 25%");
    expect(within(training as HTMLElement).getByText("Cancel")).toBeTruthy();

    // Training ground: two cards with chips and the line; stepper bound by the levy (3).
    const ground = container.querySelector('[data-section="training-ground"]')!;
    expect(ground.querySelectorAll(".barracks-card")).toHaveLength(2);
    expect(ground.querySelectorAll(".barracks-chip")).toHaveLength(12);
    expect(ground.textContent).toContain("Trains 24h");
    // The unit card lists every good the content charges, chicken included.
    expect(ground.querySelector('[data-unit="hoplite"]')!.textContent).toContain("Upkeep 1 grain · 1 oil · 1 chicken a day");
    const card = ground.querySelector('[data-unit="peltast"]')!;
    const minus = within(card as HTMLElement).getByLabelText("fewer Peltasts");
    const plus = within(card as HTMLElement).getByLabelText("more Peltasts");
    const qty = within(card as HTMLElement).getByLabelText("men to recruit as Peltast") as HTMLInputElement;
    expect(qty.value).toBe("1");
    expect((minus as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(plus); fireEvent.click(plus); fireEvent.click(plus); fireEvent.click(plus);
    expect(qty.value).toBe("3");
    expect((plus as HTMLButtonElement).disabled).toBe(true);
    expect(within(card as HTMLElement).getByText("Recruit 3")).toBeTruthy();
    fireEvent.change(qty, { target: { value: "99" } });
    expect(qty.value).toBe("3");
    fireEvent.change(qty, { target: { value: "0" } });
    expect(qty.value).toBe("1");

    // Market: hired, open, and the cap caption on the open one (2 of 2 under contract).
    const market = container.querySelector('[data-section="market"]')!;
    expect(market.textContent).toContain("Three bands in the city · 2 of 2 under contract");
    expect(market.querySelectorAll(".barracks-hired")).toHaveLength(2);
    const open = market.querySelector('[data-offer="syracusan-hoplites"]')!;
    expect(open.textContent).toContain("Two bands is all the city will feed.");
    expect((within(open as HTMLElement).getByText("Hire") as HTMLButtonElement).disabled).toBe(true);
    expect(market.textContent).toContain("20 men · line");
    expect(hookWarnings).toEqual([]);
  });

  it("re-renders after a mock cancel and a mock recruit without a hook-order warning", async () => {
    const { container } = await mount(payload());
    expect(count(container, "training")).toBe(1);

    // Cancel the training row: confirm, then the server answers without it.
    const cancelled = payload({ roster: [homeLevy, homeBand, awayRaid, awayNoMission], summary: { underArms: 117, levyMen: 206, growthPerYear: 10, seasonsPerYear: 4 }, fleet: { ships: [], space: 0, range: 0 } });
    vi.spyOn(api, "barracksCancel").mockResolvedValue(cancelled);
    const training = container.querySelector('[data-section="training"]') as HTMLElement;
    fireEvent.click(within(training).getByText("Cancel"));
    fireEvent.click(within(training).getByText("Confirm — stand down 4"));
    await flush();
    expect(api.barracksCancel).toHaveBeenCalledWith("training-ekdromoi");
    expect(count(container, "training")).toBe(0);
    expect(container.querySelector('[data-testid="summary"]')!.textContent).toContain("117 of 323 under arms");
    expect(container.querySelector('[data-testid="fleet-strip"]')).toBeNull();
    expect(container.textContent).toContain("Stood down 4 ekdromoi.");

    // Recruit 2 peltasts: the server answers with a new training row.
    const recruited = payload({ roster: [homeLevy, homeBand, awayRaid, awayNoMission, row({ id: "training-new", count: 2, startCount: 2, active: false, readyAt: iso(NOW + 24 * H), createdAt: iso(NOW) })], levy: { men: 1 } });
    vi.spyOn(api, "barracksRecruit").mockResolvedValue(recruited);
    const card = container.querySelector('[data-unit="peltast"]') as HTMLElement;
    fireEvent.click(within(card).getByLabelText("more Peltasts"));
    fireEvent.click(within(card).getByText("Recruit 2"));
    await flush();
    expect(api.barracksRecruit).toHaveBeenCalledWith("peltast", 2);
    expect(count(container, "training")).toBe(1);
    expect(container.querySelector('[data-section="training"]')!.textContent).toContain("Peltast · 2");
    // The levy is down to 1, so the stepper snaps to its new bound.
    expect((within(card).getByLabelText("men to recruit as Peltast") as HTMLInputElement).value).toBe("1");
    expect(hookWarnings).toEqual([]);
  });

  it("reports: a box after In training, one title per report, unread until opened; the card holds the rest", async () => {
    const battle = (over: Partial<MapActReport>): MapActReport => ({
      type: "raid", regionId: "R046", regionName: "Salyes", townId: null, townName: null, town: null, fleet: null, base: "R060", route: "land", steps: 1, marchId: "m-raid", minutes: 30, arrivedAt: iso(NOW - H), homeAt: iso(NOW - H / 2), destination: "R060", ships: {}, winner: "attacker", rounds: 1,
      attacker: { rows: [], losses: 0 }, defender: { label: "Tribal warband", start: 20, end: 15, losses: 5, turnout: 5 }, plunder: { drachmae: 250, grain: 25 }, conquest: null, intel: null, line: "Raided Salyes with 40 peltasts: 5 tribesmen slain, none of ours lost, 250 drachmae and 25 grain of plunder.", ...over,
    });
    const muster: KoinonMusterReport = {
      outcome: "won", reason: null, line: "Raided Reii: 50 men sent, 12 soldiers slain, 3 lost, 960 drachmae and 120 grain taken.", regionName: "Reii", townName: "Reii", men: 50, lost: 3, killed: 12, plunder: { drachmae: 960, grain: 120 },
      parts: [
        { playerId: "kallias", name: "Kallias", men: 30, lost: 3, hulls: 0, seats: 0, shares: 30, drachmae: 288, grain: 36 },
        { playerId: "nikias", name: "Nikias", men: 20, lost: 0, hulls: 1, seats: 20, shares: 40, drachmae: 384, grain: 48 },
      ],
    };
    const reports: BarracksReport[] = [
      { id: "m-raid", kind: "raid", regionId: "R046", townId: null, arrivedAt: iso(NOW - H), gameDate: "Spring, 277 BC", seen: false, report: battle({}) },
      { id: "m-scout", kind: "scout", regionId: "R046", townId: null, arrivedAt: iso(NOW - 2 * H), gameDate: "Spring, 277 BC", seen: true, report: battle({ type: "scout", marchId: "m-scout", winner: null, rounds: 0, defender: null, plunder: null, intel: { warband: 20, scoutedGameDate: "Spring, 277 BC" }, line: "Scouted Salyes with 10 peltasts: 20 tribesmen under arms." }) },
      { id: "mu-1", kind: "muster", regionId: "R031", townId: "reii", arrivedAt: iso(NOW - 3 * H), gameDate: "Winter, 278 BC", seen: false, koinonName: "The Sacred Band", report: muster },
    ];
    const seen = (...ids: string[]) => payload({ reports: reports.map((r) => (ids.includes(r.id) ? { ...r, seen: true } : r)) });
    const read = vi.spyOn(api, "barracksReportRead").mockResolvedValueOnce(seen("m-raid")).mockResolvedValueOnce(seen("m-raid", "mu-1"));
    const { container } = await mount(payload({ reports }));
    // The box is the third of the right-hand stack, after Away · Returning and In training.
    const stack = container.querySelector(".barracks-stack")!;
    expect([...stack.querySelectorAll(":scope > section")].map((s) => s.getAttribute("data-section"))).toEqual(["away", "training", "reports"]);
    const section = stack.querySelector<HTMLElement>('[data-section="reports"]')!;
    expect(section.querySelector(".barracks-head-title")!.textContent).toBe("Reports");
    expect(section.querySelector(".barracks-head-note")!.textContent).toBe("2 new");
    expect(section.querySelector(".barracks-list.reports")).not.toBeNull();
    // One title per report, the NEW tag while unread, the kind's tag; no line, no date.
    const rows = [...section.querySelectorAll<HTMLButtonElement>(".barracks-report")];
    expect(rows.map((r) => r.getAttribute("data-report"))).toEqual(["m-raid", "m-scout", "mu-1"]);
    expect(rows.map((r) => r.querySelector(".barracks-row-name")!.textContent)).toEqual(["Raided Salyes", "Scouted Salyes", "Raided Reii"]);
    expect(rows.map((r) => r.classList.contains("is-new"))).toEqual([true, false, true]);
    expect(rows.map((r) => r.textContent!.includes("NEW"))).toEqual([true, false, true]);
    expect(rows.map((r) => [...r.querySelectorAll(".barracks-tag:not(.barracks-tag-new)")].map((t) => t.textContent))).toEqual([["RAID"], ["SCOUT"], ["MUSTER"]]);
    for (const r of rows) {
      expect(r.textContent).not.toContain("slain");
      expect(r.textContent).not.toContain("under arms");
      expect(r.textContent).not.toContain("277 BC");
      expect(r.textContent).not.toContain("278 BC");
    }
    // Opening the unread raid: its card with the line and the date, the read by marchId, and the highlight gone with the returned view.
    await act(async () => {
      fireEvent.click(rows[0]!);
    });
    await flush();
    expect(container.querySelector(".w2map-modal-host .w2map-report-line")!.textContent).toBe(reports[0]!.report.line);
    expect(container.querySelector('.w2map-modal-host [data-testid="report-date"]')!.textContent).toBe("Spring, 277 BC");
    expect(read).toHaveBeenCalledWith({ marchId: "m-raid" });
    expect(container.querySelector('[data-report="m-raid"]')!.classList.contains("is-new")).toBe(false);
    expect(container.querySelector('[data-report="m-raid"]')!.textContent).not.toContain("NEW");
    expect(section.querySelector(".barracks-head-note")!.textContent).toBe("1 new");
    fireEvent.click(container.querySelector<HTMLButtonElement>(".w2map-modal-host .w2map-info-close")!);
    expect(container.querySelector(".w2map-modal-host")).toBeNull();
    // Opening the unread muster: the koinon's card with its head, its line and its parts, and the read by musterId.
    await act(async () => {
      fireEvent.click(container.querySelector<HTMLButtonElement>('[data-report="mu-1"]')!);
    });
    await flush();
    const card = container.querySelector<HTMLElement>(".w2map-modal-host")!;
    expect(card.querySelector(".w2map-info-label")!.textContent).toBe("Koinon raid · Reii");
    expect(card.querySelector('[data-testid="report-date"]')!.textContent).toBe("Winter, 278 BC · The Sacred Band");
    expect(card.textContent).toContain(muster.line!);
    expect([...card.querySelectorAll("[data-part]")].map((el) => el.getAttribute("data-part"))).toEqual(["kallias", "nikias"]);
    expect(card.querySelector('[data-part="nikias"]')!.textContent).toContain("Nikias · sent 20 men and 1 hull · lost 0 · 384 drachmae and 48 grain");
    expect(read).toHaveBeenCalledWith({ musterId: "mu-1" });
    expect(read).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-report="mu-1"]')!.classList.contains("is-new")).toBe(false);
    expect(section.querySelector(".barracks-head-note")).toBeNull();
    // A read one opens its card again without a read.
    fireEvent.click(card.querySelector<HTMLButtonElement>(".w2map-info-close")!);
    await act(async () => {
      fireEvent.click(container.querySelector<HTMLButtonElement>('[data-report="m-scout"]')!);
    });
    expect(container.querySelector(".w2map-modal-host .w2map-report-line")!.textContent).toBe(reports[1]!.report.line);
    expect(read).toHaveBeenCalledTimes(2);
    expect(hookWarnings).toEqual([]);
    cleanup();

    // No reports: the box stands with its empty line.
    const plain = await mount(payload());
    const box = plain.container.querySelector('[data-section="reports"]')!;
    expect(box).not.toBeNull();
    expect(box.querySelector(".barracks-empty")!.textContent).toBe("No reports yet.");
    expect(box.querySelector(".barracks-head-note")).toBeNull();
    expect(hookWarnings).toEqual([]);
  });

  it("a party that turns for home counts down again: one refetch at its arrival, none at the turn", async () => {
    const out = row({ id: "party", unitId: "hoplite", label: "Hoplite", plural: "Hoplites", count: 30, startCount: 30, movingTo: "R046", arrivesAt: iso(NOW - 1000), mission: { kind: "raid", regionId: "R046", departedAt: iso(NOW - 31 * 60_000), marchId: "m-1" } });
    const back = row({ ...out, movingTo: "R060", arrivesAt: iso(NOW + 30 * 60_000), mission: { kind: "raid", regionId: "R046", departedAt: iso(NOW - 31 * 60_000) } });
    const { container } = await mount(payload({ roster: [homeLevy, out] }), payload({ roster: [homeLevy, back] }));
    await flush();
    expect(api.barracks).toHaveBeenCalledTimes(2);
    const away = container.querySelector('[data-section="away"]')!;
    expect(away.textContent).toContain("Returning from Salyes");
    expect(away.textContent).toMatch(/0:29:5\d|0:30:00/);
    await flush();
    expect(api.barracks).toHaveBeenCalledTimes(2);
    expect(hookWarnings).toEqual([]);
  });

  it("ships at sea: one row per sailing under Away · Returning, with the hulls, what took them out, the clock, a bar and the AT SEA tag", async () => {
    const voyage = (id: string, over: Partial<BarracksView["atSea"] extends (infer V)[] | undefined ? V : never> = {}) => ({
      id, ships: [{ id: "trade-ship", label: "Pentekonter", count: 2 }, { id: "galley", label: "Trireme", count: 1 }], kind: "raid" as const, musterId: null, regionId: "R046", townId: null, sailedAt: iso(NOW - H), returnsAt: iso(NOW + 2 * H), ...over,
    });
    const { container } = await mount(payload({ roster: [homeLevy], atSea: [voyage("voy-1"), voyage("voy-2", { musterId: "m-1", ships: [{ id: "trade-ship", label: "Pentekonter", count: 1 }] })] }));
    const away = container.querySelector('[data-section="away"]')!;
    const sailings = away.querySelectorAll(".barracks-voyage");
    expect(sailings).toHaveLength(2);
    const first = away.querySelector('[data-voyage="voy-1"]')!;
    expect(first.querySelector(".barracks-row-name span")!.textContent).toBe("Pentekonter · 2, Trireme · 1");
    expect(first.querySelector(".barracks-mission")!.textContent).toBe("Raid on Salyes");
    expect(first.querySelector(".barracks-row-left")!.textContent).toMatch(/0(1:59:5\d|2:00:00)/);
    expect(first.querySelector(".barracks-tag")!.textContent).toBe("AT SEA");
    expect(first.querySelector(".barracks-bar-fill")?.getAttribute("style")).toContain("width: 33%");
    expect(away.querySelector('[data-voyage="voy-2"] .barracks-mission')!.textContent).toBe("The koinon's raid on Salyes");
    expect(away.textContent).not.toContain("No one on the march.");
    expect(hookWarnings).toEqual([]);
    cleanup();

    // The default payload has no sailing, and its away rows are as they were.
    const plain = await mount(payload());
    const plainAway = plain.container.querySelector('[data-section="away"]')!;
    expect(plainAway.querySelector(".barracks-voyage")).toBeNull();
    expect(plainAway.querySelectorAll(".barracks-row")).toHaveLength(2);
    expect(hookWarnings).toEqual([]);
  });

  it("countText: levy rows show the plain count, bands show their strength against the company once reduced", () => {
    expect(countText({ source: "trained", count: 33, startCount: 33 })).toBe("33");
    expect(countText({ source: "trained", count: 26, startCount: 30 })).toBe("26");
    expect(countText({ source: "band", count: 40, startCount: 40 })).toBe("40");
    expect(countText({ source: "band", count: 35, startCount: 40 })).toBe("35 of 40");
  });

  it("a row pledged to the koinon's muster stays At Home with the MUSTER tag and its line, Move and Disband disabled", async () => {
    const pledged = row({ id: "home-pledged", unitId: "hoplite", label: "Hoplite", plural: "Hoplites", icon: "HOPLITE.webp", count: 12, startCount: 12, mission: { kind: "muster", musterId: "m1", regionId: "R046", departedAt: iso(NOW - H) } });
    const { container } = await mount(payload({ roster: [homeLevy, pledged] }));
    const home = container.querySelector('[data-section="home"]') as HTMLElement;
    const el = home.querySelector('[data-row="home-pledged"]') as HTMLElement;
    expect(el).not.toBeNull();
    expect(container.querySelector('[data-section="away"] [data-row="home-pledged"]')).toBeNull();
    expect(el.querySelector(".barracks-tag")!.textContent).toBe("MUSTER");
    expect(el.querySelector(".barracks-row-service")!.textContent).toBe("Pledged to the koinon's muster.");
    const [move, disband] = [...el.querySelectorAll("button")] as HTMLButtonElement[];
    expect([move!.textContent, move!.disabled, move!.title]).toEqual(["Move", true, "Pledged to the koinon's muster."]);
    expect([disband!.textContent, disband!.disabled, disband!.title]).toEqual(["Disband", true, "Pledged to the koinon's muster."]);
    // The free row beside it is untouched.
    const free = home.querySelector('[data-row="home-hoplites"]') as HTMLElement;
    expect(free.querySelector(".barracks-tag")).toBeNull();
    expect([...free.querySelectorAll("button")].map((b) => (b as HTMLButtonElement).disabled)).toEqual([false, false]);
    expect(hookWarnings).toEqual([]);
  });

  it("the altar, cold: one button per content beast, bull first; a whole bull is offered, half a chicken is none in stock; the click burns it and re-renders from the returned view", async () => {
    const { container } = await mount(payload());
    const altar = container.querySelector('[data-section="altar"]') as HTMLElement;
    expect(altar.getAttribute("aria-label")).toBe("Altar");
    expect(altar.querySelector(".barracks-head-note")!.textContent).toBe("A beast burned here steadies every man you field for 2 seasons.");
    const buttons = [...altar.querySelectorAll("button")] as HTMLButtonElement[];
    expect(buttons.map((b) => [b.textContent, b.disabled])).toEqual([
      ["Sacrifice · you have 1", false],
      ["Sacrifice · none in stock", true],
    ]);
    const lit = payload({ altar: { good: "bull", mor: 3, until: iso(NOW + 30.5 * H) } });
    vi.spyOn(api, "barracksSacrifice").mockResolvedValue(lit);
    fireEvent.click(buttons[0]!);
    await flush();
    expect(api.barracksSacrifice).toHaveBeenCalledTimes(1);
    expect(api.barracksSacrifice).toHaveBeenCalledWith("bull");
    // The section is keyed on the blessing's end: a fresh offering mounts it anew.
    const smoking = container.querySelector('[data-section="altar"]') as HTMLElement;
    expect(smoking.querySelector(".barracks-head-note")!.textContent).toMatch(/^The altar smokes · \+3 morale to every man you field · 1d 6h$/);
    expect([...smoking.querySelectorAll("button")].every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(container.textContent).toContain("The altar is lit.");
    expect(hookWarnings).toEqual([]);
  });

  it("the altar, lit: the smoking note with the bonus and the countdown, both buttons disabled with the reason", async () => {
    const { container } = await mount(payload({ altar: { good: "bull", mor: 3, until: iso(NOW + 30.5 * H) } }));
    const altar = container.querySelector('[data-section="altar"]') as HTMLElement;
    expect(altar.querySelector(".barracks-head-note")!.textContent).toMatch(/^The altar smokes · \+3 morale to every man you field · 1d 6h$/);
    const buttons = [...altar.querySelectorAll("button")] as HTMLButtonElement[];
    expect(buttons.map((b) => [b.disabled, b.title])).toEqual([
      [true, "The altar still smokes from the last offering."],
      [true, "The altar still smokes from the last offering."],
    ]);
    expect(hookWarnings).toEqual([]);
  });

  it("the altar, locked: both buttons disabled with the lock reason", async () => {
    const { container } = await mount(payload({ gate: { met: false, reason: "The unfree may not raise an army." } }));
    const altar = container.querySelector('[data-section="altar"]') as HTMLElement;
    const buttons = [...altar.querySelectorAll("button")] as HTMLButtonElement[];
    expect(buttons).toHaveLength(2);
    expect(buttons.map((b) => [b.disabled, b.title])).toEqual([
      [true, "The unfree may not raise an army."],
      [true, "The unfree may not raise an army."],
    ]);
    expect(hookWarnings).toEqual([]);
  });

  it("the altar's server error lands under the beast that asked", async () => {
    const { container } = await mount(payload());
    const { ApiError } = await import("../src/api.js");
    vi.spyOn(api, "barracksSacrifice").mockRejectedValue(new ApiError("The altar still smokes from the last offering.", 409));
    const card = container.querySelector('[data-altar="bull"]') as HTMLElement;
    fireEvent.click(card.querySelector("button")!);
    await flush();
    expect(card.querySelector(".barracks-row-error")!.textContent).toBe("The altar still smokes from the last offering.");
    expect((container.querySelector('[data-altar="chicken"]') as HTMLElement).querySelector(".barracks-row-error")).toBeNull();
    expect(hookWarnings).toEqual([]);
  });

  it("an action's server error lands under the row that asked", async () => {
    const { container } = await mount(payload());
    const { ApiError } = await import("../src/api.js");
    vi.spyOn(api, "barracksRecruit").mockRejectedValue(new ApiError("Short of 2 timber.", 409));
    const card = container.querySelector('[data-unit="hoplite"]') as HTMLElement;
    fireEvent.click(within(card).getByText("Recruit 1"));
    await flush();
    expect(card.textContent).toContain("Short of 2 timber.");
    expect(hookWarnings).toEqual([]);
  });
  it("At Home groups rows by place — Massalia first, then holdings, then home ground — with the Levy and Mercenaries split and the Fleet under Massalia", async () => {
    const roster = [
      homeLevy,
      homeBand,
      row({ id: "salyes-hoplites", unitId: "hoplite", label: "Hoplite", plural: "Hoplites", count: 84, startCount: 84, basedAt: "R046" }),
      row({ id: "nikaia-peltasts", count: 20, basedAt: "nikaia" }),
      awayRaid,
    ];
    // The Nikaia row comes first in the roster; the place order still puts it last.
    const { container } = await mount(payload({ roster: [roster[3]!, ...roster.slice(0, 3), roster[4]!], places: { R060: "Massalia", R046: "Salyes", nikaia: "Nikaia" } }));
    const places = [...container.querySelectorAll('[data-section="home"] .barracks-place')];
    expect(places.map((p) => p.getAttribute("data-place"))).toEqual(["R060", "R046", "nikaia"]);
    expect(places.map((p) => p.querySelector(".barracks-place-head")!.textContent)).toEqual(["Massalia · 66 men", "Salyes · 84 men", "Nikaia · 20 men"]);
    // Each place keeps the split.
    const heads = (p: Element) => [...p.querySelectorAll(".barracks-list-head")].map((h) => h.textContent);
    expect(heads(places[0]!)).toEqual(["Massalia · 66 men", "Levy · 26 men", "Mercenaries · 40 men", "Fleet · 3 hulls"]);
    // An empty sub-section is hidden rather than shown empty.
    expect(heads(places[1]!)).toEqual(["Salyes · 84 men", "Levy · 84 men"]);
    expect(places[1]!.textContent).not.toContain("No bands under contract.");
    expect(heads(places[2]!)).toEqual(["Nikaia · 20 men", "Levy · 20 men"]);
    // The fleet: one row per hull type, no upkeep or service line, under Massalia only.
    const ships = [...places[0]!.querySelectorAll(".barracks-ship")];
    expect(ships.map((s) => `${s.querySelector(".barracks-row-name")!.textContent} · ${s.querySelector(".barracks-row-sub")!.textContent}`)).toEqual(["Pentekonter · 1 · carries 20 · range 7", "Trireme · 2 · escort · range 4"]);
    expect(ships.every((s) => s.querySelector(".barracks-row-service") === null)).toBe(true);
    // Each hull type shows its goods artwork in the row's icon cell.
    expect(ships.map((s) => s.querySelector(".barracks-row-ic img")?.getAttribute("src"))).toEqual([expect.stringMatching(/\/assets\/PENTEKONTER\.webp$/), expect.stringMatching(/\/assets\/TRIREME\.webp$/)]);
    expect(container.querySelectorAll('[data-section="home"] .barracks-ship')).toHaveLength(2);
    // No ships: the Fleet sub-section is hidden; men alone keep the place.
    cleanup();
    const empty = await mount(payload({ fleet: { ships: [], space: 0, range: 0 } }));
    const massalia = empty.container.querySelector('[data-section="home"] .barracks-place[data-place="R060"]')!;
    expect(heads(massalia)).toEqual(["Massalia · 66 men", "Levy · 26 men", "Mercenaries · 40 men"]);
    expect(massalia.textContent).not.toContain("No ships");
    // Ships alone keep Massalia with just the Fleet; a place with nothing at all is not shown.
    cleanup();
    const shipsOnly = await mount(payload({ roster: [awayRaid], places: { R060: "Massalia" } }));
    const only = [...shipsOnly.container.querySelectorAll('[data-section="home"] .barracks-place')];
    expect(only.map((p) => p.getAttribute("data-place"))).toEqual(["R060"]);
    expect(heads(only[0]!)).toEqual(["Massalia · 0 men", "Fleet · 3 hulls"]);
    cleanup();
    const nothing = await mount(payload({ roster: [awayRaid], fleet: { ships: [], space: 0, range: 0 } }));
    expect(nothing.container.querySelectorAll('[data-section="home"] .barracks-place')).toHaveLength(0);
    expect(nothing.container.querySelector('[data-section="home"]')!.textContent).toContain("No men under arms.");
    expect(hookWarnings).toEqual([]);
  });
});

describe("the Temple at the altar", () => {
  const LINE = "Artemis watches over the League's armies · +3 morale to every man you field · through Spring, 277 BC";

  it("shows the Temple's blessing under the altar's head while it runs", async () => {
    const { container } = await mount(payload({ temple: { mor: 3, until: iso(NOW + 5 * H), throughLabel: "Spring, 277 BC" } }));
    const altar = container.querySelector('[data-section="altar"]') as HTMLElement;
    expect(altar.querySelector(".barracks-temple")!.textContent).toBe(LINE);
  });

  it("shows no line when no Temple runs, and none for a payload without the field", async () => {
    const { container } = await mount(payload({ temple: null }));
    expect(container.querySelector(".barracks-temple")).toBeNull();
    cleanup();
    const legacy = await mount(payload());
    expect(legacy.container.querySelector(".barracks-temple")).toBeNull();
    expect(legacy.container.querySelector('[data-section="altar"]')).not.toBeNull();
  });
});

