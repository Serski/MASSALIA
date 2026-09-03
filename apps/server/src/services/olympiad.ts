import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  advanceOlympiads,
  castOlympiadVote,
  characterTraits,
  createDb,
  deliverOlympicNominationForCharacterId,
  deliverOlympicNominationToAll,
  effectLog,
  festivalEvents,
  getOlympiadBallot,
  getVoterChoice,
  latestOlympiad,
  nominateForOlympiad,
  olympicCandidates,
  players,
  playerCharacters,
  type DbTx,
} from "@massalia/db";
import {
  competeRoll,
  olympiadConfig,
  OLYMPIAD_GAMES_FESTIVAL_ID,
  OLYMPIC_DELEGATE_TRAIT_ID,
  OLYMPIONIKES_TRAIT_ID,
  REAL_MS_PER_SEASON,
  type CompeteMode,
  type EventDefinition,
} from "@massalia/shared";
import { getCalendarConfig, composurePreview, withPreviews } from "./festival.js";
import { applyChoiceInTx, choiceContentDefaults, finishChoiceEffects, listEvents } from "./eventEngine.js";
import { lockCharacterOwner } from "./lock.js";
import { applyComposureDelta, recoverComposure } from "./composure.js";
import { addTrait, getHeldTraits, TraitRuleError } from "./traits.js";
import { getAgeConfig } from "./age.js";
import { broadcastState } from "./worldState.js";

const db = createDb();

type CharacterRow = typeof playerCharacters.$inferSelect;

// Thrown inside the resolve transaction when the claim matched no row (a
// concurrent resolve won); mapped to the same 409 as the "no event" pre-check.
class OlympicEventAlreadyResolved extends Error {
  constructor() {
    super("olympic event already resolved");
  }
}

// The festival_event festival ids the Olympiad rides (nominate + Games payoff).
function olympicFestivalIds(): string[] {
  const olympiad = olympiadConfig(getCalendarConfig());
  return olympiad ? [olympiad.id, OLYMPIAD_GAMES_FESTIVAL_ID] : [OLYMPIAD_GAMES_FESTIVAL_ID];
}

// --- Lifecycle delegators (the worker sweep + lazy-on-read net) -------------

export async function deliverOlympiadNomination(character: CharacterRow, now: Date = new Date()): Promise<void> {
  if (character.status !== "alive") return;
  await deliverOlympicNominationForCharacterId(character.id, getCalendarConfig(), now);
}

export async function fireOlympiadForAll(now: Date = new Date()): Promise<{ delivered: number; advanced: number }> {
  const delivered = await deliverOlympicNominationToAll(getCalendarConfig(), now);
  const summaries = await advanceOlympiads(getCalendarConfig(), now);
  if (delivered > 0 || summaries.length) await broadcastState();
  return { delivered, advanced: summaries.length };
}

export async function advanceOlympiadCycle(now: Date = new Date()) {
  const summaries = await advanceOlympiads(getCalendarConfig(), now);
  if (summaries.length) await broadcastState();
  return summaries;
}

// --- The live Olympic event (nominate / Games) for the HUD ------------------

export async function liveOlympicEventForCharacter(character: CharacterRow) {
  if (character.status !== "alive") return null;
  const rows = await db
    .select()
    .from(festivalEvents)
    .where(and(eq(festivalEvents.characterId, character.id), inArray(festivalEvents.festivalId, olympicFestivalIds()), eq(festivalEvents.resolved, false)))
    .limit(1);
  const fe = rows[0];
  if (!fe) return null;
  const event = (await listEvents()).find((e) => e.id === fe.eventId);
  if (!event) return null;
  const traits = await getHeldTraits(character.id);
  return { festivalId: fe.festivalId, eventId: fe.eventId, gameYear: fe.gameYear, event: withPreviews(event as EventDefinition, traits) };
}

// --- Resolving the Olympic event (free civic event, no decision spent) -------

export type OlympicCompeteResult = { won: boolean; prestigeAward: number; mode: CompeteMode };

export type OlympicResolveResult =
  | { ok: false; code: number; error: string }
  | { ok: true; resultText: string; composureDelta: number; composureReason: string; composure: number; broke: boolean; nominated: boolean; compete: OlympicCompeteResult | null };

export async function resolveOlympicEvent(character: CharacterRow, choiceId: string, now: Date = new Date()): Promise<OlympicResolveResult> {
  const rows = await db
    .select()
    .from(festivalEvents)
    .where(and(eq(festivalEvents.characterId, character.id), inArray(festivalEvents.festivalId, olympicFestivalIds()), eq(festivalEvents.resolved, false)))
    .limit(1);
  const fe = rows[0];
  if (!fe) return { ok: false, code: 409, error: "No Olympic event awaits you." };

  const event = (await listEvents()).find((e) => e.id === fe.eventId);
  const choice = event?.choices.find((c) => c.id === choiceId);
  if (!event || !choice) return { ok: false, code: 404, error: "Unknown Olympic choice." };

  // The composure preview is judged against the traits as read here (pre-tx),
  // exactly as the HUD previewed them.
  const traits = await getHeldTraits(character.id);
  const { delta, reason } = composurePreview(choice, traits);
  const defs = await choiceContentDefaults(choice);

  // Claim-first, in ONE transaction: lock the player, flip the event to resolved
  // (UPDATE ... WHERE resolved = false RETURNING), then composure, the Olympic
  // nominate/compete, the content effects and the effect log — all on the tx
  // handle. A concurrent duplicate loses the claim, rolls back, and gets 409.
  let out: { composure: Awaited<ReturnType<typeof applyComposureDelta>>; nominated: boolean; compete: OlympicCompeteResult | null; ideologyTouched: boolean };
  try {
    out = await db.transaction(async (tx) => {
      await lockCharacterOwner(tx, character.id);
      const claimed = await tx
        .update(festivalEvents)
        .set({ resolved: true, resolvedChoiceId: choiceId })
        .where(and(eq(festivalEvents.id, fe.id), eq(festivalEvents.resolved, false)))
        .returning({ id: festivalEvents.id });
      if (!claimed.length) throw new OlympicEventAlreadyResolved();

      // Composure (tag/ideology layer + explicit), as the festival path does.
      await recoverComposure(character.id, now, tx);
      const composure = await applyComposureDelta(character.id, delta, `olympiad:${fe.festivalId}`, now, tx);

      // Olympic-specific effects resolve BEFORE the content effects (which remove
      // the delegate trait): registering a candidacy, or running the compete roll.
      let nominated = false;
      let compete: OlympicCompeteResult | null = null;
      for (const effect of choice.effects) {
        if (effect.type === "olympic_nominate") {
          nominated = await nominateForOlympiad(character.id, fe.gameYear, tx);
        } else if (effect.type === "olympic_compete") {
          compete = await runCompete(tx, character.id, effect.mode as CompeteMode);
        }
      }

      // Remaining content effects (+devotion for "support"; change_trait remove the
      // delegate trait for the Games — runs AFTER the compete roll above).
      const { ideologyTouched } = await applyChoiceInTx(tx, character.id, event.id, choice, defs);
      return { composure, nominated, compete, ideologyTouched };
    });
  } catch (error) {
    if (error instanceof OlympicEventAlreadyResolved) return { ok: false, code: 409, error: "No Olympic event awaits you." };
    throw error;
  }
  const { composure, nominated, compete } = out;

  // Post-tx: the permanent olympionikes trait goes through the rule-enforcing
  // trait service (like every change_trait), then the shared post-tx passes.
  if (compete?.won) {
    try {
      await addTrait(character.id, OLYMPIONIKES_TRAIT_ID);
    } catch (error) {
      if (!(error instanceof TraitRuleError)) throw error;
    }
  }
  await finishChoiceEffects(character.id, choice, out.ideologyTouched);

  return { ok: true, resultText: choice.resultText, composureDelta: delta, composureReason: reason, composure: composure.composure, broke: composure.broke, nominated, compete };
}

// The compete roll: (militia + prestige) vs a mode-scaled threshold. Victory →
// a big prestige award (+ the permanent olympionikes trait, granted by the caller
// after the tx); an honorable showing → solid prestige, no permanent trait. Runs
// inside the caller's locked transaction; the prestige write is relative and
// capped in SQL (statFloor..statCap, the same bounds capStat applies).
async function runCompete(tx: DbTx, characterId: string, mode: CompeteMode): Promise<OlympicCompeteResult> {
  const row = (await tx.select({ militia: playerCharacters.militia, prestige: playerCharacters.prestige }).from(playerCharacters).where(eq(playerCharacters.id, characterId)).limit(1))[0];
  if (!row) return { won: false, prestigeAward: 0, mode };
  const outcome = competeRoll(row.militia, row.prestige, mode);
  const { statCap, statFloor } = getAgeConfig();
  const updated = await tx
    .update(playerCharacters)
    .set({ prestige: sql`LEAST(${statCap}, GREATEST(${statFloor}, ${playerCharacters.prestige} + ${outcome.prestigeAward}))` })
    .where(eq(playerCharacters.id, characterId))
    .returning({ prestige: playerCharacters.prestige });
  const applied = (updated[0]?.prestige ?? row.prestige) - row.prestige;
  await tx.insert(effectLog).values({ characterId, kind: "change_stat", detail: { stat: "prestige", requested: outcome.prestigeAward, applied, source: `olympic_compete:${mode}` } });
  return { won: outcome.won, prestigeAward: applied, mode };
}

// --- The ballot (dedicated voting UI) ---------------------------------------

export async function ballotView(character: CharacterRow, now: Date = new Date()) {
  await advanceOlympiadCycle(now);
  const cycle = await latestOlympiad();
  const olympiad = olympiadConfig(getCalendarConfig());
  if (!cycle || !olympiad) return { gameYear: null, phase: null, votingEndsAt: null, seats: olympiad?.seats ?? 2, candidates: [], yourVote: null };
  // Candidates only — live standings stay HIDDEN until the window shuts.
  const candidates = await getOlympiadBallot(cycle.gameYear);
  const yourVote = cycle.phase === "voting" ? await getVoterChoice(character.id, cycle.gameYear) : null;
  return {
    gameYear: cycle.gameYear,
    phase: cycle.phase,
    votingEndsAt: cycle.votingEndsAt ? cycle.votingEndsAt.toISOString() : null,
    seats: olympiad.seats,
    candidates,
    yourVote,
  };
}

export type CastVoteResult = { ok: false; code: number; error: string } | { ok: true; candidateId: string };

export async function castVote(character: CharacterRow, candidateId: string, now: Date = new Date()): Promise<CastVoteResult> {
  await advanceOlympiadCycle(now);
  const cycle = await latestOlympiad();
  if (!cycle) return { ok: false, code: 409, error: "No Olympiad is in progress." };
  const outcome = await castOlympiadVote(character.id, candidateId, cycle.gameYear, now);
  if (outcome === "not_voting") return { ok: false, code: 409, error: "The ballot is not open." };
  if (outcome === "unknown_candidate") return { ok: false, code: 404, error: "No such candidate stands." };
  if (outcome === "voter_dead") return { ok: false, code: 409, error: "The dead cast no vote." };
  if (outcome === "already_voted") return { ok: false, code: 409, error: "You have already cast your Olympic vote — it is final." };
  await broadcastState();
  return { ok: true, candidateId };
}

// --- me/state status (badges, banner, countdown, city-wide victor) ----------

export async function olympiadStatus(character: CharacterRow) {
  const olympiad = olympiadConfig(getCalendarConfig());
  if (!olympiad) return null;
  const cycle = await latestOlympiad();
  if (!cycle) return null;

  const traits = await getHeldTraits(character.id);
  const youAreDelegate = traits.some((t) => t.id === OLYMPIC_DELEGATE_TRAIT_ID);
  const youAreOlympionikes = traits.some((t) => t.id === OLYMPIONIKES_TRAIT_ID);

  const liveEvent = await liveOlympicEventForCharacter(character);

  let youAreCandidate = false;
  if (cycle.phase === "nomination" || cycle.phase === "voting") {
    const cand = await db
      .select({ id: olympicCandidates.id })
      .from(olympicCandidates)
      .where(and(eq(olympicCandidates.olympiadGameYear, cycle.gameYear), eq(olympicCandidates.characterId, character.id)))
      .limit(1);
    youAreCandidate = cand.length > 0;
  }
  const yourVote = cycle.phase === "voting" ? await getVoterChoice(character.id, cycle.gameYear) : null;
  const ballotCount = cycle.phase === "voting" ? (await getOlympiadBallot(cycle.gameYear)).length : 0;

  // City-wide victor: the most recent olympionikes crowned at/after this cycle's
  // payoff (i.e. this Olympiad produced a champion). All clients see it via me/state.
  // The headline shows for ONE real day after the crowning — the `completed` phase
  // itself lasts days, so without this window it would linger for the whole phase.
  let champion: { name: string } | null = null;
  if (cycle.phase === "completed" && cycle.payoffAt && Date.now() - cycle.payoffAt.getTime() < REAL_MS_PER_SEASON) {
    const crowned = await db
      .select({ name: players.name, gainedAt: characterTraits.gainedAt })
      .from(characterTraits)
      .innerJoin(playerCharacters, eq(playerCharacters.id, characterTraits.characterId))
      .innerJoin(players, eq(players.id, playerCharacters.playerId))
      .where(eq(characterTraits.traitId, OLYMPIONIKES_TRAIT_ID))
      .orderBy(desc(characterTraits.gainedAt))
      .limit(1);
    if (crowned[0] && crowned[0].gainedAt.getTime() >= cycle.payoffAt.getTime()) {
      champion = { name: crowned[0].name };
    }
  }

  return {
    gameYear: cycle.gameYear,
    phase: cycle.phase,
    nominationEndsAt: cycle.nominationEndsAt ? cycle.nominationEndsAt.toISOString() : null,
    votingEndsAt: cycle.votingEndsAt ? cycle.votingEndsAt.toISOString() : null,
    youAreCandidate,
    youAreDelegate,
    youAreOlympionikes,
    yourVote,
    ballotCount,
    liveEvent,
    champion,
  };
}

// Lazy-on-read entry for me/state: deliver the nominate card to this character +
// advance any cycle whose window has elapsed.
export async function syncOlympiadForCharacter(character: CharacterRow, now: Date = new Date()): Promise<void> {
  await advanceOlympiadCycle(now);
  await deliverOlympiadNomination(character, now);
}
