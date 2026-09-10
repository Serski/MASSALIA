// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hook-order regression tests for the Atlas map (React error #310, "Rendered
// more hooks than during the previous render"):
//   1. World2Map renders once before the world file arrives (the "Charting the
//      known world" early return) and again after it — every hook must run on
//      both renders, including the winter countdown.
//   2. The force picker mounts with a mixed roster and re-renders with a
//      different row count; per-row hooks live in child components, so the
//      count of hooks in the picker itself never changes.
// Network is mocked; nothing here reaches a server.
// ---------------------------------------------------------------------------

type Row = {
  id: string;
  source: "trained" | "band";
  unitId: string;
  label: string;
  icon: string;
  count: number;
  startCount: number;
  recruitedSeason: number;
  readyAt: string | null;
  contractEndAt: string | null;
  basedAt: string;
  movingTo: string | null;
  arrivesAt: string | null;
  stats: Record<string, number>;
  active: boolean;
  canDisband: boolean;
};

const future = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
const past = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
const stats = { atk: 3, def: 2, msl: 5, mor: 4, spd: 8, space: 1 };
const trained = (id: string, count: number, extra: Partial<Row> = {}): Row => ({
  id, source: "trained", unitId: "peltast", label: "Peltast", icon: "PELTAST.webp", count, startCount: count, recruitedSeason: 9,
  readyAt: past(24), contractEndAt: null, basedAt: "R060", movingTo: null, arrivesAt: null, stats, active: true, canDisband: true, ...extra,
});
const band = (id: string): Row => ({
  id, source: "band", unitId: "cretan-archers", label: "Cretan archers", icon: "BAND_CRETAN.webp", count: 30, startCount: 30, recruitedSeason: 9,
  readyAt: null, contractEndAt: future(40), basedAt: "R060", movingTo: null, arrivesAt: null, stats: { ...stats, msl: 9 }, active: true, canDisband: false,
});
const mixedRoster = (): Row[] => [
  trained("ready-1", 20),
  trained("recovering-1", 7, { movingTo: "R060", arrivesAt: future(2) }),
  trained("training-1", 5, { readyAt: future(20), active: false }),
  band("band-1"),
];

const entry = { landSteps: 1, seaSteps: null, attack: { ok: true }, raid: { ok: true }, colonise: { ok: true } };
const fleet = { ships: { "trade-ship": 0, galley: 0 }, range: 0, space: 0 };

// A two-province world so the map has something to lay out.
const WORLD = {
  width: 100,
  height: 100,
  provinces: [
    { id: "R060", type: "land", path: "M0,0 L50,0 L50,50 L0,50 Z", towns: ["massalia"], neighbors: ["R046"], coastal: true },
    { id: "R046", type: "land", path: "M50,0 L100,0 L100,50 L50,50 Z", towns: [], neighbors: ["R060"], coastal: false },
  ],
  towns: [{ id: "massalia", name: "Massalia", x: 25, y: 25 }],
};
const REACH = {
  now: new Date().toISOString(),
  campaign: { season: "Winter", open: false, opensAt: future(5) },
  bases: [{ regionId: "R060", kind: "massalia" }],
  force: { men: 0, space: 0, fast: false },
  fleet,
  reach: { R046: entry },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeAll(() => {
  // The map measures its stage and schedules frames; jsdom has neither.
  class RO { observe() {} unobserve() {} disconnect() {} }
  (globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
  // jsdom has no matchMedia; the map only asks whether the phone query matches.
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
  if (!globalThis.requestAnimationFrame) {
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16)) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as typeof cancelAnimationFrame;
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("World2Map hook order", () => {
  it("renders before the world file arrives and again after it, with the winter countdown, without changing its hook count", async () => {
    // The world file is held back until we release it; everything else answers at once.
    let releaseWorld: (() => void) | null = null;
    const worldReady = new Promise<void>((resolve) => (releaseWorld = resolve));
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/map2/world2.json")) {
        await worldReady;
        return jsonResponse(WORLD);
      }
      if (url.endsWith("/map2/politics2.json")) return jsonResponse({ polities: {}, owners: {} });
      if (url.endsWith("/map2/names2.json")) return jsonResponse({ version: 1, names: { R060: "Massalia", R046: "Salyes" } });
      if (url.endsWith("/map2/townstats.json")) return jsonResponse({ version: 1, towns: {} });
      if (url.includes("/api/map/military")) return jsonResponse({ towns: {}, regions: {} });
      if (url.includes("/api/map/reach")) return jsonResponse(REACH);
      return jsonResponse({ error: "not found" }, 404);
    });
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent) => errors.push(e.error ?? e.message);
    window.addEventListener("error", onError);
    const { World2Map } = await import("../src/map/World2Map.js");

    const view = render(<World2Map />);
    expect(view.container.textContent).toContain("Charting the known world");
    // Reach (and with it the winter campaign) lands before the world does.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    // Now the world arrives: the second render must not throw a hook-order error.
    await act(async () => {
      releaseWorld!();
      await new Promise((r) => setTimeout(r, 50));
    });
    window.removeEventListener("error", onError);
    expect(errors).toEqual([]);
    // The stage (with its camera controls) is the post-world render; jsdom never
    // measures it, so the camera placeholder text may still show inside it.
    expect(view.container.querySelector(".w2map-controls")).not.toBeNull();
    expect(view.container.querySelector(".w2map-controls button[aria-label=\"Home\"]")).not.toBeNull();
  });
});

describe("ForcePicker", () => {
  it("mounts with a mixed roster and re-renders with a different row count without a hook-order error", async () => {
    const { ForcePicker } = await import("../src/map/World2Map.js");
    const props = {
      type: "raid" as const,
      regionId: "R046",
      regionName: "Salyes",
      names: { R060: "Massalia", R046: "Salyes" },
      entry,
      fleet,
      onClose: () => {},
      onActed: () => {},
    };
    const view = render(<ForcePicker {...props} roster={mixedRoster()} />);
    // Ready row and band are pickable; the recovering row is greyed; the training row is absent.
    expect(view.container.querySelectorAll(".w2map-pick-row")).toHaveLength(3);
    expect(view.container.querySelectorAll(".w2map-pick-row.dim")).toHaveLength(1);
    expect(view.container.textContent).toContain("From Massalia");
    expect(view.container.textContent).toContain("A band marches as one.");
    expect(view.container.textContent).not.toContain("training");

    // More rows: two more ready rows and a second recovering row.
    const bigger = [...mixedRoster(), trained("ready-2", 10), trained("ready-3", 3), trained("recovering-2", 4, { movingTo: "R060", arrivesAt: future(1) })];
    view.rerender(<ForcePicker {...props} roster={bigger} />);
    expect(view.container.querySelectorAll(".w2map-pick-row")).toHaveLength(6);
    expect(view.container.querySelectorAll(".w2map-pick-row.dim")).toHaveLength(2);

    // Fewer rows: only the band remains.
    view.rerender(<ForcePicker {...props} roster={[band("band-1")]} />);
    expect(view.container.querySelectorAll(".w2map-pick-row")).toHaveLength(1);

    // And the loading state, then back to the full roster.
    view.rerender(<ForcePicker {...props} roster={null} />);
    expect(view.container.textContent).toContain("Mustering");
    view.rerender(<ForcePicker {...props} roster={mixedRoster()} />);
    expect(view.container.querySelectorAll(".w2map-pick-row")).toHaveLength(3);
  });
});
