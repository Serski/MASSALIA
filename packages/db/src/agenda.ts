import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  agendaCycleSeasons,
  canAfford,
  cardLeans,
  currentAgendaCycle,
  drawAgendaCards,
  dues,
  festivalDonationCut,
  gameDate,
  questionForYear,
  REAL_MS_PER_SEASON,
  seatPurchaseCut,
  tallyBallot,
  type AgendaCard,
  type AgendaScope,
  type BallotCandidate,
  type BallotVote,
  type CalendarConfig,
  type PoliticsConfig,
} from "@massalia/shared";
import { createDb } from "./client.js";
import {
  agendaCycles,
  chamberVotes,
  effectLog,
  ephorVetoes,
  offices,
  oligarchSeats,
  partyEndorsements,
  partyFavor,
  players,
  playerCharacters,
  treasuries,
  treasuryLedger,
  worlds,
} from "./schema.js";

const db = createDb();

// ---------------------------------------------------------------------------
// The Agenda & the Three Governments (Politics Prompt 3), DB lifecycle. Treasury
// + accrual, the league & party agenda cycles (drafting → chamber vote →
// resolve, reusing the chamber tally), party leadership (for-life, filled by an
// internal favor-weighted ballot on death), and endorsements. Idempotent and
// season-correct (no boot backlog) like the festival/election sweeps.
// ---------------------------------------------------------------------------

export type TreasuryOwner = "league" | "palaioi" | "dynatoi";
const PARTIES = ["palaioi", "dynatoi"] as const;
type Party = (typeof PARTIES)[number];

async function activeWorld(): Promise<{ id: string; startedMs: number } | null> {
  const rows = await db.select({ id: worlds.id, startedAt: worlds.startedAt }).from(worlds).where(eq(worlds.status, "active")).limit(1);
  return rows[0] ? { id: rows[0].id, startedMs: rows[0].startedAt.getTime() } : null;
}

// --- Treasury -----------------------------------------------------------------

export async function ensureTreasuries(worldId: string): Promise<void> {
  await db
    .insert(treasuries)
    .values((["league", "palaioi", "dynatoi"] as TreasuryOwner[]).map((owner) => ({ worldId, owner })))
    .onConflictDoNothing();
}

export async function treasuryBalance(worldId: string, owner: TreasuryOwner): Promise<number> {
  const rows = await db.select({ balance: treasuries.balance }).from(treasuries).where(and(eq(treasuries.worldId, worldId), eq(treasuries.owner, owner))).limit(1);
  return rows[0]?.balance ?? 0;
}

// Move money and write the audit-trail row in one go. delta may be negative (a
// spend). Never drives a balance below 0 (the caller gates spends with canAfford).
export async function creditTreasury(worldId: string, owner: TreasuryOwner, delta: number, reason: string, now: Date = new Date()): Promise<number> {
  if (delta === 0) return treasuryBalance(worldId, owner);
  await ensureTreasuries(worldId);
  const updated = await db
    .update(treasuries)
    .set({ balance: sql`GREATEST(0, ${treasuries.balance} + ${delta})`, updatedAt: now })
    .where(and(eq(treasuries.worldId, worldId), eq(treasuries.owner, owner)))
    .returning({ balance: treasuries.balance });
  await db.insert(treasuryLedger).values({ worldId, owner, delta, reason });
  return updated[0]?.balance ?? 0;
}

export interface LedgerEntry {
  owner: string;
  delta: number;
  reason: string;
  createdAt: string;
}

export async function treasuryLedgerRows(worldId: string, owner: TreasuryOwner, limit = 20): Promise<LedgerEntry[]> {
  const rows = await db
    .select({ owner: treasuryLedger.owner, delta: treasuryLedger.delta, reason: treasuryLedger.reason, createdAt: treasuryLedger.createdAt })
    .from(treasuryLedger)
    .where(and(eq(treasuryLedger.worldId, worldId), eq(treasuryLedger.owner, owner)))
    .orderBy(desc(treasuryLedger.createdAt))
    .limit(limit);
  return rows.map((r) => ({ owner: r.owner, delta: r.delta, reason: r.reason, createdAt: r.createdAt.toISOString() }));
}

async function livingPartyMemberCount(worldId: string, party: Party): Promise<number> {
  const rows = await db
    .select({ id: playerCharacters.id })
    .from(playerCharacters)
    .innerJoin(players, eq(players.id, playerCharacters.playerId))
    .where(and(eq(playerCharacters.worldId, worldId), eq(playerCharacters.party, party), eq(playerCharacters.status, "alive"), eq(players.isActive, true)));
  return rows.length;
}

// Accrue the league levy + party dues for the CURRENT season, once. Idempotent
// (a ledger reason carries the season index) and no-backlog (only the current
// season is ever credited). Returns what was accrued, or null if already done.
export async function accrueTreasuries(cfg: PoliticsConfig, now: Date = new Date()): Promise<{ levy: number; dues: Record<Party, number> } | null> {
  const world = await activeWorld();
  if (!world) return null;
  await ensureTreasuries(world.id);
  const season = gameDate(now.getTime(), world.startedMs).seasonIndex;
  const reason = `levy:s${season}`;
  const existing = await db
    .select({ id: treasuryLedger.id })
    .from(treasuryLedger)
    .where(and(eq(treasuryLedger.worldId, world.id), eq(treasuryLedger.owner, "league"), eq(treasuryLedger.reason, reason)))
    .limit(1);
  if (existing.length) return null; // this season's accrual already ran

  await creditTreasury(world.id, "league", cfg.treasury.leviedPerSeason, reason, now);
  const duesByParty = {} as Record<Party, number>;
  for (const party of PARTIES) {
    const members = await livingPartyMemberCount(world.id, party);
    const amount = dues(members, cfg.partyDues);
    duesByParty[party] = amount;
    if (amount > 0) await creditTreasury(world.id, party, amount, `dues:s${season}:${members}members`, now);
  }
  return { levy: cfg.treasury.leviedPerSeason, dues: duesByParty };
}

// Hooks at the existing transactions: a cut of a seat purchase / festival donation
// goes to the LEAGUE treasury. Called by the server when those happen.
export async function creditSeatPurchaseCut(worldId: string, price: number, cfg: PoliticsConfig, now: Date = new Date()): Promise<number> {
  return creditTreasury(worldId, "league", seatPurchaseCut(price, cfg.treasury), "cut:seat_purchase", now);
}
export async function creditFestivalDonationCut(worldId: string, amount: number, cfg: PoliticsConfig, now: Date = new Date()): Promise<number> {
  return creditTreasury(worldId, "league", festivalDonationCut(amount, cfg.treasury), "cut:festival_donation", now);
}

// --- Party leadership (for-life; internal ballot fills a vacancy) ------------

const LEADER_OFFICES = ["party_archon", "party_ephor"] as const;
type LeaderOffice = (typeof LEADER_OFFICES)[number];

async function leaderHolder(worldId: string, office: LeaderOffice, party: Party): Promise<string | null> {
  const rows = await db
    .select({ holder: offices.holderCharacterId })
    .from(offices)
    .where(and(eq(offices.worldId, worldId), eq(offices.office, office), eq(offices.side, party), eq(offices.seatSlot, 0)))
    .limit(1);
  return rows[0]?.holder ?? null;
}

async function installLeader(worldId: string, office: LeaderOffice, party: Party, characterId: string, now: Date): Promise<void> {
  const year = gameDate(now.getTime(), (await activeWorld())!.startedMs).yearInGame;
  await db
    .insert(offices)
    .values({ worldId, office, side: party, seatSlot: 0, holderCharacterId: characterId, independentHolder: false, acquiredVia: "interim", termStartedYear: year, termEndsYear: null })
    .onConflictDoUpdate({
      target: [offices.worldId, offices.office, offices.side, offices.seatSlot],
      set: { holderCharacterId: characterId, acquiredVia: "interim", termStartedYear: year, termEndsYear: null },
    });
}

// Ensure each party's two leadership seats are filled by a living member; fill a
// vacancy (or a dead holder's seat) via the internal ballot. Idempotent.
export async function ensurePartyLeaders(now: Date = new Date()): Promise<{ filled: { office: LeaderOffice; party: Party; characterId: string }[] }> {
  const world = await activeWorld();
  if (!world) return { filled: [] };
  const filled: { office: LeaderOffice; party: Party; characterId: string }[] = [];

  for (const party of PARTIES) {
    // Determine who currently holds the two seats (and whether they're alive).
    const taken = new Set<string>();
    for (const office of LEADER_OFFICES) {
      const holderId = await leaderHolder(world.id, office, party);
      const alive = holderId ? (await db.select({ s: playerCharacters.status }).from(playerCharacters).where(eq(playerCharacters.id, holderId)).limit(1))[0]?.s === "alive" : false;
      if (holderId && alive) {
        taken.add(holderId);
        continue;
      }
      if (holderId && !alive) await db.update(offices).set({ holderCharacterId: null }).where(and(eq(offices.worldId, world.id), eq(offices.office, office), eq(offices.side, party), eq(offices.seatSlot, 0)));
      // Fill via the internal favor-weighted ballot, excluding whoever already
      // holds the other seat (so one member can't take both leadership seats).
      const winner = await internalPartyBallotPool(world.id, party, [...taken]);
      if (winner) {
        await installLeader(world.id, office, party, winner, now);
        taken.add(winner);
        filled.push({ office, party, characterId: winner });
      }
    }
  }
  return { filled };
}

// internalPartyBallot, but excluding a set (so one member doesn't take both seats).
async function internalPartyBallotPool(worldId: string, party: Party, exclude: string[]): Promise<string | null> {
  const members = await db
    .select({ id: playerCharacters.id, prestige: playerCharacters.prestige, createdAt: playerCharacters.createdAt, favor: partyFavor.favor })
    .from(playerCharacters)
    .innerJoin(players, eq(players.id, playerCharacters.playerId))
    .innerJoin(oligarchSeats, eq(oligarchSeats.characterId, playerCharacters.id))
    .leftJoin(partyFavor, and(eq(partyFavor.characterId, playerCharacters.id), eq(partyFavor.party, party)))
    .where(and(eq(playerCharacters.worldId, worldId), eq(playerCharacters.party, party), eq(playerCharacters.status, "alive"), eq(players.isActive, true)));
  const ex = new Set(exclude);
  const eligible = members.filter((m) => !ex.has(m.id));
  if (eligible.length === 0) return null;
  const candidates: BallotCandidate[] = eligible.map((m) => ({ characterId: m.id, prestige: m.prestige, nominatedAt: m.createdAt.getTime() }));
  const votes: BallotVote[] = [];
  for (const m of eligible) for (let i = 0; i < Math.max(0, m.favor ?? 0); i++) votes.push({ voterCharacterId: `${m.id}:${i}`, candidateCharacterId: m.id });
  return tallyBallot(candidates, votes, 1).winners[0] ?? null;
}

// Characters barred from LEAGUE office: anyone holding a party_archon / party_ephor.
export async function partyLeaderCharacterIds(worldId: string): Promise<Set<string>> {
  const rows = await db
    .select({ holder: offices.holderCharacterId })
    .from(offices)
    .where(and(eq(offices.worldId, worldId), inArray(offices.office, ["party_archon", "party_ephor"])));
  return new Set(rows.map((r) => r.holder).filter((h): h is string => !!h));
}

// --- Endorsement (party leader shifts swing weight to an endorsee) -----------

export async function recordEndorsement(worldId: string, electionId: string, endorserCharacterId: string, party: Party, endorseeCharacterId: string): Promise<void> {
  await db
    .insert(partyEndorsements)
    .values({ worldId, electionId, endorserCharacterId, party, endorseeCharacterId })
    .onConflictDoUpdate({ target: [partyEndorsements.electionId, partyEndorsements.endorserCharacterId], set: { endorseeCharacterId, party } });
}

// The endorsement swing votes to fold into a candidate's election sway: each
// endorsement of a candidate adds cfg.endorsement.swingVotes to their total.
export async function endorsementSwayByCandidate(electionId: string, cfg: PoliticsConfig): Promise<Record<string, number>> {
  const rows = await db.select({ endorsee: partyEndorsements.endorseeCharacterId }).from(partyEndorsements).where(eq(partyEndorsements.electionId, electionId));
  const out: Record<string, number> = {};
  for (const r of rows) out[r.endorsee] = (out[r.endorsee] ?? 0) + cfg.endorsement.swingVotes;
  return out;
}

// --- Agenda cycles ----------------------------------------------------------

type AgendaCycleRow = typeof agendaCycles.$inferSelect;
export type AgendaPools = Record<AgendaScope, AgendaCard[]>;


export async function getAgendaCycle(worldId: string, scope: AgendaScope, gameYear: number): Promise<AgendaCycleRow | null> {
  const rows = await db.select().from(agendaCycles).where(and(eq(agendaCycles.worldId, worldId), eq(agendaCycles.scope, scope), eq(agendaCycles.gameYear, gameYear))).limit(1);
  return rows[0] ?? null;
}

async function recentDraftedIds(worldId: string, scope: AgendaScope, limit = 4): Promise<string[]> {
  const rows = await db
    .select({ drafted: agendaCycles.draftedCardId })
    .from(agendaCycles)
    .where(and(eq(agendaCycles.worldId, worldId), eq(agendaCycles.scope, scope)))
    .orderBy(desc(agendaCycles.gameYear))
    .limit(limit);
  return rows.map((r) => r.drafted).filter((d): d is string => !!d);
}

// Open the drafting cycle for a scope when its declaration window is live (and not
// already opened). Draws this cycle's cards. No backlog: currentAgendaCycle only
// reports a window that contains `now`.
export async function openAgendaCycleIfDue(scope: AgendaScope, cfg: PoliticsConfig, pools: AgendaPools, now: Date = new Date()): Promise<AgendaCycleRow | null> {
  const world = await activeWorld();
  if (!world) return null;
  const live = currentAgendaCycle(gameDate(now.getTime(), world.startedMs).seasonIndex, scope, cfg.agenda);
  if (!live || live.phase !== "drafting") return getAgendaCycle(world.id, scope, live?.gameYear ?? -1);

  const existing = await getAgendaCycle(world.id, scope, live.gameYear);
  if (existing) return existing;

  const seasons = agendaCycleSeasons(live.gameYear, scope, cfg.agenda);
  const startedMs = world.startedMs;
  const cards = drawAgendaCards(pools[scope], await recentDraftedIds(world.id, scope), cfg.agenda.leagueCardsPerCycle);
  const inserted = await db
    .insert(agendaCycles)
    .values({
      worldId: world.id,
      scope,
      gameYear: live.gameYear,
      phase: "drafting",
      cardIds: cards.map((c) => c.id),
      opensAt: new Date(startedMs + seasons.draftSeasonIndex * REAL_MS_PER_SEASON),
      votingEndsAt: new Date(startedMs + seasons.resolveSeasonIndex * REAL_MS_PER_SEASON),
    })
    .onConflictDoNothing()
    .returning();
  return inserted[0] ?? (await getAgendaCycle(world.id, scope, live.gameYear));
}

// Draft a card (server validates the actor is a sitting Archon of the scope and
// the cycle is drafting). Records who, for the chamber vote step.
export async function setDraftedCard(cycleId: string, cardId: string): Promise<boolean> {
  const updated = await db
    .update(agendaCycles)
    .set({ draftedCardId: cardId })
    .where(and(eq(agendaCycles.id, cycleId), eq(agendaCycles.phase, "drafting")))
    .returning({ id: agendaCycles.id });
  return updated.length > 0;
}

// Veto the drafted card (server validates the Ephor + their remaining veto). Marks
// the cycle's drafted card vetoed and records the per-term veto.
export async function setVeto(worldId: string, cycleId: string, ephorCharacterId: string, scope: AgendaScope, termStartedYear: number): Promise<boolean> {
  const cycle = (await db.select().from(agendaCycles).where(eq(agendaCycles.id, cycleId)).limit(1))[0];
  if (!cycle || cycle.phase !== "drafting" || !cycle.draftedCardId) return false;
  const recorded = await db
    .insert(ephorVetoes)
    .values({ worldId, ephorCharacterId, scope, officeTermStartedYear: termStartedYear, agendaCycleId: cycleId })
    .onConflictDoNothing()
    .returning({ id: ephorVetoes.id });
  if (!recorded.length) return false; // already used a veto this term
  await db.update(agendaCycles).set({ vetoedCardId: cycle.draftedCardId, vetoedByCharacterId: ephorCharacterId }).where(eq(agendaCycles.id, cycleId));
  return true;
}

export async function vetoesUsedThisTerm(ephorCharacterId: string, scope: AgendaScope, termStartedYear: number): Promise<number> {
  const rows = await db
    .select({ id: ephorVetoes.id })
    .from(ephorVetoes)
    .where(and(eq(ephorVetoes.ephorCharacterId, ephorCharacterId), eq(ephorVetoes.scope, scope), eq(ephorVetoes.officeTermStartedYear, termStartedYear)));
  return rows.length;
}

export interface AgendaResolution {
  scope: AgendaScope;
  gameYear: number;
  cardId: string | null;
  passed: boolean;
  applied: boolean; // false when the treasury couldn't afford the cost
  spent: number;
}

export interface AgendaAdvance {
  toVoting: { scope: AgendaScope; cardId: string | null }[];
  resolved: AgendaResolution[];
}

// Advance every non-resolved agenda cycle against the clock. drafting → voting
// opens the chamber vote (the drafted, un-vetoed card, or a league flavor
// fallback); voting → resolved reads the closed vote and applies the effect +
// treasury spend on pass. Idempotent (phase-guarded).
export async function advanceAgendaCycles(calendarCfg: CalendarConfig, cfg: PoliticsConfig, pools: AgendaPools, now: Date = new Date()): Promise<AgendaAdvance> {
  void calendarCfg;
  const out: AgendaAdvance = { toVoting: [], resolved: [] };
  const world = await activeWorld();
  if (!world) return out;
  const SEASON = REAL_MS_PER_SEASON;
  const rows = await db.select().from(agendaCycles).where(and(eq(agendaCycles.worldId, world.id), sql`${agendaCycles.phase} <> 'resolved'`));

  for (const cycle of rows) {
    const scope = cycle.scope as AgendaScope;
    const seasons = agendaCycleSeasons(cycle.gameYear, scope, cfg.agenda);
    const voteOpensMs = world.startedMs + seasons.voteSeasonIndex * SEASON;
    const resolveMs = world.startedMs + seasons.resolveSeasonIndex * SEASON;

    // drafting → voting: open the chamber vote.
    if (cycle.phase === "drafting" && now.getTime() >= voteOpensMs) {
      const drafted = cycle.draftedCardId && cycle.draftedCardId !== cycle.vetoedCardId ? cycle.draftedCardId : null;
      const card = drafted ? pools[scope].find((c) => c.id === drafted) ?? null : null;
      const closesAt = new Date(world.startedMs + seasons.resolveSeasonIndex * SEASON);
      if (card) {
        await db
          .insert(chamberVotes)
          .values({ worldId: world.id, scope, gameYear: cycle.gameYear, title: card.title, description: card.description, agendaCardId: card.id, leans: cardLeans(card), opensAt: now, closesAt, status: "open" })
          .onConflictDoNothing();
      } else if (scope === "league") {
        // No drafted card (none chosen or vetoed) → the chamber still meets on the
        // year's flavor question (Prompt 1), so the league is never idle.
        const q = questionForYear(cfg.chamber, cycle.gameYear);
        await db
          .insert(chamberVotes)
          .values({ worldId: world.id, scope: "league", gameYear: cycle.gameYear, title: q.title, description: q.description, opensAt: now, closesAt, status: "open" })
          .onConflictDoNothing();
      }
      await db.update(agendaCycles).set({ phase: "voting" }).where(and(eq(agendaCycles.id, cycle.id), eq(agendaCycles.phase, "drafting")));
      out.toVoting.push({ scope, cardId: card?.id ?? null });
      cycle.phase = "voting";
    }

    // voting → resolved: the chamber vote has closed (closeDueChamberVotes runs
    // first in the sweep); apply the effect + spend on a passed agenda card.
    if (cycle.phase === "voting" && now.getTime() >= resolveMs) {
      const vote = (await db.select().from(chamberVotes).where(and(eq(chamberVotes.worldId, world.id), eq(chamberVotes.scope, scope), eq(chamberVotes.gameYear, cycle.gameYear))).limit(1))[0];
      let resolution: AgendaResolution = { scope, gameYear: cycle.gameYear, cardId: cycle.draftedCardId, passed: false, applied: false, spent: 0 };
      if (vote && vote.agendaCardId && vote.status !== "open") {
        const card = pools[scope].find((c) => c.id === vote.agendaCardId);
        const passed = vote.status === "passed";
        resolution = { scope, gameYear: cycle.gameYear, cardId: vote.agendaCardId, passed, applied: false, spent: 0 };
        if (card && passed) {
          const owner: TreasuryOwner = scope;
          const balance = await treasuryBalance(world.id, owner);
          if (canAfford(balance, card.cost)) {
            if (card.cost > 0) await creditTreasury(world.id, owner, -card.cost, `agenda:${card.id}`, now);
            await applyAgendaEffect(world.id, scope, null, card, now);
            resolution.applied = true;
            resolution.spent = card.cost;
          }
          // else: passed but the treasury can't afford it → the card fails (no spend, no effect).
        }
      }
      await db.update(agendaCycles).set({ phase: "resolved" }).where(and(eq(agendaCycles.id, cycle.id), eq(agendaCycles.phase, "voting")));
      out.resolved.push(resolution);
    }
  }
  return out;
}

// Apply a card's (light, representational) effect.
async function applyAgendaEffect(worldId: string, scope: AgendaScope, drafterId: string | null, card: AgendaCard, now: Date): Promise<void> {
  const effect = card.effect;
  if (effect.type === "flavor") return;

  if (effect.type === "treasury_grant") {
    const beneficiaries =
      effect.beneficiary === "drafter" && drafterId
        ? [drafterId]
        : await officialHolderIds(worldId, scope);
    for (const id of beneficiaries) {
      await db.update(playerCharacters).set({ drachmae: sql`${playerCharacters.drachmae} + ${effect.amount}` }).where(eq(playerCharacters.id, id));
      await db.insert(effectLog).values({ characterId: id, kind: "agenda_grant", detail: { card: card.id, amount: effect.amount } });
    }
    return;
  }

  if (effect.type === "league_stat") {
    // A light league-wide nudge to all living seat-holders (clamped to [0,100]).
    const holders = await db
      .select({ id: oligarchSeats.characterId })
      .from(oligarchSeats)
      .innerJoin(playerCharacters, eq(playerCharacters.id, oligarchSeats.characterId))
      .where(and(eq(oligarchSeats.worldId, worldId), eq(oligarchSeats.holderType, "player"), eq(playerCharacters.status, "alive")));
    for (const h of holders) {
      if (!h.id) continue;
      await db
        .update(playerCharacters)
        .set({ [effect.stat]: sql`LEAST(100, GREATEST(0, ${playerCharacters[effect.stat]} + ${effect.amount}))` })
        .where(eq(playerCharacters.id, h.id));
    }
    return;
  }

  if (effect.type === "party_favor") {
    const members = await db
      .select({ id: playerCharacters.id })
      .from(playerCharacters)
      .where(and(eq(playerCharacters.worldId, worldId), eq(playerCharacters.party, effect.party), eq(playerCharacters.status, "alive")));
    for (const m of members) {
      await db
        .insert(partyFavor)
        .values({ characterId: m.id, party: effect.party, favor: effect.amount })
        .onConflictDoUpdate({ target: [partyFavor.characterId, partyFavor.party], set: { favor: sql`${partyFavor.favor} + ${effect.amount}` } });
    }
    return;
  }
  void now;
}

// The sitting officials of a scope (for treasury_grant 'officials'): the 4 League
// magistrates, or the 2 party leaders.
async function officialHolderIds(worldId: string, scope: AgendaScope): Promise<string[]> {
  const targetOffices = scope === "league" ? ["archon", "ephor"] : ["party_archon", "party_ephor"];
  const conds = scope === "league" ? and(eq(offices.worldId, worldId), inArray(offices.office, targetOffices)) : and(eq(offices.worldId, worldId), inArray(offices.office, targetOffices), eq(offices.side, scope));
  const rows = await db.select({ holder: offices.holderCharacterId }).from(offices).where(conds);
  return rows.map((r) => r.holder).filter((h): h is string => !!h);
}
