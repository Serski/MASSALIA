import { and, desc, eq, like } from "drizzle-orm";
import { activeWorld, createDb, leagueArmyRows, leagueCities, leagueFleet, leagueProjects, loadLeagueArmy, treasuryBalance, treasuryLedger, treasuryLedgerRows } from "@massalia/db";
import { armyUpkeep, formatGameDate, gameDate, governmentSeats, LEAGUE_UNIT_IDS, leagueTax, nationName, parseDesertionReason, parseWarMotionId, projectMotion, projectMotionId, REAL_MS_PER_SEASON, treasuryReasonLabel, type GovernmentSeat, type LeagueUnitId, type LeagueUnits } from "@massalia/shared";
import { agendaScopeView, getLeagueBuildings, getLeagueCities, getWarFactions, heldOffices, leagueMeasureTitle, type AgendaScopeView } from "./agenda.js";
import type { CharacterRow } from "./character.js";
import { townDisplayName } from "./mapNames.js";
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
// what a season costs, and the last time men deserted for want of pay.
export interface GovernmentArmyView {
  towns: { townId: string; name: string; units: LeagueUnits; men: number }[];
  fleet: { at: string; pentekonters: number; triremes: number };
  men: number;
  upkeepPerSeason: number; // armyUpkeep of the men now
  lastDesertion: { men: number; label: string } | null; // label: the season's game date
}

const NO_ARMY: GovernmentArmyView = { towns: [], fleet: { at: "", pentekonters: 0, triremes: 0 }, men: 0, upkeepPerSeason: 0, lastDesertion: null };

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
function ledgerLabel(reason: string): string {
  if (reason.startsWith("agenda:festival:")) {
    const title = leagueMeasureTitle(reason.slice("agenda:".length));
    return title ? `Festival held: ${title}` : "Festival held";
  }
  if (reason.startsWith("agenda:war:")) {
    const parsed = parseWarMotionId(reason.slice("agenda:".length));
    const nation = parsed ? getWarFactions().find((f) => f.id === parsed.factionId) : undefined;
    return nation ? `War declared on ${nationName(nation)}` : "War declared";
  }
  return treasuryReasonLabel(reason, leagueMeasureTitle);
}

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
  return {
    member: true,
    seats,
    treasury: {
      balance: await treasuryBalance(world.id, "league"),
      taxPerSeason: leagueTax(poleis.map((p) => p.population), cfg.treasury),
      ledger: rows.map((r) => ({
        delta: r.delta,
        label: ledgerLabel(r.reason),
        dateLabel: dateLabel(Date.parse(r.createdAt)),
        createdAt: r.createdAt,
      })),
    },
    projects: await projectViews(world.id, dateLabel),
    league,
    festival,
    war,
    army: await armyView(world),
  };
}

// The army as it stands now. The scope views above have synced, so a fresh
// world's army is raised and its season paid before this reads.
async function armyView(world: { id: string; startedMs: number }): Promise<GovernmentArmyView> {
  const content = await loadLeagueArmy();
  const rows = await leagueArmyRows(db, world.id);
  const towns: GovernmentArmyView["towns"] = [];
  for (const town of content.towns) {
    const units = Object.fromEntries(LEAGUE_UNIT_IDS.map((id) => [id, 0])) as LeagueUnits;
    for (const row of rows) {
      if (row.basedAt === town.townId && (LEAGUE_UNIT_IDS as readonly string[]).includes(row.unitId)) units[row.unitId as LeagueUnitId] += row.count;
    }
    towns.push({ townId: town.townId, name: await townDisplayName(town.townId), units, men: LEAGUE_UNIT_IDS.reduce((n, id) => n + units[id], 0) });
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
    fleet: { at: await townDisplayName(content.fleetAt), ...fleet },
    men,
    upkeepPerSeason: armyUpkeep(men, content.upkeepPerManPerSeason),
    lastDesertion: deserted ? { men: deserted.men, label: formatGameDate(gameDate(world.startedMs + deserted.season * REAL_MS_PER_SEASON, world.startedMs)) } : null,
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
