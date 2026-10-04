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

describe("renderChronicleEntry · player market", () => {
  // Market prompt 2: sales and purchases left the Chronicle, so an old entry is blank.
  it("renders an old market_sale entry as an empty string", () => {
    const sale = { listingId: "l1", good: "oliveoil", goodLabel: "Olive Oil", qty: 5, price: 9, total: 45, tax: 4, net: 41, sellerName: "Kallias", sellerHouseName: "Xanthippos", buyerName: "Deon", buyerHouseName: "Timon", source: "market" };
    expect(renderChronicleEntry(entry("market_sale" as ChronicleEntry["type"], sale))).toBe("");
  });
});

describe("renderChronicleEntry · story lines", () => {
  it("renders the authored line as it stands, and an empty string when there is none", () => {
    expect(renderChronicleEntry(entry("story_line", { storyId: "house-of-roses", line: "The steward of House Timon is buying poison." }))).toBe(
      "The steward of House Timon is buying poison.",
    );
    expect(renderChronicleEntry(entry("story_line", { storyId: "house-of-roses" }))).toBe("");
  });
});

describe("renderChronicleEntry · koinon lines", () => {
  it("renders the six events, and an empty string for one it does not know", () => {
    const line = (event: string) => renderChronicleEntry(entry("koinon", { event, koinonName: "The Sacred Band" }));
    expect(line("founded")).toBe("Founded the koinon The Sacred Band.");
    expect(line("joined")).toBe("Joined the koinon The Sacred Band.");
    expect(line("left")).toBe("Left the koinon The Sacred Band.");
    expect(line("expelled")).toBe("Was expelled from the koinon The Sacred Band.");
    expect(line("leader")).toBe("Took the lead of the koinon The Sacred Band.");
    expect(line("lesche")).toBe("Commissioned a Lesche for the koinon The Sacred Band.");
    expect(line("renamed")).toBe("");
  });
});
