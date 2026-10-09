import { z } from "zod";
import { REAL_MS_PER_SEASON } from "./calendar.js";
import { CLASS_IDS, type ClassId } from "./character.js";

// ---------------------------------------------------------------------------
// The League's building projects (government prompt 2a). The five buildings
// come from content/politics/league-buildings.json; each Winter the docket is
// every project the League can still build and afford, one item per polis per
// building, and the Archons put one to the chamber. Pure: the server decides
// which poleis exist, what they hold and what the treasury can pay.
// ---------------------------------------------------------------------------

export const leagueBuildingSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    // The motion's title with {polis} standing for the polis's name.
    title: z.string().min(1),
    description: z.string().min(1),
    cost: z.number().int().positive(),
    seasons: z.number().int().positive(),
    // Only a polis of more than this many people may build it; null means any polis.
    populationAbove: z.number().int().nonnegative().nullable(),
    partyLean: z.enum(["palaioi", "dynatoi", "independent"]),
    // What the polis's fortifications rise by when the building stands (0 = nothing).
    fortifications: z.number().int().nonnegative(),
    // The grant: every character of `class` in the world is paid `perSeason` for
    // the `seasons` after the building stands; null pays no one.
    classBonus: z.object({ class: z.enum(CLASS_IDS), perSeason: z.number().int().positive(), seasons: z.number().int().positive() }).strict().nullable(),
    // Every army that fights in the world gets `amount` morale for the `seasons`
    // after the building stands; null gives none.
    morale: z.object({ amount: z.number().int().positive(), seasons: z.number().int().positive() }).strict().nullable(),
    // What the polis's stability gains at each yearly drift while the building stands.
    stabilityPerYear: z.number().int().nonnegative(),
    // What the building pays the League treasury each season while it stands.
    treasuryPerSeason: z.number().int().nonnegative(),
  })
  .strict();

export const leagueBuildingsSchema = z.object({ buildings: z.array(leagueBuildingSchema).min(1) }).strict();

export type LeagueBuilding = z.infer<typeof leagueBuildingSchema>;
export type LeagueBuildingsContent = z.infer<typeof leagueBuildingsSchema>;

export function parseLeagueBuildings(data: unknown): LeagueBuildingsContent {
  const parsed = leagueBuildingsSchema.parse(data);
  const seen = new Set<string>();
  for (const b of parsed.buildings) {
    if (seen.has(b.id)) throw new Error(`Duplicate league building id: ${b.id}`);
    seen.add(b.id);
  }
  return parsed;
}

// --- The motion ids ----------------------------------------------------------

const PROJECT_PREFIX = "project:";

// The agenda card id a project travels under: "project:<cityId>:<buildingId>".
export function projectMotionId(cityId: string, buildingId: string): string {
  return `${PROJECT_PREFIX}${cityId}:${buildingId}`;
}

// The polis and building of a project id, or null for anything else (a League
// card id included).
export function parseProjectMotionId(id: string): { cityId: string; buildingId: string } | null {
  if (!id.startsWith(PROJECT_PREFIX)) return null;
  const parts = id.slice(PROJECT_PREFIX.length).split(":");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { cityId: parts[0], buildingId: parts[1] };
}

// The key of a (polis, building) pair already built or under way.
export function projectKey(cityId: string, buildingId: string): string {
  return `${cityId}:${buildingId}`;
}

// --- The docket ---------------------------------------------------------------

export interface DocketPolis {
  id: string;
  name: string;
  population: number;
}

export interface ProjectMotion {
  id: string;
  cityId: string;
  buildingId: string;
  polis: string;
  title: string;
  description: string;
  cost: number;
  seasons: number;
  partyLean: LeagueBuilding["partyLean"];
}

function motion(building: LeagueBuilding, polis: { id: string; name: string }): ProjectMotion {
  return {
    id: projectMotionId(polis.id, building.id),
    cityId: polis.id,
    buildingId: building.id,
    polis: polis.name,
    title: building.title.split("{polis}").join(polis.name),
    description: building.description,
    cost: building.cost,
    seasons: building.seasons,
    partyLean: building.partyLean,
  };
}

// Every project the League can put to the chamber now: one item per polis per
// building, polis order first (content order), then the buildings' order. Kept
// are those where the building has no population floor or the polis is above
// it, the pair is not taken (built or under way), and the cost is within the
// balance.
export function leagueDocket(buildings: LeagueBuilding[], poleis: DocketPolis[], taken: ReadonlySet<string>, balance: number): ProjectMotion[] {
  const out: ProjectMotion[] = [];
  for (const polis of poleis) {
    for (const building of buildings) {
      if (building.populationAbove !== null && !(polis.population > building.populationAbove)) continue;
      if (taken.has(projectKey(polis.id, building.id))) continue;
      if (building.cost > balance) continue;
      out.push(motion(building, polis));
    }
  }
  return out;
}

// The motion for one project id, with no eligibility check, or null when the id
// is not a project id or names an unknown polis or building.
export function projectMotion(id: string, buildings: LeagueBuilding[], cities: { id: string; name: string }[]): ProjectMotion | null {
  const parsed = parseProjectMotionId(id);
  if (!parsed) return null;
  const building = buildings.find((b) => b.id === parsed.buildingId);
  const polis = cities.find((c) => c.id === parsed.cityId);
  if (!building || !polis) return null;
  return motion(building, polis);
}

// --- What a standing building does (government prompt 2b) ---------------------
// The rules below take every project of a world, under way or standing, and
// decide by time: `completesAt` is the instant the building stands, in ms.

export interface ProjectTiming {
  cityId: string;
  buildingId: string;
  completesAt: number;
}

export const CLASS_PLURALS: Record<ClassId, string> = {
  landowner: "Landowners",
  trader: "Traders",
  philosopher: "Philosophers",
  hetaira: "Hetairai",
  hoplite: "Hoplites",
  shipbuilder: "Shipbuilders",
  priest: "Priests",
  slave: "Slaves",
};

function buildingOf(buildings: LeagueBuilding[], id: string): LeagueBuilding | undefined {
  return buildings.find((b) => b.id === id);
}

// The span a grant or a blessing holds: [completesAt, completesAt + seasons), the end excluded.
function holds(completesAt: number, seasons: number, atMs: number): boolean {
  return atMs >= completesAt && atMs < completesAt + seasons * REAL_MS_PER_SEASON;
}

// What the League pays a character of `classId` for the seasons fromSeason to
// toSeason inclusive: each project whose building's grant names the class pays
// its perSeason for every season whose first instant lies in its span. Each
// building pays on its own. 0 when fromSeason > toSeason.
export function leagueClassPay(projects: ProjectTiming[], buildings: LeagueBuilding[], classId: string, worldStartMs: number, fromSeason: number, toSeason: number): number {
  let total = 0;
  for (let season = fromSeason; season <= toSeason; season++) {
    const t = worldStartMs + season * REAL_MS_PER_SEASON;
    for (const p of projects) {
      const grant = buildingOf(buildings, p.buildingId)?.classBonus;
      if (!grant || grant.class !== classId) continue;
      if (holds(p.completesAt, grant.seasons, t)) total += grant.perSeason;
    }
  }
  return total;
}

export interface LeagueClassGrant {
  cityId: string;
  buildingId: string;
  title: string; // the motion's: "A Temple of Artemis at Massalia"
  perSeason: number;
  untilMs: number; // the span's end, excluded
}

// The grants running for `classId` at atMs, in completesAt order.
export function leagueClassGrants(projects: ProjectTiming[], buildings: LeagueBuilding[], cities: { id: string; name: string }[], classId: string, atMs: number): LeagueClassGrant[] {
  const out: LeagueClassGrant[] = [];
  for (const p of [...projects].sort((a, b) => a.completesAt - b.completesAt)) {
    const grant = buildingOf(buildings, p.buildingId)?.classBonus;
    if (!grant || grant.class !== classId || !holds(p.completesAt, grant.seasons, atMs)) continue;
    const motion = projectMotion(projectMotionId(p.cityId, p.buildingId), buildings, cities);
    if (!motion) continue;
    out.push({ cityId: p.cityId, buildingId: p.buildingId, title: motion.title, perSeason: grant.perSeason, untilMs: p.completesAt + grant.seasons * REAL_MS_PER_SEASON });
  }
  return out;
}

export interface LeagueMorale {
  amount: number; // the largest among the spans that hold atMs; spans never add up
  untilMs: number; // the end of the run of spans that holds atMs, excluded
}

// The blessing every army in the world fights under at atMs, or null. A span
// that starts at or before the run's end carries the run on (a second Temple
// that stands before the first one's years run out carries the blessing on).
export function leagueMorale(projects: ProjectTiming[], buildings: LeagueBuilding[], atMs: number): LeagueMorale | null {
  const spans = projects.flatMap((p) => {
    const morale = buildingOf(buildings, p.buildingId)?.morale;
    return morale ? [{ start: p.completesAt, end: p.completesAt + morale.seasons * REAL_MS_PER_SEASON, amount: morale.amount }] : [];
  });
  const holding = spans.filter((s) => atMs >= s.start && atMs < s.end);
  if (holding.length === 0) return null;
  const amount = Math.max(...holding.map((s) => s.amount));
  let untilMs = Math.max(...holding.map((s) => s.end));
  for (let grew = true; grew; ) {
    grew = false;
    for (const s of spans) {
      if (s.start <= untilMs && s.end > untilMs) {
        untilMs = s.end;
        grew = true;
      }
    }
  }
  return { amount, untilMs };
}

// What the standing buildings pay the League treasury a season, at atMs.
export function leagueDues(projects: ProjectTiming[], buildings: LeagueBuilding[], atMs: number): number {
  return projects.reduce((sum, p) => sum + (p.completesAt <= atMs ? (buildingOf(buildings, p.buildingId)?.treasuryPerSeason ?? 0) : 0), 0);
}

// What a polis's standing buildings add to its stability at a yearly drift, at atMs.
export function leagueStabilityBonus(projects: ProjectTiming[], buildings: LeagueBuilding[], cityId: string, atMs: number): number {
  return projects.reduce((sum, p) => sum + (p.cityId === cityId && p.completesAt <= atMs ? (buildingOf(buildings, p.buildingId)?.stabilityPerYear ?? 0) : 0), 0);
}

// "1 season", "2 years" (a multiple of 4 that is 8 or more), else "<n> seasons".
function spanLabel(seasons: number): string {
  if (seasons === 1) return "1 season";
  if (seasons >= 8 && seasons % 4 === 0) return `${seasons / 4} years`;
  return `${seasons} seasons`;
}

// One line per effect a building has when it stands, in this order, each only
// when its number is set.
export function buildingEffects(building: LeagueBuilding, polis: string): string[] {
  const out: string[] = [];
  if (building.classBonus) out.push(`${CLASS_PLURALS[building.classBonus.class]} +${building.classBonus.perSeason} dr a season for ${spanLabel(building.classBonus.seasons)}`);
  if (building.morale) out.push(`Every army +${building.morale.amount} morale for ${spanLabel(building.morale.seasons)}`);
  if (building.stabilityPerYear > 0) out.push(`${polis} +${building.stabilityPerYear} stability a year`);
  if (building.treasuryPerSeason > 0) out.push(`League treasury +${building.treasuryPerSeason} dr a season`);
  if (building.fortifications > 0) out.push(`${polis}'s fortifications +${building.fortifications}`);
  return out;
}
