// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { LobbyResponse } from "../src/api.js";
import { RecordPanel } from "../src/lobby/LobbyPage.js";

// The Lobby's "Your record" panel (World 2 launch, prompt 1): a World 1 citizen
// gets one more line, `Beta citizen · World 1`; everyone else sees the three
// rows as before.
const record: LobbyResponse["record"] = { worldsPlayed: 2, offices: [] };

afterEach(cleanup);

const rows = (el: HTMLElement) => [...el.querySelectorAll(".lobby-record-rows div")].map((d) => `${d.querySelector("dt")!.textContent} · ${d.querySelector("dd")!.textContent}`);

describe("RecordPanel", () => {
  it("shows the Beta citizen line for a stamped user", () => {
    const { container } = render(<RecordPanel record={record} you={null} beta />);
    expect(rows(container)).toEqual(["Worlds played · 2", "Prestige rank · No seat yet", "Offices held · None yet", "Beta citizen · World 1"]);
  });

  it("shows no such line otherwise", () => {
    const { container } = render(<RecordPanel record={record} you={null} beta={false} />);
    expect(rows(container)).toEqual(["Worlds played · 2", "Prestige rank · No seat yet", "Offices held · None yet"]);
    expect(container.textContent).not.toContain("Beta");
  });
});
