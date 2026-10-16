import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { createDb, effectLog, ensureLeagueCities, houses, koinonMusters, leagueCities, offices, leaguePlayerId, loadFactions, playerCharacters, playerHoldings, playerMarches, players, playerUnits, strikeParts, strikes, treasuries, worlds, type StrikeDraw } from "@massalia/db";
import {
  aboutMen,
  bandDef,
  chooseTarget,
  deadOffDraws,
  factionOfPolity,
  fightsAtPeace,
  formatGameDate,
  gameDate,
  GOVERNMENT_OFFICES,
  HOME_POLITY_ID,
  landStepsBetween,
  leagueAtWarWith,
  leagueLedgerReason,
  marchIsFight,
  musterIsFight,
  parseStrikesContent,
  polisPeopleLost,
  raidsCallAt,
  raidsFireAt,
  raidsForce,
  raidsTargets,
  raidsWindowMs,
  raidTakes,
  resolveBattle,
  seasonAt,
  seasonIndexAt,
  seasonStartMs,
  strikeLines,
  strikeNation,
  strikeWarningMs,
  unitDef,
  warCallAt,
  warForce,
  warTargets,
  type BattleRow,
  type LeagueWarSpan,
  type NationPlace,
  type StrikeCallOff,
  type StrikeNation,
  type StrikeOption,
  type StrikesContent,
  type StrikeTarget,
} from "@massalia/shared";
import { getBandsContent, getBattleContent, getUnitsContent, isActive, moraleBonusFor, type UnitRow } from "./barracks.js";
import { settleAll, type ActingContext } from "./buildings.js";
import { applyComposureDelta } from "./composure.js";
import { leagueContext, leagueHomeTowns, leagueWarSpans, settleLeague, debitLeagueTreasury } from "./leagueOrders.js";
import { lockPlayer } from "./lock.js";
import { getTopology } from "./mapGraph.js";
import { loadMilitaryOwners } from "./mapMilitary.js";
import { polityDisplayName, regionDisplayName, townDisplayName } from "./mapNames.js";
import { readRegionWarband, readTownGarrison, regionBaseWarband, townBaseGarrison, writeRegionWarband, writeTownGarrison } from "./mapPools.js";
import { townStats } from "./townStats.js";

// ---------------------------------------------------------------------------
// The strikes (strikes prompt 1): a nation marches on a Massalian place. The
// rules and words are pure (packages/shared/src/strikes.ts); this reads the
// world, calls the marches, fights them and writes what follows.
//
// Where it runs (STOP 0 ruling 2): in the campaign resolver, before the handler
// of every /api, /me and /admin request, with the marches and musters, in the
// order their instants fall (koinonMuster.ts: resolveDueCampaigns). A call is
// dated at its season's start or at the fight that fired it, a strike at its
// instant; since every player write happens inside a request and the resolver
// runs first, each sees the world as it stood at that instant. A failure logs
// "strikes: failed <message>" and never fails the request; the next pass tries
// again.
//
// Locks, at a strike (call 19, after the muster's launch): the strike's own
// advisory lock (a strike being resolved elsewhere is skipped), every owner
// with men standing in the target and its holder, each by his player lock in
// ascending id order (the League's is its player lock), then the League's
// treasuries row when the League pays or defends, then the claim
// (marching → struck); the owners are read again and a changed set starts
// again. Each owner is settled to the strike instant before the battle.
// ---------------------------------------------------------------------------

const db = createDb();
type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = DbTx | typeof db;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const strikesFile = path.resolve(__dirname, "../../../../content/military/strikes.json");
let strikesContent: StrikesContent | null = null;

// Loaded and validated at boot (a malformed file fails it); read lazily after.
export async function loadStrikesContent(): Promise<StrikesContent> {
  strikesContent = parseStrikesContent(JSON.parse(await fs.readFile(strikesFile, "utf8")));
  return strikesContent;
}
export async function getStrikesContent(): Promise<StrikesContent> {
  return strikesContent ?? loadStrikesContent();
}

// A polis's town: the Cities tab's poleis are keyed by their own ids, which
// are their towns' but for Olbia's (olbia-provence). Arelate has no polis.
const POLIS_TOWNS: Record<string, string> = { olbia: "olbia-provence" };
const polisOfTown = (townId: string): string => Object.entries(POLIS_TOWNS).find(([, town]) => town === townId)?.[0] ?? townId;

// --- Nations ---------------------------------------------------------------------

export type Nation = { id: string; factionId: string | null; polities: string[]; words: StrikeNation };

// Call 16: a Diplomacy faction (its land is every place of every polity it
// has), else the place's owner polity alone. Massalia's own and unclaimed land
// are no nation (STOP 0 ruling 2).
export async function nationOfPolity(polity: string | null): Promise<Nation | null> {
  if (polity === null || polity === HOME_POLITY_ID || polity === "unclaimed") return null;
  const faction = factionOfPolity({ factions: await loadFactions() } as Parameters<typeof factionOfPolity>[0], polity);
  if (faction) return { id: faction.id, factionId: faction.id, polities: faction.polities ?? [faction.id], words: strikeNation(faction, faction.name) };
  return { id: polity, factionId: null, polities: [polity], words: strikeNation(null, await polityDisplayName(polity)) };
}
export async function nationById(id: string): Promise<Nation | null> {
  const faction = (await loadFactions()).find((f) => f.id === id);
  return faction ? nationOfPolity((faction.polities ?? [faction.id])[0]!) : nationOfPolity(id);
}

const placeNameOf = (townId: string | null, regionId: string) => (townId ? townDisplayName(townId) : regionDisplayName(regionId));

// --- The world as a call sees it ----------------------------------------------------

type WorldRow = { id: string; startedMs: number; fromMs: number };
async function activeWorldRow(exec: Exec): Promise<WorldRow | null> {
  const w = (await exec.select({ id: worlds.id, startedAt: worlds.startedAt, strikesFrom: worlds.strikesFrom }).from(worlds).where(eq(worlds.status, "active")).limit(1))[0];
  return w ? { id: w.id, startedMs: w.startedAt.getTime(), fromMs: (w.strikesFrom ?? w.startedAt).getTime() } : null;
}

// The men standing in each of `placeIds` at `at`: active, not on the road, every owner's.
async function standingAt(exec: Exec, worldId: string, placeIds: string[], at: Date): Promise<UnitRow[]> {
  if (placeIds.length === 0) return [];
  const rows = await exec.select().from(playerUnits).where(and(eq(playerUnits.worldId, worldId), inArray(playerUnits.basedAt, placeIds), isNull(playerUnits.movingTo)));
  return rows.filter((r) => isActive(r, at) && r.count > 0);
}
const menAt = (rows: UnitRow[], placeId: string) => rows.filter((r) => r.basedAt === placeId).reduce((n, r) => n + r.count, 0);

type HoldingRow = typeof playerHoldings.$inferSelect;
const holdingPlace = (h: Pick<HoldingRow, "townId" | "regionId">) => h.townId || h.regionId;

// The targets as they stand at `at`: the League's home towns and every holding.
async function targetsAt(exec: Exec, world: WorldRow, polities: readonly string[], at: Date): Promise<{ homes: StrikeTarget[]; holdings: StrikeTarget[]; held: Set<string> }> {
  const topology = getTopology();
  const homeTowns = await leagueHomeTowns();
  const heldRows = await exec.select().from(playerHoldings).where(eq(playerHoldings.worldId, world.id));
  const held = new Set(heldRows.map(holdingPlace));
  const standing = await standingAt(exec, world.id, [...homeTowns, ...held], at);
  const homes: StrikeTarget[] = [];
  for (const town of homeTowns) {
    const regionId = topology.townRegion.get(town);
    if (!regionId) continue;
    homes.push({ placeId: town, regionId, townId: town, kind: "home", holderPlayerId: null, takenFrom: false, name: await townDisplayName(town), full: await townBaseGarrison(town), defenders: menAt(standing, town) });
  }
  const holdings: StrikeTarget[] = [];
  for (const h of heldRows) {
    const placeId = holdingPlace(h);
    const townId = h.townId || null;
    holdings.push({
      placeId,
      regionId: h.regionId,
      townId,
      kind: "holding",
      holderPlayerId: h.ownerPlayerId,
      takenFrom: h.previousOwner !== null && polities.includes(h.previousOwner),
      name: await placeNameOf(townId, h.regionId),
      full: townId ? await townBaseGarrison(townId) : await regionBaseWarband(h.regionId),
      defenders: menAt(standing, placeId),
    });
  }
  return { homes, holdings, held };
}

// A nation's own towns and lands (never a place Massalia holds), with their
// men as they stand at `at`.
async function nationLand(exec: Exec, world: WorldRow, nation: Nation, held: Set<string>, at: Date): Promise<NationPlace[]> {
  const topology = getTopology();
  const owners = await loadMilitaryOwners();
  const out: NationPlace[] = [];
  for (const [town, owner] of Object.entries(owners.towns)) {
    if (!nation.polities.includes(owner) || held.has(town)) continue;
    const regionId = topology.townRegion.get(town);
    if (regionId) out.push({ placeId: town, kind: "town", regionId, men: await readTownGarrison(exec, world.id, town, at), full: await townBaseGarrison(town) });
  }
  for (const [region, owner] of Object.entries(owners.regions)) {
    if (!nation.polities.includes(owner) || held.has(region)) continue;
    out.push({ placeId: region, kind: "region", regionId: region, men: await readRegionWarband(exec, world.id, region, at), full: await regionBaseWarband(region) });
  }
  return out;
}

// When the road clears for a nation: none of its marches on the road (null
// when one is), and the instant the last one struck or turned back.
async function roadOf(exec: Exec, worldId: string, nationId: string): Promise<{ marching: boolean; clearMs: number | null }> {
  const rows = await exec.select({ status: strikes.status, strikesAt: strikes.strikesAt }).from(strikes).where(and(eq(strikes.worldId, worldId), eq(strikes.nationId, nationId)));
  if (rows.some((r) => r.status === "marching")) return { marching: true, clearMs: null };
  const last = rows.reduce<number | null>((m, r) => Math.max(m ?? 0, r.strikesAt.getTime()), null);
  return { marching: false, clearMs: last };
}

// --- Calling ------------------------------------------------------------------------

// Marches that stayed home (nothing outnumbered) this process has already
// weighed: a war march once a season. A raids march that stays home is weighed
// again at the place's next fight.
const stayedHome = new Set<string>();

type CallInput = { world: WorldRow; nation: Nation; trigger: "war" | "raids"; callMs: number; raided?: { placeId: string; kind: "town" | "region"; regionId: string; full: number; atMs: number } };

// Weigh the targets as they stand at the call and send the march, or stay home.
async function callMarch(input: CallInput): Promise<string | null> {
  const { world, nation, trigger, callMs } = input;
  const c = await getStrikesContent();
  const topology = getTopology();
  const at = new Date(callMs);
  return db.transaction(async (tx) => {
    const { homes, holdings, held } = await targetsAt(tx, world, nation.polities, at);
    let options: StrikeOption[];
    if (trigger === "war") {
      const land = await nationLand(tx, world, nation, held, at);
      const regions = land.map((p) => p.regionId);
      options = warTargets(topology, homes, holdings, land).map((t) => ({ ...t, ...warForce(topology, t, land, c.forceShare), steps: landStepsBetween(topology, regions, t.regionId) }));
    } else {
      const raided = input.raided!;
      const sent = raidsForce(raided);
      options = raidsTargets(topology, homes, holdings, raided.regionId).map((t) => ({ ...t, ...sent, steps: landStepsBetween(topology, [raided.regionId], t.regionId) }));
    }
    const choice = chooseTarget(options);
    if (!choice) return null;
    const mode = trigger === "raids" || choice.kind === "home" ? "raid" : "attack";
    const inserted = await tx
      .insert(strikes)
      .values({
        worldId: world.id,
        nationId: nation.id,
        trigger,
        mode,
        seasonIndex: seasonIndexAt(callMs, world.startedMs),
        triggerPlaceId: input.raided?.placeId ?? null,
        triggerAt: input.raided ? new Date(input.raided.atMs) : null,
        regionId: choice.regionId,
        townId: choice.townId,
        targetKind: choice.kind,
        holderPlayerId: choice.holderPlayerId,
        takenFrom: choice.takenFrom,
        force: choice.force,
        about: aboutMen(choice.force),
        draws: choice.draws as StrikeDraw[],
        calledAt: at,
        strikesAt: new Date(callMs + strikeWarningMs(c)),
      })
      .onConflictDoNothing()
      .returning({ id: strikes.id });
    return inserted[0]?.id ?? null;
  });
}

// The war marches due: each nation at war at a season's start (this season or
// the last, after the strikes went live) that has not marched that season.
async function callWarMarches(world: WorldRow, wars: LeagueWarSpan[], now: Date): Promise<void> {
  if (wars.length === 0) return;
  const c = await getStrikesContent();
  const current = seasonIndexAt(now.getTime(), world.startedMs);
  for (const index of [current - 1, current]) {
    const start = seasonStartMs(index, world.startedMs);
    if (index < 0 || start < world.fromMs || start > now.getTime()) continue;
    for (const factionId of [...new Set(wars.map((w) => w.factionId))].sort()) {
      if (!leagueAtWarWith(wars, factionId, start)) continue;
      const memo = `${world.id}:${factionId}:${index}`;
      if (stayedHome.has(memo)) continue;
      const called = await db.select({ id: strikes.id }).from(strikes).where(and(eq(strikes.worldId, world.id), eq(strikes.nationId, factionId), eq(strikes.trigger, "war"), eq(strikes.seasonIndex, index))).limit(1);
      if (called.length > 0) continue;
      const road = await roadOf(db, world.id, factionId);
      if (road.marching) continue;
      const callMs = warCallAt(index, road.clearMs !== null && road.clearMs > start ? road.clearMs : null, strikeWarningMs(c), world.startedMs);
      if (callMs === null || callMs > now.getTime() || !leagueAtWarWith(wars, factionId, callMs)) continue;
      const nation = await nationById(factionId);
      if (!nation) continue;
      if ((await callMarch({ world, nation, trigger: "war", callMs })) === null) {
        // Stayed home, or another pass called it first: either way, weighed.
        const again = await db.select({ id: strikes.id }).from(strikes).where(and(eq(strikes.worldId, world.id), eq(strikes.nationId, factionId), eq(strikes.trigger, "war"), eq(strikes.seasonIndex, index))).limit(1);
        if (again.length === 0) stayedHome.add(memo);
      }
    }
  }
}

// Every fight in the world from `sinceMs`, by place: a party's raid or attack
// that met the defenders (the League's included), a muster won or driven off.
async function fightsSince(world: WorldRow, sinceMs: number): Promise<Map<string, { atMs: number[]; regionId: string; townId: string | null }>> {
  const since = new Date(sinceMs);
  const marches = await db
    .select({ regionId: playerMarches.regionId, townId: playerMarches.townId, kind: playerMarches.kind, report: playerMarches.report, at: playerMarches.arrivesAt })
    .from(playerMarches)
    .where(and(eq(playerMarches.worldId, world.id), eq(playerMarches.status, "resolved"), inArray(playerMarches.kind, ["raid", "attack"]), gte(playerMarches.arrivesAt, since)));
  const musters = await db
    .select({ regionId: koinonMusters.regionId, townId: koinonMusters.townId, report: koinonMusters.report, at: koinonMusters.arrivesAt })
    .from(koinonMusters)
    .where(and(eq(koinonMusters.worldId, world.id), eq(koinonMusters.status, "resolved"), gte(koinonMusters.arrivesAt, since)));
  const out = new Map<string, { atMs: number[]; regionId: string; townId: string | null }>();
  const add = (regionId: string, townId: string | null, atMs: number) => {
    const key = townId ?? regionId;
    const entry = out.get(key) ?? { atMs: [], regionId, townId };
    entry.atMs.push(atMs);
    out.set(key, entry);
  };
  for (const m of marches) if (marchIsFight(m.kind, (m.report as { winner?: unknown } | null)?.winner)) add(m.regionId, m.townId, m.at.getTime());
  for (const m of musters) if (m.at && musterIsFight((m.report as { outcome?: unknown } | null)?.outcome)) add(m.regionId, m.townId, m.at.getTime());
  return out;
}

// The raids marches due: a place fought more than 10 times within 96 hours
// calls one, once, at the fight that tipped it over (or when the road clears,
// or at Spring's start).
async function callRaidsMarches(world: WorldRow, wars: LeagueWarSpan[], now: Date): Promise<void> {
  const c = await getStrikesContent();
  const windowMs = raidsWindowMs(c);
  const topology = getTopology();
  const owners = await loadMilitaryOwners();
  const fights = await fightsSince(world, Math.max(world.fromMs, now.getTime() - 2 * windowMs));
  for (const [placeId, f] of [...fights].sort(([a], [b]) => a.localeCompare(b))) {
    if (f.atMs.length <= c.raids.moreThan) continue;
    const owner = f.townId !== null ? (owners.towns[f.townId] ?? null) : (owners.regions[f.regionId] ?? null);
    const nation = await nationOfPolity(owner);
    if (!nation) continue;
    const restart = (await db.select({ at: strikes.triggerAt }).from(strikes).where(and(eq(strikes.worldId, world.id), eq(strikes.trigger, "raids"), eq(strikes.triggerPlaceId, placeId))).orderBy(desc(strikes.triggerAt)).limit(1))[0]?.at ?? null;
    const fireMs = raidsFireAt(fightsAtPeace(f.atMs, wars, nation.factionId), { fromMs: world.fromMs, restartMs: restart?.getTime() ?? null, windowMs, moreThan: c.raids.moreThan });
    if (fireMs === null) continue;
    const road = await roadOf(db, world.id, nation.id);
    if (road.marching) continue;
    const callMs = raidsCallAt(Math.max(fireMs, road.clearMs ?? fireMs), strikeWarningMs(c), world.startedMs);
    if (callMs > now.getTime()) continue;
    if (nation.factionId !== null && leagueAtWarWith(wars, nation.factionId, callMs)) continue;
    const kind = f.townId !== null ? ("town" as const) : ("region" as const);
    const full = f.townId !== null ? await townBaseGarrison(f.townId) : await regionBaseWarband(f.regionId);
    const regionId = f.townId !== null ? (topology.townRegion.get(f.townId) ?? f.regionId) : f.regionId;
    await callMarch({ world, nation, trigger: "raids", callMs, raided: { placeId, kind, regionId, full, atMs: fireMs } });
  }
}

// Every march due by `now`. `raids`: weigh the raids count too (after a fight,
// and at most once a minute otherwise: it reads the fights of eight days).
let raidsWeighedMs = 0;
export async function callDueStrikes(now: Date, opts: { raids?: boolean } = {}): Promise<void> {
  const world = await activeWorldRow(db);
  if (!world) return;
  const wars = await leagueWarSpans(db, world.id);
  await callWarMarches(world, wars, now);
  if (opts.raids || now.getTime() - raidsWeighedMs >= 60_000 || now.getTime() < raidsWeighedMs) {
    raidsWeighedMs = now.getTime();
    await callRaidsMarches(world, wars, now);
  }
}

// The strikes due by `now`, for the campaign resolver's queue.
export async function dueStrikes(now: Date): Promise<{ id: string; at: Date }[]> {
  return db.select({ id: strikes.id, at: strikes.strikesAt }).from(strikes).where(and(eq(strikes.status, "marching"), lte(strikes.strikesAt, now)));
}

// --- The strike -------------------------------------------------------------------------

class OwnersChanged extends Error {}
const strikeLockKey = (id: string) => crypto.createHash("sha256").update(`strike:${id}`).digest().readBigInt64BE(0);

export type StrikeResolved = { outcome: "struck" | "called_off" | "not_due" | "busy" };
type Shrine = { ctx: ActingContext; composureDays: number }[];

export type StrikePartReport = { playerId: string; men: number; lost: number; paid: number; holder: boolean };
export type StrikeReport = {
  outcome: "won" | "driven_off" | "stormed" | "called_off";
  calledOff?: StrikeCallOff;
  mode: "raid" | "attack";
  line: string;
  place: string;
  rounds: number;
  defenders: number;
  theirDead: number;
  ourDead: number;
  survivors: number;
  paid: number;
  payer: "treasury" | "holder" | null;
  peopleLost: number | null;
  holdingLost: boolean;
  deadOff: StrikeDraw[];
  parts: StrikePartReport[];
};

// The strike at its instant (rulings 7-10, calls 17-19, 21). One transaction;
// every clock in it is the strike's instant.
export async function resolveStrike(strikeId: string, now: Date): Promise<StrikeResolved> {
  for (let attempt = 1; ; attempt++) {
    try {
      const done = await db.transaction(async (tx) => strikeTx(tx, strikeId, now));
      for (const s of done.shrine) {
        const ch = (await db.select({ id: playerCharacters.id }).from(playerCharacters).where(eq(playerCharacters.playerId, s.ctx.playerId)).limit(1))[0];
        if (ch && s.composureDays > 0) await applyComposureDelta(ch.id, s.composureDays, "building:shrine", done.at!);
      }
      return { outcome: done.outcome };
    } catch (err) {
      if (!(err instanceof OwnersChanged) || attempt >= 5) throw err;
      console.warn(`[strikes] resolve of ${strikeId}: attempt ${attempt} of 5 found the defending owners changed under the locks; retrying`);
    }
  }
}

// The defending owners: every owner with men standing in the place at `at`,
// or on a move that ends there by then (his settle at the instant lands them,
// so they fight), and the holder.
async function ownersAt(tx: DbTx, worldId: string, placeId: string, holderId: string | null, at: Date): Promise<string[]> {
  const rows = await standingAt(tx, worldId, [placeId], at);
  const arriving = (await tx.select().from(playerUnits).where(and(eq(playerUnits.worldId, worldId), eq(playerUnits.movingTo, placeId), lte(playerUnits.arrivesAt, at)))).filter((r) => !r.mission?.marchId && !r.mission?.musterId);
  return [...new Set([...rows.map((r) => r.ownerPlayerId), ...arriving.map((r) => r.ownerPlayerId), ...(holderId ? [holderId] : [])])].sort();
}

async function strikeTx(tx: DbTx, strikeId: string, now: Date): Promise<StrikeResolved & { shrine: Shrine; at?: Date }> {
  const none = (outcome: StrikeResolved["outcome"]) => ({ outcome, shrine: [] as Shrine });
  const lock = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(${strikeLockKey(strikeId)}) AS granted`);
  if (!(lock.rows as { granted: boolean }[])[0]?.granted) return none("busy");
  const s = (await tx.select().from(strikes).where(eq(strikes.id, strikeId)).limit(1))[0];
  if (!s || s.status !== "marching" || s.strikesAt.getTime() > now.getTime()) return none("not_due");
  const at = s.strikesAt;
  const c = await getStrikesContent();
  const battleC = getBattleContent();
  const world = (await tx.select({ startedAt: worlds.startedAt }).from(worlds).where(eq(worlds.id, s.worldId)).limit(1))[0]!;
  const worldStartedMs = world.startedAt.getTime();
  const nation = (await nationById(s.nationId))!;
  const place = await placeNameOf(s.townId, s.regionId);
  const placeId = s.townId ?? s.regionId;
  const wars = await leagueWarSpans(tx, s.worldId);
  const holdingAt = async () => (await tx.select().from(playerHoldings).where(and(eq(playerHoldings.worldId, s.worldId), eq(playerHoldings.regionId, s.regionId), eq(playerHoldings.townId, s.townId ?? ""))).limit(1))[0] ?? null;

  // Turned back (call 15, STOP 0 rulings 4 and 7): a war march at peace, a
  // raids march at war, a holding no longer held, or Winter. Nobody's rows.
  const turnBack = async (why: StrikeCallOff): Promise<StrikeResolved & { shrine: Shrine }> => {
    const report: StrikeReport = { outcome: "called_off", calledOff: why, mode: s.mode, line: strikeLines.calledOff(nation.words, place, why), place, rounds: 0, defenders: 0, theirDead: 0, ourDead: 0, survivors: s.force, paid: 0, payer: null, peopleLost: null, holdingLost: false, deadOff: [], parts: [] };
    const claimed = await tx.update(strikes).set({ status: "called_off", resolvedAt: at, report }).where(and(eq(strikes.id, s.id), eq(strikes.status, "marching"))).returning({ id: strikes.id });
    return { outcome: claimed.length ? "called_off" : "not_due", shrine: [] };
  };
  if (s.trigger === "war" && (nation.factionId === null || !leagueAtWarWith(wars, nation.factionId, at.getTime()))) return turnBack("peace");
  if (s.trigger === "raids" && nation.factionId !== null && leagueAtWarWith(wars, nation.factionId, at.getTime())) return turnBack("war");
  if (seasonAt(at.getTime(), worldStartedMs) === "Winter") return turnBack(null);
  let holding = await holdingAt();
  if (s.targetKind === "holding" && !holding) return turnBack("lost");

  // The locks: every defending owner and the holder, ascending; the treasury.
  const leagueId = await leaguePlayerId(tx, s.worldId);
  const before = await ownersAt(tx, s.worldId, placeId, holding?.ownerPlayerId ?? null, at);
  for (const id of before) await lockPlayer(tx, id);
  const leagueInvolved = s.targetKind === "home" || (leagueId !== null && before.includes(leagueId));
  if (leagueInvolved) {
    await tx.insert(treasuries).values({ worldId: s.worldId, owner: "league" }).onConflictDoNothing();
    await tx.select({ balance: treasuries.balance }).from(treasuries).where(and(eq(treasuries.worldId, s.worldId), eq(treasuries.owner, "league"))).for("update");
  }
  // The claim: a lost one applies nothing.
  const claimed = await tx.update(strikes).set({ status: "struck", resolvedAt: at }).where(and(eq(strikes.id, s.id), eq(strikes.status, "marching"))).returning({ id: strikes.id });
  if (claimed.length !== 1) return none("not_due");
  holding = await holdingAt();
  const after = await ownersAt(tx, s.worldId, placeId, holding?.ownerPlayerId ?? null, at);
  if (after.length !== before.length || after.some((id, i) => id !== before[i])) throw new OwnersChanged();

  // Each owner settled to the strike instant.
  const shrine: Shrine = [];
  for (const id of before) {
    if (id === leagueId) {
      const lctx = await leagueContext(tx, { id: s.worldId, startedMs: worldStartedMs });
      if (lctx) await settleLeague(tx, lctx, at);
    } else {
      const ctx: ActingContext = { playerId: id, worldId: s.worldId, worldStartedMs };
      const settled = await settleAll(tx, ctx, at);
      if (settled.composureDays > 0) shrine.push({ ctx, composureDays: settled.composureDays });
    }
  }
  // A holding its holder's settle gave back at this instant is no longer one to strike.
  holding = await holdingAt();
  if (s.targetKind === "holding" && !holding) {
    const report: StrikeReport = { outcome: "called_off", calledOff: "lost", mode: s.mode, line: strikeLines.calledOff(nation.words, place, "lost"), place, rounds: 0, defenders: 0, theirDead: 0, ourDead: 0, survivors: s.force, paid: 0, payer: null, peopleLost: null, holdingLost: false, deadOff: [], parts: [] };
    await tx.update(strikes).set({ status: "called_off", report }).where(eq(strikes.id, s.id));
    return { outcome: "called_off", shrine, at };
  }
  const holderId = holding?.ownerPlayerId ?? null;

  // The battle (call 17): every man standing there, at his owner's morale, a
  // town's walls with them; the enemy as a tribal warband, no turnout.
  const rows = await standingAt(tx, s.worldId, [placeId], at);
  const unitsC = getUnitsContent();
  const bandsC = getBandsContent();
  let walls = 0;
  if (s.targetKind === "home") await ensureLeagueCities(tx, s.worldId);
  if (s.townId !== null) {
    if (s.targetKind === "home") {
      const polis = (await tx.select({ fortifications: leagueCities.fortifications }).from(leagueCities).where(and(eq(leagueCities.worldId, s.worldId), eq(leagueCities.cityId, polisOfTown(s.townId)))).limit(1))[0];
      walls = polis ? polis.fortifications : (await townStats(s.townId)).walls;
    } else walls = (await townStats(s.townId)).walls;
  }
  const wallBonus = Math.min(walls, battleC.town.wallsDefCap);
  const morale = await moraleBonusFor(tx, s.worldId, [...new Set(rows.map((r) => r.ownerPlayerId))], at);
  const defender: BattleRow[] = rows.map((r) => {
    const def = (r.source === "trained" ? unitDef(unitsC, r.unitId) : bandDef(bandsC, r.unitId))!;
    const bonus = morale.get(r.ownerPlayerId) ?? 0;
    return { id: r.id, label: def.label, count: r.count, stats: { ...def.stats, def: def.stats.def + wallBonus, mor: def.stats.mor + bonus } };
  });
  const enemy = battleC.npc.warband;
  const seed = crypto.createHash("sha256").update([s.worldId, s.id, placeId, at.toISOString()].join("|")).digest("hex");
  const result = resolveBattle({ attacker: [{ id: "raiders", label: enemy.label, count: s.force, stats: enemy.stats }], defender, seed, config: battleC, mode: s.mode });

  // Each owner's losses on his own rows.
  const characterOf = new Map<string, string>();
  for (const id of before) {
    const ch = (await tx.select({ id: playerCharacters.id }).from(playerCharacters).where(eq(playerCharacters.playerId, id)).limit(1))[0];
    if (ch) characterOf.set(id, ch.id);
  }
  const menOf = new Map<string, number>();
  const lostOf = new Map<string, number>();
  for (const r of rows) {
    const side = result.defender.rows.find((x) => x.id === r.id)!;
    const lost = side.start - side.end;
    menOf.set(r.ownerPlayerId, (menOf.get(r.ownerPlayerId) ?? 0) + r.count);
    if (lost > 0) {
      lostOf.set(r.ownerPlayerId, (lostOf.get(r.ownerPlayerId) ?? 0) + lost);
      const characterId = characterOf.get(r.ownerPlayerId);
      if (characterId) await tx.insert(effectLog).values({ characterId, kind: "battle_loss", detail: { rowId: r.id, unitId: r.unitId, source: r.source, lost, regionId: s.regionId, townId: s.townId, action: "strike", strikeId: s.id }, createdAt: at });
    }
    if (side.end <= 0) await tx.delete(playerUnits).where(eq(playerUnits.id, r.id));
    else if (lost > 0) await tx.update(playerUnits).set({ count: side.end }).where(eq(playerUnits.id, r.id));
  }

  // The enemy's dead off the pools it drew from, in proportion (ruling 10).
  const theirDead = result.attacker.losses;
  const deadOff = deadOffDraws(theirDead, s.draws);
  for (const d of deadOff) {
    if (d.men <= 0) continue;
    if (d.kind === "town") await writeTownGarrison(tx, s.worldId, d.placeId, (await readTownGarrison(tx, s.worldId, d.placeId, at)) - d.men, at);
    else await writeRegionWarband(tx, s.worldId, d.placeId, (await readRegionWarband(tx, s.worldId, d.placeId, at)) - d.men, at);
  }
  const survivors = Math.max(0, s.force - theirDead);
  const ourDead = [...lostOf.values()].reduce((n, x) => n + x, 0);
  const defenders = rows.reduce((n, r) => n + r.count, 0);

  // What follows (rulings 8 and 9).
  let outcome: StrikeReport["outcome"] = "driven_off";
  let line = strikeLines.drivenOff(nation.words, place, theirDead, ourDead);
  let paid = 0;
  let payer: StrikeReport["payer"] = null;
  let peopleLost: number | null = null;
  let holdingLost = false;
  const houseName = async (playerId: string) => {
    const row = (await tx.select({ name: houses.name }).from(players).leftJoin(houses, eq(houses.slug, players.houseSlug)).where(eq(players.id, playerId)).limit(1))[0];
    return row?.name ?? "—";
  };
  const treasuryPays = async () => {
    const balance = (await tx.select({ balance: treasuries.balance }).from(treasuries).where(and(eq(treasuries.worldId, s.worldId), eq(treasuries.owner, "league"))).limit(1))[0]?.balance ?? 0;
    const take = raidTakes(survivors, c.plunderPerRaider, balance);
    if (take > 0 && !(await debitLeagueTreasury(tx, s.worldId, take, leagueLedgerReason.strike(s.nationId, placeId, s.id), at))) throw new Error(`strike ${s.id}: the treasury debit of ${take} was refused`);
    return take;
  };
  if (result.winner === "attacker" && s.mode === "raid") {
    outcome = "won";
    if (s.targetKind === "home") {
      paid = await treasuryPays();
      payer = "treasury";
      const polis = (await tx.select().from(leagueCities).where(and(eq(leagueCities.worldId, s.worldId), eq(leagueCities.cityId, polisOfTown(s.townId!)))).for("update").limit(1))[0];
      if (polis) {
        peopleLost = polisPeopleLost(polis.population, c.polis.peopleLoss);
        await tx.update(leagueCities).set({ population: sql`GREATEST(0, ${leagueCities.population} - ${peopleLost})`, stability: sql`GREATEST(0, ${leagueCities.stability} - ${c.polis.stabilityLoss})` }).where(eq(leagueCities.id, polis.id));
      }
      line = strikeLines.brokeIntoHome(nation.words, place, paid, peopleLost);
    } else if (holderId !== null && holderId === leagueId) {
      paid = await treasuryPays();
      payer = "treasury";
      line = strikeLines.brokeIntoHolding(nation.words, place, paid, null);
    } else if (holderId !== null) {
      const wallet = (await tx.select({ drachmae: playerCharacters.drachmae }).from(playerCharacters).where(eq(playerCharacters.playerId, holderId)).limit(1))[0]?.drachmae ?? 0;
      const take = raidTakes(survivors, c.plunderPerRaider, wallet);
      if (take > 0) {
        const debited = await tx.update(playerCharacters).set({ drachmae: sql`${playerCharacters.drachmae} - ${take}` }).where(and(eq(playerCharacters.playerId, holderId), gte(playerCharacters.drachmae, take))).returning({ id: playerCharacters.id });
        if (debited.length !== 1) throw new Error(`strike ${s.id}: the holder's debit of ${take} touched ${debited.length} rows`);
      }
      paid = take;
      payer = "holder";
      line = strikeLines.brokeIntoHolding(nation.words, place, paid, await houseName(holderId));
    }
  } else if (result.winner === "attacker" && s.mode === "attack" && holding) {
    // The holding is lost: it returns to its people as a holding that reverts
    // does; the survivors fall back at their owners' next settles.
    const gone = await tx.delete(playerHoldings).where(and(eq(playerHoldings.worldId, s.worldId), eq(playerHoldings.regionId, s.regionId), eq(playerHoldings.townId, s.townId ?? ""))).returning({ regionId: playerHoldings.regionId });
    if (gone.length === 1) {
      holdingLost = true;
      outcome = "stormed";
      if (s.townId !== null) await writeTownGarrison(tx, s.worldId, s.townId, await townBaseGarrison(s.townId), at);
      else await writeRegionWarband(tx, s.worldId, s.regionId, await regionBaseWarband(s.regionId), at);
      line = strikeLines.stormed(nation.words, place, holderId === leagueId ? null : await houseName(holderId!));
    }
  }

  // The parts, a report each, and one effect_log row for each house.
  const parts: StrikePartReport[] = before.filter((id) => menOf.has(id) || id === holderId).map((id) => ({ playerId: id, men: menOf.get(id) ?? 0, lost: lostOf.get(id) ?? 0, paid: id === holderId && payer === "holder" ? paid : 0, holder: id === holderId }));
  for (const p of parts) await tx.insert(strikeParts).values({ strikeId: s.id, playerId: p.playerId, men: p.men, lost: p.lost, paid: p.paid, holder: p.holder });
  for (const p of parts) {
    const characterId = characterOf.get(p.playerId);
    if (characterId) await tx.insert(effectLog).values({ characterId, kind: "strike", detail: { strikeId: s.id, nationId: s.nationId, regionId: s.regionId, townId: s.townId, line, men: p.men, lost: p.lost, paid: p.paid, holder: p.holder, outcome }, createdAt: at });
  }
  const report: StrikeReport = { outcome, mode: s.mode, line, place, rounds: result.rounds.length, defenders, theirDead, ourDead, survivors, paid, payer, peopleLost, holdingLost, deadOff, parts };
  await tx.update(strikes).set({ report }).where(eq(strikes.id, s.id));
  return { outcome: "struck", shrine, at };
}

// --- What everyone sees ------------------------------------------------------------------

// A march as the map, the Diplomacy page and the Government tab show it (ruling
// 11): its words and the "about" alone, never a pool's numbers, its draws or
// its exact force (call 20). `line` is the march's while it is on the road, its
// result's after.
export type StrikeView = {
  id: string;
  nationId: string;
  nation: string; // "the Volcae", "Carthage"
  placeId: string;
  regionId: string;
  townId: string | null;
  place: string;
  trigger: "war" | "raids";
  mode: "raid" | "attack";
  status: "marching" | "struck" | "called_off";
  about: number;
  calledAt: string;
  strikesAt: string;
  line: string;
  dateLabel: string; // the game date of the call (on the road) or of the strike
};

const utcTime = (ms: number) => `${new Date(ms).toISOString().slice(11, 16)} UTC`;
// A march's line while it is on the road, as Strikes 1 words it.
const marchLine = (s: Pick<typeof strikes.$inferSelect, "trigger" | "about" | "strikesAt">, words: StrikeNation, place: string) =>
  (s.trigger === "raids" ? strikeLines.raidsMarch : strikeLines.march)(words, place, s.about, utcTime(s.strikesAt.getTime()));

// Every march on the road and every one that ended within the last game year,
// newest first.
export async function strikeViews(exec: Exec, world: { id: string; startedMs: number }, now: Date, limit = 40): Promise<StrikeView[]> {
  const c = await getStrikesContent();
  const since = new Date(now.getTime() - raidsWindowMs(c));
  const rows = await exec
    .select()
    .from(strikes)
    .where(and(eq(strikes.worldId, world.id), sql`(${strikes.status} = 'marching' OR ${strikes.resolvedAt} >= ${since.toISOString()}::timestamptz)`))
    .orderBy(desc(strikes.calledAt), desc(strikes.id))
    .limit(limit);
  const out: StrikeView[] = [];
  for (const s of rows) {
    const nation = await nationById(s.nationId);
    if (!nation) continue;
    const place = await placeNameOf(s.townId, s.regionId);
    const marching = s.status === "marching";
    const line = marching ? marchLine(s, nation.words, place) : ((s.report as { line?: string } | null)?.line ?? "");
    const datedMs = marching ? s.calledAt.getTime() : s.strikesAt.getTime();
    out.push({ id: s.id, nationId: s.nationId, nation: nation.words.name, placeId: s.townId ?? s.regionId, regionId: s.regionId, townId: s.townId, place, trigger: s.trigger, mode: s.mode, status: s.status, about: s.about, calledAt: s.calledAt.toISOString(), strikesAt: s.strikesAt.toISOString(), line, dateLabel: formatGameDate(gameDate(datedMs, world.startedMs)) });
  }
  return out;
}

// The one each place, or each nation, shows: a march on the road first, else the newest.
export function newestBy(views: StrikeView[], key: (v: StrikeView) => string): Map<string, StrikeView> {
  const out = new Map<string, StrikeView>();
  for (const v of [...views].sort((a, b) => Number(b.status === "marching") - Number(a.status === "marching"))) if (!out.has(key(v))) out.set(key(v), v);
  return out;
}

// GET /military's strikes: the target's panel, for everyone, by town or region.
export type MilitaryStrike = Pick<StrikeView, "nation" | "status" | "mode" | "trigger" | "about" | "strikesAt" | "line" | "dateLabel">;
export async function militaryStrikes(exec: Exec, world: { id: string; startedMs: number }, now: Date): Promise<{ towns: Record<string, MilitaryStrike>; regions: Record<string, MilitaryStrike> }> {
  const out: { towns: Record<string, MilitaryStrike>; regions: Record<string, MilitaryStrike> } = { towns: {}, regions: {} };
  for (const v of newestBy(await strikeViews(exec, world, now), (x) => x.placeId).values()) {
    const shown: MilitaryStrike = { nation: v.nation, status: v.status, mode: v.mode, trigger: v.trigger, about: v.about, strikesAt: v.strikesAt, line: v.line, dateLabel: v.dateLabel };
    if (v.townId !== null) out.towns[v.townId] = shown;
    else out.regions[v.regionId] = shown;
  }
  return out;
}

// --- The alarms (strikes prompt 2) ---------------------------------------------------------

// A march on the road against a holding of the viewer's: its words for the
// Barracks' INCOMING entry, its target's ids for "Show on map", and the strike
// instant for the countdown.
export type StrikeAlarm = { id: string; nation: string; place: string; regionId: string; townId: string | null; about: number; strikesAt: string; line: string };
export type StrikeAlarms = { government: number; incoming: StrikeAlarm[] };
export const NO_STRIKE_ALARMS: StrikeAlarms = { government: 0, incoming: [] };

// GET /me/state's alarms: `government`, the number of marches on the road for
// a sitting Archon, Ephor or Strategos (else 0); `incoming`, those on the road
// against the viewer's own holdings, as they are held now (a holding that
// changed hands takes its march with it, STOP 0 ruling 4 of Strikes 1). With
// nothing on the road, one read on the marching strikes' index.
export async function strikeAlarms(exec: Exec, viewer: { worldId: string; playerId: string; characterId: string }): Promise<StrikeAlarms> {
  const marching = await exec.select().from(strikes).where(and(eq(strikes.worldId, viewer.worldId), eq(strikes.status, "marching")));
  if (marching.length === 0) return NO_STRIKE_ALARMS;
  const seats = await exec.select({ office: offices.office }).from(offices).where(eq(offices.holderCharacterId, viewer.characterId));
  const government = seats.some((x) => (GOVERNMENT_OFFICES as readonly string[]).includes(x.office)) ? marching.length : 0;
  const mine = new Set((await exec.select({ regionId: playerHoldings.regionId, townId: playerHoldings.townId }).from(playerHoldings).where(and(eq(playerHoldings.worldId, viewer.worldId), eq(playerHoldings.ownerPlayerId, viewer.playerId)))).map(holdingPlace));
  const incoming: StrikeAlarm[] = [];
  for (const m of [...marching].sort((a, b) => a.strikesAt.getTime() - b.strikesAt.getTime() || a.id.localeCompare(b.id))) {
    if (m.targetKind !== "holding" || !mine.has(m.townId ?? m.regionId)) continue;
    const nation = await nationById(m.nationId);
    if (!nation) continue;
    const place = await placeNameOf(m.townId, m.regionId);
    incoming.push({ id: m.id, nation: nation.words.name, place, regionId: m.regionId, townId: m.townId, about: m.about, strikesAt: m.strikesAt.toISOString(), line: marchLine(m, nation.words, place) });
  }
  return { government, incoming };
}
