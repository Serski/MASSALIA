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
import { applyCityStat, shiftStance } from "./league.js";

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
  married: false,
  spouseTraitIds: [],
  livingChildren: [],
};

// A convenience for family-eligibility tests: the base ctx with overrides applied.
function famCtx(over: Partial<EligibilityContext>): EligibilityContext {
  return { ...ctx, ...over };
}

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
  it("accepts family requires fields under the strict schema", () => {
    const out = parseEventFile(
      event({ id: "e", requires: { married: true, spouseTrait: "brave", hasChildren: true, childAgeBand: "youth", childSex: "female", household: true } }),
    );
    expect(out[0]!.requires?.childAgeBand).toBe("youth");
  });
  it("still rejects an unknown requires key (strict)", () => {
    expect(() => parseEventFile(event({ id: "e", requires: { bogus: true } as never }))).toThrow();
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

  it("any family field routes to the family arena", () => {
    expect(eventArena(event({ id: "a", requires: { married: true } }))).toBe("family");
    expect(eventArena(event({ id: "b", requires: { spouseTrait: "brave" } }))).toBe("family");
    expect(eventArena(event({ id: "c", requires: { hasChildren: true } }))).toBe("family");
    expect(eventArena(event({ id: "d", requires: { childAgeBand: "infant" } }))).toBe("family");
    expect(eventArena(event({ id: "e", requires: { childSex: "male" } }))).toBe("family");
    expect(eventArena(event({ id: "f", requires: { household: true } }))).toBe("family");
  });

  it("family precedence: family beats class on {class, household}", () => {
    // The hetaira household event carries class:"hetaira" AND household:true —
    // family must win over the class check.
    expect(eventArena(event({ id: "h", requires: { class: "hetaira", household: true } }))).toBe("family");
  });

  it("baseline player draws class + general (non-winter)", () => {
    expect(dailyArenasFor(famCtx({ party: "none" }), false)).toEqual(["class", "general"]);
  });
  it("oligarch in a party draws all four (non-winter)", () => {
    expect(dailyArenasFor(famCtx({ isCouncilor: true, party: "dynatoi" }), false)).toEqual(["class", "general", "council", "party"]);
  });

  describe("family arena: winter × qualifying", () => {
    it("winter + married adds the family arena", () => {
      expect(dailyArenasFor(famCtx({ married: true }), true)).toContain("family");
    });
    it("winter + a living child adds the family arena", () => {
      expect(dailyArenasFor(famCtx({ livingChildren: [{ sex: "male", ageYears: 3 }] }), true)).toContain("family");
    });
    it("winter + hetaira adds the family arena", () => {
      expect(dailyArenasFor(famCtx({ classId: "hetaira" }), true)).toContain("family");
    });
    it("winter but NOT qualifying (unmarried, childless, non-hetaira) → no family arena", () => {
      expect(dailyArenasFor(famCtx({ married: false, livingChildren: [], classId: "trader" }), true)).not.toContain("family");
    });
    it("qualifying but NOT winter → no family arena", () => {
      expect(dailyArenasFor(famCtx({ married: true }), false)).not.toContain("family");
    });
  });

  // The daily decision set IS the action budget: card count per day = arena count.
  describe("daily card count by archetype (non-winter)", () => {
    const cardCount = (over: Partial<EligibilityContext>) => dailyArenasFor(famCtx(over), false).length;

    it("a commoner (no office, unaligned) gets 2 cards", () => {
      expect(cardCount({ isCouncilor: false, party: "none" })).toBe(2);
    });
    it("a partied commoner gets 3 cards", () => {
      expect(cardCount({ isCouncilor: false, party: "palaioi" })).toBe(3);
    });
    it("an unaligned councilor gets 3 cards", () => {
      expect(cardCount({ isCouncilor: true, party: "none" })).toBe(3);
    });
    it("a partied councilor gets 4 cards", () => {
      expect(cardCount({ isCouncilor: true, party: "dynatoi" })).toBe(4);
    });
  });
});

describe("isEventEligible — family gating", () => {
  it("married requires a living spouse", () => {
    expect(isEventEligible(event({ id: "e", requires: { married: true } }), famCtx({ married: true }))).toBe(true);
    expect(isEventEligible(event({ id: "e", requires: { married: true } }), famCtx({ married: false }))).toBe(false);
  });
  it("spouseTrait matches personality OR mechanical id", () => {
    const e = event({ id: "e", requires: { spouseTrait: "brave" } });
    expect(isEventEligible(e, famCtx({ married: true, spouseTraitIds: ["brave"] }))).toBe(true);
    expect(isEventEligible(e, famCtx({ married: true, spouseTraitIds: ["frail"] }))).toBe(false);
    // no spouse -> spouseTraitIds is [] -> fails
    expect(isEventEligible(e, famCtx({ married: false, spouseTraitIds: [] }))).toBe(false);
  });
  it("hasChildren requires ≥1 living child", () => {
    expect(isEventEligible(event({ id: "e", requires: { hasChildren: true } }), famCtx({ livingChildren: [{ sex: "female", ageYears: 2 }] }))).toBe(true);
    expect(isEventEligible(event({ id: "e", requires: { hasChildren: true } }), famCtx({ livingChildren: [] }))).toBe(false);
  });
  it("household requires the hetaira class", () => {
    expect(isEventEligible(event({ id: "e", requires: { household: true } }), famCtx({ classId: "hetaira" }))).toBe(true);
    expect(isEventEligible(event({ id: "e", requires: { household: true } }), famCtx({ classId: "trader" }))).toBe(false);
  });

  describe("childAgeBand boundaries (infant 0–4, child 5–9, youth 10–14)", () => {
    const kids = (ageYears: number, sex: "male" | "female" = "male") => famCtx({ livingChildren: [{ sex, ageYears }] });
    const band = (b: "infant" | "child" | "youth") => event({ id: "e", requires: { childAgeBand: b } });

    it("infant includes 4, excludes 5", () => {
      expect(isEventEligible(band("infant"), kids(4))).toBe(true);
      expect(isEventEligible(band("infant"), kids(5))).toBe(false);
    });
    it("child includes 5 and 9, excludes 10", () => {
      expect(isEventEligible(band("child"), kids(5))).toBe(true);
      expect(isEventEligible(band("child"), kids(9))).toBe(true);
      expect(isEventEligible(band("child"), kids(10))).toBe(false);
    });
    it("youth includes 10 and 14, excludes 15", () => {
      expect(isEventEligible(band("youth"), kids(10))).toBe(true);
      expect(isEventEligible(band("youth"), kids(14))).toBe(true);
      expect(isEventEligible(band("youth"), kids(15))).toBe(false);
    });
    it("childSex narrows the band match", () => {
      const e = event({ id: "e", requires: { childAgeBand: "child", childSex: "female" } });
      expect(isEventEligible(e, kids(6, "female"))).toBe(true);
      expect(isEventEligible(e, kids(6, "male"))).toBe(false);
    });
    it("matches when ANY child fits (multiple children)", () => {
      const c = famCtx({ livingChildren: [{ sex: "male", ageYears: 1 }, { sex: "female", ageYears: 12 }] });
      expect(isEventEligible(event({ id: "e", requires: { childAgeBand: "youth", childSex: "female" } }), c)).toBe(true);
      expect(isEventEligible(event({ id: "e", requires: { childAgeBand: "youth", childSex: "male" } }), c)).toBe(false);
    });
  });

  it("family + non-family requirements combine (all must pass)", () => {
    const e = event({ id: "e", requires: { class: "hetaira", household: true } });
    expect(isEventEligible(e, famCtx({ classId: "hetaira" }))).toBe(true);
    expect(isEventEligible(e, famCtx({ classId: "trader" }))).toBe(false); // household fails
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

describe("world-scoped event effects (Atlas Phase 2b-ii)", () => {
  // A minimal single-event file carrying one choice with the given effects.
  const fileWith = (effects: unknown[]) => ({
    id: "evt-world",
    weight: 1,
    scene: "x",
    choices: [{ id: "c", label: "c", effects, resultText: "r" }],
  });

  it("parses the three new effect variants", () => {
    const events = parseEventFile(
      fileWith([
        { type: "change_city_stat", cityId: "antipolis", stat: "population", amount: -150 },
        { type: "change_faction_stance", factionId: "rome", amount: 1 },
        { type: "set_faction_vassal", factionId: "ligurians", vassal: true },
      ]),
    );
    expect(events[0]!.choices[0]!.effects).toHaveLength(3);
  });

  it("rejects change_city_stat with fortifications (Archon-only, not a CityStat)", () => {
    expect(() => parseEventFile(fileWith([{ type: "change_city_stat", cityId: "massalia", stat: "fortifications", amount: 1 }]))).toThrow();
  });

  it("rejects malformed world effects at parse time", () => {
    expect(() => parseEventFile(fileWith([{ type: "change_faction_stance", factionId: "rome" }]))).toThrow(); // missing amount
    expect(() => parseEventFile(fileWith([{ type: "set_faction_vassal", factionId: "rome", vassal: "yes" }]))).toThrow(); // vassal not boolean
    expect(() => parseEventFile(fileWith([{ type: "change_city_stat", cityId: "rome", stat: "population" }]))).toThrow(); // missing amount
  });
});

describe("shiftStance (clamped to war..allied)", () => {
  it("shifts by signed rungs", () => {
    expect(shiftStance("neutral", 2)).toBe("cordial");
    expect(shiftStance("neutral", -1)).toBe("unfriendly");
    expect(shiftStance("hostile", 1)).toBe("unfriendly");
  });
  it("clamps at both ends of the scale", () => {
    expect(shiftStance("allied", 2)).toBe("allied");
    expect(shiftStance("cordial", 5)).toBe("allied");
    expect(shiftStance("war", -3)).toBe("war");
    expect(shiftStance("unfriendly", -5)).toBe("war");
  });
  it("rounds a fractional nudge", () => {
    expect(shiftStance("neutral", 1.4)).toBe("friendly");
  });
});

describe("applyCityStat (clamped)", () => {
  it("floors population/tax/garrison at 0 (never negative)", () => {
    expect(applyCityStat("population", 100, -500)).toBe(0);
    expect(applyCityStat("garrison", 10, -50)).toBe(0);
    expect(applyCityStat("tax", 50, -999)).toBe(0);
  });
  it("bounds stability to 0..100", () => {
    expect(applyCityStat("stability", 95, 20)).toBe(100);
    expect(applyCityStat("stability", 5, -20)).toBe(0);
    expect(applyCityStat("stability", 70, 5)).toBe(75);
  });
  it("applies a normal positive delta and rounds to an integer", () => {
    expect(applyCityStat("population", 1000, 200)).toBe(1200);
    expect(applyCityStat("garrison", 100, 2.6)).toBe(103);
  });
});
