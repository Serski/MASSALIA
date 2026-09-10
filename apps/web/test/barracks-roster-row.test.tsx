// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AwayRow, HomeRow, TrainingRow, missionLine } from "../src/dashboard/panels/BarracksPanel.js";
import type { BarracksRosterRow } from "../src/api.js";

// The three roster places, one row each: at home (ready), in training, and on
// the march — the march line names the region and counts down to arrival.

const H = 3_600_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const base = (over: Partial<BarracksRosterRow>): BarracksRosterRow => ({
  id: "row-1", source: "trained", unitId: "peltast", label: "Peltast", plural: "Peltasts", icon: "PELTAST.webp", count: 20, startCount: 20, recruitedSeason: 9,
  readyAt: iso(-H), contractEndAt: null, basedAt: "R060", movingTo: null, arrivesAt: null, mission: null, createdAt: iso(-25 * H),
  stats: { atk: 3, def: 2, msl: 5, mor: 4, spd: 8, space: 1 }, active: true, canDisband: true, ...over,
});
const names = { R060: "Massalia", R046: "Salyes" };
const noop = () => {};

afterEach(cleanup);

describe("roster rows", () => {
  it("at home, ready: name, count, upkeep and a released service line", () => {
    const { container } = render(
      <HomeRow row={base({})} offset={0} releaseAt={null} upkeep={{ row: { grain: 20, oliveoil: 20 }, perMan: { grain: 1, oliveoil: 1 } }} names={names} locked={false} lockReason="" busy={false} busyKey={null} confirming={false} error={null} onConfirmChange={noop} onDisband={noop} onZero={noop} />,
    );
    expect(container.querySelector(".barracks-row-name")?.textContent).toBe("Peltast · 20");
    expect(container.querySelector(".barracks-row-sub")?.textContent).toBe("1 grain · 1 oil a day per man · 20 grain · 20 oil for the row");
    expect(container.querySelector(".barracks-row-service")?.textContent).toBe("May be released.");
  });

  it("in training: counts down to ready_at with a progress bar", () => {
    const { container } = render(
      <TrainingRow row={base({ active: false, readyAt: iso(2 * H + 14 * 60_000 + 7_000), createdAt: iso(-(2 * H)) })} offset={0} serverNowMs={Date.now()} busy={false} busyKey={null} confirming={false} error={null} onConfirmChange={noop} onCancel={noop} onZero={noop} />,
    );
    expect(container.querySelector(".barracks-row-left")?.textContent).toMatch(/^02:14:0[67]$/);
    expect(container.querySelector(".barracks-bar-fill")?.getAttribute("style")).toContain("width: 47%");
  });

  it("on the march: the mission line and tag, the countdown, and the region name from the names file", () => {
    const raid = base({ movingTo: "R060", arrivesAt: iso(2 * H + 14 * 60_000 + 7_000), mission: { kind: "raid", regionId: "R046", departedAt: iso(-H) } });
    const { container } = render(<AwayRow row={raid} names={names} offset={0} serverNowMs={Date.now()} onZero={noop} />);
    expect(container.querySelector(".barracks-mission")?.textContent).toBe("Returning from Salyes");
    expect(container.querySelector(".barracks-tag")?.textContent).toBe("RAID");
    expect(container.querySelector(".barracks-row-left")?.textContent).toMatch(/^02:14:0[67]$/);
    // Still bound for its target: the verb names the action.
    expect(missionLine(base({ movingTo: "R046", mission: { kind: "raid", regionId: "R046", departedAt: iso(0) } }), names)).toBe("Raiding Salyes");
    expect(missionLine(base({ movingTo: "R046", mission: { kind: "scout", regionId: "R046", departedAt: iso(0) } }), names)).toBe("Scouting Salyes");
    expect(missionLine(base({ movingTo: "R046", mission: { kind: "attack", regionId: "R046", departedAt: iso(0) } }), names)).toBe("Marching on Salyes");
    expect(missionLine(base({ movingTo: "R999", mission: { kind: "move", regionId: "R999", departedAt: iso(0) } }), names)).toBe("Marching to R999");
    expect(missionLine(base({ movingTo: "R060", mission: null }), names)).toBe("Returning");
  });
});
