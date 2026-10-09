import type { HeldOffice, TreasuryConfig } from "./agenda.js";

// ---------------------------------------------------------------------------
// The Government (government prompt 1): the sitting Archons, Ephors and
// Strategoi, the League treasury's seasonal income and the words its ledger
// shows. Pure; the server decides who holds what and when a season turns.
// ---------------------------------------------------------------------------

// The League offices whose holders sit in the Government, in the order the
// Government tab lists them.
export const GOVERNMENT_OFFICES = ["archon", "ephor", "strategos"] as const;
export type GovernmentOffice = (typeof GOVERNMENT_OFFICES)[number];
export type GovernmentSide = "palaioi" | "dynatoi" | null;

export interface GovernmentSeat {
  office: GovernmentOffice;
  side: GovernmentSide;
}

function isGovernmentOffice(office: string): office is GovernmentOffice {
  return (GOVERNMENT_OFFICES as readonly string[]).includes(office);
}

// The Government seats among the offices a character holds: Archon first, then
// Ephor, then Strategos. Party offices (party_archon, party_ephor) are not seats.
export function governmentSeats(held: HeldOffice[]): GovernmentSeat[] {
  const out: GovernmentSeat[] = [];
  for (const office of GOVERNMENT_OFFICES) {
    for (const h of held) {
      if (h.office !== office || !isGovernmentOffice(h.office)) continue;
      out.push({ office, side: h.side === "palaioi" || h.side === "dynatoi" ? h.side : null });
    }
  }
  return out;
}

// --- The polis tax -----------------------------------------------------------

// What one polis pays the League treasury a season: population × taxPerHead,
// rounded per polis as a conquered town's tribute is rounded per town.
export function polisTax(population: number, cfg: TreasuryConfig): number {
  return Math.round(Math.max(0, population) * cfg.taxPerHead);
}

// The League's tax income a season: the sum of polisTax over every polis.
export function leagueTax(populations: number[], cfg: TreasuryConfig): number {
  return populations.reduce((sum, population) => sum + polisTax(population, cfg), 0);
}

// --- The ledger's claim reasons and labels -----------------------------------

// The reasons the League treasury credits exactly once (the unique partial index
// of migration 0070, widened by 0072, is keyed on them): the opening balance
// once per world; the poleis' tax, the swept fees and the standing Bazaars' and
// Ports' dues once per world per season.
export const treasuryClaimReason = {
  opening: "opening",
  tax: (season: number): string => `tax:s${season}`,
  fees: (season: number): string => `fees:s${season}`,
  buildings: (season: number): string => `buildings:s${season}`,
} as const;

// The words a ledger row shows for its stored reason. `cardTitle` resolves a
// passed measure's card id to its title; without one, or for an unknown id,
// the line says only that a measure passed. An unknown reason shows as stored.
export function treasuryReasonLabel(reason: string, cardTitle?: (cardId: string) => string | undefined): string {
  if (reason === treasuryClaimReason.opening) return "Opening balance";
  if (reason.startsWith("levy:s")) return "Levy";
  if (reason.startsWith("tax:s")) return "Taxes of the poleis";
  if (reason.startsWith("fees:s")) return "Market tax and fees";
  if (reason.startsWith("buildings:s")) return "Bazaar and harbor dues";
  if (reason === "cut:seat_purchase") return "Share of a seat sale";
  if (reason === "cut:festival_donation") return "Share of a festival gift";
  if (reason.startsWith("agenda:")) {
    const title = cardTitle?.(reason.slice("agenda:".length));
    return title ? `Passed measure: ${title}` : "Passed measure";
  }
  return reason;
}
