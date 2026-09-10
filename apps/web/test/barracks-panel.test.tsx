// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type BarracksRosterRow, type BarracksView } from "../src/api.js";
import BarracksPanel from "../src/dashboard/panels/BarracksPanel.js";

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

const unit = (id: string, label: string, plural: string, trainSeasons: number) => ({ id, label, plural, icon: `${id.toUpperCase()}.webp`, role: "line", trainSeasons, gear: { timber: 1, iron: 1 }, upkeepPerDay: { grain: 2, oliveoil: 1 }, stats });
const offer = (id: string, label: string, hired: boolean) => ({ id, label, icon: "BAND.webp", role: "line", men: 20, upkeepPerDay: { drachmae: 90, wine: 3, chicken: 3, herbal: 2 }, stats, hired });

function payload(over: Partial<BarracksView> = {}): BarracksView {
  const roster = over.roster ?? [homeLevy, homeBand, awayRaid, awayNoMission, trainingRow];
  return {
    gate: { stat: "militia", required: 20, current: 26, met: true },
    season: 93,
    now: iso(NOW),
    levy: { men: 3 },
    config: { minServiceSeasons: 2, maxActiveBands: 2, termSeasons: 2 },
    units: [unit("peltast", "Peltast", "Peltasts", 1), unit("hoplite", "Hoplite", "Hoplites", 2)],
    roster,
    offers: [offer("etruscan-hoplites", "Etruscan hoplites", true), offer("syracusan-hoplites", "Syracusan hoplites", false), offer("volcae-irregulars", "Volcae irregulars", true)],
    activeBands: 2,
    upkeep: { perDay: { grain: 200, oliveoil: 114, wine: 7, chicken: 7, herbal: 4, drachmae: 130 }, rows: { "home-hoplites": { grain: 52, oliveoil: 26 }, "home-band": { drachmae: 40, wine: 4, chicken: 4, herbal: 2 } }, note: "Shortfalls are bought at the market's seasonal price." },
    summary: { underArms: 121, levyMen: 202, growthPerYear: 10, seasonsPerYear: 4 },
    ...over,
  };
}
const player = { gameDateLabel: "Spring, 277 BC" } as unknown as Parameters<typeof BarracksPanel>[0]["player"];

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const rowsIn = (c: HTMLElement, section: string) => within(c.querySelector(`[data-section="${section}"]`) as HTMLElement).queryAllByText((_, el) => el?.classList.contains("barracks-row") ?? false, { selector: ".barracks-row" });
const count = (c: HTMLElement, section: string) => (c.querySelector(`[data-section="${section}"]`) as HTMLElement).querySelectorAll(".barracks-row, .barracks-card").length;

let hookWarnings: string[] = [];
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function mount(view: BarracksView) {
  hookWarnings = [];
  // The names file the mission lines read (restoreAllMocks clears it after each test).
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ version: 1, names: { R060: "Massalia", R046: "Salyes" } }), { status: 200, headers: { "content-type": "application/json" } }));
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    const text = args.map(String).join(" ");
    if (/order of Hooks|Rendered more hooks|Rendered fewer hooks/.test(text)) hookWarnings.push(text);
  });
  vi.spyOn(api, "barracks").mockResolvedValue(view);
  const utils = render(<BarracksPanel player={player} onRefresh={() => {}} />);
  await flush();
  return utils;
}

describe("BarracksPanel", () => {
  it("locked: the banner shows and every action is disabled, while the catalogue still renders", async () => {
    const { container } = await mount(payload({ gate: { stat: "militia", required: 20, current: 4, met: false }, roster: [] }));
    expect(container.querySelector(".barracks-lock")?.textContent).toContain("You stand at 4");
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
    expect(strip).toContain("200 grain · 114 oil · 7 wine · 7 chicken · 4 herbs · 130 dr");
    expect(container.textContent).not.toContain("Your men eat");

    // At home: the levy row and the band, with their counts and lines.
    const home = container.querySelector('[data-section="home"]')!;
    expect(home.querySelectorAll(".barracks-row")).toHaveLength(2);
    expect(home.textContent).toContain("At home");
    expect(home.textContent).toContain("66 men"); // 26 + 40
    expect(home.textContent).toContain("Levy · 26 men");
    expect(home.textContent).toContain("Mercenaries · 40 men");
    expect(home.textContent).toContain("Hoplite · 26 of 30");
    expect(home.textContent).toContain("2 grain · 1 oil a day per man · 52 grain · 26 oil for the row");
    expect(home.textContent).toContain("May be released.");
    expect(home.textContent).toMatch(/4 wine · 4 chicken · 2 herbs · 40 drachmae a day · contract 1d 1[56]h/);
    expect(home.querySelectorAll("button").length).toBe(2); // one Disband each

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
    const cancelled = payload({ roster: [homeLevy, homeBand, awayRaid, awayNoMission], summary: { underArms: 117, levyMen: 206, growthPerYear: 10, seasonsPerYear: 4 } });
    vi.spyOn(api, "barracksCancel").mockResolvedValue(cancelled);
    const training = container.querySelector('[data-section="training"]') as HTMLElement;
    fireEvent.click(within(training).getByText("Cancel"));
    fireEvent.click(within(training).getByText("Confirm — stand down 4"));
    await flush();
    expect(api.barracksCancel).toHaveBeenCalledWith("training-ekdromoi");
    expect(count(container, "training")).toBe(0);
    expect(container.querySelector('[data-testid="summary"]')!.textContent).toContain("117 of 323 under arms");
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
});
