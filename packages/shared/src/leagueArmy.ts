import { z } from "zod";

// ---------------------------------------------------------------------------
// The League's army (government prompt 5a). The ten home towns' garrisons are
// the League's own units of the four trained types, standing in their towns,
// with the whole fleet at one of them; the League treasury pays a flat upkeep
// per man once a season, and men desert when it cannot. The numbers come from
// content/military/league-army.json. Pure: the server reads the rows, the
// treasury and the clock.
// ---------------------------------------------------------------------------

// The four trained types, in the order the army's lines name them.
export const LEAGUE_UNIT_IDS = ["hoplite", "peltast", "ekdromos", "hippeis"] as const;
export type LeagueUnitId = (typeof LEAGUE_UNIT_IDS)[number];
export type LeagueUnits = Record<LeagueUnitId, number>;

const men = z.number().int().nonnegative();
const unitsSchema = z.object({ hoplite: men, peltast: men, ekdromos: men, hippeis: men }).strict();

export const leagueArmySchema = z
  .object({
    version: z.number().int().positive(),
    source: z.string(),
    // What the League treasury pays per man per season.
    upkeepPerManPerSeason: z.number().positive(),
    // For how many seasons after the League's army fights at a place the house
    // of a sitting Archon or Strategos may not raid or attack it (government
    // prompt 5b, ruling 3 at STOP 1): a year.
    harvestBanSeasons: z.number().int().nonnegative(),
    // The town the whole fleet stands at; one of `towns`.
    fleetAt: z.string().min(1),
    // The army as it is raised, town by town, in the order the Government tab lists them.
    towns: z.array(z.object({ townId: z.string().min(1), units: unitsSchema }).strict()).min(1),
  })
  .strict();

export type LeagueArmyContent = z.infer<typeof leagueArmySchema>;

export function parseLeagueArmy(data: unknown): LeagueArmyContent {
  const parsed = leagueArmySchema.parse(data);
  const seen = new Set<string>();
  for (const t of parsed.towns) {
    if (seen.has(t.townId)) throw new Error(`league-army.json: town "${t.townId}" twice`);
    seen.add(t.townId);
  }
  if (!seen.has(parsed.fleetAt)) throw new Error(`league-army.json: fleetAt "${parsed.fleetAt}" is not one of its towns`);
  return parsed;
}

// The men of one town, or of any set of the four counts.
export function leagueUnitsMen(units: LeagueUnits): number {
  return LEAGUE_UNIT_IDS.reduce((n, id) => n + units[id], 0);
}

// --- The upkeep ---------------------------------------------------------------

// A season's upkeep for `men` at `rate` drachmae a man: whole drachmae, rounded.
export function armyUpkeep(men: number, rate: number): number {
  return Math.round(men * rate);
}

// The men a payment keeps at `rate` a man. The epsilon keeps a rate that is not
// a binary fraction from losing a man to the division.
export function menPaidFor(paid: number, rate: number): number {
  return Math.floor(paid / rate + 1e-9);
}

// --- Desertion ----------------------------------------------------------------

export interface DesertionRow {
  basedAt: string;
  unitId: string;
  count: number;
}

// What each row loses when `deserters` men leave, in the rows' own order.
// Desertion thins every row: when the deserters are the whole army every row
// goes; otherwise each row first loses floor(count × deserters / men), and the
// men still owed come one each from the rows in order of their count before
// desertion, largest first, ties by based_at then unit_id. Never more than a
// row holds, nor more than the deserters in all.
export function desertionPlan(rows: readonly DesertionRow[], deserters: number): number[] {
  const army = rows.reduce((n, r) => n + r.count, 0);
  const leaving = Math.max(0, Math.min(army, Math.floor(deserters)));
  if (leaving === 0) return rows.map(() => 0);
  if (leaving === army) return rows.map((r) => r.count);
  const lose = rows.map((r) => Math.floor((r.count * leaving) / army));
  let owed = leaving - lose.reduce((n, x) => n + x, 0);
  const order = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.count > 0)
    .sort((a, b) => b.r.count - a.r.count || a.r.basedAt.localeCompare(b.r.basedAt) || a.r.unitId.localeCompare(b.r.unitId));
  for (const { r, i } of order) {
    if (owed === 0) break;
    if (lose[i]! >= r.count) continue;
    lose[i]! += 1;
    owed -= 1;
  }
  return lose;
}

// --- The army's words -----------------------------------------------------------

const UNIT_WORDS: Record<LeagueUnitId, [one: string, many: string]> = {
  hoplite: ["hoplite", "hoplites"],
  peltast: ["peltast", "peltasts"],
  ekdromos: ["ekdromos", "ekdromoi"],
  hippeis: ["hippeis", "hippeis"],
};

// "500 hoplites, 250 peltasts, 150 ekdromoi, 100 hippeis": the types a town
// holds, in the army's order, a type with no men left out; "no men" for none.
export function leagueUnitsLine(units: LeagueUnits): string {
  const parts = LEAGUE_UNIT_IDS.filter((id) => units[id] > 0).map((id) => `${units[id].toLocaleString("en-US")} ${UNIT_WORDS[id][units[id] === 1 ? 0 : 1]}`);
  return parts.length ? parts.join(", ") : "no men";
}
