import { z } from "zod";

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
