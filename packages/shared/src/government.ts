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
// Ports' dues once per world per season. The army's upkeep (government prompt
// 5a, migration 0075) is the one once-only debit, once per world per season.
export const treasuryClaimReason = {
  opening: "opening",
  tax: (season: number): string => `tax:s${season}`,
  fees: (season: number): string => `fees:s${season}`,
  buildings: (season: number): string => `buildings:s${season}`,
  army: (season: number): string => `army:s${season}`,
} as const;

// The row a season's desertion leaves on the ledger (government prompt 5a): its
// delta is 0 and its reason carries the season and the men who left, since the
// ledger has no other place for a count.
export function desertionReason(season: number, men: number): string {
  return `desertion:s${season}:${men}`;
}

export function parseDesertionReason(reason: string): { season: number; men: number } | null {
  const m = /^desertion:s(\d+):(\d+)$/.exec(reason);
  return m ? { season: Number(m[1]), men: Number(m[2]) } : null;
}

// The League treasury as the army's purse (government prompt 5b). Three reasons,
// each written once by something that happens once: a voyage's naval supplies
// (bought with the order), a raid's plunder (credited when its march resolves)
// and a holding's tribute (credited as its marker advances). The place rides
// in the reason, since the ledger has no other column for it.
export const leagueLedgerReason = {
  supplies: (orderId: string): string => `supplies:${orderId}`,
  plunder: (placeId: string, marchId: string): string => `plunder:${placeId}:${marchId}`,
  tribute: (placeId: string, day: number): string => `tribute:${placeId}:d${day}`,
  // A raid by a nation that won on a home town or a League holding (strikes prompt 1).
  strike: (nationId: string, placeId: string, strikeId: string): string => `strike:${nationId}:${placeId}:${strikeId}`,
} as const;

// The place a plunder or tribute row names (a town slug or a region id); null for any other reason.
export function leagueLedgerPlace(reason: string): string | null {
  const m = /^(?:plunder|tribute):([^:]+):/.exec(reason);
  return m ? m[1]! : null;
}

// "1,650 men", "1 man".
export function menLabel(men: number): string {
  return `${men.toLocaleString("en-US")} ${men === 1 ? "man" : "men"}`;
}

// The words a ledger row shows for its stored reason. `cardTitle` resolves a
// passed measure's card id to its title; without one, or for an unknown id,
// the line says only that a measure passed. An unknown reason shows as stored.
// `delta` is the row's amount, where the words depend on it: a season's army
// upkeep the treasury could not pay at all is its claim at 0, "Army upkeep unpaid".
// `placeName` resolves the place a plunder or tribute row names to its display name.
export function treasuryReasonLabel(reason: string, cardTitle?: (cardId: string) => string | undefined, delta?: number, placeName?: (placeId: string) => string | undefined): string {
  if (reason === treasuryClaimReason.opening) return "Opening balance";
  if (reason.startsWith("levy:s")) return "Levy";
  if (reason.startsWith("tax:s")) return "Taxes of the poleis";
  if (reason.startsWith("fees:s")) return "Market tax and fees";
  if (reason.startsWith("buildings:s")) return "Bazaar and harbor dues";
  if (reason.startsWith("army:s")) return delta === 0 ? "Army upkeep unpaid" : "Army upkeep";
  if (reason.startsWith("desertion:s")) {
    const parsed = parseDesertionReason(reason);
    return parsed ? `Deserted for want of pay: ${menLabel(parsed.men)}` : "Deserted for want of pay";
  }
  if (reason.startsWith("supplies:")) return "Naval supplies";
  if (reason.startsWith("plunder:") || reason.startsWith("tribute:")) {
    const what = reason.startsWith("plunder:") ? "Plunder" : "Tribute";
    const place = leagueLedgerPlace(reason);
    const name = place ? placeName?.(place) : undefined;
    return name ? `${what} of ${name}` : what;
  }
  if (reason === "cut:seat_purchase") return "Share of a seat sale";
  if (reason === "cut:festival_donation") return "Share of a festival gift";
  if (reason.startsWith("agenda:")) {
    const title = cardTitle?.(reason.slice("agenda:".length));
    return title ? `Passed measure: ${title}` : "Passed measure";
  }
  return reason;
}
