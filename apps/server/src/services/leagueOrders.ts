import { and, eq, gt, gte, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { activeWorld, createDb, leagueOrders, leaguePlayerId, leagueWars, loadFactions, loadLeagueArmy, offices, playerCharacters, players, playerHoldings, playerMarches, playerUnits, playerVoyages, treasuries, treasuryLedger, type LeagueOrderForce, type LeagueOrderKind } from "@massalia/db";
import { commandSeat, factionOfPolity, formatGameDate, gameDate, goodCategoryFor, harvestBanEndsMs, harvestRefusal, HOME_POLITY_ID, isLeagueFight, leagueAtWarWith, leagueLedgerReason, leagueWarRefusal, seasonAt, vendorUnitPrice, type FactionDef, type LeagueWarSpan, type VendorAction } from "@massalia/shared";
import { isActive, type UnitRow } from "./barracks.js";
import { creditResource, getBuildingsContent, getOrCreateResource, type ActingContext } from "./buildings.js";
import { garrisonCount, holdingBaseId, listHoldings, settleHoldings, tributeRateOf, type HoldingsSettle } from "./holdings.js";
import { lockPlayer } from "./lock.js";
import { loadMilitaryOwners } from "./mapMilitary.js";
import { regionDisplayName, townDisplayName } from "./mapNames.js";
import { regionContentOwner, townContentOwner } from "./mapPools.js";

// ---------------------------------------------------------------------------
// The League's army takes orders (government prompt 5b). The League's men and
// ships belong to the world's players row of kind 'league', which has no
// character: this module is everything the map's orders do for the League in
// the place of what they do for a house. Its acting context; its lock; the
// League treasury as its purse; and its own settle (hulls home, arrivals, the
// merge, holdings kept or reverted, tribute to the treasury), which is never
// settleAll or settleBarracks: those charge a house's upkeep in goods and
// disband what it cannot feed, and the League's upkeep is settleLeagueArmy's.
//
// ONE LOCK ORDER for every write to the League's men or its treasury: the
// League's player lock (lockPlayer on its row id), then the League's treasuries
// row FOR UPDATE, then everything else. lockLeagueWrite takes both at the start
// of the transaction, whether or not it will pay. settleLeagueArmy
// (packages/db) takes them in the same order.
// ---------------------------------------------------------------------------

const db = createDb();
type Db = ReturnType<typeof createDb>;
type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Exec = DbTx | Db;

const MS_PER_DAY = 86_400_000;

// The official an order is given by: his character, his name as it stands when
// he gives it (kept on the order) and the seat he gave it from. Nothing of his
// house's: an order is the League's, and so is what its party sees.
export type LeagueOrderer = { characterId: string; name: string; office: "archon" | "strategos"; side: string | null };
// The League's acting context: the three fields every map action takes, with
// the League's mark. `orderer` is null where no one is ordering (the settle, a
// read).
export type LeagueContext = ActingContext & { league: { orderer: LeagueOrderer | null } };
export function isLeague(ctx: ActingContext): ctx is LeagueContext {
  return (ctx as Partial<LeagueContext>).league !== undefined;
}

// The context of a world's League, or null before its army is raised.
export async function leagueContext(exec: Exec, world: { id: string; startedMs: number }, orderer: LeagueOrderer | null = null): Promise<LeagueContext | null> {
  const playerId = await leaguePlayerId(exec, world.id);
  return playerId ? { playerId, worldId: world.id, worldStartedMs: world.startedMs, league: { orderer } } : null;
}

// --- The lock, and the treasury as the purse -----------------------------------

// The start of every League write: the League's lock, then its treasuries row.
// Returns the balance as it stands under the lock.
export async function lockLeagueWrite(tx: DbTx, ctx: Pick<ActingContext, "playerId" | "worldId">): Promise<number> {
  await lockPlayer(tx, ctx.playerId);
  await tx.insert(treasuries).values({ worldId: ctx.worldId, owner: "league" }).onConflictDoNothing();
  const locked = await tx.select({ balance: treasuries.balance }).from(treasuries).where(and(eq(treasuries.worldId, ctx.worldId), eq(treasuries.owner, "league"))).for("update");
  return locked[0]?.balance ?? 0;
}

// What the market pays or asks for a good at an instant: the vendor's band and
// the season's coefficient, as a player meets them. "buy" is what a buyer pays,
// "sell" what a seller gets.
export function marketPrice(good: string, action: VendorAction, at: Date, worldStartedMs: number): number {
  const c = getBuildingsContent();
  const band = c.vendor[good];
  if (!band) return 0;
  return vendorUnitPrice(band, action, c.seasonal, goodCategoryFor(c.seasonal, good), seasonAt(at.getTime(), worldStartedMs));
}

// Credit the League treasury with its ledger row. Under lockLeagueWrite.
export async function creditLeagueTreasury(tx: DbTx, worldId: string, amount: number, reason: string, at: Date): Promise<void> {
  if (amount <= 0) return;
  const credited = await tx
    .update(treasuries)
    .set({ balance: sql`${treasuries.balance} + ${amount}`, updatedAt: at })
    .where(and(eq(treasuries.worldId, worldId), eq(treasuries.owner, "league")))
    .returning({ id: treasuries.id });
  if (credited.length !== 1) throw new Error(`league treasury credit for ${reason} touched ${credited.length} rows`);
  await tx.insert(treasuryLedger).values({ worldId, owner: "league", delta: amount, reason, createdAt: at });
}

// Debit it, guarded: false (and nothing written) when it holds less.
export async function debitLeagueTreasury(tx: DbTx, worldId: string, amount: number, reason: string, at: Date): Promise<boolean> {
  if (amount <= 0) return true;
  const debited = await tx
    .update(treasuries)
    .set({ balance: sql`${treasuries.balance} - ${amount}`, updatedAt: at })
    .where(and(eq(treasuries.worldId, worldId), eq(treasuries.owner, "league"), gte(treasuries.balance, amount)))
    .returning({ id: treasuries.id });
  if (debited.length !== 1) return false;
  await tx.insert(treasuryLedger).values({ worldId, owner: "league", delta: -amount, reason, createdAt: at });
  return true;
}

// --- The League's settle --------------------------------------------------------

export type LeagueSettle = {
  shipsHome: number; // voyages whose hulls came back to stock
  arrived: number; // rows whose road ended
  merged: number; // rows folded into another
  holdings: HoldingsSettle;
  tribute: { placeId: string; days: number; amount: number }[];
};

async function leagueRows(exec: Exec, ctx: ActingContext): Promise<UnitRow[]> {
  return exec.select().from(playerUnits).where(and(eq(playerUnits.worldId, ctx.worldId), eq(playerUnits.ownerPlayerId, ctx.playerId)));
}

// Everything the League's men, ships and holdings owe the clock at `at`, under
// lockLeagueWrite. In the barracks settle's order, without its upkeep:
//  1. hulls home: each voyage whose returns_at has passed is claimed
//     (returned_at stamped) and its ships credited back to the League's stock;
//  2. arrivals: a row whose road has ended stands at its destination; a row
//     still carrying a march is landed by its march's arrival, never here;
//  3. the merge: at each place the ready, standing trained rows of one unit
//     fold into one;
//  4. holdings: a garrisoned holding keeps its marker current, one left empty
//     for a full day reverts (settleHoldings, which needs no character);
//  5. tribute: each holding still held pays the treasury for the whole days
//     since its marker, its grain and timber sold at what the market pays, as
//     one ledger row; the marker's advance is the claim.
export async function settleLeague(tx: DbTx, ctx: LeagueContext, at: Date): Promise<LeagueSettle> {
  const out: LeagueSettle = { shipsHome: 0, arrived: 0, merged: 0, holdings: { reverted: [] }, tribute: [] };

  const home = await tx
    .update(playerVoyages)
    .set({ returnedAt: at })
    .where(and(eq(playerVoyages.worldId, ctx.worldId), eq(playerVoyages.ownerPlayerId, ctx.playerId), isNull(playerVoyages.returnedAt), lte(playerVoyages.returnsAt, at)))
    .returning({ id: playerVoyages.id, ships: playerVoyages.ships, returnsAt: playerVoyages.returnsAt });
  home.sort((a, b) => a.returnsAt.getTime() - b.returnsAt.getTime() || a.id.localeCompare(b.id));
  for (const v of home) {
    for (const [shipId, count] of Object.entries(v.ships)) {
      if (count >= 1) await creditResource(tx, (await getOrCreateResource(tx, ctx.playerId, shipId, at)).id, Math.floor(count));
    }
    out.shipsHome++;
  }

  let rows = await leagueRows(tx, ctx);
  for (const r of rows) {
    if (r.movingTo === null || r.arrivesAt === null || r.arrivesAt.getTime() > at.getTime()) continue;
    if (r.mission?.marchId || r.mission?.musterId) continue;
    await tx.update(playerUnits).set({ basedAt: r.movingTo, movingTo: null, arrivesAt: null, mission: null }).where(eq(playerUnits.id, r.id));
    out.arrived++;
  }

  rows = await leagueRows(tx, ctx);
  const groups = new Map<string, UnitRow[]>();
  for (const r of rows) {
    if (r.source !== "trained" || r.movingTo !== null || !isActive(r, at)) continue;
    const key = `${r.basedAt}\u0000${r.unitId}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const [target, ...others] = group.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)) as [UnitRow, ...UnitRow[]];
    const count = group.reduce((n, r) => n + r.count, 0);
    const startCount = group.reduce((n, r) => n + r.startCount, 0);
    await tx.update(playerUnits).set({ count, startCount }).where(eq(playerUnits.id, target.id));
    for (const r of others) await tx.delete(playerUnits).where(eq(playerUnits.id, r.id));
    out.merged += others.length;
  }

  out.holdings = await settleHoldings(tx, ctx, at);

  for (const h of await listHoldings(tx, ctx)) {
    const days = Math.floor((at.getTime() - h.lastTributeAt.getTime()) / MS_PER_DAY);
    if (days <= 0) continue;
    const advanced = new Date(h.lastTributeAt.getTime() + days * MS_PER_DAY);
    const claimed = await tx
      .update(playerHoldings)
      .set({ lastTributeAt: advanced })
      .where(and(eq(playerHoldings.worldId, h.worldId), eq(playerHoldings.regionId, h.regionId), eq(playerHoldings.townId, h.townId), eq(playerHoldings.lastTributeAt, h.lastTributeAt)))
      .returning({ regionId: playerHoldings.regionId });
    if (claimed.length !== 1) continue; // those days are already paid for
    const rate = await tributeRateOf(h);
    const placeId = holdingBaseId(h);
    // A garrison under the minimum pays nothing for the days that passed; they are gone.
    if ((await garrisonCount(tx, ctx, placeId, at)) < rate.minGarrison) continue;
    const amount = days * (rate.drachmae + rate.grain * marketPrice("grain", "sell", at, ctx.worldStartedMs) + rate.timber * marketPrice("timber", "sell", at, ctx.worldStartedMs));
    if (amount <= 0) continue;
    await creditLeagueTreasury(tx, ctx.worldId, amount, leagueLedgerReason.tribute(placeId, Math.floor(advanced.getTime() / MS_PER_DAY)), at);
    out.tribute.push({ placeId, days, amount });
  }
  return out;
}

// Whether the League's settle has anything to do at `now`: a row whose road has
// ended, a voyage back, or a holding a day past either of its markers (the
// tribute's, or the empty-for-a-day one). Three small reads, no lock.
export async function leagueDue(exec: Exec, ctx: Pick<ActingContext, "playerId" | "worldId">, now: Date): Promise<boolean> {
  const landed = await exec
    .select({ id: playerUnits.id })
    .from(playerUnits)
    .where(and(eq(playerUnits.ownerPlayerId, ctx.playerId), isNotNull(playerUnits.movingTo), lte(playerUnits.arrivesAt, now), sql`${playerUnits.mission}->>'marchId' IS NULL`))
    .limit(1);
  if (landed.length > 0) return true;
  const back = await exec
    .select({ id: playerVoyages.id })
    .from(playerVoyages)
    .where(and(eq(playerVoyages.ownerPlayerId, ctx.playerId), isNull(playerVoyages.returnedAt), lte(playerVoyages.returnsAt, now)))
    .limit(1);
  if (back.length > 0) return true;
  const dayAgo = new Date(now.getTime() - MS_PER_DAY);
  const held = await exec
    .select({ regionId: playerHoldings.regionId })
    .from(playerHoldings)
    .where(and(eq(playerHoldings.worldId, ctx.worldId), eq(playerHoldings.ownerPlayerId, ctx.playerId), or(lte(playerHoldings.lastTributeAt, dayAgo), lte(playerHoldings.lastGarrisonedAt, dayAgo))))
    .limit(1);
  return held.length > 0;
}

// The settle for a read (the sync, the town panels, the Government view, the
// League's map view): nothing, and no lock, unless something is due. Returns
// whether it settled. The callers guard it as 5a's army calls are guarded.
export async function settleLeagueIfDue(now: Date = new Date()): Promise<boolean> {
  const world = await activeWorld();
  if (!world) return false;
  const ctx = await leagueContext(db, world);
  if (!ctx || !(await leagueDue(db, ctx, now))) return false;
  await db.transaction(async (tx) => {
    await lockLeagueWrite(tx, ctx);
    await settleLeague(tx, ctx, now);
  });
  return true;
}

// The same, never throwing: a failure is logged as the army's and stops nothing else.
export async function settleLeagueQuietly(now: Date = new Date()): Promise<void> {
  try {
    await settleLeagueIfDue(now);
  } catch (error) {
    console.error(`army: failed ${error instanceof Error ? error.message : String(error)}`);
  }
}

// --- Who commands -----------------------------------------------------------------

// The official behind an order: the character's seat as it stands now (a
// sitting Archon's, else a Strategos's), or null for anyone else. Read at every
// order; the client only hides what this would refuse.
export async function ordererFor(exec: Exec, character: { id: string; worldId: string }): Promise<LeagueOrderer | null> {
  const held = await exec.select({ office: offices.office, side: offices.side }).from(offices).where(and(eq(offices.worldId, character.worldId), eq(offices.holderCharacterId, character.id)));
  const seat = commandSeat(held);
  if (!seat) return null;
  const named = await exec.select({ name: players.name }).from(playerCharacters).innerJoin(players, eq(players.id, playerCharacters.playerId)).where(eq(playerCharacters.id, character.id)).limit(1);
  return { characterId: character.id, name: named[0]?.name ?? "", office: seat.office, side: seat.side };
}

// --- The League's places ------------------------------------------------------------

// The ten home towns the army was raised in, by town slug, in the content's order.
export async function leagueHomeTowns(): Promise<string[]> {
  return (await loadLeagueArmy()).towns.map((t) => t.townId);
}

// --- The war gate -------------------------------------------------------------------

// The world's wars as spans of time: the whole truth of whom the League is at
// war with at an instant, whether or not the sync has yet set or dropped a
// nation's flag. No nation starts at war in content.
export async function leagueWarSpans(exec: Exec, worldId: string): Promise<LeagueWarSpan[]> {
  const rows = await exec.select({ factionId: leagueWars.factionId, startsAt: leagueWars.startsAt, endsAt: leagueWars.endsAt }).from(leagueWars).where(eq(leagueWars.worldId, worldId));
  return rows.map((r) => ({ factionId: r.factionId, startsAt: r.startsAt.getTime(), endsAt: r.endsAt.getTime() }));
}

// The nation whose land a place is (a town by its owner, a townless region by
// its own): one of the Diplomacy page's, or null for unclaimed land and for a
// people no nation holds.
export async function nationOfPlace(regionId: string, townId: string | null): Promise<FactionDef | null> {
  const polity = townId !== null ? await townContentOwner(townId) : await regionContentOwner(regionId);
  return factionOfPolity({ factions: await loadFactions() }, polity);
}

// Whether the League may raid or attack a place at an instant: only on the land
// of a nation it is at war with then. One answer for the gate at the order, the
// gate at the arrival, the war's plunder and the opinion roll.
export type LeagueWarGate = { ok: true; nation: FactionDef } | { ok: false; nation: FactionDef | null; reason: string };
export async function leagueWarGate(exec: Exec, worldId: string, regionId: string, townId: string | null, at: Date): Promise<LeagueWarGate> {
  const nation = await nationOfPlace(regionId, townId);
  if (nation && leagueAtWarWith(await leagueWarSpans(exec, worldId), nation.id, at.getTime())) return { ok: true, nation };
  return { ok: false, nation, reason: leagueWarRefusal(nation) };
}

// The war gate for the whole map at an instant, for the League's map view: the
// refusal a raid or an attack would meet, by town and by townless region, for
// every place that is not Massalia's own and not a nation's at war. A place
// absent from both maps passes the gate.
export async function leagueGateMap(exec: Exec, worldId: string, at: Date): Promise<{ towns: Record<string, string>; regions: Record<string, string> }> {
  const owners = await loadMilitaryOwners();
  const content = { factions: await loadFactions() };
  const spans = await leagueWarSpans(exec, worldId);
  const refusal = (polity: string): string | null => {
    if (polity === HOME_POLITY_ID) return null;
    const nation = factionOfPolity(content, polity);
    return nation && leagueAtWarWith(spans, nation.id, at.getTime()) ? null : leagueWarRefusal(nation);
  };
  const out = { towns: {} as Record<string, string>, regions: {} as Record<string, string> };
  for (const [id, polity] of Object.entries(owners.towns)) {
    const r = refusal(polity);
    if (r) out.towns[id] = r;
  }
  for (const [id, polity] of Object.entries(owners.regions)) {
    const r = refusal(polity);
    if (r) out.regions[id] = r;
  }
  return out;
}

// --- The record of an order -----------------------------------------------------------

export type LeagueOrderInput = {
  id: string;
  kind: LeagueOrderKind;
  baseId: string;
  regionId: string;
  townId: string | null;
  rows: Pick<UnitRow, "unitId" | "count">[];
  ships: Record<string, number>;
  supplies: number;
  suppliesCost: number;
  marchId: string | null;
  report: Record<string, unknown> | null;
  orderedAt: Date;
  arrivesAt: Date;
};

// Write the order's row, in the order's own transaction. The men sent are
// summed by type.
export async function recordLeagueOrder(tx: DbTx, ctx: LeagueContext, input: LeagueOrderInput): Promise<void> {
  const orderer = ctx.league.orderer;
  if (!orderer) throw new Error("league order: no official is ordering");
  const byUnit = new Map<string, number>();
  for (const r of input.rows) byUnit.set(r.unitId, (byUnit.get(r.unitId) ?? 0) + r.count);
  const force: LeagueOrderForce = [...byUnit.entries()].map(([unitId, count]) => ({ unitId, count }));
  await tx.insert(leagueOrders).values({
    id: input.id,
    worldId: ctx.worldId,
    orderedByCharacterId: orderer.characterId,
    orderedByName: orderer.name,
    office: orderer.office,
    side: orderer.side,
    kind: input.kind,
    baseId: input.baseId,
    regionId: input.regionId,
    townId: input.townId,
    men: input.rows.reduce((n, r) => n + r.count, 0),
    force,
    ships: input.ships,
    supplies: input.supplies,
    suppliesCost: input.suppliesCost,
    marchId: input.marchId,
    report: input.report,
    orderedAt: input.orderedAt,
    arrivesAt: input.arrivesAt,
  });
}

// --- What the League has seen --------------------------------------------------------

// What a League party sees is the League's, never the house's of the official
// who sent it (ruling at STOP 1): a scout's snapshot, or the place as a fight
// left it, is on the party's report and nowhere else. The League's last
// sighting of each place is read back from its own marches' reports: the
// newest resolved one that carries what the men saw. A party that turned back
// or broke up saw nothing.
export type LeagueSightings = {
  towns: Record<string, { garrison: number; pentekonters: number; triremes: number; scoutedGameDate: string }>;
  regions: Record<string, { warband: number; scoutedGameDate: string }>;
};
export async function leagueSightings(exec: Exec, ctx: Pick<ActingContext, "playerId" | "worldId">): Promise<LeagueSightings> {
  const marches = await exec
    .select({ regionId: playerMarches.regionId, townId: playerMarches.townId, report: playerMarches.report })
    .from(playerMarches)
    .where(and(eq(playerMarches.worldId, ctx.worldId), eq(playerMarches.ownerPlayerId, ctx.playerId), eq(playerMarches.status, "resolved")))
    .orderBy(playerMarches.arrivesAt, playerMarches.id);
  const out: LeagueSightings = { towns: {}, regions: {} };
  // Oldest first, so the newest sighting of a place is the one left standing.
  for (const m of marches) {
    const intel = (m.report as { intel?: { warband?: unknown; pentekonters?: unknown; triremes?: unknown; scoutedGameDate?: unknown } | null } | null)?.intel;
    if (!intel || typeof intel.warband !== "number" || typeof intel.scoutedGameDate !== "string") continue;
    if (m.townId) out.towns[m.townId] = { garrison: intel.warband, pentekonters: typeof intel.pentekonters === "number" ? intel.pentekonters : 0, triremes: typeof intel.triremes === "number" ? intel.triremes : 0, scoutedGameDate: intel.scoutedGameDate };
    else out.regions[m.regionId] = { warband: intel.warband, scoutedGameDate: intel.scoutedGameDate };
  }
  return out;
}

// --- No harvest of the League's work ---------------------------------------------------

// Where the League's army has fought within the ban (league-army.json's
// harvestBanSeasons, a year), with the sentence the house of a sitting Archon
// or Strategos is refused a raid or an attack there with: by town, and by
// townless region. A fight is a raid or an attack that met the defenders
// (isLeagueFight); the newest at a place sets the date the ban ends. Read from
// the League's own resolved marches, as its sightings are.
export async function leagueHarvestMap(exec: Exec, ctx: Pick<ActingContext, "worldId" | "worldStartedMs">, at: Date): Promise<{ towns: Record<string, string>; regions: Record<string, string> }> {
  const out = { towns: {} as Record<string, string>, regions: {} as Record<string, string> };
  const seasons = (await loadLeagueArmy()).harvestBanSeasons;
  const leagueId = seasons > 0 ? await leaguePlayerId(exec, ctx.worldId) : null;
  if (!leagueId) return out;
  const since = new Date(harvestBanEndsMs(at.getTime(), -seasons));
  const fought = await exec
    .select({ kind: playerMarches.kind, regionId: playerMarches.regionId, townId: playerMarches.townId, arrivesAt: playerMarches.arrivesAt, report: playerMarches.report })
    .from(playerMarches)
    .where(and(eq(playerMarches.worldId, ctx.worldId), eq(playerMarches.ownerPlayerId, leagueId), eq(playerMarches.status, "resolved"), gt(playerMarches.arrivesAt, since), lte(playerMarches.arrivesAt, at)))
    .orderBy(playerMarches.arrivesAt, playerMarches.id);
  // Oldest first, so the newest fight at a place is the one that stands.
  for (const m of fought) {
    if (!isLeagueFight(m.kind, (m.report as { winner?: unknown } | null)?.winner)) continue;
    const until = formatGameDate(gameDate(harvestBanEndsMs(m.arrivesAt.getTime(), seasons), ctx.worldStartedMs));
    if (m.townId) out.towns[m.townId] = harvestRefusal(await townDisplayName(m.townId), until);
    else out.regions[m.regionId] = harvestRefusal(await regionDisplayName(m.regionId), until);
  }
  return out;
}

// The refusal for one house's raid or attack on one place, or null: only for
// the house of a character who sits as an Archon or a Strategos at this instant.
export async function harvestRefusalFor(exec: Exec, ctx: ActingContext, characterId: string, regionId: string, townId: string | null, at: Date): Promise<string | null> {
  const map = await leagueHarvestMap(exec, ctx, at);
  const sentence = townId !== null ? map.towns[townId] : map.regions[regionId];
  if (!sentence) return null;
  return (await ordererFor(exec, { id: characterId, worldId: ctx.worldId })) ? sentence : null;
}

// The League treasury's balance, unlocked: for a view.
export async function leagueBalance(exec: Exec, worldId: string): Promise<number> {
  return (await exec.select({ balance: treasuries.balance }).from(treasuries).where(and(eq(treasuries.worldId, worldId), eq(treasuries.owner, "league"))).limit(1))[0]?.balance ?? 0;
}
