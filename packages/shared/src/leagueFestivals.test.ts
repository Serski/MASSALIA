import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  festivalClassGrants,
  festivalClassPay,
  festivalDocket,
  festivalEffects,
  festivalMotion,
  festivalMotionId,
  parseFestivalMotionId,
  parseLeagueFestivals,
  REAL_MS_PER_SEASON,
  type FestivalSpan,
} from "./index.js";

// ---------------------------------------------------------------------------
// The League's festivals (government prompt 3), pure rules: the content parses,
// the Summer docket is the festivals the coming year allows and the treasury
// can afford, a held festival pays its classes each season of its year, and the
// ids round-trip. The numbers come from content.
// ---------------------------------------------------------------------------

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const festivals = parseLeagueFestivals(JSON.parse(readFileSync(resolve(root, "content/politics/league-festivals.json"), "utf8"))).festivals;
const S = REAL_MS_PER_SEASON;
const season = (n: number) => n * S;

describe("league-festivals.json", () => {
  it("parses: four festivals in order with their classes, costs and the Olympiad flag", () => {
    expect(festivals.map((f) => [f.id, f.classes, f.cost, f.bonusPerSeason, f.olympiadOnly, f.partyLean])).toEqual([
      ["dionysia", ["hetaira", "philosopher"], 500, 10, false, "independent"],
      ["artemisia", ["priest", "landowner"], 600, 10, false, "independent"],
      ["apollo", ["trader", "shipbuilder"], 500, 10, false, "independent"],
      ["olympiad", ["hoplite"], 800, 10, true, "independent"],
    ]);
  });

  it("rejects a duplicate id, an unknown class, an unknown key and a bonus of 0", () => {
    expect(() => parseLeagueFestivals({ festivals: [festivals[0], festivals[0]] })).toThrow(/Duplicate league festival/);
    expect(() => parseLeagueFestivals({ festivals: [{ ...festivals[0], classes: ["sailor"] }] })).toThrow();
    expect(() => parseLeagueFestivals({ festivals: [{ ...festivals[0], extra: 1 }] })).toThrow();
    expect(() => parseLeagueFestivals({ festivals: [{ ...festivals[0], bonusPerSeason: 0 }] })).toThrow();
  });
});

describe("the festival ids", () => {
  it("round-trip, and anything else parses to null", () => {
    expect(festivalMotionId("dionysia", 3)).toBe("festival:dionysia:y3");
    expect(parseFestivalMotionId("festival:dionysia:y3")).toEqual({ festivalId: "dionysia", year: 3 });
    expect(parseFestivalMotionId("project:massalia:temple")).toBeNull();
    expect(parseFestivalMotionId("league-sea-wall")).toBeNull();
    expect(parseFestivalMotionId("festival:dionysia")).toBeNull();
    expect(parseFestivalMotionId("festival:dionysia:3")).toBeNull();
  });
});

describe("festivalDocket", () => {
  it("a plain year holds the three yearly festivals, an Olympiad year the four, with the year's label in the titles", () => {
    const plain = festivalDocket(festivals, 3, false, 60_000);
    expect(plain.map((m) => m.id)).toEqual(["festival:dionysia:y3", "festival:artemisia:y3", "festival:apollo:y3"]);
    expect(plain[0]).toEqual({
      id: "festival:dionysia:y3",
      festivalId: "dionysia",
      title: "A Dionysia for 297 BC",
      description: festivals[0]!.description,
      cost: 500,
      classes: ["hetaira", "philosopher"],
      bonusPerSeason: 10,
      partyLean: "independent",
      year: 3,
    });
    const olympiad = festivalDocket(festivals, 8, true, 60_000);
    expect(olympiad.map((m) => m.festivalId)).toEqual(["dionysia", "artemisia", "apollo", "olympiad"]);
    expect(olympiad[3]!.title).toBe("The Olympiad of 292 BC");
  });

  it("the balance bounds it: 599 leaves the two at 500, 499 leaves none", () => {
    expect(festivalDocket(festivals, 3, true, 599).map((m) => m.festivalId)).toEqual(["dionysia", "apollo"]);
    expect(festivalDocket(festivals, 3, true, 499)).toEqual([]);
  });

  it("festivalMotion resolves one id with no eligibility check", () => {
    expect(festivalMotion("festival:olympiad:y5", festivals)?.title).toBe("The Olympiad of 295 BC");
    expect(festivalMotion("festival:saturnalia:y5", festivals)).toBeNull();
    expect(festivalMotion("project:massalia:temple", festivals)).toBeNull();
  });
});

describe("a held festival pays its classes", () => {
  // An Artemisia held in year 2: seasons 8 to 11.
  const artemisia: FestivalSpan = { festivalId: "artemisia", year: 2, startsAt: season(8), endsAt: season(12) };

  it("festivalClassPay: a Priest draws 10 a season for the four seasons of the year, a Trader nothing", () => {
    const pay = (from: number, to: number, classId = "priest") => festivalClassPay([artemisia], festivals, classId, 0, from, to);
    expect(pay(8, 11)).toBe(40);
    expect(pay(8, 8)).toBe(10);
    expect(pay(4, 7)).toBe(0);
    expect(pay(12, 20)).toBe(0);
    expect(pay(7, 9)).toBe(20);
    expect(pay(8, 11, "trader")).toBe(0);
    expect(pay(9, 8)).toBe(0);
  });

  it("festivalClassGrants: inside the year one grant with the motion's title and the year's end; outside none", () => {
    expect(festivalClassGrants([artemisia], festivals, "landowner", season(9))).toEqual([
      { cityId: "", buildingId: "artemisia", title: "An Artemisia for 298 BC", perSeason: 10, untilMs: season(12) },
    ]);
    expect(festivalClassGrants([artemisia], festivals, "landowner", season(12))).toEqual([]);
    expect(festivalClassGrants([artemisia], festivals, "hoplite", season(9))).toEqual([]);
  });
});

describe("festivalEffects", () => {
  it("one line per festival, verbatim", () => {
    expect(festivals.map((f) => festivalEffects(f))).toEqual([
      ["Hetairai and Philosophers +10 dr a season for the year"],
      ["Priests and Landowners +10 dr a season for the year"],
      ["Traders and Shipbuilders +10 dr a season for the year"],
      ["Hoplites +10 dr a season for the year"],
    ]);
  });
});
