import { and, eq, lt } from "drizzle-orm";
import { createDb, dailyDecisions, playerCharacters } from "@massalia/db";
import type { DbTx } from "./lock.js";
import {
  dailyArenasFor,
  defaultChoiceFor,
  drawEvent,
  eventArena,
  gameDate,
  isCalendarEvent,
  isEventEligible,
  type EligibilityContext,
  type EventChoice,
  type EventDefinition,
} from "@massalia/shared";
import { applyChoiceEffects, ChoiceClaimRejected, listEvents, recentEventIds } from "./eventEngine.js";
import { applyComposureDelta, composurePreview, getComposureConfig, recoverComposure } from "./composure.js";
import { getHeldTraits } from "./traits.js";
import { livingSpouseState } from "./family.js";

const db = createDb();

export type DailyCardRow = typeof dailyDecisions.$inferSelect;

// UTC calendar day (YYYY-MM-DD) the set belongs to.
export function utcDayString(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export async function getDailySet(characterId: string, now: Date): Promise<DailyCardRow[]> {
  return db
    .select()
    .from(dailyDecisions)
    .where(and(eq(dailyDecisions.characterId, characterId), eq(dailyDecisions.utcDay, utcDayString(now))));
}

export type AppliedDefault = { cardId: string; eventId: string; choiceId: string; composureDelta: number };

// Settle every card from a PAST UTC day the player left unresolved to its event's
// defaultChoiceId: charge composure exactly as a live resolve would, apply the
// choice's effects (which also records the event in history) and mark the card
// resolved-by-default. Lazy by design — runs on the first access of a new day
// (see ensureDailySet), never from a worker tick. Cards whose event has no
// default keep today's behaviour: expired, no effect.
// `events` is injectable for tests; production passes the loaded content.
export async function applyExpiredDefaults(characterId: string, now: Date, events?: EventDefinition[]): Promise<AppliedDefault[]> {
  const expired = await db
    .select()
    .from(dailyDecisions)
    .where(and(eq(dailyDecisions.characterId, characterId), eq(dailyDecisions.resolved, false), lt(dailyDecisions.utcDay, utcDayString(now))));
  if (expired.length === 0) return [];

  const byId = new Map((events ?? (await listEvents())).map((event) => [event.id, event] as const));
  const applied: AppliedDefault[] = [];
  for (const row of expired) {
    const event = byId.get(row.eventId);
    if (!event) {
      // Content removed since the card was drawn — nothing sensible to apply.
      console.warn(`applyExpiredDefaults: unknown event ${row.eventId} on card ${row.id}; left unresolved`);
      continue;
    }
    const choice = defaultChoiceFor(event);
    if (!choice) continue;

    // Traits/spouse are read BEFORE the claim (the composure preview is judged
    // against them, exactly as the resolve route reads them before resolving).
    // Re-read per card: an earlier default may have changed the traits the next one
    // is judged against.
    const character = (await db.select().from(playerCharacters).where(eq(playerCharacters.id, characterId)).limit(1))[0];
    if (!character) {
      console.warn(`applyExpiredDefaults: character ${characterId} not found for card ${row.id}; left unresolved`);
      continue;
    }
    const heldTraits = await getHeldTraits(characterId);
    const spouseTraits = (await livingSpouseState(character, now))?.personalityTraits ?? [];

    // Claim-first (mirrors the resolve route step for step): the card flips to
    // resolved-by-default and the effects apply in ONE locked transaction. Two
    // first-accesses of the same new day can race here — the loser claims nothing
    // and applies nothing (no double charge, no double composure).
    const resolved = await resolveDailyCard(row, choice, { byDefault: true });
    if (!resolved.claimed) continue;

    // Composure after the claim (recover → preview → apply): the trait/ideology
    // layer plus explicit change_composure, with the living spouse's reaction and
    // NO tag-derived philia (the double-count guard). The withdrawn gate is
    // deliberately absent — the default is not the player acting — and a default
    // may itself break the character; applyComposureDelta handles that exactly as
    // for a live resolve.
    await recoverComposure(characterId, now);
    const { delta, reason } = composurePreview(choice, heldTraits, getComposureConfig(), spouseTraits);
    await applyComposureDelta(characterId, delta, reason, now);
    applied.push({ cardId: row.id, eventId: row.eventId, choiceId: choice.id, composureDelta: delta });
  }
  return applied;
}

// Return today's curated set, generating it on first access: one weighted card
// per arena the character qualifies for, excluding recently-seen events.
// `events` is injectable for tests; production loads the content pool.
export async function ensureDailySet(
  characterId: string,
  ctx: EligibilityContext,
  now: Date,
  startedMs: number,
  events?: EventDefinition[],
): Promise<DailyCardRow[]> {
  const existing = await getDailySet(characterId, now);
  if (existing.length > 0) return existing;

  const day = utcDayString(now);
  const content = events ?? (await listEvents());
  // First access of a new day: settle yesterday's leftovers to their defaults
  // BEFORE reading history, so a default resolution counts as recently seen.
  await applyExpiredDefaults(characterId, now, content);
  // Calendar/festival events fire from the festival system — never the daily draw.
  const eligible = content.filter((event) => !isCalendarEvent(event) && isEventEligible(event, ctx));
  const recent = await recentEventIds(characterId, 5);

  // The family arena is included only on the winter day — its once-per-game-year
  // cadence by construction (1 winter per 4 real-day year).
  const isWinter = gameDate(now.getTime(), startedMs).seasonOfYear === 0;
  for (const arena of dailyArenasFor(ctx, isWinter)) {
    const pool = eligible.filter((event) => eventArena(event) === arena);
    const drawn = drawEvent(pool, recent);
    if (!drawn) continue;
    await db
      .insert(dailyDecisions)
      .values({ characterId, utcDay: day, arena, eventId: drawn.id })
      .onConflictDoNothing();
    // History is written when the card is RESOLVED (applyChoiceEffects), not here:
    // an unresolved card must not buy itself a cooldown. This push only keeps the
    // same event out of two arenas on the same day.
    recent.push(drawn.id);
  }

  return getDailySet(characterId, now);
}

export async function findDailyCard(characterId: string, eventId: string, now: Date): Promise<DailyCardRow | null> {
  const rows = await getDailySet(characterId, now);
  return rows.find((row) => row.eventId === eventId) ?? null;
}

// `byDefault` flags a lazy default resolution (applyExpiredDefaults); a player's
// own resolve leaves the column at its false default.
export async function markCardResolved(cardId: string, choiceId: string, opts: { byDefault?: boolean } = {}): Promise<void> {
  await db
    .update(dailyDecisions)
    .set({ resolved: true, resolvedChoiceId: choiceId, ...(opts.byDefault ? { resolvedByDefault: true } : {}) })
    .where(eq(dailyDecisions.id, cardId));
}

// --- Claim-first resolution --------------------------------------------------
// The claim: flip the card to resolved ONLY if it is still unresolved, and report
// whether this transaction won. `UPDATE ... WHERE resolved = false RETURNING id` is
// the whole race guard — under the player lock the second of two concurrent
// resolves sees the first one's commit and matches zero rows.
export async function claimDailyCard(tx: DbTx, cardId: string, choiceId: string, opts: { byDefault?: boolean } = {}): Promise<boolean> {
  const claimed = await tx
    .update(dailyDecisions)
    .set({ resolved: true, resolvedChoiceId: choiceId, ...(opts.byDefault ? { resolvedByDefault: true } : {}) })
    .where(and(eq(dailyDecisions.id, cardId), eq(dailyDecisions.resolved, false)))
    .returning({ id: dailyDecisions.id });
  return claimed.length > 0;
}

export type CardResolution = { claimed: false } | { claimed: true; resultText: string };

// Resolve a daily card to a choice: lock the player → claim the card → apply the
// choice's effects + event_history, all in ONE transaction (applyChoiceEffects'
// claim hook). A lost claim rolls everything back and returns { claimed: false } —
// the caller answers 409 and applies nothing else (composure included).
export async function resolveDailyCard(card: DailyCardRow, choice: EventChoice, opts: { byDefault?: boolean } = {}): Promise<CardResolution> {
  try {
    const result = await applyChoiceEffects(card.characterId, card.eventId, choice, {
      claim: (tx) => claimDailyCard(tx, card.id, choice.id, opts),
    });
    return { claimed: true, resultText: result.resultText };
  } catch (error) {
    if (error instanceof ChoiceClaimRejected) return { claimed: false };
    throw error;
  }
}
