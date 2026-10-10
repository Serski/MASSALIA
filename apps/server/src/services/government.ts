import { eq } from "drizzle-orm";
import { activeWorld, createDb, leagueCities, leagueProjects, treasuryBalance, treasuryLedgerRows } from "@massalia/db";
import { formatGameDate, gameDate, governmentSeats, leagueTax, projectMotion, projectMotionId, treasuryReasonLabel, type GovernmentSeat } from "@massalia/shared";
import { agendaScopeView, getLeagueBuildings, getLeagueCities, heldOffices, leagueMeasureTitle, type AgendaScopeView } from "./agenda.js";
import type { CharacterRow } from "./character.js";
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
    };

const LEDGER_LINES = 40;

// The words a League ledger row shows. A festival's spend (government prompt 3)
// reads "Festival held: <title>"; everything else as treasuryReasonLabel says.
function ledgerLabel(reason: string): string {
  if (reason.startsWith("agenda:festival:")) {
    const title = leagueMeasureTitle(reason.slice("agenda:".length));
    return title ? `Festival held: ${title}` : "Festival held";
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
  const world = await activeWorld();
  if (!world) return { member: true, seats, treasury: { balance: 0, taxPerSeason: 0, ledger: [] }, projects: [], league, festival };

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
