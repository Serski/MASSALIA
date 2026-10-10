import { z } from "zod";
import { REAL_MS_PER_SEASON, START_YEAR_BC } from "./calendar.js";
import { CLASS_IDS } from "./character.js";
import { CLASS_PLURALS, type LeagueClassGrant } from "./leagueProjects.js";

// ---------------------------------------------------------------------------
// The League's festivals (government prompt 3). Each Summer the Archons put one
// festival to the chamber for the coming year, from content/politics/
// league-festivals.json; a passed festival is paid from the League treasury and
// its classes draw its bonus each season of that year, through the same grant
// settle the buildings use. Pure: the server decides the year, the Olympiad
// rule and the balance.
// ---------------------------------------------------------------------------

export const leagueFestivalSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    // The motion's title with {year} standing for the festival year's label ("299 BC").
    title: z.string().min(1),
    description: z.string().min(1),
    // The classes paid bonusPerSeason each season of the festival year.
    classes: z.array(z.enum(CLASS_IDS)).min(1),
    // What the League treasury pays when the vote closes.
    cost: z.number().int().nonnegative(),
    bonusPerSeason: z.number().int().positive(),
    // Only on the docket for an Olympiad year.
    olympiadOnly: z.boolean(),
    partyLean: z.enum(["palaioi", "dynatoi", "independent"]),
  })
  .strict();

export const leagueFestivalsSchema = z.object({ festivals: z.array(leagueFestivalSchema).min(1) }).strict();

export type LeagueFestival = z.infer<typeof leagueFestivalSchema>;
export type LeagueFestivalsContent = z.infer<typeof leagueFestivalsSchema>;

export function parseLeagueFestivals(data: unknown): LeagueFestivalsContent {
  const parsed = leagueFestivalsSchema.parse(data);
  const seen = new Set<string>();
  for (const f of parsed.festivals) {
    if (seen.has(f.id)) throw new Error(`Duplicate league festival id: ${f.id}`);
    seen.add(f.id);
  }
  return parsed;
}

// --- The motion ids -----------------------------------------------------------

const FESTIVAL_PREFIX = "festival:";

// The agenda card id a festival travels under: "festival:<id>:y<year>".
export function festivalMotionId(festivalId: string, year: number): string {
  return `${FESTIVAL_PREFIX}${festivalId}:y${year}`;
}

export function parseFestivalMotionId(id: string): { festivalId: string; year: number } | null {
  if (!id.startsWith(FESTIVAL_PREFIX)) return null;
  const parts = id.slice(FESTIVAL_PREFIX.length).split(":");
  if (parts.length !== 2 || !parts[0] || !/^y\d+$/.test(parts[1] ?? "")) return null;
  return { festivalId: parts[0], year: Number(parts[1]!.slice(1)) };
}

// --- The docket ---------------------------------------------------------------

export interface FestivalMotion {
  id: string;
  festivalId: string;
  title: string;
  description: string;
  cost: number;
  classes: LeagueFestival["classes"];
  bonusPerSeason: number;
  partyLean: LeagueFestival["partyLean"];
  year: number;
}

export function festivalYearLabel(year: number): string {
  return `${START_YEAR_BC - year} BC`;
}

function motion(festival: LeagueFestival, year: number): FestivalMotion {
  return {
    id: festivalMotionId(festival.id, year),
    festivalId: festival.id,
    title: festival.title.split("{year}").join(festivalYearLabel(year)),
    description: festival.description,
    cost: festival.cost,
    classes: festival.classes,
    bonusPerSeason: festival.bonusPerSeason,
    partyLean: festival.partyLean,
    year,
  };
}

// The festivals the Archons may put to the chamber for `year`: every festival
// the year allows (an olympiadOnly one only when `olympiadYear`) within the
// balance, in content order.
export function festivalDocket(festivals: LeagueFestival[], year: number, olympiadYear: boolean, balance: number): FestivalMotion[] {
  return festivals.filter((f) => (!f.olympiadOnly || olympiadYear) && f.cost <= balance).map((f) => motion(f, year));
}

// The motion for one festival id, with no eligibility check, or null.
export function festivalMotion(id: string, festivals: LeagueFestival[]): FestivalMotion | null {
  const parsed = parseFestivalMotionId(id);
  if (!parsed) return null;
  const festival = festivals.find((f) => f.id === parsed.festivalId);
  return festival ? motion(festival, parsed.year) : null;
}

// --- What a held festival pays ----------------------------------------------
// A span is a festival held: [startsAt, endsAt) in ms, the festival year.

export interface FestivalSpan {
  festivalId: string;
  year: number;
  startsAt: number;
  endsAt: number;
}

// What the League pays a character of `classId` for the seasons fromSeason to
// toSeason inclusive: each span whose festival names the class pays its bonus for
// every season whose first instant lies in the span. 0 when fromSeason > toSeason.
export function festivalClassPay(spans: FestivalSpan[], festivals: LeagueFestival[], classId: string, worldStartMs: number, fromSeason: number, toSeason: number): number {
  let total = 0;
  for (let season = fromSeason; season <= toSeason; season++) {
    const t = worldStartMs + season * REAL_MS_PER_SEASON;
    for (const span of spans) {
      const festival = festivals.find((f) => f.id === span.festivalId);
      if (!festival || !(festival.classes as readonly string[]).includes(classId)) continue;
      if (t >= span.startsAt && t < span.endsAt) total += festival.bonusPerSeason;
    }
  }
  return total;
}

// The festival grants running for `classId` at atMs, in startsAt order, in the
// shape the buildings' grants use (the title is the motion's, untilMs the span's end).
export function festivalClassGrants(spans: FestivalSpan[], festivals: LeagueFestival[], classId: string, atMs: number): LeagueClassGrant[] {
  const out: LeagueClassGrant[] = [];
  for (const span of [...spans].sort((a, b) => a.startsAt - b.startsAt)) {
    const festival = festivals.find((f) => f.id === span.festivalId);
    if (!festival || !(festival.classes as readonly string[]).includes(classId)) continue;
    if (atMs < span.startsAt || atMs >= span.endsAt) continue;
    out.push({ cityId: "", buildingId: span.festivalId, title: motion(festival, span.year).title, perSeason: festival.bonusPerSeason, untilMs: span.endsAt });
  }
  return out;
}

// One line: "Hetairai and Philosophers +10 dr a season for the year".
export function festivalEffects(festival: LeagueFestival): string[] {
  return [`${festival.classes.map((c) => CLASS_PLURALS[c]).join(" and ")} +${festival.bonusPerSeason} dr a season for the year`];
}
