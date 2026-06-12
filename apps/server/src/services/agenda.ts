import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import {
  accrueTreasuries,
  advanceAgendaCycles,
  closeDueChamberVotes,
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
  canDraft,
  canVeto,
  currentAgendaCycle,
  gameDate,
  parseAgendaFile,
  type AgendaCard,
  type AgendaScope,
  type HeldOffice,
} from "@massalia/shared";
import type { CharacterRow } from "./character.js";
import { getCalendarConfig } from "./festival.js";
import { getPoliticsConfig } from "./oligarchy.js";
import { broadcastState } from "./worldState.js";

const db = createDb();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

// --- Content (the three agenda pools) ---------------------------------------

let pools: AgendaPools | null = null;

export async function loadAgendaContent(): Promise<AgendaPools> {
  const read = async (file: string) => parseAgendaFile(JSON.parse(await fs.readFile(path.join(repoRoot, "content/politics", file), "utf8")));
  pools = {
    league: await read("agenda-league.json"),
    palaioi: await read("agenda-palaioi.json"),
    dynatoi: await read("agenda-dynatoi.json"),
  };
  return pools;
}

export function getAgendaPools(): AgendaPools {
  if (!pools) throw new Error("Agenda content not loaded — call loadAgendaContent() at boot.");
  return pools;
}

const SCOPES: AgendaScope[] = ["league", "palaioi", "dynatoi"];

async function activeWorld(): Promise<{ id: string; startedMs: number } | null> {
  const rows = await db.select({ id: worlds.id, startedAt: worlds.startedAt }).from(worlds).where(eq(worlds.status, "active")).limit(1);
  return rows[0] ? { id: rows[0].id, startedMs: rows[0].startedAt.getTime() } : null;
}

async function heldOffices(characterId: string): Promise<HeldOffice[]> {
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

  if (accrued || opened || advanced || leaders) await broadcastState();
  return { accrued, opened, advanced, leaders };
}

// --- Draft / veto (officials) -----------------------------------------------

export type DraftResult = { ok: false; code: number; error: string } | { ok: true; scope: AgendaScope; cardId: string };

export async function draftCard(actor: CharacterRow, scope: AgendaScope, cardId: string, now: Date = new Date()): Promise<DraftResult> {
  await syncAgenda(now);
  const world = await activeWorld();
  if (!world) return { ok: false, code: 503, error: "No active world." };
  const cfg = getPoliticsConfig();

  if (!canDraft(await heldOffices(actor.id), scope)) {
    return { ok: false, code: 403, error: scope === "league" ? "Only a sitting Archon may set the league's agenda." : "Only the party Archon may set the party's agenda." };
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

export type VetoResult = { ok: false; code: number; error: string } | { ok: true; scope: AgendaScope };

export async function vetoCard(actor: CharacterRow, scope: AgendaScope, now: Date = new Date()): Promise<VetoResult> {
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
  const used = await vetoesUsedThisTerm(actor.id, scope, term);
  if (!canVeto({ held: await heldOffices(actor.id), vetoesUsedThisTerm: used, phase: "drafting" }, scope, cfg.agenda)) {
    return { ok: false, code: 409, error: "You have no veto left this term." };
  }
  const ok = await setVeto(world.id, cycle.id, actor.id, scope, term);
  if (!ok) return { ok: false, code: 409, error: "The veto could not be recorded." };
  await broadcastState();
  return { ok: true, scope };
}

// The Ephor seat (league ephor of either side, or the party_ephor) the actor
// holds for this scope, and its term-started year — or null if they hold none.
async function ephorTermYear(worldId: string, characterId: string, scope: AgendaScope): Promise<number | null> {
  const wantOffice = scope === "league" ? "ephor" : "party_ephor";
  const rows = await db
    .select({ office: offices.office, side: offices.side, term: offices.termStartedYear })
    .from(offices)
    .where(and(eq(offices.worldId, worldId), eq(offices.holderCharacterId, characterId), eq(offices.office, wantOffice)));
  const seat = scope === "league" ? rows[0] : rows.find((r) => r.side === scope);
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
}

export interface AgendaScopeView {
  scope: AgendaScope;
  phase: "drafting" | "voting" | "resolved" | null;
  gameYear: number | null;
  cards: AgendaCardView[];
  draftedCardId: string | null;
  vetoedCardId: string | null;
  treasury: TreasuryView;
  youMayDraft: boolean;
  youMayVeto: boolean;
}

function cardViews(pool: AgendaCard[], ids: string[]): AgendaCardView[] {
  return ids.map((id) => pool.find((c) => c.id === id)).filter((c): c is AgendaCard => !!c).map((c) => ({ id: c.id, title: c.title, description: c.description, cost: c.cost, partyLean: c.partyLean }));
}

export async function agendaScopeView(actor: CharacterRow, scope: AgendaScope, now: Date = new Date()): Promise<AgendaScopeView> {
  await syncAgenda(now);
  const world = await activeWorld();
  const cfg = getPoliticsConfig();
  const owner: TreasuryOwner = scope;
  if (!world) return { scope, phase: null, gameYear: null, cards: [], draftedCardId: null, vetoedCardId: null, treasury: { owner, balance: 0, ledger: [] }, youMayDraft: false, youMayVeto: false };

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
    cards: cycle ? cardViews(getAgendaPools()[scope], cycle.cardIds) : [],
    draftedCardId: cycle?.draftedCardId ?? null,
    vetoedCardId: cycle?.vetoedCardId ?? null,
    treasury: await treasuryView(world.id, owner),
    youMayDraft: cycle?.phase === "drafting" && canDraft(held, scope),
    youMayVeto,
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
