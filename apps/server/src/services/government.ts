import { eq } from "drizzle-orm";
import { activeWorld, createDb, leagueCities, treasuryBalance, treasuryLedgerRows } from "@massalia/db";
import { formatGameDate, gameDate, governmentSeats, leagueTax, treasuryReasonLabel, type GovernmentSeat } from "@massalia/shared";
import { agendaScopeView, getAgendaPools, heldOffices, type AgendaScopeView } from "./agenda.js";
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
      league: AgendaScopeView; // agendaScopeView(actor, "league", now), unfiltered
    };

const LEDGER_LINES = 40;

export async function governmentView(actor: CharacterRow, now: Date = new Date()): Promise<GovernmentView> {
  const seats = governmentSeats(await heldOffices(actor.id));
  if (seats.length === 0) return { member: false };

  // The scope view syncs first, so a fresh world's opening balance and tax are
  // already in the books it reads next.
  const league = await agendaScopeView(actor, "league", now);
  const world = await activeWorld();
  if (!world) return { member: true, seats, treasury: { balance: 0, taxPerSeason: 0, ledger: [] }, league };

  const cfg = getPoliticsConfig();
  const pool = getAgendaPools().league;
  const cardTitle = (cardId: string) => pool.find((c) => c.id === cardId)?.title;
  const poleis = await db.select({ population: leagueCities.population }).from(leagueCities).where(eq(leagueCities.worldId, world.id));
  const rows = await treasuryLedgerRows(world.id, "league", LEDGER_LINES);
  return {
    member: true,
    seats,
    treasury: {
      balance: await treasuryBalance(world.id, "league"),
      taxPerSeason: leagueTax(poleis.map((p) => p.population), cfg.treasury),
      ledger: rows.map((r) => ({
        delta: r.delta,
        label: treasuryReasonLabel(r.reason, cardTitle),
        dateLabel: formatGameDate(gameDate(Date.parse(r.createdAt), world.startedMs)),
        createdAt: r.createdAt,
      })),
    },
    league,
  };
}
