import { z } from "zod";
import { SEASONS_PER_YEAR } from "./calendar.js";

// ---------------------------------------------------------------------------
// The Agenda & the Three Governments (Politics Prompt 3) — the capstone. Three
// governments on one engine: the League (4 sitting officials draft/veto a card
// to the chamber) and the two Party machines (a for-life Archon + Ephor, dues-
// funded treasury, party-member-only votes), one tier down on an offset cadence.
//
// Everything here is pure + unit-tested. Tuning lives in politics-config.json.
// The chamber tally itself is reused from oligarchy.ts; the ballot from ballot.ts.
// ---------------------------------------------------------------------------

export const AGENDA_SCOPES = ["league", "palaioi", "dynatoi"] as const;
export type AgendaScope = (typeof AGENDA_SCOPES)[number];

// --- Agenda card content -----------------------------------------------------

// Effects are deliberately light/representational for now (deep state buildings
// & armies come later): a treasury grant, a small league-wide stat nudge, a party
// favor shift, or pure flavor. The treasury SPEND is the card's `cost`, separate.
export const agendaEffectSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("treasury_grant"), beneficiary: z.enum(["drafter", "officials"]), amount: z.number().int().nonnegative() }),
  z.object({ type: z.literal("league_stat"), stat: z.enum(["prestige", "devotion", "militia", "intelligence"]), amount: z.number().int() }),
  z.object({ type: z.literal("party_favor"), party: z.enum(["palaioi", "dynatoi"]), amount: z.number().int() }),
  z.object({ type: z.literal("flavor") }),
]);
export type AgendaEffect = z.infer<typeof agendaEffectSchema>;

export const agendaCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  // Spent from the relevant treasury on pass (0 = free). Can't overspend.
  cost: z.number().int().nonnegative(),
  // Which NPC base favors it (votes "yes"); the other sides vote "no".
  partyLean: z.enum(["palaioi", "dynatoi", "independent"]),
  effect: agendaEffectSchema,
});
export type AgendaCard = z.infer<typeof agendaCardSchema>;

export function parseAgendaFile(data: unknown): AgendaCard[] {
  return z.array(agendaCardSchema).min(1).parse(data);
}

// The {palaioi,dynatoi,independent} yes/no leans a card presents to the chamber
// tally: its favored side votes yes, the others no.
export function cardLeans(card: AgendaCard): { palaioi: "yes" | "no"; dynatoi: "yes" | "no"; independent: "yes" | "no" } {
  return {
    palaioi: card.partyLean === "palaioi" ? "yes" : "no",
    dynatoi: card.partyLean === "dynatoi" ? "yes" : "no",
    independent: card.partyLean === "independent" ? "yes" : "no",
  };
}

// --- Config (the politics-config.json blocks) -------------------------------

export const treasuryConfigSchema = z.object({
  leviedPerSeason: z.number().int().nonnegative(),
  seatPurchaseCutFraction: z.number().min(0).max(1),
  festivalDonationCutFraction: z.number().min(0).max(1),
});
export type TreasuryConfig = z.infer<typeof treasuryConfigSchema>;

export const partyDuesConfigSchema = z.object({ duesPerSeasonPerMember: z.number().int().nonnegative() });
export type PartyDuesConfig = z.infer<typeof partyDuesConfigSchema>;

export const agendaConfigSchema = z.object({
  leagueCardsPerCycle: z.number().int().positive(),
  leagueCadenceGameYears: z.number().int().positive(),
  partyCadenceGameYears: z.number().int().positive(),
  // Seasons from the year's Winter at which party business opens (keeps party
  // cycles in different seasons than the league's: league Winter→Spring, party
  // Summer→Autumn at offset 2).
  partyCadenceSeasonOffset: z.number().int().nonnegative(),
  vetoesPerEphorPerTerm: z.number().int().nonnegative(),
});
export type AgendaConfig = z.infer<typeof agendaConfigSchema>;

export const endorsementConfigSchema = z.object({ swingVotes: z.number().int().nonnegative() });
export type EndorsementConfig = z.infer<typeof endorsementConfigSchema>;

// --- Treasury math (pure) ---------------------------------------------------

export function seatPurchaseCut(price: number, cfg: TreasuryConfig): number {
  return Math.max(0, Math.floor(price * cfg.seatPurchaseCutFraction));
}
export function festivalDonationCut(amount: number, cfg: TreasuryConfig): number {
  return Math.max(0, Math.floor(amount * cfg.festivalDonationCutFraction));
}
// Party dues accrued for a season: per-member dues × the party's living member count.
export function dues(memberCount: number, cfg: PartyDuesConfig): number {
  return Math.max(0, Math.floor(memberCount)) * cfg.duesPerSeasonPerMember;
}
// A treasury can fund a cost only if its balance covers it (never overspends).
export function canAfford(balance: number, cost: number): boolean {
  return balance >= cost;
}

// --- Draft / veto eligibility (pure) ----------------------------------------

export interface HeldOffice {
  office: string; // 'archon' | 'ephor' | 'party_archon' | 'party_ephor' | …
  side: string | null;
}

// The office that DRAFTS for a scope: the League's Archons (either side) for the
// league; the party_archon of a party for that party.
export function draftScopeOffice(scope: AgendaScope): { office: string; side: string | null } {
  return scope === "league" ? { office: "archon", side: null } : { office: "party_archon", side: scope };
}
// The office that VETOES for a scope: the League's Ephors for the league; the
// party_ephor of a party for that party.
export function vetoScopeOffice(scope: AgendaScope): { office: string; side: string | null } {
  return scope === "league" ? { office: "ephor", side: null } : { office: "party_ephor", side: scope };
}

function holdsOffice(held: HeldOffice[], want: { office: string; side: string | null }): boolean {
  return held.some((h) => h.office === want.office && (want.side === null || h.side === want.side));
}

// Only a sitting Archon of the scope may draft a card to the chamber.
export function canDraft(held: HeldOffice[], scope: AgendaScope): boolean {
  return holdsOffice(held, draftScopeOffice(scope));
}

// A sitting Ephor of the scope may veto one card per term, but only while the
// card is still in DRAFTING (before it reaches the chamber).
export function canVeto(
  input: { held: HeldOffice[]; vetoesUsedThisTerm: number; phase: AgendaPhase },
  scope: AgendaScope,
  cfg: AgendaConfig,
): boolean {
  if (!holdsOffice(input.held, vetoScopeOffice(scope))) return false;
  if (input.phase !== "drafting") return false; // can't veto once it's at the chamber
  return input.vetoesUsedThisTerm < cfg.vetoesPerEphorPerTerm;
}

// --- Agenda cadence on the season clock (no backlog) ------------------------

export type AgendaPhase = "drafting" | "voting" | "resolved";

export function isAgendaYear(gameYear: number, scope: AgendaScope, cfg: AgendaConfig): boolean {
  const cadence = scope === "league" ? cfg.leagueCadenceGameYears : cfg.partyCadenceGameYears;
  return gameYear % cadence === 0;
}

export interface AgendaCycleSeasons {
  draftSeasonIndex: number; // drafting opens (officials choose / veto)
  voteSeasonIndex: number; // drafting closes, the chamber vote opens
  resolveSeasonIndex: number; // the chamber vote closes / resolves
}

export function agendaCycleSeasons(gameYear: number, scope: AgendaScope, cfg: AgendaConfig): AgendaCycleSeasons {
  const offset = scope === "league" ? 0 : cfg.partyCadenceSeasonOffset;
  const draft = gameYear * SEASONS_PER_YEAR + offset;
  return { draftSeasonIndex: draft, voteSeasonIndex: draft + 1, resolveSeasonIndex: draft + 2 };
}

// The agenda cycle LIVE at a point on the season clock, or null. Like the election
// sweep's currentElectionCycle: only reports a cycle whose window actually contains
// `now`, so a worker that boots mid/after a cycle never retro-fires it.
export function currentAgendaCycle(seasonIndex: number, scope: AgendaScope, cfg: AgendaConfig): { gameYear: number; phase: "drafting" | "voting" } | null {
  const here = Math.floor(seasonIndex / SEASONS_PER_YEAR);
  for (const gameYear of [here - 1, here]) {
    if (gameYear < 0 || !isAgendaYear(gameYear, scope, cfg)) continue;
    const seasons = agendaCycleSeasons(gameYear, scope, cfg);
    if (seasonIndex < seasons.draftSeasonIndex || seasonIndex >= seasons.resolveSeasonIndex) continue;
    return { gameYear, phase: seasonIndex < seasons.voteSeasonIndex ? "drafting" : "voting" };
  }
  return null;
}

// --- Card draw (pure, rng-injectable) ---------------------------------------

// Draw `count` distinct cards from the pool, preferring those not recently used.
export function drawAgendaCards(pool: AgendaCard[], recentIds: string[], count: number, rng: () => number = Math.random): AgendaCard[] {
  const recent = new Set(recentIds);
  let available = pool.filter((card) => !recent.has(card.id));
  if (available.length < count) available = [...pool];
  const arr = [...available];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr.slice(0, Math.min(count, arr.length));
}
