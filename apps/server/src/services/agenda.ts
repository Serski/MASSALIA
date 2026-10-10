import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import {
  accrueTreasuries,
  advanceAgendaCycles,
  closeDueChamberVotes,
  collectLeagueRevenue,
  completeLeagueProjects,
  createDb,
  ensurePartyLeaders,
  ensureTreasuries,
  getAgendaCycle,
  offices,
  openAgendaCycleIfDue,
  players,
  playerCharacters,
  recordEndorsement,
  setDraftedCard,
  setVeto,
  treasuryBalance,
  treasuryLedgerRows,
  vetoesUsedThisTerm,
  worlds,
  type AgendaPools,
  type TreasuryOwner,
} from "@massalia/db";
import {
  buildingEffects,
  canDraft,
  canVeto,
  currentAgendaCycle,
  festivalEffects,
  festivalMotion,
  formatGameDate,
  gameDate,
  MOTION_SCOPES,
  nextAgendaDocket,
  parseAgendaFile,
  parseCitiesContent,
  parseLeagueBuildings,
  parseLeagueFestivals,
  projectMotion,
  REAL_MS_PER_SEASON,
  treasuryOwnerOf,
  type AgendaCard,
  type AgendaScope,
  type CitiesContent,
  type HeldOffice,
  type LeagueBuilding,
  type LeagueFestival,
  type MotionScope,
} from "@massalia/shared";
import type { CharacterRow } from "./character.js";
import { getCalendarConfig } from "./festival.js";
import { getPoliticsConfig } from "./oligarchy.js";
import { broadcastState } from "./worldState.js";

const db = createDb();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

// --- Content (the three agenda pools, the League's buildings and poleis) ------

let pools: AgendaPools | null = null;
let leagueBuildings: LeagueBuilding[] | null = null;
let leagueCities: CitiesContent | null = null;
let leagueFestivals: LeagueFestival[] | null = null;

export async function loadAgendaContent(): Promise<AgendaPools> {
  const read = async (file: string) => parseAgendaFile(JSON.parse(await fs.readFile(path.join(repoRoot, "content/politics", file), "utf8")));
  pools = {
    league: await read("agenda-league.json"),
    palaioi: await read("agenda-palaioi.json"),
    dynatoi: await read("agenda-dynatoi.json"),
  };
  // The League's measures are building projects (government prompt 2a): the
  // buildings and the poleis they stand in. The League pool stays for the titles
  // of the cards passed before.
  leagueBuildings = parseLeagueBuildings(JSON.parse(await fs.readFile(path.join(repoRoot, "content/politics/league-buildings.json"), "utf8"))).buildings;
  leagueCities = parseCitiesContent(JSON.parse(await fs.readFile(path.join(repoRoot, "content/cities/cities.json"), "utf8")));
  // The festival motion's festivals (government prompt 3).
  leagueFestivals = parseLeagueFestivals(JSON.parse(await fs.readFile(path.join(repoRoot, "content/politics/league-festivals.json"), "utf8"))).festivals;
  return pools;
}

export function getLeagueFestivals(): LeagueFestival[] {
  if (!leagueFestivals) throw new Error("Agenda content not loaded — call loadAgendaContent() at boot.");
  return leagueFestivals;
}

export function getAgendaPools(): AgendaPools {
  if (!pools) throw new Error("Agenda content not loaded — call loadAgendaContent() at boot.");
  return pools;
}

export function getLeagueBuildings(): LeagueBuilding[] {
  if (!leagueBuildings) throw new Error("Agenda content not loaded — call loadAgendaContent() at boot.");
  return leagueBuildings;
}

export function getLeagueCities(): CitiesContent {
  if (!leagueCities) throw new Error("Agenda content not loaded — call loadAgendaContent() at boot.");
  return leagueCities;
}

// The title a League measure id shows: a project's, a festival's, or a League card's.
export function leagueMeasureTitle(id: string): string | undefined {
  return projectMotion(id, getLeagueBuildings(), getLeagueCities().cities)?.title ?? festivalMotion(id, getLeagueFestivals())?.title ?? getAgendaPools().league.find((c) => c.id === id)?.title;
}

// The four motions: the League's projects, the two parties' cards and the
// League's festival (government prompt 3).
const SCOPES: readonly MotionScope[] = MOTION_SCOPES;

// The scope a veto is recorded under: the festival motion shares the League's
// one veto per term (government prompt 3, ruling 3), so it writes to "league".
function vetoScopeOf(scope: MotionScope): AgendaScope {
  return treasuryOwnerOf(scope);
}

async function activeWorld(): Promise<{ id: string; startedMs: number } | null> {
  const rows = await db.select({ id: worlds.id, startedAt: worlds.startedAt }).from(worlds).where(eq(worlds.status, "active")).limit(1);
  return rows[0] ? { id: rows[0].id, startedMs: rows[0].startedAt.getTime() } : null;
}

export async function heldOffices(characterId: string): Promise<HeldOffice[]> {
  const rows = await db.select({ office: offices.office, side: offices.side }).from(offices).where(eq(offices.holderCharacterId, characterId));
  return rows.map((r) => ({ office: r.office, side: r.side }));
}

// --- The sync (worker sweep + lazy-on-read net) -----------------------------

// Accrue treasuries, keep the party leaders seeded, open due cycles, then close
// the chamber vote + resolve the cycle. Idempotent + season-correct. Broadcasts
// on change. Returns whether anything moved (for the sweep log).
export async function syncAgenda(now: Date = new Date()): Promise<{ accrued: boolean; opened: number; advanced: number; leaders: number }> {
  const world = await activeWorld();
  if (!world) return { accrued: false, opened: 0, advanced: 0, leaders: 0 };
  const cfg = getPoliticsConfig();
  await ensureTreasuries(world.id);

  const accrued = (await accrueTreasuries(cfg, now)) !== null;
  // The League's income (government prompt 1): the opening balance once, the
  // poleis' tax and the fee sweep once a season. Cheap when nothing is due.
  const revenue = await collectLeagueRevenue(cfg, now);
  const credited = revenue.opened + revenue.tax + revenue.dues + revenue.fees > 0;
  const leaders = (await ensurePartyLeaders(now)).filled.length;

  let opened = 0;
  for (const scope of SCOPES) {
    if (await openAgendaCycleIfDue(scope, cfg, getAgendaPools(), now)) opened++;
  }
  // Close any due chamber vote (agenda or flavor), THEN resolve agenda cycles so
  // the resolve reads a settled vote.
  await closeDueChamberVotes(cfg, now);
  const advance = await advanceAgendaCycles(getCalendarConfig(), cfg, getAgendaPools(), now);
  const advanced = advance.toVoting.length + advance.resolved.length;
  // A finished building stands (government prompt 2a).
  const built = (await completeLeagueProjects(now)).length;

  if (accrued || credited || opened || advanced || leaders || built) await broadcastState();
  return { accrued, opened, advanced, leaders };
}

// --- Draft / veto (officials) -----------------------------------------------

export type DraftResult = { ok: false; code: number; error: string } | { ok: true; scope: MotionScope; cardId: string };

export async function draftCard(actor: CharacterRow, scope: MotionScope, cardId: string, now: Date = new Date()): Promise<DraftResult> {
  await syncAgenda(now);
  const world = await activeWorld();
  if (!world) return { ok: false, code: 503, error: "No active world." };
  const cfg = getPoliticsConfig();

  if (!canDraft(await heldOffices(actor.id), scope)) {
    return { ok: false, code: 403, error: scope === "league" || scope === "festival" ? "Only a sitting Archon may set the league's agenda." : "Only the party Archon may set the party's agenda." };
  }
  const live = currentAgendaCycle(gameDate(now.getTime(), world.startedMs).seasonIndex, scope, cfg.agenda);
  if (!live || live.phase !== "drafting") return { ok: false, code: 409, error: "The agenda is not in drafting." };
  const cycle = await getAgendaCycle(world.id, scope, live.gameYear);
  if (!cycle) return { ok: false, code: 409, error: "No agenda cycle is open." };
  if (!cycle.cardIds.includes(cardId)) return { ok: false, code: 400, error: "That card is not on this cycle's docket." };
  if (cycle.vetoedCardId === cardId) return { ok: false, code: 409, error: "That card has been vetoed." };

  const ok = await setDraftedCard(cycle.id, cardId);
  if (!ok) return { ok: false, code: 409, error: "The agenda is no longer in drafting." };
  await broadcastState();
  return { ok: true, scope, cardId };
}

export type VetoResult = { ok: false; code: number; error: string } | { ok: true; scope: MotionScope };

export async function vetoCard(actor: CharacterRow, scope: MotionScope, now: Date = new Date()): Promise<VetoResult> {
  await syncAgenda(now);
  const world = await activeWorld();
  if (!world) return { ok: false, code: 503, error: "No active world." };
  const cfg = getPoliticsConfig();

  const live = currentAgendaCycle(gameDate(now.getTime(), world.startedMs).seasonIndex, scope, cfg.agenda);
  if (!live || live.phase !== "drafting") return { ok: false, code: 409, error: "There is nothing to veto." };
  const cycle = await getAgendaCycle(world.id, scope, live.gameYear);
  if (!cycle?.draftedCardId) return { ok: false, code: 409, error: "No card has been drafted to veto." };

  // The Ephor's term-started year scopes their one-per-term veto.
  const term = await ephorTermYear(world.id, actor.id, scope);
  if (term === null) return { ok: false, code: 403, error: "Only a sitting Ephor may veto." };
  const used = await vetoesUsedThisTerm(actor.id, vetoScopeOf(scope), term);
  if (!canVeto({ held: await heldOffices(actor.id), vetoesUsedThisTerm: used, phase: "drafting" }, scope, cfg.agenda)) {
    return { ok: false, code: 409, error: "You have no veto left this term." };
  }
  const ok = await setVeto(world.id, cycle.id, actor.id, vetoScopeOf(scope), term);
  if (!ok) return { ok: false, code: 409, error: "The veto could not be recorded." };
  await broadcastState();
  return { ok: true, scope };
}

// The Ephor seat (league ephor of either side, or the party_ephor) the actor
// holds for this scope, and its term-started year — or null if they hold none.
async function ephorTermYear(worldId: string, characterId: string, scope: MotionScope): Promise<number | null> {
  const league = scope === "league" || scope === "festival";
  const wantOffice = league ? "ephor" : "party_ephor";
  const rows = await db
    .select({ office: offices.office, side: offices.side, term: offices.termStartedYear })
    .from(offices)
    .where(and(eq(offices.worldId, worldId), eq(offices.holderCharacterId, characterId), eq(offices.office, wantOffice)));
  const seat = league ? rows[0] : rows.find((r) => r.side === scope);
  return seat ? seat.term ?? 0 : null;
}

// --- Endorsement (party leader during a league election) --------------------

export type EndorseResult = { ok: false; code: number; error: string } | { ok: true; endorseeCharacterId: string };

export async function endorse(actor: CharacterRow, electionId: string, endorseeCharacterId: string): Promise<EndorseResult> {
  const world = await activeWorld();
  if (!world) return { ok: false, code: 503, error: "No active world." };
  // The actor must be a party leader (party_archon / party_ephor) of a party.
  const held = await heldOffices(actor.id);
  const leader = held.find((h) => (h.office === "party_archon" || h.office === "party_ephor") && (h.side === "palaioi" || h.side === "dynatoi"));
  if (!leader || !leader.side) return { ok: false, code: 403, error: "Only a party leader may endorse." };
  const target = (await db.select({ id: playerCharacters.id }).from(playerCharacters).where(eq(playerCharacters.id, endorseeCharacterId)).limit(1))[0];
  if (!target) return { ok: false, code: 404, error: "No such candidate." };
  await recordEndorsement(world.id, electionId, actor.id, leader.side as "palaioi" | "dynatoi", endorseeCharacterId);
  await broadcastState();
  return { ok: true, endorseeCharacterId };
}

// --- Views ------------------------------------------------------------------

export interface TreasuryView {
  owner: TreasuryOwner;
  balance: number;
  ledger: { delta: number; reason: string; createdAt: string }[];
}

async function treasuryView(worldId: string, owner: TreasuryOwner): Promise<TreasuryView> {
  return { owner, balance: await treasuryBalance(worldId, owner), ledger: (await treasuryLedgerRows(worldId, owner)).map((l) => ({ delta: l.delta, reason: l.reason, createdAt: l.createdAt })) };
}

export interface AgendaCardView {
  id: string;
  title: string;
  description: string;
  cost: number;
  partyLean: string;
  // A building project's polis and build time (government prompt 2a); absent on a card.
  group?: string;
  seasons?: number;
  // What the project does when it stands, one line per effect (government prompt 2b); absent on a card.
  effects?: string[];
}

export interface AgendaScopeView {
  scope: MotionScope;
  phase: "drafting" | "voting" | "resolved" | null;
  gameYear: number | null;
  cards: AgendaCardView[];
  draftedCardId: string | null;
  vetoedCardId: string | null;
  treasury: TreasuryView;
  youMayDraft: boolean;
  youMayVeto: boolean;
  // The game date the scope's next docket opens, or the open one's (government
  // prompt 3b); null with no world.
  nextOpensLabel: string | null;
}

function cardViews(pool: AgendaCard[], ids: string[]): AgendaCardView[] {
  return ids.map((id) => pool.find((c) => c.id === id)).filter((c): c is AgendaCard => !!c).map((c) => ({ id: c.id, title: c.title, description: c.description, cost: c.cost, partyLean: c.partyLean }));
}

// The League's docket: a project id resolves to its motion with the polis and
// the build time; any other id (a League card from before) from the pool as now.
function leagueCardViews(ids: string[]): AgendaCardView[] {
  const buildings = getLeagueBuildings();
  const cities = getLeagueCities().cities;
  const pool = getAgendaPools().league;
  const out: AgendaCardView[] = [];
  for (const id of ids) {
    const motion = projectMotion(id, buildings, cities);
    if (motion) {
      const building = buildings.find((b) => b.id === motion.buildingId)!;
      out.push({ id: motion.id, title: motion.title, description: motion.description, cost: motion.cost, partyLean: motion.partyLean, group: motion.polis, seasons: motion.seasons, effects: buildingEffects(building, motion.polis) });
      continue;
    }
    out.push(...cardViews(pool, [id]));
  }
  return out;
}

// The festival docket (government prompt 3): each id resolves to its motion
// with what the festival does when held.
function festivalCardViews(ids: string[]): AgendaCardView[] {
  const festivals = getLeagueFestivals();
  const out: AgendaCardView[] = [];
  for (const id of ids) {
    const m = festivalMotion(id, festivals);
    if (!m) continue;
    const festival = festivals.find((f) => f.id === m.festivalId)!;
    out.push({ id: m.id, title: m.title, description: m.description, cost: m.cost, partyLean: m.partyLean, effects: festivalEffects(festival) });
  }
  return out;
}

// The League scope as everyone outside the Government sees it (government
// prompt 1): the treasury's balance without its ledger, no draft or veto power,
// and of the docket only the card going to the vote — the drafted card while
// voting, when it is not the vetoed card. After a veto an Archon may draft
// another card and that one goes to the vote, so the test is
// `draftedCardId !== vetoedCardId`, not `vetoedCardId === null`. While drafting
// the cards are empty here; the docket itself is public on the Cities tab
// (government prompt 3b), but what is drafted and vetoed is not.
export function publicLeagueView(view: AgendaScopeView): AgendaScopeView {
  const toVote = view.phase === "voting" && view.draftedCardId && view.draftedCardId !== view.vetoedCardId ? view.draftedCardId : null;
  return {
    ...view,
    cards: toVote ? view.cards.filter((c) => c.id === toVote) : [],
    draftedCardId: toVote,
    vetoedCardId: null,
    treasury: { ...view.treasury, ledger: [] },
    youMayDraft: false,
    youMayVeto: false,
  };
}

export async function agendaScopeView(actor: CharacterRow, scope: MotionScope, now: Date = new Date()): Promise<AgendaScopeView> {
  await syncAgenda(now);
  const world = await activeWorld();
  const cfg = getPoliticsConfig();
  const owner: TreasuryOwner = treasuryOwnerOf(scope);
  if (!world) return { scope, phase: null, gameYear: null, cards: [], draftedCardId: null, vetoedCardId: null, treasury: { owner, balance: 0, ledger: [] }, youMayDraft: false, youMayVeto: false, nextOpensLabel: null };

  const live = currentAgendaCycle(gameDate(now.getTime(), world.startedMs).seasonIndex, scope, cfg.agenda);
  const cycle = live ? await getAgendaCycle(world.id, scope, live.gameYear) : null;
  const held = await heldOffices(actor.id);
  let youMayVeto = false;
  if (cycle?.phase === "drafting" && cycle.draftedCardId) {
    const term = await ephorTermYear(world.id, actor.id, scope);
    if (term !== null) youMayVeto = canVeto({ held, vetoesUsedThisTerm: await vetoesUsedThisTerm(actor.id, scope, term), phase: "drafting" }, scope, cfg.agenda);
  }
  return {
    scope,
    phase: (cycle?.phase as AgendaScopeView["phase"]) ?? null,
    gameYear: cycle?.gameYear ?? null,
    cards: !cycle ? [] : scope === "league" ? leagueCardViews(cycle.cardIds) : scope === "festival" ? festivalCardViews(cycle.cardIds) : cardViews(getAgendaPools()[scope], cycle.cardIds),
    draftedCardId: cycle?.draftedCardId ?? null,
    vetoedCardId: cycle?.vetoedCardId ?? null,
    treasury: await treasuryView(world.id, owner),
    youMayDraft: cycle?.phase === "drafting" && canDraft(held, scope),
    youMayVeto,
    nextOpensLabel: formatGameDate(gameDate(world.startedMs + nextAgendaDocket(gameDate(now.getTime(), world.startedMs).seasonIndex, scope, cfg.agenda).draftSeasonIndex * REAL_MS_PER_SEASON, world.startedMs)),
  };
}

export interface PartyLeaderView {
  office: "party_archon" | "party_ephor";
  party: "palaioi" | "dynatoi";
  holder: { characterId: string; name: string } | null;
  youHold: boolean;
}

export async function partyLeadersView(actor: CharacterRow): Promise<PartyLeaderView[]> {
  const world = await activeWorld();
  if (!world) return [];
  const rows = await db
    .select({ office: offices.office, side: offices.side, holder: offices.holderCharacterId })
    .from(offices)
    .where(and(eq(offices.worldId, world.id)));
  const out: PartyLeaderView[] = [];
  for (const office of ["party_archon", "party_ephor"] as const) {
    for (const party of ["palaioi", "dynatoi"] as const) {
      const seat = rows.find((r) => r.office === office && r.side === party);
      let holder: PartyLeaderView["holder"] = null;
      if (seat?.holder) {
        const nm = (
          await db
            .select({ name: players.name })
            .from(playerCharacters)
            .innerJoin(players, eq(players.id, playerCharacters.playerId))
            .where(eq(playerCharacters.id, seat.holder))
            .limit(1)
        )[0];
        holder = { characterId: seat.holder, name: nm?.name ?? "—" };
      }
      out.push({ office, party, holder, youHold: seat?.holder === actor.id });
    }
  }
  return out;
}
