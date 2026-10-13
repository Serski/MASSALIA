import { and, desc, eq, isNull, like } from "drizzle-orm";
import { activeWorld, createDb, leagueCities, leagueFleet, leagueOrders, leaguePlayerId, leagueProjects, loadLeagueArmy, playerCharacters, playerHoldings, playerMarches, players, playerUnits, playerVoyages, treasuryBalance, treasuryLedger, treasuryLedgerRows, type LeagueOrderKind } from "@massalia/db";
import { armyUpkeep, formatGameDate, gameDate, governmentSeats, LEAGUE_UNIT_IDS, leagueLedgerPlace, leagueTax, nationName, parseDesertionReason, parseWarMotionId, projectMotion, projectMotionId, REAL_MS_PER_SEASON, treasuryReasonLabel, type GovernmentSeat, type LeagueUnitId, type LeagueUnits } from "@massalia/shared";
import { agendaScopeView, getLeagueBuildings, getLeagueCities, getWarFactions, heldOffices, leagueMeasureTitle, type AgendaScopeView } from "./agenda.js";
import type { CharacterRow } from "./character.js";
import { tributeRateOf } from "./holdings.js";
import { regionDisplayName, townDisplayName } from "./mapNames.js";
import { getPoliticsConfig } from "./oligarchy.js";

const db = createDb();

// ---------------------------------------------------------------------------
// The Government tab (government prompt 1): what a sitting Archon, Ephor or
// Strategos sees — their seats, the League treasury's books and the League
// agenda's docket, unfiltered. Everyone else gets `{ member: false }` and
// nothing more; the public agenda (publicLeagueView) is their only window.
// ---------------------------------------------------------------------------

export interface GovernmentLedgerLine {
  delta: number;
  label: string; // treasuryReasonLabel of the stored reason
  dateLabel: string; // "Spring, 299 BC": the row's game date
  createdAt: string;
}

// A League building project (government prompt 2a): under way or standing.
export interface GovernmentProjectView {
  cityId: string;
  polis: string;
  buildingId: string;
  title: string;
  status: "building" | "built";
  completesAt: string;
  completesLabel: string; // "Summer, 292 BC": the game date the building stands
}

// The League's army (government prompt 5a), whole, for every member: the men in
// each home town by type in the content's order, the fleet and where it stands,
// what a season costs, and the last time men deserted for want of pay. Since
// the army takes orders (government prompt 5b) a town's men are those standing
// in it, and the rest of the army is here too: its holdings with their
// garrisons, every party on the road, the hulls at sea, the latest orders with
// who gave them, and the latest reports.
export interface GovernmentArmyParty {
  kind: LeagueOrderKind;
  returning: boolean; // on the way home from a scout, a raid or an attack
  from: string; // display names
  to: string;
  units: LeagueUnits;
  men: number;
  arrivesAt: string;
}
export interface GovernmentArmyOrder {
  id: string;
  kind: LeagueOrderKind;
  by: string; // the official's name
  office: "archon" | "strategos";
  side: string | null;
  from: string;
  to: string;
  units: LeagueUnits;
  men: number;
  suppliesCost: number; // what the voyage's naval supplies cost the treasury; 0 by land
  dateLabel: string; // the game date it was given
  orderedAt: string;
}
export interface GovernmentArmyReport {
  id: string; // the march's
  kind: LeagueOrderKind;
  to: string;
  line: string; // the report's one sentence, as the server wrote it
  dateLabel: string; // the game date the party arrived
  arrivedAt: string;
}
export interface GovernmentArmyView {
  towns: { townId: string; name: string; units: LeagueUnits; men: number }[];
  holdings: { id: string; name: string; units: LeagueUnits; men: number; minGarrison: number }[];
  parties: GovernmentArmyParty[]; // soonest to arrive first
  fleet: { at: string; pentekonters: number; triremes: number; atSea: { pentekonters: number; triremes: number; to: string; returnsAt: string }[] };
  men: number; // every man under arms, the road included: the upkeep is paid for all
  upkeepPerSeason: number; // armyUpkeep of the men now
  lastDesertion: { men: number; label: string } | null; // label: the season's game date
  orders: GovernmentArmyOrder[]; // the 10 newest
  reports: GovernmentArmyReport[]; // the 10 newest
}

const NO_ARMY: GovernmentArmyView = { towns: [], holdings: [], parties: [], fleet: { at: "", pentekonters: 0, triremes: 0, atSea: [] }, men: 0, upkeepPerSeason: 0, lastDesertion: null, orders: [], reports: [] };
const ARMY_LINES = 10;

export type GovernmentView =
  | { member: false }
  | {
      member: true;
      seats: GovernmentSeat[];
      treasury: {
        balance: number;
        taxPerSeason: number; // leagueTax over the world's poleis now
        ledger: GovernmentLedgerLine[]; // the 40 newest
      };
      projects: GovernmentProjectView[]; // under way first by completion, then built by completion
      league: AgendaScopeView; // agendaScopeView(actor, "league", now), unfiltered
      festival: AgendaScopeView; // the festival motion (government prompt 3), unfiltered
      war: AgendaScopeView; // the war motion (government prompt 4), unfiltered
      army: GovernmentArmyView; // the League's army (government prompt 5a)
    };

const LEDGER_LINES = 40;

// The words a League ledger row shows. A festival's spend (government prompt 3)
// reads "Festival held: <title>"; a war's (government prompt 4) "War declared on
// <nation>", the nation as nationName gives it; everything else as
// treasuryReasonLabel says.
function ledgerLabel(reason: string, delta: number, placeName?: (placeId: string) => string | undefined): string {
  if (reason.startsWith("agenda:festival:")) {
    const title = leagueMeasureTitle(reason.slice("agenda:".length));
    return title ? `Festival held: ${title}` : "Festival held";
  }
  if (reason.startsWith("agenda:war:")) {
    const parsed = parseWarMotionId(reason.slice("agenda:".length));
    const nation = parsed ? getWarFactions().find((f) => f.id === parsed.factionId) : undefined;
    return nation ? `War declared on ${nationName(nation)}` : "War declared";
  }
  return treasuryReasonLabel(reason, leagueMeasureTitle, delta, placeName);
}

// A place by the id the map's rows carry: a region id (R001…) or a town slug.
const placeName = (id: string) => (/^R\d+$/.test(id) ? regionDisplayName(id) : townDisplayName(id));

export async function governmentView(actor: CharacterRow, now: Date = new Date()): Promise<GovernmentView> {
  const seats = governmentSeats(await heldOffices(actor.id));
  if (seats.length === 0) return { member: false };

  // The scope view syncs first, so a fresh world's opening balance and tax are
  // already in the books it reads next.
  const league = await agendaScopeView(actor, "league", now);
  const festival = await agendaScopeView(actor, "festival", now);
  const war = await agendaScopeView(actor, "war", now);
  const world = await activeWorld();
  if (!world) return { member: true, seats, treasury: { balance: 0, taxPerSeason: 0, ledger: [] }, projects: [], league, festival, war, army: NO_ARMY };

  const cfg = getPoliticsConfig();
  const poleis = await db.select({ population: leagueCities.population }).from(leagueCities).where(eq(leagueCities.worldId, world.id));
  const rows = await treasuryLedgerRows(world.id, "league", LEDGER_LINES);
  const dateLabel = (ms: number) => formatGameDate(gameDate(ms, world.startedMs));
  // The places the army's plunder and tribute rows name, by their display names.
  const ledgerPlaces = new Map<string, string>();
  for (const r of rows) {
    const id = leagueLedgerPlace(r.reason);
    if (id && !ledgerPlaces.has(id)) ledgerPlaces.set(id, await placeName(id));
  }
  return {
    member: true,
    seats,
    treasury: {
      balance: await treasuryBalance(world.id, "league"),
      taxPerSeason: leagueTax(poleis.map((p) => p.population), cfg.treasury),
      ledger: rows.map((r) => ({
        delta: r.delta,
        label: ledgerLabel(r.reason, r.delta, (id) => ledgerPlaces.get(id)),
        dateLabel: dateLabel(Date.parse(r.createdAt)),
        createdAt: r.createdAt,
      })),
    },
    projects: await projectViews(world.id, dateLabel),
    league,
    festival,
    war,
    army: await armyView(world, dateLabel),
  };
}

// The army as it stands now. The scope views above have synced, so a fresh
// world's army is raised, its season paid and its arrivals settled before this reads.
async function armyView(world: { id: string; startedMs: number }, dateLabel: (ms: number) => string): Promise<GovernmentArmyView> {
  const content = await loadLeagueArmy();
  const leagueId = await leaguePlayerId(db, world.id);
  if (!leagueId) return { ...NO_ARMY, fleet: { ...NO_ARMY.fleet, at: await townDisplayName(content.fleetAt) } };
  const rows = await db.select().from(playerUnits).where(and(eq(playerUnits.worldId, world.id), eq(playerUnits.ownerPlayerId, leagueId))).orderBy(playerUnits.basedAt, playerUnits.unitId, playerUnits.id);
  const noUnits = () => Object.fromEntries(LEAGUE_UNIT_IDS.map((id) => [id, 0])) as LeagueUnits;
  const add = (units: LeagueUnits, unitId: string, count: number) => {
    if ((LEAGUE_UNIT_IDS as readonly string[]).includes(unitId)) units[unitId as LeagueUnitId] += count;
  };
  const menOf = (units: LeagueUnits) => LEAGUE_UNIT_IDS.reduce((n, id) => n + units[id], 0);
  // The men standing at a place: a row on the road is in no town.
  const standingAt = (placeId: string) => {
    const units = noUnits();
    for (const row of rows) if (row.basedAt === placeId && row.movingTo === null) add(units, row.unitId, row.count);
    return units;
  };

  const towns: GovernmentArmyView["towns"] = [];
  for (const town of content.towns) {
    const units = standingAt(town.townId);
    towns.push({ townId: town.townId, name: await townDisplayName(town.townId), units, men: menOf(units) });
  }

  // The League's holdings, oldest first, with the garrison each needs to pay its tribute.
  const held = await db.select().from(playerHoldings).where(and(eq(playerHoldings.worldId, world.id), eq(playerHoldings.ownerPlayerId, leagueId))).orderBy(playerHoldings.since, playerHoldings.regionId, playerHoldings.townId);
  const holdings: GovernmentArmyView["holdings"] = [];
  for (const h of held) {
    const id = h.townId || h.regionId;
    const units = standingAt(id);
    holdings.push({ id, name: await placeName(id), units, men: menOf(units), minGarrison: (await tributeRateOf(h)).minGarrison });
  }

  // The parties on the road: the rows that set out together, as one.
  const parties = new Map<string, GovernmentArmyParty>();
  for (const row of rows) {
    if (row.movingTo === null || row.arrivesAt === null) continue;
    const mission = row.mission;
    const kind: LeagueOrderKind = mission && mission.kind !== "muster" ? (mission.kind as LeagueOrderKind) : "move";
    const target = mission ? (mission.townId ?? mission.regionId) : row.movingTo;
    // Out to a scout, a raid or an attack the rows carry their march; a move
    // goes from its base to its destination; anything else is on its way home.
    const outbound = Boolean(mission?.marchId) || kind === "move";
    const key = mission?.marchId ?? `${kind}|${row.basedAt}|${row.movingTo}|${row.arrivesAt.toISOString()}`;
    let party = parties.get(key);
    if (!party) {
      party = { kind, returning: !outbound, from: await placeName(outbound ? row.basedAt : target), to: await placeName(outbound && kind !== "move" ? target : row.movingTo), units: noUnits(), men: 0, arrivesAt: row.arrivesAt.toISOString() };
      parties.set(key, party);
    }
    add(party.units, row.unitId, row.count);
    party.men += row.count;
  }

  // The hulls at sea, soonest home first.
  const away = await db.select().from(playerVoyages).where(and(eq(playerVoyages.worldId, world.id), eq(playerVoyages.ownerPlayerId, leagueId), isNull(playerVoyages.returnedAt))).orderBy(playerVoyages.returnsAt, playerVoyages.id);
  const atSea: GovernmentArmyView["fleet"]["atSea"] = [];
  for (const v of away) atSea.push({ pentekonters: Math.floor(v.ships["trade-ship"] ?? 0), triremes: Math.floor(v.ships.galley ?? 0), to: await placeName(v.townId ?? v.regionId), returnsAt: v.returnsAt.toISOString() });

  // The latest orders, with who gave each and from which seat.
  const given = await db
    .select({ order: leagueOrders, by: players.name })
    .from(leagueOrders)
    .innerJoin(playerCharacters, eq(playerCharacters.id, leagueOrders.orderedByCharacterId))
    .innerJoin(players, eq(players.id, playerCharacters.playerId))
    .where(eq(leagueOrders.worldId, world.id))
    .orderBy(desc(leagueOrders.orderedAt), desc(leagueOrders.id))
    .limit(ARMY_LINES);
  const orders: GovernmentArmyOrder[] = [];
  for (const { order, by } of given) {
    const units = noUnits();
    for (const f of order.force) add(units, f.unitId, f.count);
    orders.push({ id: order.id, kind: order.kind, by, office: order.office, side: order.side, from: await placeName(order.baseId), to: await placeName(order.townId ?? order.regionId), units, men: order.men, suppliesCost: order.suppliesCost, dateLabel: dateLabel(order.orderedAt.getTime()), orderedAt: order.orderedAt.toISOString() });
  }

  // The latest reports: what each party that arrived found, in the server's sentence.
  const arrived = await db
    .select()
    .from(playerMarches)
    .where(and(eq(playerMarches.worldId, world.id), eq(playerMarches.ownerPlayerId, leagueId), eq(playerMarches.status, "resolved")))
    .orderBy(desc(playerMarches.arrivesAt), desc(playerMarches.id))
    .limit(ARMY_LINES);
  const reports: GovernmentArmyReport[] = [];
  for (const march of arrived) {
    const line = (march.report as { line?: unknown } | null)?.line;
    if (typeof line !== "string") continue;
    reports.push({ id: march.id, kind: march.kind, to: await placeName(march.townId ?? march.regionId), line, dateLabel: dateLabel(march.arrivesAt.getTime()), arrivedAt: march.arrivesAt.toISOString() });
  }

  const men = rows.reduce((n, r) => n + r.count, 0);
  const fleet = await leagueFleet(db, world.id);
  const last = (
    await db
      .select({ reason: treasuryLedger.reason })
      .from(treasuryLedger)
      .where(and(eq(treasuryLedger.worldId, world.id), eq(treasuryLedger.owner, "league"), like(treasuryLedger.reason, "desertion:s%")))
      .orderBy(desc(treasuryLedger.createdAt))
      .limit(1)
  )[0];
  const deserted = last ? parseDesertionReason(last.reason) : null;
  return {
    towns,
    holdings,
    parties: [...parties.values()].sort((a, b) => a.arrivesAt.localeCompare(b.arrivesAt)),
    fleet: { at: await townDisplayName(content.fleetAt), ...fleet, atSea },
    men,
    upkeepPerSeason: armyUpkeep(men, content.upkeepPerManPerSeason),
    lastDesertion: deserted ? { men: deserted.men, label: formatGameDate(gameDate(world.startedMs + deserted.season * REAL_MS_PER_SEASON, world.startedMs)) } : null,
    orders,
    reports,
  };
}

// The world's projects: under way first by completion, then the built ones by completion.
async function projectViews(worldId: string, dateLabel: (ms: number) => string): Promise<GovernmentProjectView[]> {
  const buildings = getLeagueBuildings();
  const cities = getLeagueCities().cities;
  const rows = await db.select().from(leagueProjects).where(eq(leagueProjects.worldId, worldId));
  const views: GovernmentProjectView[] = [];
  for (const row of rows) {
    const motion = projectMotion(projectMotionId(row.cityId, row.buildingId), buildings, cities);
    if (!motion) continue;
    views.push({
      cityId: row.cityId,
      polis: motion.polis,
      buildingId: row.buildingId,
      title: motion.title,
      status: row.completedAt ? "built" : "building",
      completesAt: row.completesAt.toISOString(),
      completesLabel: dateLabel(row.completesAt.getTime()),
    });
  }
  const rank = (v: GovernmentProjectView) => (v.status === "building" ? 0 : 1);
  return views.sort((a, b) => rank(a) - rank(b) || a.completesAt.localeCompare(b.completesAt));
}
