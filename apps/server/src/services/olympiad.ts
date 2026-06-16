import { and, desc, eq, inArray } from "drizzle-orm";
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
} from "@massalia/db";
import {
  capStat,
  competeRoll,
  olympiadConfig,
  OLYMPIAD_GAMES_FESTIVAL_ID,
  OLYMPIC_DELEGATE_TRAIT_ID,
  OLYMPIONIKES_TRAIT_ID,
  type CompeteMode,
  type EventDefinition,
} from "@massalia/shared";
import { getCalendarConfig, composurePreview, withPreviews } from "./festival.js";
import { listEvents, applyChoiceEffects } from "./eventEngine.js";
import { applyComposureDelta, recoverComposure } from "./composure.js";
import { addTrait, getHeldTraits, TraitRuleError } from "./traits.js";
import { getAgeConfig } from "./age.js";
import { broadcastState } from "./worldState.js";

const db = createDb();

type CharacterRow = typeof playerCharacters.$inferSelect;

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

  // Composure (tag/ideology layer + explicit), as the festival path does.
  await recoverComposure(character.id, now);
  const traits = await getHeldTraits(character.id);
  const { delta, reason } = composurePreview(choice, traits);
  const composure = await applyComposureDelta(character.id, delta, `olympiad:${fe.festivalId}`, now);

  // Olympic-specific effects resolve BEFORE applyChoiceEffects (which removes the
  // delegate trait): registering a candidacy, or running the compete roll.
  let nominated = false;
  let compete: OlympicCompeteResult | null = null;
  for (const effect of choice.effects) {
    if (effect.type === "olympic_nominate") {
      nominated = await nominateForOlympiad(character.id, fe.gameYear);
    } else if (effect.type === "olympic_compete") {
      compete = await runCompete(character.id, effect.mode as CompeteMode);
    }
  }

  // Remaining content effects (+devotion for "support"; change_trait remove the
  // delegate trait for the Games — runs AFTER the compete roll above).
  const result = await applyChoiceEffects(character.id, event.id, choice);

  await db.update(festivalEvents).set({ resolved: true, resolvedChoiceId: choiceId }).where(eq(festivalEvents.id, fe.id));
  await broadcastState();

  return { ok: true, resultText: result.resultText, composureDelta: delta, composureReason: reason, composure: composure.composure, broke: composure.broke, nominated, compete };
}

// The compete roll: (militia + prestige) vs a mode-scaled threshold. Victory →
// a big prestige award + the permanent olympionikes trait; an honorable showing →
// solid prestige, no permanent trait.
async function runCompete(characterId: string, mode: CompeteMode): Promise<OlympicCompeteResult> {
  const row = (await db.select({ militia: playerCharacters.militia, prestige: playerCharacters.prestige }).from(playerCharacters).where(eq(playerCharacters.id, characterId)).limit(1))[0];
  if (!row) return { won: false, prestigeAward: 0, mode };
  const outcome = competeRoll(row.militia, row.prestige, mode);
  const next = capStat(row.prestige + outcome.prestigeAward, getAgeConfig());
  const applied = next - row.prestige;
  await db.update(playerCharacters).set({ prestige: next }).where(eq(playerCharacters.id, characterId));
  await db.insert(effectLog).values({ characterId, kind: "change_stat", detail: { stat: "prestige", requested: outcome.prestigeAward, applied, source: `olympic_compete:${mode}` } });
  if (outcome.won) {
    try {
      await addTrait(characterId, OLYMPIONIKES_TRAIT_ID);
    } catch (error) {
      if (!(error instanceof TraitRuleError)) throw error;
    }
  }
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
  let champion: { name: string } | null = null;
  if (cycle.phase === "completed" && cycle.payoffAt) {
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
