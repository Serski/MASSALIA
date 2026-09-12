// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { ChronicleEntry } from "../src/api.js";
import { renderChronicleEntry } from "../src/dashboard/panels/FamilyPanel.js";

// The house chronicle's campaign lines (barracks prompt 3c): a tribute settle
// and a town taken render through the shared wording; an unknown kind is blank.
const entry = (type: ChronicleEntry["type"], payload: Record<string, unknown>): ChronicleEntry =>
  ({ seasonIndex: 9, label: "Spring, 300 BC", generation: 1, type, payload }) as unknown as ChronicleEntry;

describe("renderChronicleEntry · campaigns", () => {
  it("renders tribute and town lines", () => {
    expect(renderChronicleEntry(entry("holding_tribute", { regionId: "R032", tribute: [{ name: "Vienna", days: 2, drachmae: 240 }] }))).toBe("Tribute: Vienna sent 240 drachmae over 2 days.");
    expect(
      renderChronicleEntry(entry("map_action", { action: "attack", regionId: "R047", townId: "reii", townName: "Reii", force: [{ count: 20, label: "Peltast", plural: "Peltasts", source: "trained" }], winner: "attacker", killed: 3, lost: 1, conquest: true })),
    ).toBe("Took Reii with 20 peltasts: 3 soldiers slain, 1 of ours lost. The town is ours.");
    expect(renderChronicleEntry(entry("nothing_of_the_kind" as ChronicleEntry["type"], {}))).toBe("");
  });
});
