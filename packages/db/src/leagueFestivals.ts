import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { festivalDocket, festivalMotion, olympiadConfig, parseCalendarConfig, parseLeagueFestivals, type CalendarConfig, type FestivalMotion, type FestivalSpan, type LeagueFestival } from "@massalia/shared";
import { createDb, type DbExec } from "./client.js";
import { leagueFestivals, treasuries } from "./schema.js";

const db = createDb();

// ---------------------------------------------------------------------------
// The League's festivals (government prompt 3): the Summer docket the Archons
// choose from for the coming year, the motion behind a festival id, and the
// festivals held, as spans the grant settle pays from. The festivals come from
// content/politics/league-festivals.json; the Olympiad years from the calendar.
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const festivalsFile = path.join(repoRoot, "content/politics/league-festivals.json");
const calendarFile = path.join(repoRoot, "content/calendar/calendar-config.json");

let festivals: LeagueFestival[] | null = null;
export async function loadLeagueFestivals(): Promise<LeagueFestival[]> {
  if (!festivals) festivals = parseLeagueFestivals(JSON.parse(await readFile(festivalsFile, "utf8"))).festivals;
  return festivals;
}

let calendar: CalendarConfig | null = null;
async function loadCalendar(): Promise<CalendarConfig> {
  if (!calendar) calendar = parseCalendarConfig(JSON.parse(await readFile(calendarFile, "utf8")));
  return calendar;
}

// An Olympiad year by the calendar's Olympiad entry (cadenceYears 8: years 0, 8, 16, …).
export async function isOlympiadYear(year: number): Promise<boolean> {
  const olympiad = olympiadConfig(await loadCalendar());
  return olympiad !== null && year % olympiad.cadenceYears === 0;
}

// The festivals the League can put to the chamber for `year`: the ones the year
// allows, within the League's balance, in content order.
export async function festivalDocketFor(worldId: string, year: number): Promise<FestivalMotion[]> {
  const defs = await loadLeagueFestivals();
  const balance = (await db.select({ balance: treasuries.balance }).from(treasuries).where(and(eq(treasuries.worldId, worldId), eq(treasuries.owner, "league"))).limit(1))[0]?.balance ?? 0;
  return festivalDocket(defs, year, await isOlympiadYear(year), balance);
}

// The motion behind a festival id, with no eligibility check; null for any other id.
export async function festivalMotionFor(id: string): Promise<FestivalMotion | null> {
  return festivalMotion(id, await loadLeagueFestivals());
}

// Every festival held in the world, as the span of its year. One select.
export async function festivalSpans(exec: DbExec, worldId: string): Promise<FestivalSpan[]> {
  const rows = await exec
    .select({ festivalId: leagueFestivals.festivalId, year: leagueFestivals.gameYear, startsAt: leagueFestivals.startsAt, endsAt: leagueFestivals.endsAt })
    .from(leagueFestivals)
    .where(eq(leagueFestivals.worldId, worldId));
  return rows.map((r) => ({ festivalId: r.festivalId, year: r.year, startsAt: r.startsAt.getTime(), endsAt: r.endsAt.getTime() }));
}
