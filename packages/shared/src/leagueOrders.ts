import type { HeldOffice } from "./agenda.js";
import { REAL_MS_PER_SEASON } from "./calendar.js";
import { renderForce, type CampaignForcePart } from "./chronicle.js";
import type { FactionDef } from "./league.js";
import { nationName } from "./leagueWars.js";

// ---------------------------------------------------------------------------
// The League's orders (government prompt 5b). A sitting Archon or Strategos
// orders the League's army as a player orders his own men; the League raids and
// attacks only a nation it is at war with by the chamber's vote; its purse is
// the League treasury. Pure: the seat that commands, the war as it stands at an
// instant, and every sentence the server answers with, so the map and the
// server never word a refusal twice.
// ---------------------------------------------------------------------------

// The seat an order is given from: a sitting Archon's first, else a Strategos's;
// null for an Ephor and for anyone else.
export type CommandSeat = { office: "archon" | "strategos"; side: "palaioi" | "dynatoi" | null };
export function commandSeat(held: HeldOffice[]): CommandSeat | null {
  for (const office of ["archon", "strategos"] as const) {
    const seat = held.find((h) => h.office === office);
    if (seat) return { office, side: seat.side === "palaioi" || seat.side === "dynatoi" ? seat.side : null };
  }
  return null;
}
export const LEAGUE_COMMAND_REFUSAL = "Only a sitting Archon or Strategos commands the League's army.";

// A war as league_wars holds it: the League is at war with the nation from
// starts_at until ends_at, the end excluded.
export type LeagueWarSpan = { factionId: string; startsAt: number; endsAt: number };
export function leagueAtWarWith(wars: readonly LeagueWarSpan[], factionId: string, atMs: number): boolean {
  return wars.some((w) => w.factionId === factionId && w.startsAt <= atMs && atMs < w.endsAt);
}

// Why the League may not raid or attack a place: its land is a nation's the
// League is at peace with, or no nation's at all (unclaimed land and the
// peoples no nation holds are the houses' to raid; the League only scouts there).
export function leagueWarRefusal(nation: Pick<FactionDef, "name" | "group"> | null): string {
  return nation ? `The League is not at war with ${nationName(nation)}.` : "The League makes war only on nations, and no nation holds this land.";
}

// Who holds a place an order would raid or attack: the League (to a house), or
// another house (to a house and to the League alike).
export function holderRefusal(holder: "league" | "house", place: "town" | "land"): string {
  return holder === "league" ? `The League holds this ${place}.` : `Another house holds this ${place}.`;
}

// The League's men move only between its own places.
export const LEAGUE_MOVE_REFUSAL = "The League's men move only between its towns and its holdings.";

// A voyage the treasury cannot pay for.
export function leagueSuppliesRefusal(cost: number, balance: number): string {
  return `The treasury cannot pay for the voyage: ${cost.toLocaleString("en-US")} drachmae of naval supplies, ${balance.toLocaleString("en-US")} in the treasury.`;
}

// A party that turned back whole: the League's, which found the war over when
// it arrived; or a house's, which found the place held by the League.
export function leaguePeaceLine(force: CampaignForcePart[], place: string, nation: Pick<FactionDef, "name" | "group">): string {
  return `${renderForce(force) || "The League's men"} reached ${place} after the peace with ${nationName(nation)} and turned back.`;
}
export function heldByLeagueLine(force: CampaignForcePart[], place: string): string {
  return `${renderForce(force) || "Our men"} found ${place} held by the League and turned back.`;
}

// --- No harvest of the League's work (ruling 3 at STOP 1) ----------------------
// The Archons and Strategoi may not use the army for their own gain: for a year
// after the League's army fights at a town or a land, the house of a sitting
// Archon or Strategos may not raid or attack it. A fight is a raid or an attack
// that met the defenders: the attackers won, were broken, or stood and
// withdrew. A scout, a party that turned back or broke up on the road, and a
// landing driven off at sea are no fight.
export function isLeagueFight(kind: string, winner: unknown): boolean {
  return (kind === "raid" || kind === "attack") && (winner === "attacker" || winner === "defender" || winner === "stand");
}
// The instant the ban on a place ends: `seasons` (league-army.json's harvestBanSeasons) after the fight.
export function harvestBanEndsMs(foughtAtMs: number, seasons: number): number {
  return foughtAtMs + seasons * REAL_MS_PER_SEASON;
}
// What the house of a sitting official is answered, with the game date the ban ends.
export function harvestRefusal(place: string, untilLabel: string): string {
  return `The League's army fought at ${place}. No Archon or Strategos may raid or attack it with his own men until ${untilLabel}.`;
}
