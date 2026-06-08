import { describe, expect, it } from "vitest";
import {
  applyStatGrowth,
  choiceComposureEffectDelta,
  dailyArenasFor,
  describeChoiceCosts,
  drawEvent,
  eventArena,
  isEventEligible,
  parseEventFile,
  type EligibilityContext,
  type EventChoice,
  type EventDefinition,
} from "./events.js";

function event(over: Partial<EventDefinition> & { id: string }): EventDefinition {
  return {
    weight: 10,
    scene: "x",
    choices: [{ id: "c", label: "c", effects: [], resultText: "r" }],
    ...over,
  };
}

const ctx: EligibilityContext = {
  classId: "trader",
  party: "dynatoi",
  isCouncilor: false,
  stats: { prestige: 5, devotion: 2, militia: 0, intelligence: 8 },
  traitIds: ["shrewd"],
};

describe("parseEventFile — array vs single", () => {
  it("loads a single event object", () => {
    const out = parseEventFile(event({ id: "solo" }));
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("solo");
  });
  it("loads an array of events (category pack)", () => {
    const out = parseEventFile([event({ id: "a" }), event({ id: "b" })]);
    expect(out.map((e) => e.id)).toEqual(["a", "b"]);
  });
  it("throws on a malformed event", () => {
    expect(() => parseEventFile([{ id: "bad" }])).toThrow();
  });
  it("accepts the new effect types + requires", () => {
    const out = parseEventFile(
      event({
        id: "e",
        requires: { class: "trader", minStat: { intelligence: 5 } },
        choices: [
          {
            id: "c",
            label: "c",
            resultText: "r",
            effects: [
              { type: "change_stat", stat: "prestige", amount: 2 },
              { type: "change_drachmae", amount: -10 },
              { type: "change_party_favor", party: "dynatoi", amount: 3 },
              { type: "change_composure", amount: -5 },
              { type: "change_ideology", amount: 4 },
            ],
          },
        ],
      }),
    );
    expect(out[0]!.choices[0]!.effects).toHaveLength(5);
  });
});

describe("isEventEligible — gating", () => {
  it("passes with no requires", () => {
    expect(isEventEligible(event({ id: "e" }), ctx)).toBe(true);
  });
  it("class gate", () => {
    expect(isEventEligible(event({ id: "e", requires: { class: "trader" } }), ctx)).toBe(true);
    expect(isEventEligible(event({ id: "e", requires: { class: "priest" } }), ctx)).toBe(false);
  });
  it("party gate", () => {
    expect(isEventEligible(event({ id: "e", requires: { party: "dynatoi" } }), ctx)).toBe(true);
    expect(isEventEligible(event({ id: "e", requires: { party: "palaioi" } }), ctx)).toBe(false);
  });
  it("office councilor gate", () => {
    expect(isEventEligible(event({ id: "e", requires: { office: "councilor" } }), ctx)).toBe(false);
    expect(isEventEligible(event({ id: "e", requires: { office: "councilor" } }), { ...ctx, isCouncilor: true })).toBe(true);
  });
  it("minStat gate", () => {
    expect(isEventEligible(event({ id: "e", requires: { minStat: { intelligence: 8 } } }), ctx)).toBe(true);
    expect(isEventEligible(event({ id: "e", requires: { minStat: { intelligence: 9 } } }), ctx)).toBe(false);
    expect(isEventEligible(event({ id: "e", requires: { minStat: { militia: 1 } } }), ctx)).toBe(false);
  });
  it("trait / noTrait gate", () => {
    expect(isEventEligible(event({ id: "e", requires: { trait: "shrewd" } }), ctx)).toBe(true);
    expect(isEventEligible(event({ id: "e", requires: { trait: "bold" } }), ctx)).toBe(false);
    expect(isEventEligible(event({ id: "e", requires: { noTrait: "bold" } }), ctx)).toBe(true);
    expect(isEventEligible(event({ id: "e", requires: { noTrait: "shrewd" } }), ctx)).toBe(false);
  });
  it("combines conditions (all must pass)", () => {
    const e = event({ id: "e", requires: { class: "trader", party: "dynatoi", minStat: { intelligence: 5 } } });
    expect(isEventEligible(e, ctx)).toBe(true);
    expect(isEventEligible(e, { ...ctx, party: "palaioi" })).toBe(false);
  });
});

describe("drawEvent — weighted, excludes recent", () => {
  const pool = [event({ id: "a", weight: 1 }), event({ id: "b", weight: 1 }), event({ id: "c", weight: 1 })];
  it("excludes recently-seen ids", () => {
    // rng=0 picks the first of the non-recent pool
    const drawn = drawEvent(pool, ["a", "b"], () => 0);
    expect(drawn!.id).toBe("c");
  });
  it("falls back to the full set when all are recent", () => {
    const drawn = drawEvent(pool, ["a", "b", "c"], () => 0);
    expect(drawn!.id).toBe("a");
  });
  it("respects weight (heavy event wins a low roll across the range)", () => {
    const weighted = [event({ id: "rare", weight: 1 }), event({ id: "common", weight: 99 })];
    // roll just under total picks the last bucket (common)
    expect(drawEvent(weighted, [], () => 0.99)!.id).toBe("common");
    // roll at 0 picks the first bucket (rare)
    expect(drawEvent(weighted, [], () => 0)!.id).toBe("rare");
  });
  it("returns null on an empty pool", () => {
    expect(drawEvent([], [], () => 0)).toBeNull();
  });
});

describe("eventArena / dailyArenasFor", () => {
  it("infers arena from requires", () => {
    expect(eventArena(event({ id: "g" }))).toBe("general");
    expect(eventArena(event({ id: "c", requires: { class: "trader" } }))).toBe("class");
    expect(eventArena(event({ id: "o", requires: { office: "councilor" } }))).toBe("council");
    expect(eventArena(event({ id: "p", requires: { party: "dynatoi" } }))).toBe("party");
    // a general event with only a stat gate is still general
    expect(eventArena(event({ id: "m", requires: { minStat: { militia: 3 } } }))).toBe("general");
  });
  it("baseline player draws class + general", () => {
    expect(dailyArenasFor({ isCouncilor: false, party: "none" })).toEqual(["class", "general"]);
  });
  it("oligarch in a party draws all four", () => {
    expect(dailyArenasFor({ isCouncilor: true, party: "dynatoi" })).toEqual(["class", "general", "council", "party"]);
  });
});

describe("applyStatGrowth — growthMultiplier math (round half up)", () => {
  it("scales positive gains and rounds half up", () => {
    expect(applyStatGrowth(2, 1.5)).toBe(3); // 3.0
    expect(applyStatGrowth(3, 1.5)).toBe(5); // 4.5 -> 5
    expect(applyStatGrowth(1, 1.5)).toBe(2); // 1.5 -> 2
    expect(applyStatGrowth(4, 1.0)).toBe(4);
  });
  it("leaves losses and zero unscaled", () => {
    expect(applyStatGrowth(-3, 1.5)).toBe(-3);
    expect(applyStatGrowth(0, 1.5)).toBe(0);
  });
});

function choice(effects: EventChoice["effects"]): EventChoice {
  return { id: "c", label: "c", resultText: "r", effects };
}

describe("choiceComposureEffectDelta — explicit composure", () => {
  it("sums explicit change_composure effects", () => {
    expect(choiceComposureEffectDelta(choice([{ type: "change_composure", amount: -5 }, { type: "change_composure", amount: -3 }]))).toBe(-8);
  });
  it("is 0 when no explicit composure effect", () => {
    expect(choiceComposureEffectDelta(choice([{ type: "change_drachmae", amount: 10 }]))).toBe(0);
  });
});

describe("describeChoiceCosts — up-front mechanical preview", () => {
  it("labels stats, drachmae, favor, ideology, and resources", () => {
    const costs = describeChoiceCosts(
      choice([
        { type: "change_stat", stat: "militia", amount: 2 },
        { type: "change_drachmae", amount: -10 },
        { type: "change_party_favor", party: "palaioi", amount: 2 },
        { type: "change_ideology", amount: 5 },
        { type: "gain_resource", scope: "player", id: "p", resource: "grain", amount: 3 },
      ]),
    );
    expect(costs).toEqual([
      { label: "+2 Militia", tone: "positive" },
      { label: "-10 drachmae", tone: "negative" },
      { label: "+2 Palaioi favor", tone: "positive" },
      { label: "+5 Reformist", tone: "neutral" },
      { label: "+3 grain", tone: "positive" },
    ]);
  });
  it("renders a negative ideology shift as a Traditionalist lean", () => {
    expect(describeChoiceCosts(choice([{ type: "change_ideology", amount: -4 }]))).toEqual([
      { label: "+4 Traditionalist", tone: "neutral" },
    ]);
  });
  it("omits ideology shifts aimed at other characters, traits, and composure", () => {
    const costs = describeChoiceCosts(
      choice([
        { type: "change_ideology", amount: 6, characterId: "someone-else" },
        { type: "change_trait", traitId: "drunkard", operation: "add" },
        { type: "change_composure", amount: -5 },
      ]),
    );
    expect(costs).toEqual([]);
  });
});
