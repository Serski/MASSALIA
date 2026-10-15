import { z } from "zod";
import { seasonAt, seasonIndexAt } from "./buildings.js";
import { REAL_MS_PER_SEASON } from "./calendar.js";
import type { FactionDef } from "./league.js";
import { isLeagueFight, leagueAtWarWith, type LeagueWarSpan } from "./leagueOrders.js";
import { nationName } from "./leagueWars.js";
import type { Topology } from "./mapGraph.js";
import { distancesFrom } from "./reach.js";

// ---------------------------------------------------------------------------
// The strikes (strikes prompt 1): a nation marches on a Massalian place. Pure
// rules and words; the server reads the world, calls the march, fights it and
// writes the result (apps/server/src/services/strikes.ts).
//
// Two triggers. War: each season a nation is at war with the League, a march
// is called at the season's start and strikes `warningHours` later; its force
// is a fifth of the men in its towns and lands next to the target. Raids: a
// town or land fought more than `raids.moreThan` times within
// `raids.windowHours` calls a march at the fight that tips it over; its force
// is the raided place's full strength, its targets are next to the raided
// place (STOP 0 ruling 5). No march is called, and none strikes, in Winter.
// ---------------------------------------------------------------------------

const strikesSchema = z
  .object({
    version: z.literal(1),
    source: z.string(),
    forceShare: z.number().gt(0).max(1),
    warningHours: z.number().positive(),
    plunderPerRaider: z.number().int().nonnegative(),
    polis: z.object({ peopleLoss: z.number().min(0).max(1), stabilityLoss: z.number().int().nonnegative() }).strict(),
    raids: z.object({ moreThan: z.number().int().positive(), windowHours: z.number().positive() }).strict(),
  })
  .strict();
export type StrikesContent = z.infer<typeof strikesSchema>;
export function parseStrikesContent(data: unknown): StrikesContent {
  return strikesSchema.parse(data);
}

const HOUR_MS = 3_600_000;
export const strikeWarningMs = (c: StrikesContent) => c.warningHours * HOUR_MS;
export const raidsWindowMs = (c: StrikesContent) => c.raids.windowHours * HOUR_MS;

// --- Places ------------------------------------------------------------------

export type StrikePlaceKind = "town" | "region";
export type StrikeDrawView = { placeId: string; kind: StrikePlaceKind; men: number };
// One of the nation's own towns or lands (never one Massalia holds), with its
// men as they stand and its full strength.
export type NationPlace = { placeId: string; kind: StrikePlaceKind; regionId: string; men: number; full: number };
// A place it may strike: a home town (the League's) or a holding (a house's or
// the League's), with the men standing there when the march is called.
export type StrikeTarget = {
  placeId: string;
  regionId: string;
  townId: string | null;
  kind: "home" | "holding";
  holderPlayerId: string | null;
  takenFrom: boolean;
  name: string;
  full: number;
  defenders: number;
};

// A region and every region bordering it by land.
export function nearRegions(t: Topology, regionId: string): Set<string> {
  return new Set([regionId, ...(t.land.get(regionId) ?? [])]);
}

// Next to: the place's region is, or borders by land, one of `regions`.
export function isNextTo(t: Topology, regionId: string, regions: ReadonlySet<string>): boolean {
  for (const r of nearRegions(t, regionId)) if (regions.has(r)) return true;
  return false;
}

// The targets of a war march (ruling 4): the home towns next to the nation's
// land, and every holding next to it or taken from it.
export function warTargets(t: Topology, homes: StrikeTarget[], holdings: StrikeTarget[], land: readonly NationPlace[]): StrikeTarget[] {
  const regions = new Set(land.map((p) => p.regionId));
  return [...homes.filter((h) => isNextTo(t, h.regionId, regions)), ...holdings.filter((h) => h.takenFrom || isNextTo(t, h.regionId, regions))];
}

// The targets of a raids march (STOP 0 ruling 5): the home towns and holdings
// next to the raided place.
export function raidsTargets(t: Topology, homes: StrikeTarget[], holdings: StrikeTarget[], raidedRegionId: string): StrikeTarget[] {
  const near = nearRegions(t, raidedRegionId);
  return [...homes, ...holdings].filter((p) => near.has(p.regionId));
}

// --- The force -----------------------------------------------------------------

// `total` split over `weights` by largest remainder, each share never above its weight.
export function apportion(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((n, w) => n + Math.max(0, w), 0);
  const whole = Math.max(0, Math.min(Math.floor(total), sum));
  if (whole === 0 || sum === 0) return weights.map(() => 0);
  const exact = weights.map((w) => (whole * Math.max(0, w)) / sum);
  const out = exact.map((x) => Math.floor(x));
  let left = whole - out.reduce((n, x) => n + x, 0);
  const order = exact.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    if (out[i]! < weights[i]!) {
      out[i]!++;
      left--;
    }
  }
  return out;
}

// A war march's force on a target (ruling 6): a fifth of the men in its towns
// and lands next to the target, drawn from each in proportion; against a place
// taken from it, at least that place's full strength (the men beyond the
// draws come from no pool, and their dead come off none).
export function warForce(t: Topology, target: Pick<StrikeTarget, "regionId" | "takenFrom" | "full">, land: readonly NationPlace[], share: number): { force: number; draws: StrikeDrawView[] } {
  const near = nearRegions(t, target.regionId);
  const from = land.filter((p) => near.has(p.regionId) && p.men > 0);
  const total = from.reduce((n, p) => n + p.men, 0);
  const drawn = Math.floor(total * share);
  const split = apportion(drawn, from.map((p) => p.men));
  const draws = from.map((p, i) => ({ placeId: p.placeId, kind: p.kind, men: split[i]! })).filter((d) => d.men > 0);
  return { force: target.takenFrom ? Math.max(drawn, target.full) : drawn, draws };
}

// A raids march's force (STOP 0 ruling 5): the raided place's full strength,
// all of it drawn from that place.
export function raidsForce(raided: Pick<NationPlace, "placeId" | "kind" | "full">): { force: number; draws: StrikeDrawView[] } {
  return { force: raided.full, draws: raided.full > 0 ? [{ placeId: raided.placeId, kind: raided.kind, men: raided.full }] : [] };
}

// The enemy's dead off the pools it drew from, in proportion to what each sent
// (ruling 10), never more than a pool sent.
export function deadOffDraws(dead: number, draws: readonly StrikeDrawView[]): StrikeDrawView[] {
  const split = apportion(dead, draws.map((d) => d.men));
  return draws.map((d, i) => ({ ...d, men: split[i]! }));
}

// --- The choice ----------------------------------------------------------------

export type StrikeOption = StrikeTarget & { force: number; draws: StrikeDrawView[]; steps: number };

// The land steps from the nearest of `from` (regions) to `regionId`; Infinity when no road.
export function landStepsBetween(t: Topology, from: readonly string[], regionId: string): number {
  let best = Infinity;
  for (const r of new Set(from)) {
    const d = distancesFrom(t, r).land.get(regionId);
    if (d !== undefined && d < best) best = d;
  }
  return best;
}

// Ruling 5: the target its force most outnumbers; ties to a place taken from
// it, then the nearer, then by name. Null when it outnumbers the men nowhere:
// it stays home.
export function chooseTarget(options: readonly StrikeOption[]): StrikeOption | null {
  const ahead = options.filter((o) => o.force > o.defenders);
  ahead.sort((a, b) => b.force - b.defenders - (a.force - a.defenders) || Number(b.takenFrom) - Number(a.takenFrom) || a.steps - b.steps || a.name.localeCompare(b.name) || a.placeId.localeCompare(b.placeId));
  return ahead[0] ?? null;
}

// The number a march shows (call 20): to the nearest 10.
export const aboutMen = (force: number): number => Math.round(force / 10) * 10;

// --- The raids count --------------------------------------------------------------

// A fight, for the count: a party's raid or attack that met the defenders
// (isLeagueFight), or a koinon's muster that won or was driven off.
export const marchIsFight = (kind: string, winner: unknown): boolean => isLeagueFight(kind, winner);
export const musterIsFight = (outcome: unknown): boolean => outcome === "won" || outcome === "driven_off";

// The raids trigger is off for a nation while it is at war with the League
// (ruling 2b): a fight at one of its places while at war does not count (STOP 0
// ruling 3). A tribe with no faction is never at war.
export function fightsAtPeace(fightsMs: readonly number[], wars: readonly LeagueWarSpan[], factionId: string | null): number[] {
  return factionId === null ? [...fightsMs] : fightsMs.filter((ms) => !leagueAtWarWith(wars, factionId, ms));
}

// The instant of the fight that makes a place's count exceed `moreThan` within
// the window, counting only fights at or after `fromMs` (the world's start, or
// when the strikes went live: call 14) and after `restartMs` (the last raids
// march's trigger: the count starts again). Null when none does.
export function raidsFireAt(fightsMs: readonly number[], opts: { fromMs: number; restartMs: number | null; windowMs: number; moreThan: number }): number | null {
  const counted = fightsMs.filter((ms) => ms >= opts.fromMs && (opts.restartMs === null || ms > opts.restartMs)).sort((a, b) => a - b);
  for (let i = 0; i < counted.length; i++) {
    const at = counted[i]!;
    let n = 0;
    for (let j = 0; j <= i; j++) if (counted[j]! > at - opts.windowMs) n++;
    if (n > opts.moreThan) return at;
  }
  return null;
}

// --- The calendar ------------------------------------------------------------------

export const seasonStartMs = (index: number, worldStartedMs: number): number => worldStartedMs + index * REAL_MS_PER_SEASON;
const isWinter = (ms: number, worldStartedMs: number) => seasonAt(ms, worldStartedMs) === "Winter";

// When a raids march is called, the fight that fires it at `fireMs` (or the
// road clearing, call 13): then, unless it or its strike would fall in Winter
// (ruling 3), in which case at the start of the next Spring (STOP 0 ruling 4).
export function raidsCallAt(fireMs: number, warningMs: number, worldStartedMs: number): number {
  if (!isWinter(fireMs, worldStartedMs) && !isWinter(fireMs + warningMs, worldStartedMs)) return fireMs;
  let i = seasonIndexAt(fireMs, worldStartedMs) + 1;
  while (seasonAt(seasonStartMs(i, worldStartedMs), worldStartedMs) !== "Spring") i++;
  return seasonStartMs(i, worldStartedMs);
}

// When the war march of season `index` is called: at its start, or when the
// road clears (call 13) if that is still within the season; never in Winter,
// and never so that it would strike in Winter (ruling 3, STOP 0 ruling 5).
// Null when that season's march is lost.
export function warCallAt(index: number, clearMs: number | null, warningMs: number, worldStartedMs: number): number | null {
  const start = seasonStartMs(index, worldStartedMs);
  if (isWinter(start, worldStartedMs)) return null;
  const at = Math.max(start, clearMs ?? start);
  if (at >= start + REAL_MS_PER_SEASON) return null;
  if (isWinter(at + warningMs, worldStartedMs)) return null;
  return at;
}

// --- The battle's sums ----------------------------------------------------------------

// What a raid that won takes (ruling 8): `per` drachmae a raider left standing,
// as much as the payer has.
export const raidTakes = (survivors: number, per: number, have: number): number => Math.max(0, Math.min(Math.floor(have), survivors * per));
// The people a polis loses to a raid that won.
export const polisPeopleLost = (population: number, share: number): number => Math.round(population * share);

// --- Words ---------------------------------------------------------------------------

// A nation as the lines name it: a Diplomacy faction by nationName ("the
// Volcae", "Carthage"), a tribe with none as "the {polity}"; a people takes a
// plural verb, a major power a singular one.
export type StrikeNation = { name: string; plural: boolean };
export function strikeNation(faction: Pick<FactionDef, "name" | "group"> | null, polityName: string): StrikeNation {
  return faction ? { name: nationName(faction), plural: faction.group !== "major-powers" } : { name: `the ${polityName}`, plural: true };
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const num = (n: number) => n.toLocaleString("en-US");

export type StrikeCallOff = "peace" | "war" | "lost" | null;

export const strikeLines = {
  march: (n: StrikeNation, place: string, about: number, time: string) => `${cap(n.name)} ${n.plural ? "march" : "marches"} on ${place} with about ${num(about)} men. They strike at ${time}.`,
  raidsMarch: (n: StrikeNation, place: string, about: number, time: string) => `Raided once too often, ${n.name} ${n.plural ? "march" : "marches"} on ${place} with about ${num(about)} men. They strike at ${time}.`,
  drivenOff: (n: StrikeNation, place: string, theirDead: number, ourDead: number) => `${cap(n.name)} struck at ${place} and ${n.plural ? "were" : "was"} driven off. ${num(theirDead)} of them fell, and ${num(ourDead)} of the defenders.`,
  // A home town with no polis (Arelate) loses no people (call 18).
  brokeIntoHome: (n: StrikeNation, place: string, drachmae: number, people: number | null) =>
    people === null ? `${cap(n.name)} broke into ${place}. They carried off ${num(drachmae)} drachmae from the treasury.` : `${cap(n.name)} broke into ${place}. They carried off ${num(drachmae)} drachmae from the treasury, and ${num(people)} of its people were lost.`,
  // `house` null: a League holding, paid from the treasury.
  brokeIntoHolding: (n: StrikeNation, place: string, drachmae: number, house: string | null) => `${cap(n.name)} broke into ${place} and carried off ${num(drachmae)} drachmae from ${house === null ? "the treasury" : `House ${house}`}.`,
  stormed: (n: StrikeNation, place: string, house: string | null) => `${cap(n.name)} stormed ${place}. ${house === null ? "The League has lost it." : `House ${house} has lost it.`}`,
  calledOff: (n: StrikeNation, place: string, why: StrikeCallOff) =>
    `${cap(n.name)} turned back from ${place}${why === "peace" ? ": peace is made." : why === "war" ? ": they are at war with the League now." : why === "lost" ? ": it is theirs again." : "."}`,
  ledger: (n: StrikeNation, place: string) => `Raid by ${n.name} on ${place}`,
  yourPart: (men: number, lost: number) => `${num(men)} of your men were among the defenders, and ${num(lost)} of them fell.`,
  title: (n: StrikeNation, place: string) => `${cap(n.name)} at ${place}`,
};
