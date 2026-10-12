import { z } from "zod";
import { OPINION_MAX, OPINION_MIN, opinionBand, type FactionDef } from "./league.js";
import { spanLabel } from "./leagueProjects.js";

// ---------------------------------------------------------------------------
// The League's wars (government prompt 4). Each Spring the Archons put one war
// to the chamber, on a nation of the Diplomacy page whose bar is below
// opinionBelow; a passed war is paid from the League treasury and lasts
// `seasons`, during which raids on that nation's land take plunderMultiplier
// times the plunder and no longer sour it. Then peace comes by itself and the
// bar is set to peaceOpinion. The numbers come from content/politics/
// league-war.json. Pure: the server reads the bars and the balance.
// ---------------------------------------------------------------------------

const NATION = "{nation}";
const withNation = z.string().min(1).refine((s) => s.includes(NATION), { message: `must hold ${NATION}` });

export const leagueWarSchema = z
  .object({
    // What the League treasury pays when the vote closes.
    cost: z.number().int().nonnegative(),
    // How long the war lasts, from the instant the vote closes.
    seasons: z.number().int().positive(),
    // A nation is on the docket while its bar is below this.
    opinionBelow: z.number().int().min(OPINION_MIN).max(OPINION_MAX),
    // The bar the nation is set to when peace comes.
    peaceOpinion: z.number().int().min(OPINION_MIN).max(OPINION_MAX),
    // What a raid on the enemy's land takes, times the usual plunder.
    plunderMultiplier: z.number().min(1),
    partyLean: z.enum(["palaioi", "dynatoi", "independent"]),
    // The motion's words, with {nation} standing for the nation as nationName gives it.
    title: withNation,
    description: withNation,
  })
  .strict();

export type LeagueWar = z.infer<typeof leagueWarSchema>;

export function parseLeagueWar(data: unknown): LeagueWar {
  return leagueWarSchema.parse(data);
}

// A nation as a sentence names it: a major power by its name, a people with
// the article ("Carthage", "the Cadurci"), the rule raidGrudgeLine follows.
export function nationName(faction: Pick<FactionDef, "name" | "group">): string {
  return faction.group === "major-powers" ? faction.name : `the ${faction.name}`;
}

// --- The motion ids -----------------------------------------------------------

const WAR_PREFIX = "war:";

// The agenda card id a war travels under: "war:<factionId>:y<year>", the year
// being the game year of the cycle that drafts it.
export function warMotionId(factionId: string, year: number): string {
  return `${WAR_PREFIX}${factionId}:y${year}`;
}

export function parseWarMotionId(id: string): { factionId: string; year: number } | null {
  if (!id.startsWith(WAR_PREFIX)) return null;
  const parts = id.slice(WAR_PREFIX.length).split(":");
  if (parts.length !== 2 || !parts[0] || !/^y\d+$/.test(parts[1] ?? "")) return null;
  return { factionId: parts[0], year: Number(parts[1]!.slice(1)) };
}

// --- The docket ---------------------------------------------------------------

export interface WarMotion {
  id: string;
  factionId: string;
  name: string; // the faction's name, as the Diplomacy page shows it
  title: string;
  description: string;
  cost: number;
  partyLean: LeagueWar["partyLean"];
  year: number;
}

// A nation's bar and war flag in a world; a nation with no entry is at its content start.
export type WarRelation = { opinion: number; atWar: boolean };

type WarFaction = Pick<FactionDef, "id" | "name" | "group" | "start">;

function motion(faction: WarFaction, war: LeagueWar, year: number): WarMotion {
  const nation = nationName(faction);
  return {
    id: warMotionId(faction.id, year),
    factionId: faction.id,
    name: faction.name,
    title: war.title.split(NATION).join(nation),
    description: war.description.split(NATION).join(nation),
    cost: war.cost,
    partyLean: war.partyLean,
    year,
  };
}

// The wars the Archons may put to the chamber in `year`: one per nation, in
// content order, whose bar is below war.opinionBelow and that is not at war
// already, while the treasury can pay the war's cost.
export function warDocket(factions: WarFaction[], relations: ReadonlyMap<string, WarRelation>, war: LeagueWar, year: number, balance: number): WarMotion[] {
  if (war.cost > balance) return [];
  return factions
    .filter((f) => {
      const now = relations.get(f.id) ?? { opinion: f.start.opinion, atWar: f.start.atWar };
      return now.opinion < war.opinionBelow && !now.atWar;
    })
    .map((f) => motion(f, war, year));
}

// The motion for one war id, with no eligibility check, or null.
export function warMotion(id: string, factions: WarFaction[], war: LeagueWar): WarMotion | null {
  const parsed = parseWarMotionId(id);
  if (!parsed) return null;
  const faction = factions.find((f) => f.id === parsed.factionId);
  return faction ? motion(faction, war, parsed.year) : null;
}

// What a passed war does, one line per effect, in the words the dockets use.
export function warEffects(war: LeagueWar): string[] {
  return [
    `Raids on the enemy's land +${Math.round((war.plunderMultiplier - 1) * 100)}% plunder`,
    `Peace after ${spanLabel(war.seasons)}, at ${opinionBand(war.peaceOpinion).label}`,
  ];
}
