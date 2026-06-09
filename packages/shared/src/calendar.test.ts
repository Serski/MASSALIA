import { describe, expect, it } from "vitest";
import {
  formatGameDate,
  gameDate,
  REAL_MS_PER_SEASON,
  SEASON_NAMES,
  START_YEAR_BC,
} from "./calendar.js";

const START = 1_000_000; // arbitrary injected world-start instant (ms)
const at = (seasons: number) => START + seasons * REAL_MS_PER_SEASON;

describe("gameDate", () => {
  it("starts at Winter, 300 BC on day zero", () => {
    const d = gameDate(START, START);
    expect(d.seasonIndex).toBe(0);
    expect(d.seasonName).toBe("Winter");
    expect(d.yearInGame).toBe(0);
    expect(d.yearBC).toBe(START_YEAR_BC);
  });

  it("cycles Winter -> Spring -> Summer -> Autumn over the first four seasons", () => {
    expect(gameDate(at(0), START).seasonName).toBe("Winter");
    expect(gameDate(at(1), START).seasonName).toBe("Spring");
    expect(gameDate(at(2), START).seasonName).toBe("Summer");
    expect(gameDate(at(3), START).seasonName).toBe("Autumn");
  });

  it("rolls over to a new year every four seasons", () => {
    const yearTwoWinter = gameDate(at(4), START);
    expect(yearTwoWinter.seasonIndex).toBe(4);
    expect(yearTwoWinter.seasonOfYear).toBe(0);
    expect(yearTwoWinter.seasonName).toBe("Winter");
    expect(yearTwoWinter.yearInGame).toBe(1);

    // Mid-year alignment: season 6 = year 1, Summer.
    const d6 = gameDate(at(6), START);
    expect(d6.yearInGame).toBe(1);
    expect(d6.seasonOfYear).toBe(2);
    expect(d6.seasonName).toBe("Summer");
  });

  it("counts the BC year down from 300, one per in-game year", () => {
    expect(gameDate(at(0), START).yearBC).toBe(300);
    expect(gameDate(at(3), START).yearBC).toBe(300); // still year 0
    expect(gameDate(at(4), START).yearBC).toBe(299); // first rollover
    expect(gameDate(at(72), START).yearBC).toBe(282); // 72 / 4 = 18 years -> 300 - 18
    expect(gameDate(at(72), START).seasonName).toBe("Winter"); // 72 % 4 = 0 -> Winter
  });

  it("uses the partway-through-a-season instant (floors), not rounding", () => {
    const justBeforeSpring = START + REAL_MS_PER_SEASON - 1;
    expect(gameDate(justBeforeSpring, START).seasonName).toBe("Winter");
  });

  it("clamps a not-yet-started / skewed world to the opening Winter", () => {
    const d = gameDate(START - 5 * REAL_MS_PER_SEASON, START);
    expect(d.seasonIndex).toBe(0);
    expect(d.seasonName).toBe("Winter");
    expect(d.yearBC).toBe(START_YEAR_BC);
  });
});

describe("formatGameDate", () => {
  it("renders the written date label", () => {
    expect(formatGameDate(gameDate(at(0), START))).toBe("Winter, 300 BC");
    // season 74 = 18 years + 2 seasons -> Summer, 282 BC (the spec example)
    expect(formatGameDate(gameDate(at(74), START))).toBe("Summer, 282 BC");
  });

  it("exposes the four canonical season names in cycle order", () => {
    expect(SEASON_NAMES).toEqual(["Winter", "Spring", "Summer", "Autumn"]);
  });
});
