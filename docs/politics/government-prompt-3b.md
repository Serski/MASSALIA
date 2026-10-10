# Government 3b: the League's plans, in advance

Drafted by Claude on 10 Oct 2026 against a29aa3f, from Argiris's ruling of 10 Oct. Save this prompt as docs/politics/government-prompt-3b.md in the first commit. Read AGENTS.md first. No migration, no content change, no production write. One concern per commit, staged by path. Recon first and STOP only if something below does not match the code; otherwise build straight through to STOP 1. Before each commit, run the suites its files touch and read the exit code. Commits stay local; no push until I say push.

## What it is

A player outside the Government cannot see what the League can build, where, what a building does, or when the next docket opens. The Cities tab shows only the buildings standing or under way; the building docket appears to the Government alone, and only once it is open; a festival appears to everyone only once it is before the chamber. Players need all of it in advance, to plan their votes, their seats and their class.

This prompt adds three cards to the Cities tab, for everyone: the League's buildings (cost, build time, where, lean, what each does when it stands), the building docket (when it opens and what would be on it, city by city) and the festival docket (when it opens, the year it is for, and each festival with its cost, lean and effect). And wherever an agenda says "No measure is in session.", it now says when the next docket opens.

The first festival docket opens on 11 Oct 2026 00:00 UTC and the first building docket on 13 Oct 00:00 UTC (year 7's Winter), so this must be live before 13 Oct.

## Rulings (Argiris, 10 Oct 2026)

1. Everyone sees in advance. On the Cities tab, at all times: the League's five buildings with what they do; the next building docket, with the date it opens and its projects as it would open today; the next festival docket, with the date it opens, the year it is for and its festivals as it would open today.
2. While a docket is open (its drafting season), its card shows that docket itself: the projects or festivals fixed in the cycle when it opened. This replaces prompt 1's "never the docket while drafted": the list is public. What an Archon drafts and what an Ephor vetoes stay the Government's until the vote, as now. GET /api/agenda's public scopes keep their filter, and the Government tab does not change.
3. Every agenda scope with no measure in session names the season its next docket opens.
4. The words below are Claude's; Argiris rules on them at STOP 1.
5. Not in this prompt: the wallet settle's rounding, the party dockets GET /api/agenda already sends everyone, war (4), the state army (5).

## Scope

Five commits; the first also saves this file. Touch only:
- docs/politics/government-prompt-3b.md (this file)
- packages/shared/src/agenda.ts (one new function after currentAgendaCycle) and agenda.test.ts
- apps/server/src/services/leagueWorks.ts (new), apps/server/src/routes/league.ts (GET /cities only) and routes/league.test.ts
- apps/server/src/services/agenda.ts (its imports, AgendaScopeView, agendaScopeView, the comment above publicLeagueView) and routes/government.test.ts
- apps/web/src/api.ts, apps/web/src/dashboard/panels/CitiesView.tsx, apps/web/src/dashboard/panels/AgendaSection.tsx, apps/web/test/cities-view.test.tsx, apps/web/test/politics-government.test.tsx

Do not touch: the docket rules (leagueDocket, festivalDocket, leagueDocketFor, festivalDocketFor), openAgendaCycleIfDue and the cycles, the draft and the veto, what publicLeagueView filters, GET /api/government, the chamber, PoliticsPanel.tsx, content, migrations, AGENTS.md. No production write.

## Phase 0: recon (read only)

Confirm each of these. On any mismatch, STOP 0 and report.
- main is at a29aa3f or a fast-forward of it; say which.
- packages/shared/src/agenda.ts: isAgendaYear (:166); agendaCycleSeasons (:177), offset 0 for the League, festivalCadenceSeasonOffset for the festival, partyCadenceSeasonOffset for a party; currentAgendaCycle (:186), which reports only a cycle whose drafting or voting season holds the season index. agenda.test.ts takes agendaCfg from content (:26-27); the cadence tests are at :103 and :123.
- packages/db/src/agenda.ts: getAgendaCycle(worldId, scope, gameYear) (:263); openAgendaCycleIfDue (:283) fixes the docket in card_ids when it opens, the League's from leagueDocketFor and the festival's from festivalDocketFor(world, live.gameYear + 1) (:300).
- packages/db/src/leagueProjects.ts: leagueDocketFor(worldId) (:35) uses the live populations, the pairs built or under way and the League's balance (0 with no treasuries row). packages/db/src/leagueFestivals.ts: festivalDocketFor(worldId, year) (:42), with the Olympiad rule.
- packages/shared: projectMotion (leagueProjects.ts:132), buildingEffects(building, polis) (:257), festivalYearLabel (leagueFestivals.ts:78), festivalMotion (:104), festivalEffects (:151); gameDate and formatGameDate (calendar.ts).
- apps/server/src/services/agenda.ts: getLeagueFestivals (:85), getLeagueBuildings (:95), getLeagueCities (:100); AgendaScopeView (:272); the comment above publicLeagueView (:321-327); agendaScopeView (:341) and its no-world return (:346).
- apps/server/src/routes/league.ts: GET /cities (:123) imports @massalia/db and the services inside the handler (:124-128), reads started_at (:156) and returns `{ cities: out }` (:187). It does not sync the agenda; GET /me/state does, on every dashboard load (routes/me.ts:124).
- apps/server/src/routes/league.test.ts: the TRUNCATE cascades through worlds (:63); the world starts a day back, in season 1, Spring 300 BC (:64). routes/government.test.ts: the Scope type (:51), firstSummer (:243).
- apps/web/src/api.ts: leagueCities (:591), AgendaScopeView (:770), LeagueCitiesResponse (:863). CitiesView.tsx keeps `res.cities` alone (:52-55). AgendaSection.tsx: the drafting heading (:64), "No measure is in session." (:109). dashboard.css: .agenda-effects (:3553).

Then these production reads, read only, through `railway run --service Postgres --environment production` with DATABASE_PUBLIC_URL. If they cannot run, say so at STOP 1 and carry on.
- World 2: its id, started_at and the season index now
- its agenda_cycles for the scopes league and festival: game_year, phase, jsonb_array_length(card_ids)
- the League's balance
- its league_cities: city_id, population
- its league_projects, every row

## Commit 1: shared: the docket a scope has open, or the next one to open

1. packages/shared/src/agenda.ts, after currentAgendaCycle: `nextAgendaDocket(seasonIndex, scope, cfg): { gameYear: number; draftSeasonIndex: number; drafting: boolean }`. When currentAgendaCycle reports the scope drafting, that cycle, with drafting true. Otherwise the first agenda year whose drafting season comes after seasonIndex, with drafting false, so a cycle in its voting season points to the next one. Walk the game years up from 0; the cadence is a positive integer, so the walk ends.
2. agenda.test.ts, one describe, with the content's agendaCfg, as {gameYear, draftSeasonIndex, drafting}:
   - league: 0 → {0, 0, true}; 1 → {1, 4, false}; 3 → {1, 4, false}; 4 → {1, 4, true}; 25 → {7, 28, false}; 29 → {8, 32, false}
   - festival: 0 → {0, 2, false}; 2 → {0, 2, true}; 3 → {1, 6, false}; 27 → {7, 30, false}
   - palaioi: 0 → {0, 2, false}
   - with `{ ...agendaCfg, leagueCadenceGameYears: 2 }`: league 1 → {2, 8, false}; 9 → {4, 16, false}

## Commit 2: server: the League's plans on the Cities route

1. New apps/server/src/services/leagueWorks.ts, `leagueWorksView(world: { id: string; startedMs: number }, now = new Date()): Promise<LeagueWorksView>`, with the agenda config from getPoliticsConfig():
   - buildings: every building in content order, `{ id, name, cost, seasons, populationAbove, partyLean, effects }`, effects buildingEffects(building, "The city").
   - projects: next = nextAgendaDocket(the season index now, "league", the agenda config); `{ opensAt, opensLabel, drafting, items }`, opensAt the ISO instant next.draftSeasonIndex begins, opensLabel its formatGameDate. While drafting with a cycle row for that year, the items are its card_ids through projectMotion, skipping any id that is not a project; otherwise, drafting without a row yet included, leagueDocketFor(world.id). Each item `{ id, cityId, polis, buildingId, name }`, name the building's.
   - festivals: the same for "festival", plus year = next.gameYear + 1 and yearLabel festivalYearLabel(year); the items are the cycle's card_ids through festivalMotion, or festivalDocketFor(world.id, year). Each item `{ id, name, cost, partyLean, effects }`, name the festival's, effects festivalEffects.
2. routes/league.ts, GET /cities: import the service inside the handler as the others are, and return `{ cities: out, works: await leagueWorksView({ id: worldId, startedMs }) }`.
3. routes/league.test.ts, with a League treasuries row at 60,000 unless a test says otherwise:
   - works.buildings is the five content buildings in order; the Temple's effects are ["Priests +20 dr a season for 4 seasons", "Every army +3 morale for 2 years", "The city +3 stability a year"] and the Walls' ["The city's fortifications +1"].
   - In the season-1 world: projects is not drafting, opensAt the world's start plus 4 days, opensLabel "Winter, 299 BC", and its item ids equal leagueDocket over the content's cities at their start populations with nothing taken and 60,000 (36 items); festivals is not drafting, opensLabel "Summer, 300 BC", year 1, yearLabel "299 BC", item ids ["festival:dionysia:y1", "festival:artemisia:y1", "festival:apollo:y1"], each with festivalEffects.
   - A project under way (Massalia's Temple) is not on it.
   - The world's start moved to an hour back (its first Winter, the League drafting year 0), with a League cycle for year 0 holding ["project:nikaia:walls", "project:olbia:port"]: projects is drafting, opensLabel "Winter, 300 BC", and the items are those two in that order. The same world without the cycle row: drafting, and the 36.
   - No treasuries row: both item lists are empty.

## Commit 3: server: every agenda scope names when its next docket opens

1. services/agenda.ts: AgendaScopeView gains `nextOpensLabel: string | null`, the formatGameDate of the draft season of nextAgendaDocket for the scope (the open docket's while drafting), null with no world. publicLeagueView passes it through. Its comment's last sentence becomes: while drafting the cards are empty here; the docket itself is public on the Cities tab (government prompt 3b), but what is drafted and vetoed is not.
2. routes/government.test.ts: the Scope type gains `nextOpensLabel`. In a world in its first Summer, a citizen's public League scope has phase null and nextOpensLabel "Winter, 299 BC", and the festival scope "Summer, 300 BC". In a world in its first Autumn (started three days and an hour back), the festival scope's nextOpensLabel is "Summer, 299 BC".

## Commit 4: web: the League's plans on the Cities tab

1. api.ts: `LeagueWorksView` as the server sends it; LeagueCitiesResponse gains `works?` (Pages can go live before Railway does, and an old server sends none).
2. CitiesView.tsx keeps the whole response. After the city groups, while `works` is there, three DashboardCards in this order, each with its label in `panel-label`; muted lines carry class `works-note`, each building or festival is a `works-item` with its name in `dashboard-label` and a muted `works-facts` line; inline styles as the file already uses; costs and populations with toLocaleString:
   - class `works-buildings`, label "The League's buildings"; a note "One of each per city. Each Winter the Archons put one project to the chamber; it votes in Spring."; per building the facts `<cost> dr · built in <seasons> seasons · <where> · <Lean> lean`, where is "Cities of more than <n> people" or "Any city", then `When it stands: <effects joined by " · ">` (class agenda-effects).
   - class `works-projects`, label "The building docket"; a note, while drafting "Open now. The Archons choose one this season; the chamber votes next season.", else "Opens <opensLabel>. Shown as it would open today; city sizes change at each new year."; then one `works-row` per city in item order: the city's name, and its buildings' names joined by " · ". With no items: "No project can go on it today."
   - class `works-festivals`, label "The festival docket"; a note, while drafting "Open now, for the year <yearLabel>. The Archons choose one this season; the chamber votes next season.", else "Opens <opensLabel>, for the year <yearLabel>. Shown as it would open today."; per festival the facts `<cost> dr · <Lean> lean`, then `If it passes: <effects>` (agenda-effects). With no items: "No festival can go on it today."
3. cities-view.test.tsx: a payload with works (two buildings, the Temple and the Walls; three items in two cities; one festival) shows the three cards in that order with every line above verbatim; drafting shows the two "Open now" notes; empty items show the two "can go on it today" lines; a payload without works shows none of the cards and the cities as before.

## Commit 5: web: when the next docket opens, and where the docket is

1. api.ts: AgendaScopeView gains `nextOpensLabel?: string | null`.
2. AgendaSection.tsx: the no-measure line reads "No measure is in session. The next docket opens <nextOpensLabel>." while the label is there, and as now without it. While drafting with no cards (the public League view), a line under the heading, class dashboard-todo: "The docket is on the Cities tab."
3. politics-government.test.tsx: a citizen's Council League card with phase null and nextOpensLabel "Winter, 293 BC" shows the line with the date; without the field, "No measure is in session." alone. The default public view (drafting, no cards) shows the Cities line; an Archon's docket on the Government tab does not.

## Gate and STOP 1

Run `DATABASE_URL=…/massalia_test pnpm gate` at HEAD after commit 5, then `pnpm audit --audit-level=high`. The gate must end `GATE GREEN: HEAD <sha>, tree clean`; the audit must exit 0. A red from a timeout in a suite this diff does not touch is a STOP with the log; never rerun to get a pass. Commit only on a read exit code.

STOP 1. Report:
- Committed: <SHA> <subject>, one line per commit
- Gate: the last line, suite counts; the audit exit code
- The production reads, and from them what the Cities tab will show in World 2 now, on 11 Oct and on 12 Oct: each docket's note and its items (the projects counted by city)
- From the route test, the `works` JSON for the season-1 world (the project items cut to the first three, with the count)
- Every player-facing string this adds or changes, verbatim, for ruling
- Any deviation, as a question for a ruling

## Push (only after I reply "push")

Not in the hour before the 00:00 UTC season rollover, and before 2026-10-12 23:00 UTC. Fast-forward only, plain `git push`. If CI goes red before Checkout on a registry pull, rerun it once; if Railway then leaves the commit SKIPPED, deploy it as AGENTS.md says (environmentTriggersDeploy, the server first, then the worker). Any other red is a STOP with the log. Report:
- remote HEAD
- the CI run with its Gate and Audit steps, and the Pages run
- Railway server and worker on the new SHA; no migration applied (`__massalia_migrations` still ends at 0073)
- API health
- GET /api/league/cities `works` from production if you hold a session there; otherwise say so, and I check the Cities tab in the game

Anything off is a STOP: report it and wait. Do not write to production to fix it.
