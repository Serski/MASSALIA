// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RosterRow } from "../src/dashboard/panels/BarracksPanel.js";

// The Barracks roster row in its three states: ready, still training, and on
// the march (returning home, or marching to another region). The march line
// names the region from the map's names file and counts down to arrival.

type Row = Parameters<typeof RosterRow>[0]["row"];
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const base = (over: Partial<Row>): Row => ({
  id: "row-1", source: "trained", unitId: "peltast", label: "Peltast", icon: "PELTAST.webp", count: 20, startCount: 20, recruitedSeason: 9,
  readyAt: iso(-3_600_000), contractEndAt: null, basedAt: "R060", movingTo: null, arrivesAt: null, stats: { atk: 3, def: 2, msl: 5, mor: 4, spd: 8, space: 1 },
  active: true, canDisband: true, ...over,
});
const names = { R060: "Massalia", R046: "Salyes" };
const mount = (row: Row) =>
  render(
    <RosterRow
      row={row}
      offset={0}
      releaseAt={null}
      upkeep={{ row: null, perMan: null }}
      names={names}
      locked={false}
      lockReason=""
      busy={false}
      busyKey={null}
      confirming={false}
      error={null}
      onConfirmChange={() => {}}
      onDisband={() => {}}
      onZero={() => {}}
    />,
  );
const status = (c: HTMLElement) => c.querySelector(".pr-s")?.textContent ?? "";

afterEach(cleanup);

describe("RosterRow", () => {
  it("ready: says Ready", () => {
    const { container } = mount(base({}));
    expect(status(container)).toBe("Ready");
  });

  it("training: counts down to ready_at", () => {
    const { container } = mount(base({ active: false, readyAt: iso(2 * 3_600_000 + 14 * 60_000 + 7_000) }));
    expect(status(container)).toMatch(/^Training · 02:14:0[67]$/);
  });

  it("on the march: returning home names the base, marching elsewhere names the destination, both counting down to arrival", () => {
    const home = mount(base({ movingTo: "R060", arrivesAt: iso(2 * 3_600_000 + 14 * 60_000 + 7_000) }));
    expect(status(home.container)).toMatch(/^Returning to Massalia · 02:14:0[67]$/);
    cleanup();
    const away = mount(base({ movingTo: "R046", arrivesAt: iso(45 * 60_000) }));
    expect(status(away.container)).toMatch(/^Marching to Salyes · 00:4[45]:/);
    cleanup();
    // An unknown region falls back to its id.
    const unknown = mount(base({ movingTo: "R999", arrivesAt: iso(60_000) }));
    expect(status(unknown.container)).toMatch(/^Marching to R999 · 00:0[01]:/);
  });
});
