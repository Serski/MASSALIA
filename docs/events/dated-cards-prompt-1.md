# Dated cards, prompt 1: the Emporion Convoy and the Rhodanos Tolls

## What this builds

A content-dated card: an event in `content/events/` carrying a `date` (an in-game season) that is dealt into the daily set of every eligible character who loads the dashboard during that season, once per character, as an extra card beside the arena draws. Two ship with it, both for seated oligarchs, both paying 50 drachmae: The Emporion Convoy (Summer 300 BC) and The Rhodanos Tolls (Spring 299 BC). Any later dated card is a JSON edit.

Rulings (Argiris, 16 Sept 2026):

- A dated card is dealt at every dashboard load during its season to every character eligible for it at that load, at most once per character ever. A character who never loads the dashboard during the season never gets it. A seat bought at noon gets the card at the next load.
- It is a normal daily card once dealt: resolved through `POST /events/:eventId/choices/:choiceId`, settled to its `defaultChoiceId` at the next login if left unresolved (`applyExpiredDefaults`), dismissable like any other. Its `defaultChoiceId` is the payout, so seeing the card is enough to be paid.
- One dated card per season across all content; two dated events on the same date fail content loading at boot, like a duplicate id.
- A dated event carries `trigger: "calendar"`, so `isCalendarEvent` keeps it out of the random draw with no change to that function. A `date` without that trigger fails at boot.
- No migration, no worker sweep, no client change. The client keeps its `ARENA_LABELS`; the server reports a dated card's arena as the event's own arena (`eventArena`, so `council` here), and the existing "Oligarchy Council" kicker applies.

## Dates

`packages/shared/src/calendar.ts`: `START_YEAR_BC = 300`, `SEASONS_PER_YEAR = 4`, seasons Winter, Spring, Summer, Autumn (seasonOfYear 0..3). Content dates use the calendar config's convention, `season` 1..4 with 1 = Winter (`festivalSchema` in `packages/shared/src/festival.ts`).

- Summer 300 BC = seasonIndex `(300 - 300) * 4 + (3 - 1)` = 2. World 2 started `2026-09-15T00:00:00Z`, so the season is 2026-09-17 00:00 UTC to 2026-09-18 00:00 UTC. Deploy before it opens; a deploy inside the window still deals to every load after it.
- Spring 299 BC = seasonIndex `(300 - 299) * 4 + (2 - 1)` = 5, 2026-09-20 00:00 UTC to 2026-09-21 00:00 UTC.

## Phase 0: recon (no code)

Confirm each reference. If any is not as described, STOP 0 with the mismatch before writing anything.

- `packages/shared/src/events.ts`: `EventDefinition` (lines 70-84, `trigger?` at 76, `defaultChoiceId?` at 82); `eventDefinitionSchema` (148-169, a zod object that strips unknown keys, so an undeclared `date` would vanish silently); `assertUniqueEventIds` (~187); `isCalendarEvent` (213); `isEventEligible` (217, `office: "councilor"` checked against `ctx.isCouncilor` at 223); `eventArena` (268); `dailyArenasFor` (287).
- `apps/server/src/services/eventEngine.ts` lines 64-81: `listEvents()` scans every `.json` in `content/events/` and calls `assertUniqueEventIds` at 79.
- `apps/server/src/services/dailyDecisions.ts`: `utcDayString` (26), `getDailySet` (30), `applyExpiredDefaults` (45), `ensureDailySet` (101-138; early return on an existing set at 109, `content = events ?? listEvents()` at 112, `gameDate` already imported).
- `apps/server/src/routes/events.ts`: GET handler builds `ctx` at 94, calls `ensureDailySet` at 95, loads `listEvents()` at 96, reports `arena: card.arena` at 105; POST calls `ensureDailySet` at 154 and `findDailyCard` at 155.
- `packages/db/src/schema.ts` 338-352: `daily_decisions` with `arena text` and the unique index `(character_id, utc_day, arena)`.
- `apps/web/src/dashboard/panels/CourtPanel.tsx` 10-16: `ARENA_LABELS` (`council: "Oligarchy Council"`), fallback "Decision". Not touched.
- `apps/server/src/services/dailyDecisions.test.ts`: DB-gated harness with an injectable fixture `pool`, a `ctx` object (`isCouncilor: false`), `createCharacter`, `insertCard`, `drachmaeOf`, cases (a) to (g); `ensureDailySet` takes `startedMs` as a parameter, so a test picks the season by the start it passes.

## Phase 1: shared schema and content (one commit)

1. Save this prompt verbatim as `docs/events/dated-cards-prompt-1.md`.
2. `packages/shared/src/events.ts`:
   - `EventDefinition` gains `date?: { yearBC: number; season: number }` with a comment: dealt into the daily set during that season (1 = Winter, as the calendar config), never drawn.
   - `eventDefinitionSchema` gains `date: z.object({ yearBC: z.number().int(), season: z.number().int().min(1).max(4) }).optional()`; the `superRefine` also rejects a `date` on an event whose `trigger` is not `"calendar"` (message: `Event ${id}: a dated event must carry trigger "calendar"`).
   - `export function datedSeasonIndex(date: { yearBC: number; season: number }): number` = `(START_YEAR_BC - yearBC) * SEASONS_PER_YEAR + (season - 1)` (import both from `./calendar.js`).
   - `export function assertOneDatedEventPerSeason(events: EventDefinition[]): void`, next to `assertUniqueEventIds`: throws `Two dated events on the same season: <a>, <b>` on a collision.
3. `content/events/events-dated.json` (new file, picked up by the directory scan), exactly:

```json
[
  {
    "id": "dated-emporion-convoy",
    "weight": 0,
    "trigger": "calendar",
    "date": { "yearBC": 300, "season": 3 },
    "requires": { "office": "councilor" },
    "scene": "Midsummer, and the convoy from Emporion has made the Lakydon: thirty hulls low in the water with Iberian silver, tin and salt fish. The Ephors have tallied the harbour dues, and by old custom the Council takes its tenth before the rest goes to the treasury.",
    "choices": [
      {
        "id": "take",
        "label": "Take your share of the dues",
        "effects": [{ "type": "change_drachmae", "amount": 50 }],
        "resultText": "Fifty drachmae of Emporion silver, counted out on the quay. The rest goes to the treasury, as custom holds."
      }
    ],
    "defaultChoiceId": "take"
  },
  {
    "id": "dated-rhodanos-tolls",
    "weight": 0,
    "trigger": "calendar",
    "date": { "yearBC": 299, "season": 2 },
    "requires": { "office": "councilor" },
    "scene": "The snow is off the passes and the first rafts of the year have come down the Rhodanos to Arelate, stacked with northern tin and Gaulish hides. The Ephors have tallied the river tolls, and by old custom the Council takes its tenth before the rest goes to the treasury.",
    "choices": [
      {
        "id": "take",
        "label": "Take your share of the tolls",
        "effects": [{ "type": "change_drachmae", "amount": 50 }],
        "resultText": "Fifty drachmae in river tolls, weighed out at the Arelate customs house. The rest goes to the treasury, as custom holds."
      }
    ],
    "defaultChoiceId": "take"
  }
]
```

4. `packages/shared/src/events.test.ts`: the schema keeps `date` (parse and read it back); rejects `season: 5`; rejects a dated event without `trigger: "calendar"`; `datedSeasonIndex` gives 2 for `{300, 3}` and 5 for `{299, 2}`; `assertOneDatedEventPerSeason` throws for two events dated `{300, 3}` and passes for the two content dates; `isCalendarEvent` is true for a dated event; the real `content/events/events-dated.json` parses through `parseEventFile` to two events on seasonIndex 2 and 5.

Commit: `dated cards: content date on events, the Emporion Convoy and the Rhodanos Tolls`.

## Phase 2: dealing (one commit)

1. `apps/server/src/services/eventEngine.ts` `listEvents()`: call `assertOneDatedEventPerSeason(events)` right after `assertUniqueEventIds(events)`.
2. `apps/server/src/services/dailyDecisions.ts`:
   - New exported `dealDatedCards(characterId, ctx, now, startedMs, content): Promise<number>`: `gd = gameDate(now, startedMs)`; `due = content.filter(e => e.date && datedSeasonIndex(e.date) === gd.seasonIndex && isEventEligible(e, ctx))`; for each, skip when a `daily_decisions` row for `(character_id, event_id)` already exists on ANY day (the once-ever guard; a season can straddle two UTC days when a world starts mid-day), else insert `{ characterId, utcDay: utcDayString(now), arena: "dated", eventId }` with `onConflictDoNothing().returning(...)`; return the count inserted. A day with no dated card due costs no query.
   - `ensureDailySet`: load `content` before the early return; on an existing set, run `dealDatedCards` and return a fresh `getDailySet` when it dealt anything, else the existing rows; on generation, run it after the arena loop. History is still written only at resolve; do not push dated ids onto `recent`.
3. `apps/server/src/routes/events.ts`:
   - GET: move `const events = await listEvents()` above `ensureDailySet` and pass it as the fifth argument (this also drops the double content read that exists today); report `arena: card.arena === "dated" ? eventArena(event) : card.arena` (import `eventArena` from `@massalia/shared`).
   - POST: unchanged call; `ensureDailySet` loads the pool itself there. One content read per resolve is accepted; memoising `listEvents()` stays the separate pending task.
4. `apps/server/src/services/dailyDecisions.test.ts`, with a `DATED` fixture (`dated-test`, `trigger: "calendar"`, `date: { yearBC: 300, season: 3 }`, `requires: { office: "councilor" }`, one choice `take` at `+50`, `defaultChoiceId: "take"`) added to the pool and a `councilor` ctx (`{ ...ctx, isCouncilor: true }`). Pick the season through `startedMs`: `now - 2 * DAY - 10 min` is Summer 300, `now - DAY - 10 min` is Spring 300.
   - (h) a councilor's set in Summer 300 holds the dated card with `arena: "dated"` beside the arena cards; a non-councilor's does not; a councilor's set in Spring 300 does not.
   - (i) a second `ensureDailySet` the same day deals nothing new; a set generated earlier today with the non-councilor ctx gains the dated card when called again with the councilor ctx (the noon-seat and mid-day-deploy case).
   - (j) straddling season: with `startedMs = now - 2 * DAY + 6 h` (Summer 300 began yesterday 18:00 UTC), a `dated-test` row inserted for yesterday means today's call deals nothing.
   - (k) resolving the dated card pays +50 once and a second resolve is rejected by the claim; left unresolved, `applyExpiredDefaults` on the next day pays +50 and marks it resolved by default.

Commit: `dated cards: dealt into the daily set during their season`.

## Gate and STOP 1

Full `pnpm build && pnpm test` at HEAD after the last commit, against a migrated `massalia_test`. A run where the DB-gated suites skip is not green. No push. Report:
```

Committed: <SHA> dated cards: content date on events, the Emporion Convoy and the Rhodanos Tolls
Committed: <SHA> dated cards: dealt into the daily set during their season
Gate: <pnpm build && pnpm test output, per package, DB-gated suites confirmed run>
Deviations: <each as a ruling for Argiris, or "none">
Post-deploy check: after 2026-09-17 00:00 UTC, `select count(*), count(*) filter (where resolved) from daily_decisions where event_id = 'dated-emporion-convoy';`
and, on a seated character, the card under the "Oligarchy Council" kicker in the Court panel with a "+50 drachmae" chip.

```

## Scope fence

Do not touch: the festival system, the worker, the Chronicle, the web client, `oligarchy.ts` and seat purchase, `applyEffectsInTx` and the rest of the event engine beyond the one assertion call, `applyExpiredDefaults`, the market, the barracks, any other content file, `listEvents()` memoisation, any guide or copy. No migration. No balance numbers beyond the two 50s in content. No refactors along the way.

END OF PROMPT
