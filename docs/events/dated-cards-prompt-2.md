# Dated cards, prompt 2: the election notice and the shipper's purse

Save this prompt as docs/events/dated-cards-prompt-2.md in the first commit. Read AGENTS.md first, then docs/events/dated-cards-prompt-1.md, whose rulings still hold. Repo HEAD when this was drafted: f4500fb. No migration, no engine change, no client change. One concern per commit, staged by path. Recon first and STOP only if something below does not match the code; otherwise build straight through to STOP 1. Before the commit, run the suites its files touch and read the exit code. Commits stay local; no push until I say push.

## What it is

Two dated cards in `content/events/events-dated.json`, dealt by the dated-card mechanism of prompt 1 (every eligible character who loads the dashboard during the card's season gets it once; it is a normal daily card once dealt).

1. **The election notice**, for every character, dated Autumn 294 BC (season 4), which is 2026-10-12 00:00 to 2026-10-13 00:00 UTC. The election cycle due in year 6 opened its declarations in Spring 294 BC (10 October); the vote opens Winter 293 BC (13 October 00:00 UTC) and winners take office Spring 293 BC (14 October). One choice, no effect, self-resolving, so seeing the card is enough.
2. **The shipper's purse**, for seated oligarchs, dated Winter 293 BC (season 1), 2026-10-13 00:00 to 2026-10-14 00:00 UTC. Two choices: take 100 drachmae and lose 5 prestige, or refuse and gain 10 prestige. No default: a card left unresolved expires with no effect.

## Rulings (Argiris, 12 Oct 2026)

1. The notice has `requires` absent, so `isEventEligible` passes everyone and `eventArena` reports `general`; the Court panel's kicker reads "Massalia". Its single choice `noted` carries no effects and is the `defaultChoiceId`, so the card settles itself at the next login if left alone.
2. The purse has `requires: { office: "councilor" }` (arena `council`, kicker "Oligarchy Council") and no `defaultChoiceId`: an unanswered card expires with nothing applied, as `applyExpiredDefaults` already does for a card without a default.
3. The numbers are written into the choice labels, since the daily card shows a choice's label and nothing of its effects, and no client change ships here.
4. Effects go through the engine as they stand: `change_drachmae` is a relative write floored at 0; `change_stat` is scaled by the character's `growthMultiplier` (`applyStatGrowth`) and clamped to [0, 100] by `capStat`, never refused. So the +10 and −5 are the requested amounts, and a character at 3 prestige who takes the purse ends at 0.
5. One dated card per season across all content holds: the notice takes Autumn 294 BC and the purse Winter 293 BC.
6. The notice is one-shot by date. A notice that fires itself every election cycle is an engine change for a later prompt, not this one.
7. Both cards must be live before their seasons: the notice before 2026-10-12 23:00 UTC, the purse before 2026-10-13 00:00 UTC. If the push cannot land today, STOP before pushing and I re-date both.

## The two cards, verbatim

```json
{
  "id": "dated-election-notice-294",
  "weight": 0,
  "trigger": "calendar",
  "date": { "yearBC": 294, "season": 4 },
  "scene": "Heralds in the agora: the Three Hundred go to the vote. The oligarchy chooses two Archons and two Ephors, one seat of each for the Palaioi and one for the Dynatoi. Candidacies are open now and close when Winter opens; the vote runs the season through, and the winners take office in Spring. A seat in the chamber is needed to stand or to vote.",
  "choices": [
    {
      "id": "noted",
      "label": "Noted",
      "effects": [],
      "resultText": "The heralds move on down the quay."
    }
  ],
  "defaultChoiceId": "noted"
}
```

```json
{
  "id": "dated-shippers-purse-293",
  "weight": 0,
  "trigger": "calendar",
  "date": { "yearBC": 293, "season": 1 },
  "requires": { "office": "councilor" },
  "scene": "The Three Hundred take up the quay fees this season. Tonight a Chian wine shipper is in your courtyard with a purse of a hundred drachmae and a quiet request: that your voice be absent when the fees are read. His slave waits at the gate, where the street can see him.",
  "choices": [
    {
      "id": "take",
      "label": "Take the purse and say nothing (100 drachmae, −5 prestige)",
      "effects": [
        { "type": "change_drachmae", "amount": 100 },
        { "type": "change_stat", "stat": "prestige", "amount": -5 }
      ],
      "resultText": "The purse is heavy and the street is dark. Somebody at the gate counted the slave's steps all the same."
    },
    {
      "id": "refuse",
      "label": "Send him and his purse back through the gate, in sight of the street (+10 prestige)",
      "effects": [
        { "type": "change_stat", "stat": "prestige", "amount": 10 }
      ],
      "resultText": "He goes without a word. By morning the quay knows which door would not open."
    }
  ]
}
```

## Phase 0: recon (read only)

Confirm at f4500fb or a fast-forward of it (say which); any mismatch is a STOP 0.

- `packages/shared/src/events.ts`: `EventDefinition` at 75 (`trigger?` 81, `date?` 85, `defaultChoiceId?` 90); `eventDefinitionSchema` at 158 with the `date`-needs-`trigger: "calendar"` refinement at 173-177 and the `defaultChoiceId` refinement at 182-187; `parseEventFile` 202; `assertUniqueEventIds` 209; `datedSeasonIndex` 219; `assertOneDatedEventPerSeason` 225; `isCalendarEvent` 252; `isEventEligible` 256 (no `requires` passes at 258, `office: "councilor"` against `ctx.isCouncilor` at 262); `eventArena` 307 (`council` for the office, `general` when nothing matches). `effectSchema` accepts `change_stat` with `statName` of the four stats (106, 120) and `change_drachmae` (122); `eventChoiceSchema` allows an empty `effects` array (150-157).
- `apps/server/src/services/eventEngine.ts`: `listEvents` 74 loads every file under `content/events/` and runs `assertUniqueEventIds` (99) and `assertOneDatedEventPerSeason` (102); `change_stat` at 151-164 applies `applyStatGrowth` then `capStat`; `change_drachmae` at 176-185 is `GREATEST(0, drachmae + amount)`.
- `apps/server/src/services/dailyDecisions.ts`: `dealDatedCards` 117-148 (deals every content card whose `datedSeasonIndex` is the current season to an eligible character, once ever, arena `dated`); `ensureDailySet` 150 calls it on every load.
- `apps/server/src/routes/events.ts`: GET `/daily` at 81 reports a dated card's arena as `eventArena(event)` (109); POST `/:eventId/choices/:choiceId` at 125.
- `apps/web/src/dashboard/panels/CourtPanel.tsx`: `ARENA_LABELS` 10-16 with `general: "Massalia"` and `council: "Oligarchy Council"`.
- `content/events/events-dated.json`: two cards, `dated-emporion-convoy` (300 BC, season 3) and `dated-rhodanos-tolls` (299 BC, season 2), both `requires.office` councilor with a `take` default paying 50.
- `packages/shared/src/events.test.ts` 226-238 pins that file: the two ids, season indices `[2, 5]`, arena `council` for each, default `take` paying 50.
- The season arithmetic: Autumn 294 BC is season index 27 = 2026-10-12; Winter 293 BC is 28 = 2026-10-13; `START_YEAR_BC` 300, World 2 started 2026-09-15 00:00 UTC.
- Elections: `content/calendar/calendar-config.json` election block `cadenceYears 6, declareSeasonOffset 1, voteSeasonOffset 4, officeSeasonOffset 5`; `currentElectionCycle(27, cfg)` is due year 6 in phase `declaration`, vote at season 28, office at 29.

Then one production read, read only, through `railway run --service Postgres --environment production` with DATABASE_PUBLIC_URL:
- `SELECT count(*) FROM daily_decisions WHERE event_id IN ('dated-election-notice-294', 'dated-shippers-purse-293')` must be 0.
- `SELECT count(*) FILTER (WHERE is_councilor) AS seated, count(*) AS characters FROM player_characters WHERE world_id = (SELECT id FROM worlds WHERE status = 'active')`, for the report.

## Commit 1: `content: the election notice and the shipper's purse, two dated cards`

1. Save this prompt as docs/events/dated-cards-prompt-2.md.
2. Append the two cards above to `content/events/events-dated.json`, verbatim, after the Rhodanos Tolls. Nothing else in the file moves.
3. `packages/shared/src/events.test.ts`, the test at 226: the ids become the four, the season indices `[2, 5, 27, 28]`; the per-card loop keeps its three old assertions for the first two cards only. Add for the notice: `isCalendarEvent` true, arena `general`, `isEventEligible` true for a non-councilor context, default choice `noted` with `effects` `[]`. Add for the purse: arena `council`, `isEventEligible` false for a non-councilor and true for a councilor, `defaultChoiceFor` null, choice `take` with exactly the two effects above and `refuse` with the one. `assertOneDatedEventPerSeason` still passes on the four.
4. `apps/server/src/services/dailyDecisions.test.ts`: one new test beside (h), (j), (k): in a world started so that now is Autumn 294 BC (`T0 + 27 days`), a non-councilor's set holds the notice and not the purse; a day later (Winter 293 BC) a councilor's set holds the purse and a non-councilor's does not; resolving the purse with `take` pays 100 drachmae and lowers prestige by the engine's applied amount once, a second resolve loses the claim; resolving with `refuse` on another councilor raises prestige; a purse left unresolved past its day applies nothing at the next load and the notice left unresolved settles to `noted` with no effect_log row.
5. Suites: `pnpm --filter @massalia/shared test`, then the server's `dailyDecisions.test.ts` and `eventEngine.test.ts`, then the server suite. Exit codes read directly.

## Gate and STOP 1

Run `DATABASE_URL=…/massalia_test pnpm gate` at HEAD after commit 1, then `pnpm audit --audit-level=high`. The gate must end `GATE GREEN: HEAD <sha>, tree clean`; the audit must exit 0. A red from a timeout in a suite this diff does not touch is a STOP with the log; never rerun to get a pass. Commit only on a read exit code.

STOP 1. Report:

```
Committed: <SHA> content: the election notice and the shipper's purse, two dated cards
Gate: <the gate's last line>, suite counts; audit exit code
Production: the two counts from the read
Dates: each card's season index and its UTC window, and the UTC time of the report
Words: every player-facing string in the two cards, verbatim, for ruling
Deviations, as questions for a ruling: <each with the reason, or "none">
```

## Push (only after I reply "push")

Before 2026-10-12 23:00 UTC, or STOP: a push after that misses the notice's season and the purse's would be cut short. Fast-forward only, plain `git push`. If CI goes red before Checkout on a registry pull, rerun it once; if Railway then leaves the commit SKIPPED, deploy it as AGENTS.md says (environmentTriggersDeploy, the server first, then the worker). Any other red is a STOP with the log. Report:
- remote HEAD
- the CI run with its Gate and Audit steps, and the Pages run
- Railway server and worker on the new SHA; no migration applied
- API health
- read only, an hour after the deploy and again after 2026-10-13 01:00 UTC: for each of the two event ids, the `daily_decisions` rows dealt, how many are resolved, and the count by `choice_id`; for the purse, the `effect_log` rows of kind `change_drachmae` and `change_stat` written since the deploy whose detail matches it

Anything off is a STOP: report it and wait. Do not write to production to fix it.

## Scope fence

Only `content/events/events-dated.json` (two appended cards), `packages/shared/src/events.test.ts` (the one test) and `apps/server/src/services/dailyDecisions.test.ts` (the one new test), plus this file. Do not touch the engine, the schema, the routes, the client, the calendar, the election code or any other content. No migration.

## Corrections (Claude, 12 Oct, checked against f4500fb)

Save the prompt with this section at its end. Where this section and the prompt above differ, this section wins.

1. Where to build. First `git fetch`, `git status -sb` and `git log --oneline origin/main..main`. A dirty tree is a STOP 0. If main has commits ahead of origin/main (the war prompt's or any other), set them aside before you start: `git branch held-main`, then `git reset --keep origin/main`, and note each one's `git patch-id`. Build this prompt on main from origin/main as written. Those commits never go out with this one; item 7 puts them back.

2. The line numbers above are guides. At f4500fb: `eventChoiceSchema` is 149-156; `effectSchema` starts at 110 (`statName` 106, `change_stat` 120, `change_drachmae` 122); `dealDatedCards` is 117-145; `ARENA_LABELS` is `apps/web/src/dashboard/panels/CourtPanel.tsx:10-16`; the election block is `content/calendar/calendar-config.json:8-18`. A line that moved is not a STOP; a behaviour that differs is.

3. Phase 0 also reads production, read only, through `railway run --service Postgres --environment production` with DATABASE_PUBLIC_URL:

```sql
SELECT e.office, e.game_year, e.phase, e.declaration_ends_at, e.voting_ends_at,
       (SELECT count(*) FROM election_candidates c WHERE c.election_id = e.id) AS candidates
FROM elections e JOIN worlds w ON w.id = e.world_id AND w.status = 'active'
ORDER BY e.game_year DESC, e.office;
```

Expected: two rows, archon and ephor, game_year 6, phase `declaration`, declarations closing 2026-10-13 00:00 UTC and voting 2026-10-14 00:00 UTC. Anything else is a STOP 0: the notice would promise the wrong days. Report the candidate counts.

4. Check every claim in the two cards' words against the code, as below. A disagreement is a deviation for STOP 1, not something to reword quietly.
   - Declarations close at the turn into Winter 293 BC (13 Oct 00:00 UTC). The vote runs through that Winter; the winners take office at the turn into Spring 293 BC (14 Oct 00:00 UTC), for six years.
   - Two Archons and two Ephors: for each office one seat on the Palaioi bench and one on the Dynatoi bench. A party member stands only on his own party's bench; an independent picks one.
   - Only a holder of one of the Three Hundred seats may stand. A regent or a party leader may not, and no one serves more than two elected terms in one office.
   - Every living character may vote, seat or no seat: one secret vote per office, for any candidate on either bench, changeable until the close. Each party's NPC bloc backs that party's strongest candidate on its bench.
   - A declared candidate campaigns through the campaign routine (one routine a day). It buys favor with his own party, which sways that party's NPC swing votes at the tally; an independent gains no favor from it.
   - Declaring and voting happen on Politics, Oligarchy Council tab (the election cards under the offices), not on the Government tab, which only sitting officials see.
   - The notice shows under "Massalia" (no `requires`, so the general arena), the purse under "Oligarchy Council".

5. `events.test.ts:226-238` pins two ids, seasons `[2, 5]`, and a council, `take` and 50 drachmae check on every card in the file, so the notice breaks it as written. Keep those checks for the two old cards only. Pin the four ids and their seasons in file order (27 for the notice, 28 for the purse), the notice's arena `general` and its eligibility for a non-councilor, and the purse's arena `council`. Also assert that every dated card has at least one choice: the schema accepts an empty `choices`, and such a card could never be resolved.

6. Reach. The notice's season is today, season 27, from 12 Oct 00:00 to 13 Oct 00:00 UTC. A player gets it at his next dashboard load after the deploy (the Court badge fetches the daily set, and dated cards are dealt on every fetch, also into a set made earlier today), and never if he does not load before 00:00 UTC. Each hour of delay loses readers, so go straight through to STOP 1 and give the UTC time there.

7. Push after my "push" as above, and never at or after 23:00 UTC: if it cannot go out by then, STOP, the notice needs a new date. If item 1 set commits aside, once the push is done: `git rebase main held-main` (none of this prompt's files are in them; on any conflict `git rebase --abort` and STOP), then `git switch main`, `git merge --ff-only held-main`, `git branch -d held-main`. Show each commit's `git patch-id` unchanged and report the new SHAs. Their gate runs again before their own push.

8. Push report, besides the usual (remote HEAD, CI with Gate and Audit, Pages, Railway server and worker on the new SHA, no migration, API health): the time the server went live, and an hour later, read only, `SELECT count(*), count(*) FILTER (WHERE resolved) FROM daily_decisions WHERE event_id = '<the notice's id>'`.

## Rulings on STOP 1 (12 Oct)

1. Fix the notice, and its opening too, which also says only the Three Hundred vote. Scene, verbatim:
`Heralds in the agora: Massalia goes to the vote. The city chooses two Archons and two Ephors, one seat of each for the Palaioi and one for the Dynatoi. Candidacies are open now and close when Winter opens; the vote runs the season through, and the winners take office in Spring. A seat in the chamber is needed to stand; every citizen may vote.`
Result, verbatim: `The heralds move on down the quay. Candidacies and the ballot are under Politics, on the Oligarchy Council tab.`
The choice `Noted` stays. Check the new words against the code as before.

2. Keep the councilors' prestige 20.

3. Noted, keep: a purse left alone lapses as `expired` with nothing paid.

4. No cast. The file already has `ctx` at events.test.ts:34, a Dynatoi trader who is not a councilor. Use it for the citizen and `{ ...ctx, isCouncilor: true }` for the councilor, as line 151 does.

Then two commits, staged by path:
- `content: the election notice says every citizen may vote` (events-dated.json, events.test.ts, and any other test that pins the notice's words)
- `docs: the dated cards 2 prompt's STOP 1 rulings` (these rulings appended to docs/events/dated-cards-prompt-2.md)

Gate at HEAD, then the audit. If the gate ends `GATE GREEN: HEAD <sha>, tree clean` and the audit exits 0: push, plain `git push`, without another STOP, and report as corrections item 8 says. Any red is a STOP with the log. Never at or after 23:00 UTC.
