import { z } from "zod";

// ---------------------------------------------------------------------------
// Annual festivals (Prompt 7). Rides the EXISTING season clock (calendar.ts).
// All tuning from content/calendar/calendar-config.json. Olympiad entries
// (type "olympic") are accepted here but handled in Prompt 8 — ignored for now.
//
// SEASON INDEXING: the config uses season 1–4 (1=Winter…4=Autumn); the calendar
// exposes seasonOfYear 0–3. Map config.season - 1 to the calendar's seasonOfYear.
// ---------------------------------------------------------------------------

export const festivalSchema = z
  .object({
    id: z.string(),
    eventId: z.string(),
    season: z.number().int().min(1).max(4),
    cadenceYears: z.number().int().positive(),
    type: z.string(), // "donation" | "olympic" | …
    choregosTraitId: z.string().optional(),
  })
  .passthrough(); // olympic-only fields ride along

export type Festival = z.infer<typeof festivalSchema>;

export const calendarConfigSchema = z
  .object({
    realMsPerPeriod: z.number(),
    periodsPerYear: z.number(),
    startYearBC: z.number(),
    seasonNames: z.array(z.string()),
    festivals: z.array(festivalSchema),
  })
  .passthrough(); // election/etc. (other packs) ride along

export type CalendarConfig = z.infer<typeof calendarConfigSchema>;

export function parseCalendarConfig(data: unknown): CalendarConfig {
  return calendarConfigSchema.parse(data);
}

// The calendar seasonOfYear (0–3) a festival fires in (config season is 1–4).
export function festivalSeasonOfYear(festival: Festival): number {
  return festival.season - 1;
}

export function donationFestivals(cfg: CalendarConfig): Festival[] {
  return cfg.festivals.filter((festival) => festival.type === "donation");
}

export function festivalById(cfg: CalendarConfig, id: string): Festival | undefined {
  return cfg.festivals.find((festival) => festival.id === id);
}

// The donation festivals live at a given point on the clock: those whose season
// matches the current seasonOfYear in a qualifying year (yearInGame % cadence == 0).
export function festivalsFiringAt(cfg: CalendarConfig, seasonOfYear: number, yearInGame: number): Festival[] {
  return donationFestivals(cfg).filter(
    (festival) => festivalSeasonOfYear(festival) === seasonOfYear && yearInGame % festival.cadenceYears === 0,
  );
}

// Whether a festival is currently live (its season + qualifying year) for a date.
export function isFestivalLive(festival: Festival, seasonOfYear: number, yearInGame: number): boolean {
  if (festival.type !== "donation") return false;
  return festivalSeasonOfYear(festival) === seasonOfYear && yearInGame % festival.cadenceYears === 0;
}
