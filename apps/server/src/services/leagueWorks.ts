import { festivalDocketFor, getAgendaCycle, leagueDocketFor } from "@massalia/db";
import { buildingEffects, festivalEffects, festivalMotion, festivalYearLabel, formatGameDate, gameDate, nextAgendaDocket, projectMotion, REAL_MS_PER_SEASON, type MotionScope } from "@massalia/shared";
import { getLeagueBuildings, getLeagueCities, getLeagueFestivals } from "./agenda.js";
import { getPoliticsConfig } from "./oligarchy.js";

// ---------------------------------------------------------------------------
// The League's plans, in advance (government prompt 3b): what everyone sees on
// the Cities tab. The five buildings and what each does; the building docket,
// when it opens and what would be on it today (or what is on it, while it is
// open); the festival docket the same, with the year it is for. Nothing here
// is the Government's: what is drafted and vetoed stays with the agenda views.
// ---------------------------------------------------------------------------

export interface LeagueWorksBuilding {
  id: string;
  name: string;
  cost: number;
  seasons: number;
  populationAbove: number | null;
  partyLean: string;
  effects: string[]; // buildingEffects for "The city"
}

export interface LeagueWorksProjectItem {
  id: string;
  cityId: string;
  polis: string;
  buildingId: string;
  name: string; // the building's
}

export interface LeagueWorksFestivalItem {
  id: string;
  name: string; // the festival's
  cost: number;
  partyLean: string;
  effects: string[];
}

export interface LeagueWorksDocket<Item> {
  opensAt: string; // the ISO instant the docket's drafting season begins
  opensLabel: string; // its game date, "Winter, 299 BC"
  drafting: boolean; // open now
  items: Item[];
}

export interface LeagueWorksView {
  buildings: LeagueWorksBuilding[];
  projects: LeagueWorksDocket<LeagueWorksProjectItem>;
  festivals: LeagueWorksDocket<LeagueWorksFestivalItem> & { year: number; yearLabel: string };
}

const CITY_PLACEHOLDER = "The city";

export async function leagueWorksView(world: { id: string; startedMs: number }, now: Date = new Date()): Promise<LeagueWorksView> {
  const cfg = getPoliticsConfig().agenda;
  const buildings = getLeagueBuildings();
  const cities = getLeagueCities().cities;
  const festivals = getLeagueFestivals();
  const seasonIndex = gameDate(now.getTime(), world.startedMs).seasonIndex;

  const docket = (scope: MotionScope) => {
    const next = nextAgendaDocket(seasonIndex, scope, cfg);
    const opensMs = world.startedMs + next.draftSeasonIndex * REAL_MS_PER_SEASON;
    return { next, opensAt: new Date(opensMs).toISOString(), opensLabel: formatGameDate(gameDate(opensMs, world.startedMs)) };
  };

  // The building docket: while drafting with a cycle row, the docket fixed when it
  // opened; otherwise (a coming docket, or an open one no sync has fixed yet) as
  // it would open today.
  const p = docket("league");
  const projectCycle = p.next.drafting ? await getAgendaCycle(world.id, "league", p.next.gameYear) : null;
  const projectIds = projectCycle ? projectCycle.cardIds : (await leagueDocketFor(world.id)).map((m) => m.id);
  const projectItems: LeagueWorksProjectItem[] = [];
  for (const id of projectIds) {
    const motion = projectMotion(id, buildings, cities);
    if (!motion) continue; // a League card from before
    projectItems.push({ id: motion.id, cityId: motion.cityId, polis: motion.polis, buildingId: motion.buildingId, name: buildings.find((b) => b.id === motion.buildingId)?.name ?? motion.buildingId });
  }

  // The festival docket, for the coming year.
  const f = docket("festival");
  const year = f.next.gameYear + 1;
  const festivalCycle = f.next.drafting ? await getAgendaCycle(world.id, "festival", f.next.gameYear) : null;
  const festivalIds = festivalCycle ? festivalCycle.cardIds : (await festivalDocketFor(world.id, year)).map((m) => m.id);
  const festivalItems: LeagueWorksFestivalItem[] = [];
  for (const id of festivalIds) {
    const motion = festivalMotion(id, festivals);
    const festival = motion ? festivals.find((x) => x.id === motion.festivalId) : undefined;
    if (!motion || !festival) continue;
    festivalItems.push({ id: motion.id, name: festival.name, cost: festival.cost, partyLean: festival.partyLean, effects: festivalEffects(festival) });
  }

  return {
    buildings: buildings.map((b) => ({ id: b.id, name: b.name, cost: b.cost, seasons: b.seasons, populationAbove: b.populationAbove, partyLean: b.partyLean, effects: buildingEffects(b, CITY_PLACEHOLDER) })),
    projects: { opensAt: p.opensAt, opensLabel: p.opensLabel, drafting: p.next.drafting, items: projectItems },
    festivals: { opensAt: f.opensAt, opensLabel: f.opensLabel, drafting: f.next.drafting, items: festivalItems, year, yearLabel: festivalYearLabel(year) },
  };
}
