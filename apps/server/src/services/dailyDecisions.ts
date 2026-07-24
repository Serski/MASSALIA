import { and, eq } from "drizzle-orm";
import { createDb, dailyDecisions } from "@massalia/db";
import { dailyArenasFor, drawEvent, eventArena, gameDate, isCalendarEvent, isEventEligible, type EligibilityContext } from "@massalia/shared";
import { listEvents, recentEventIds, recordDraw } from "./eventEngine.js";

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

// Return today's curated set, generating it on first access: one weighted card
// per arena the character qualifies for, excluding recently-seen events.
export async function ensureDailySet(characterId: string, ctx: EligibilityContext, now: Date, startedMs: number): Promise<DailyCardRow[]> {
  const existing = await getDailySet(characterId, now);
  if (existing.length > 0) return existing;

  const day = utcDayString(now);
  // Calendar/festival events fire from the festival system — never the daily draw.
  const eligible = (await listEvents()).filter((event) => !isCalendarEvent(event) && isEventEligible(event, ctx));
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
    await recordDraw(characterId, drawn.id);
    recent.push(drawn.id); // don't draw the same event into two arenas the same day
  }

  return getDailySet(characterId, now);
}

export async function findDailyCard(characterId: string, eventId: string, now: Date): Promise<DailyCardRow | null> {
  const rows = await getDailySet(characterId, now);
  return rows.find((row) => row.eventId === eventId) ?? null;
}

export async function markCardResolved(cardId: string, choiceId: string): Promise<void> {
  await db
    .update(dailyDecisions)
    .set({ resolved: true, resolvedChoiceId: choiceId })
    .where(eq(dailyDecisions.id, cardId));
}
