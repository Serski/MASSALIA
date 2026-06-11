import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  competeRoll,
  olympiadConfig,
  olympiadFiringAt,
  olympiadSeasonOfYear,
  parseCalendarConfig,
  OLYMPIC_VICTORY_PRESTIGE,
  OLYMPIC_HONORABLE_PRESTIGE,
} from "./index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const cfg = parseCalendarConfig(JSON.parse(readFileSync(resolve(root, "content/calendar/calendar-config.json"), "utf8")));

describe("olympiadConfig", () => {
  it("normalizes the single type:'olympic' festival entry", () => {
    const o = olympiadConfig(cfg)!;
    expect(o.id).toBe("olympiad");
    expect(o.eventId).toBe("olympic-nominate");
    expect(o.season).toBe(3); // Summer
    expect(o.cadenceYears).toBe(8);
    expect(o.seats).toBe(2);
    expect(o.excludeClasses).toEqual(["hetaira", "slave"]);
    expect(o.payoffEventId).toBe("olympic-games");
    expect(o.payoffPeriodsLater).toBe(1);
  });

  it("maps config season 3 to seasonOfYear 2 (Summer)", () => {
    expect(olympiadSeasonOfYear(olympiadConfig(cfg)!)).toBe(2);
  });
});

describe("olympiadFiringAt", () => {
  const o = olympiadConfig(cfg)!;
  it("fires only in Summer of a cadence-aligned year", () => {
    expect(olympiadFiringAt(o, 2, 0)).toBe(true); // Summer, year 0 (0 % 8 == 0)
    expect(olympiadFiringAt(o, 2, 8)).toBe(true); // Summer, year 8
    expect(olympiadFiringAt(o, 2, 16)).toBe(true);
  });
  it("does not fire off-season or off-cadence", () => {
    expect(olympiadFiringAt(o, 1, 0)).toBe(false); // Spring
    expect(olympiadFiringAt(o, 2, 1)).toBe(false); // Summer but year 1
    expect(olympiadFiringAt(o, 2, 7)).toBe(false);
  });
});

describe("competeRoll", () => {
  it("all_out has the higher ceiling (a strong swing crowns a victor)", () => {
    const out = competeRoll(20, 20, "all_out", () => 0.999); // swing ~80 → 40 + 80 = 120
    expect(out.won).toBe(true);
    expect(out.prestigeAward).toBe(OLYMPIC_VICTORY_PRESTIGE);
  });

  it("all_out has the higher variance (a weak swing loses)", () => {
    const out = competeRoll(20, 20, "all_out", () => 0); // swing 0 → 40, below threshold
    expect(out.won).toBe(false);
    expect(out.prestigeAward).toBe(OLYMPIC_HONORABLE_PRESTIGE);
  });

  it("measured guarantees a floor (swing >= 25) but a lower ceiling", () => {
    const low = competeRoll(20, 20, "measured", () => 0); // 40 + 25 = 65 < 80 → honorable
    expect(low.won).toBe(false);
    const high = competeRoll(30, 30, "measured", () => 0.999); // 60 + ~55 = 115 → victory
    expect(high.won).toBe(true);
    // measured swing never exceeds 55, so a weak base cannot vault to the ceiling.
    const capped = competeRoll(10, 10, "measured", () => 0.999); // 20 + 55 = 75 < 80
    expect(capped.won).toBe(false);
  });

  it("an honorable showing still awards solid prestige", () => {
    expect(competeRoll(0, 0, "measured", () => 0).prestigeAward).toBe(OLYMPIC_HONORABLE_PRESTIGE);
  });
});
