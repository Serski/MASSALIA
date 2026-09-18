// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BuildClock, BuildProgress, buildLabel } from "../src/dashboard/shared.js";

// The build bar: the Barracks bar under a label and a live clock. The window is
// the one the Barracks training row is tested on (−2h … +2h14m07s → 47%).

const H = 3_600_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

afterEach(cleanup);

describe("the build bar", () => {
  it("shows the label, the clock to completion and the share of the window already served", () => {
    const { container } = render(<BuildProgress label="Under construction" startedAt={iso(-(2 * H))} completesAt={iso(2 * H + 14 * 60_000 + 7_000)} offset={0} />);
    expect(container.querySelector(".build-progress-head span")?.textContent).toBe("Under construction");
    expect(container.querySelector(".build-clock")?.textContent).toMatch(/^02:14:0[67]$/);
    expect(container.querySelector(".barracks-bar.build .barracks-bar-fill")?.getAttribute("style")).toContain("width: 47%");
  });

  it("labels a fresh build and an upgrade by the row's tier", () => {
    expect(buildLabel(1)).toBe("Under construction");
    expect(buildLabel(3)).toBe("Upgrading to Tier 3");
  });

  it("a clock with nothing to count to reads zero", () => {
    const { container } = render(<BuildClock completesAt={null} offset={0} />);
    expect(container.querySelector(".build-clock")?.textContent).toBe("00:00:00");
  });
});
