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

describe("renderChronicleEntry · muster lines", () => {
  const peltasts = [{ count: 20, label: "Peltast", plural: "Peltasts", source: "trained" }];
  const base = { koinonName: "The Sacred Band", regionId: "R047", regionName: "Vocontii", force: peltasts, hulls: 0, winner: "attacker", killed: 12, lost: 3, share: { drachmae: 240, grain: 30 } };
  const line = (over: Record<string, unknown>) => renderChronicleEntry(entry("koinon_muster", { ...base, ...over }));

  it("a won raid with men only, hulls only, and both", () => {
    expect(line({})).toBe("Raided Vocontii with the koinon The Sacred Band: sent 20 peltasts, 12 tribesmen slain, 3 of ours lost, 240 drachmae and 30 grain for our share.");
    expect(line({ force: [], hulls: 2, lost: 0 })).toBe("Raided Vocontii with the koinon The Sacred Band: sent 2 hulls, 12 tribesmen slain, none of ours lost, 240 drachmae and 30 grain for our share.");
    expect(line({ hulls: 1 })).toBe("Raided Vocontii with the koinon The Sacred Band: sent 20 peltasts and 1 hull, 12 tribesmen slain, 3 of ours lost, 240 drachmae and 30 grain for our share.");
  });

  it("driven off with men only, hulls only, and both", () => {
    const off = { townId: "reii", townName: "Reii", winner: "defender", killed: 1, share: null };
    expect(line(off)).toBe("Raided Reii with the koinon The Sacred Band and were driven off: sent 20 peltasts, 1 soldier slain, 3 of ours lost.");
    expect(line({ ...off, force: [], hulls: 2, lost: 0 })).toBe("Raided Reii with the koinon The Sacred Band and were driven off: sent 2 hulls, 1 soldier slain, none of ours lost.");
    expect(line({ ...off, hulls: 2 })).toBe("Raided Reii with the koinon The Sacred Band and were driven off: sent 20 peltasts and 2 hulls, 1 soldier slain, 3 of ours lost.");
  });

  it("repulsed at sea reads the same whatever was sent", () => {
    const repulsed = { townId: "reii", townName: "Reii", winner: "repulsed", killed: 0, lost: 0, share: null };
    const expected = "Sailed against Reii with the koinon The Sacred Band and were driven off by its fleet before landing.";
    expect(line(repulsed)).toBe(expected);
    expect(line({ ...repulsed, force: [], hulls: 2 })).toBe(expected);
    expect(line({ ...repulsed, hulls: 2 })).toBe(expected);
  });
});
