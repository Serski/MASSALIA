import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  donationFestivals,
  festivalSeasonOfYear,
  festivalsFiringAt,
  isCalendarEvent,
  isEventEligible,
  parseCalendarConfig,
  parseEventFile,
  type CalendarConfig,
} from "./index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const cfg: CalendarConfig = parseCalendarConfig(JSON.parse(readFileSync(resolve(root, "content/calendar/calendar-config.json"), "utf8")));
const festivalEvents = parseEventFile(JSON.parse(readFileSync(resolve(root, "content/events/events-festivals.json"), "utf8")));

describe("calendar config + festivals", () => {
  it("parses the shipped calendar config", () => {
    expect(cfg.startYearBC).toBe(300);
    expect(cfg.festivals.length).toBeGreaterThanOrEqual(4);
  });

  it("donationFestivals are the three annual rites (olympiad excluded)", () => {
    const ids = donationFestivals(cfg).map((f) => f.id).sort();
    expect(ids).toEqual(["fest-apollo", "fest-artemisia", "fest-dionysia"]);
  });

  it("maps config season 1–4 to the calendar's seasonOfYear 0–3", () => {
    const byId = Object.fromEntries(cfg.festivals.map((f) => [f.id, f]));
    expect(festivalSeasonOfYear(byId["fest-dionysia"]!)).toBe(0); // Winter
    expect(festivalSeasonOfYear(byId["fest-artemisia"]!)).toBe(1); // Spring
    expect(festivalSeasonOfYear(byId["fest-apollo"]!)).toBe(3); // Autumn
  });

  it("fires the right donation festival for a season; olympiad never fires here", () => {
    expect(festivalsFiringAt(cfg, 0, 0).map((f) => f.id)).toEqual(["fest-dionysia"]); // Winter, year 0
    expect(festivalsFiringAt(cfg, 1, 5).map((f) => f.id)).toEqual(["fest-artemisia"]); // Spring (cadence 1, any year)
    expect(festivalsFiringAt(cfg, 3, 2).map((f) => f.id)).toEqual(["fest-apollo"]); // Autumn
    // Summer (seasonOfYear 2) is the olympiad's season (type olympic) -> no donation festival fires.
    expect(festivalsFiringAt(cfg, 2, 8)).toEqual([]);
  });

  it("respects cadenceYears (every fires yearly here; only qualifying years for higher cadence)", () => {
    // Synthetic biennial festival to prove the modulo.
    const biennial: CalendarConfig = { ...cfg, festivals: [{ id: "x", eventId: "x", season: 1, cadenceYears: 2, type: "donation" }] };
    expect(festivalsFiringAt(biennial, 0, 0).map((f) => f.id)).toEqual(["x"]);
    expect(festivalsFiringAt(biennial, 0, 1)).toEqual([]); // odd year, cadence 2
    expect(festivalsFiringAt(biennial, 0, 4).map((f) => f.id)).toEqual(["x"]);
  });
});

describe("festival events are calendar-triggered (excluded from the daily draw)", () => {
  it("every shipped festival/olympic event carries trigger:'calendar'", () => {
    expect(festivalEvents.length).toBeGreaterThan(0);
    for (const event of festivalEvents) expect(isCalendarEvent(event)).toBe(true);
  });

  it("a normal arena event is NOT a calendar event", () => {
    const normal = { id: "n", weight: 1, scene: "x", choices: [] };
    expect(isCalendarEvent(normal as never)).toBe(false);
  });

  it("noClass excludes the listed classes from eligibility (olympiad bars hetaira/slave)", () => {
    const olympic = festivalEvents.find((e) => e.id === "olympic-nominate")!;
    const ctx = (classId: string) => ({ classId, party: "none", isCouncilor: false, stats: { prestige: 0, devotion: 0, militia: 0, intelligence: 0 }, traitIds: [], married: false, spouseTraitIds: [], livingChildren: [] });
    expect(isEventEligible(olympic, ctx("hetaira"))).toBe(false);
    expect(isEventEligible(olympic, ctx("slave"))).toBe(false);
    expect(isEventEligible(olympic, ctx("trader"))).toBe(true);
  });
});
