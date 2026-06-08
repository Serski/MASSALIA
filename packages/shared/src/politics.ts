// ---------------------------------------------------------------------------
// Political party rules (pure). Ideology: +Reformist / -Traditionalist.
// Palaioi = Traditionalist (ideology <= -10); Dynatoi = Reformist (>= +10).
// ---------------------------------------------------------------------------

export type PoliticalParty = "none" | "palaioi" | "dynatoi";
export type JoinableParty = "palaioi" | "dynatoi";

export const PARTY_IDEOLOGY_THRESHOLD = 10;
export const CENSURE_DURATION_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
export const DEFECTION_TRAIT_ID = "turncoat";

// Whether an ideology satisfies a party's valid range. Used for both join
// eligibility and ongoing membership. 'none' is always valid.
export function meetsPartyIdeology(party: PoliticalParty, ideology: number): boolean {
  if (party === "palaioi") return ideology <= -PARTY_IDEOLOGY_THRESHOLD;
  if (party === "dynatoi") return ideology >= PARTY_IDEOLOGY_THRESHOLD;
  return true;
}

// A current member whose ideology has drifted out of their party's range —
// either back into the centre (-10, +10) or past the opposing threshold.
export function hasDriftedFromParty(party: PoliticalParty, ideology: number): boolean {
  return party !== "none" && !meetsPartyIdeology(party, ideology);
}

// At censure expiry: still out of range -> kick (party 'none' + turncoat); else clear.
export function censureExpiryOutcome(party: PoliticalParty, ideology: number): "kick" | "clear" {
  return meetsPartyIdeology(party, ideology) ? "clear" : "kick";
}
