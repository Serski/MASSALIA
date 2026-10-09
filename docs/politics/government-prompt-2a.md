# Government 2a: the building projects and the League's motion

Save this prompt as docs/politics/government-prompt-2a.md in the first commit. Read AGENTS.md first. Repo HEAD when this was drafted: 2678070. One migration. One concern per commit, staged by path. Recon first and STOP only if something below does not match the code; otherwise build straight through to STOP 1. Before each commit, run the suites its files touch and read the exit code. Commits stay local; no push until I say push.

## What it is

The League cards go. Each Winter the Archons put one building project to the chamber, chosen from a docket of every project the League can still build and afford. A passed project is paid from the League treasury, and work begins when the vote closes. The Walls raise their polis's fortifications when they stand. What the other buildings do (the class incomes, the Temple's morale and stability, the treasury's new income) comes in 2b.

Two things change on the way. The year's chamber question has been taking the League's vote slot every Winter, so no League card has ever reached a vote; that is fixed first. And the city drift changes: stability falls a point a year, and a polis can no longer be stuck at zero people.

## Rulings (9 Oct 2026)

- The year's chamber question no longer opens on its own in a year the League agenda runs. The agenda's own vote is the League's vote of the year: the drafted project, or the year's question when nothing was drafted or the draft was vetoed. Today openChamberVoteIfDue opens the question at the first sweep of each year with scope League, and the agenda's Spring vote for the same (world, scope, year) is then dropped by ON CONFLICT DO NOTHING.
- The docket is every project not yet built or under way, in a polis that qualifies, that the League treasury can afford when the docket opens in Winter. The Archons draft one; an Ephor's veto (one per term) still applies; the chamber votes in Spring. Passed and affordable: the treasury pays the cost, and work begins at the instant the vote closed.
- The five buildings, one of each per polis:
  - Temple of Artemis: 1,000 drachmae, 4 seasons
  - Grand Bazaar: 1,500, 4 seasons
  - Granary: 1,200, 4 seasons
  - Walls: 2,000, 8 seasons; when they stand, the polis's fortifications rise by 1, up to the 5 at the top of the scale
  - Port: 2,000, 8 seasons
- The Temple, the Bazaar and the Granary may only be built in a polis of more than 2,000 people, counted when the docket opens. The Walls and the Port may be built in any polis.
- The NPC leans on the chamber vote: the Temple and the Walls lean Palaioi, the Bazaar and the Port Dynatoi, the Granary independent. Mine, and Argiris's to change at STOP 1.
- Everyone sees each polis's finished buildings and those under way on the Cities tab. The docket stays in the Government tab.
- A League vote on anything but a project, the year's question or a card from a cycle opened before the deploy, resolves its cycle and applies nothing. The League cards' effects are retired with them. The party agendas do not change.
- City drift, once a game year: stability falls by 1, never below 0, replacing the pull toward 70; a polis grows by 2% of its population or 2% of its starting population, whichever is larger. The drift's numbers stay in packages/shared/src/league.ts beside CITY_POP_GROWTH, an exception to the content rule until the drift moves to content as a whole.
- Not in this prompt: what a finished Temple, Bazaar, Granary or Port does (2b), the festival motion (3), war (4), the state army (5).

## Scope

Seven commits; the first also saves this file. Touch only:
- docs/politics/government-prompt-2a.md (this file)
- packages/db/migrations/0071_league_projects.sql (new) and packages/db/src/schema.ts
- packages/db/src/chamber.ts (openChamberVoteIfDue only) and apps/server/src/services/oligarchy.test.ts (its full chamber vote test)
- content/politics/league-buildings.json (new)
- packages/shared/src/leagueProjects.ts and leagueProjects.test.ts (new), packages/shared/src/index.ts (one export line), packages/shared/src/agenda.ts (cardLeans's parameter type only), packages/shared/src/league.ts (the drift section only) and league.test.ts (its import line and the driftCity tests)
- packages/db/src/leagueProjects.ts (new), packages/db/src/agenda.ts, packages/db/src/leagueRevenue.ts (to export its cities loader), packages/db/src/leagueDrift.ts, packages/db/src/index.ts (one export line)
- apps/worker/src/index.ts (the import line and the agenda-sweep)
- apps/server/src/services/agenda.ts and agenda.test.ts, services/government.ts, routes/league.ts and league.test.ts, routes/government.test.ts
- apps/web/src/api.ts, apps/web/src/dashboard/panels/AgendaSection.tsx, GovernmentView.tsx, CitiesView.tsx, apps/web/test/politics-government.test.tsx, apps/web/test/cities-view.test.tsx (new)

Do not touch: the party agendas, their card files and their resolve path, agenda-league.json (kept for the cards' titles), the chamber tally and closeDueChamberVotes, the elections and offices services, creditWorldTreasury, the League's revenue rules, AGENTS.md. No production write.

## Phase 0: recon (read only)

Confirm each of these. On any mismatch, STOP 0 and report.
- main is at 2678070 or a fast-forward of it; say which. The newest migration is 0070_treasury_claims.sql. If main has moved, the new file takes the next free number, and 0071 below means that number.
- packages/db/src/chamber.ts: openChamberVoteIfDue (:72) inserts the year's question whenever chamberVoteDueAt says the year is due, with the default scope 'league' (schema.ts:573), ON CONFLICT DO NOTHING. It runs in the worker's chamber-sweep (apps/worker/src/index.ts:146) and in syncChamberVotes (apps/server/src/services/oligarchy.ts:62-66). chamber_votes is unique on (world_id, scope, game_year) (schema.ts:579).
- packages/db/src/agenda.ts: openAgendaCycleIfDue (:275) draws the docket with drawAgendaCards from `pools[scope]` (:286) into `card_ids`. advanceAgendaCycles (:355): drafting to voting finds the card in `pools[scope]` (:372) and inserts the chamber vote ON CONFLICT DO NOTHING (:375-:378), or the year's question for the League when nothing was drafted (:379-:386), setting the phase in memory (:390); voting to resolved reads the vote, spends through creditTreasury when canAfford (:405), applies the effect, and only then sets the phase to resolved (:414), with no transaction and no claim.
- packages/shared/src/agenda.ts: cardLeans (:48) takes an AgendaCard, which requires `effect`, and reads only `partyLean`.
- apps/server/src/services/agenda.ts: loadAgendaContent (:51) runs at server boot (apps/server/src/index.ts:102); syncAgenda (:83) runs accrueTreasuries, collectLeagueRevenue, the party leaders, openAgendaCycleIfDue, closeDueChamberVotes and advanceAgendaCycles, and runs on every GET /me/state; draftCard refuses an id not in `cycle.cardIds` (:127); AgendaCardView (:204); cardViews (:224) resolves ids from a pool; agendaScopeView builds `cards` from `getAgendaPools()[scope]` (:267); publicLeagueView (:235).
- apps/server/src/services/government.ts: the ledger labels resolve `agenda:<id>` through the League pool's titles (:50-:51).
- apps/worker/src/index.ts: the import line (:7); the agenda-sweep (:177) calls collectLeagueRevenue (:185) and advanceAgendaCycles (:192) and logs one line (:193).
- packages/db/src/leagueRevenue.ts: the cities loader `loadCities` (:27-:31) is private; ensureLeagueCities is exported; collectLeagueRevenue reads cheaply before it opens a transaction.
- packages/shared/src/league.ts: CITY_POP_GROWTH (:531), CITY_STABILITY_BASELINE (:535), CITY_STABILITY_STEP (:537), driftCity (:553); fortifications are 1 to 5 in the cities schema (:358). packages/shared/src/league.test.ts imports CITY_STABILITY_BASELINE (:7) and tests driftCity at :298-:349. packages/db/src/leagueDrift.ts is driftCity's only caller.
- apps/server/src/services/oligarchy.test.ts: the full chamber vote test (:181) opens its vote with openChamberVoteIfDue.
- apps/server/src/services/agenda.test.ts: the two League tests (:99 and :129) draft League cards by id; the chamber setup removes the Dynatoi and independent blocs, so a Palaioi-leaning measure passes.
- apps/server/src/routes/government.test.ts expects `leagueCardsPerCycle` cards on the docket (:134) and drafts and vetoes the docket's first and second ids (:145, :171, :181, :213, :233).
- apps/web/src/api.ts: AgendaCardView (:758), GovernmentView (:796), CityView (:834). apps/web/src/dashboard/panels/CitiesView.tsx has no render test.

Then these production reads, read only, through `railway run --service Postgres --environment production` with DATABASE_PUBLIC_URL. If they cannot run, say so at STOP 1 and carry on.
- World 2's chamber_votes: scope, game_year, agenda_card_id, status, opens_at, closes_at, every row
- its League agenda cycles: game_year, phase, card_ids, drafted_card_id, vetoed_card_id, every row
- its League treasury balance, and any treasury_ledger row whose reason starts with `agenda:`
- its league_cities rows: city_id, population, stability, fortifications

## Commit 1: db: the League's building projects (migration 0071)

1. Save this prompt file.
2. packages/db/migrations/0071_league_projects.sql:
```sql
   -- The League's building projects (government prompt 2a). One row per project
   -- the chamber has passed: the polis, the building, what it cost and the cycle
   -- that passed it. started_at is the instant the vote closed; completes_at the
   -- instant the building stands; completed_at is copied from completes_at by
   -- the sweep that first finds it standing, NULL until then. One of each
   -- building per polis per world. Idempotent, one transaction.
   CREATE TABLE IF NOT EXISTS league_projects (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     world_id uuid NOT NULL REFERENCES worlds(id),
     city_id text NOT NULL,
     building_id text NOT NULL,
     cost integer NOT NULL CHECK (cost >= 0),
     agenda_cycle_id uuid REFERENCES agenda_cycles(id),
     started_at timestamptz NOT NULL,
     completes_at timestamptz NOT NULL,
     completed_at timestamptz,
     UNIQUE (world_id, city_id, building_id)
   );
   CREATE INDEX IF NOT EXISTS league_projects_due_idx ON league_projects (completes_at) WHERE completed_at IS NULL;
```
3. schema.ts: `leagueProjects`, mirroring it, the partial index declared as oligarchSeats declares its own.

## Commit 2: chamber: the year's question leaves the League's slot to the agenda

1. openChamberVoteIfDue returns null, opening nothing, in a year the League agenda runs (`isAgendaYear(year, "league", cfg.agenda)`). In any other due year it opens the question as now.
2. oligarchy.test.ts, the full chamber vote test: it asserts that openChamberVoteIfDue opens nothing in year 0, then opens its vote by inserting the year-0 question row itself (open, closing one season later, as openChamberVoteIfDue did), and runs the rest unchanged.

## Commit 3: shared: the League's buildings, the docket and the project motion

1. content/politics/league-buildings.json, in this order:

   | id | name | title | cost | seasons | populationAbove | partyLean | fortifications |
   |---|---|---|---|---|---|---|---|
   | temple | Temple of Artemis | A Temple of Artemis at {polis} | 1000 | 4 | 2000 | palaioi | 0 |
   | bazaar | Grand Bazaar | The Grand Bazaar of {polis} | 1500 | 4 | 2000 | dynatoi | 0 |
   | granary | Granary | The Granary of {polis} | 1200 | 4 | 2000 | independent | 0 |
   | walls | Walls | The Walls of {polis} | 2000 | 8 | null | palaioi | 1 |
   | port | Port | The Port of {polis} | 2000 | 8 | null | dynatoi | 0 |

   Each also carries a `description`:
   - temple: "Raise the goddess a house of dressed stone. Her priests will remember who paid for it."
   - bazaar: "Roof the market in colonnades and give the traders room to haggle. The treasury will take its share."
   - granary: "Stone bins for the harvest, against the lean years. The landowners will sell into them."
   - walls: "Ring the town in stone. Its fortifications rise by one."
   - port: "Deepen the harbor and lay new slipways. The shipwrights will follow the work."

   The words and the leans are mine and yours to change at STOP 1.
2. packages/shared/src/agenda.ts: cardLeans takes `Pick<AgendaCard, "partyLean">`; nothing else there changes.
3. packages/shared/src/leagueProjects.ts, exported from index.ts, all pure:
   - The zod schema and `parseLeagueBuildings` (strict; unique ids; cost and seasons positive integers; `populationAbove` a non-negative integer or null; `fortifications` 0 or more).
   - `projectMotionId(cityId, buildingId)` gives `project:<cityId>:<buildingId>`; `parseProjectMotionId(id)` gives `{ cityId, buildingId }`, or null for anything else, a League card id included.
   - `leagueDocket(buildings, poleis, taken, balance)`: `poleis` in content order as `{ id, name, population }`, `taken` the set of `<cityId>:<buildingId>` already built or under way. One item per polis per building, polis order first, then the buildings' order, keeping those where `populationAbove` is null or the population is greater than it, the pair is not taken, and the cost is within `balance`. Each item: `{ id, cityId, buildingId, polis, title, description, cost, seasons, partyLean }`, the title with `{polis}` filled in.
   - `projectMotion(id, buildings, cities)`: the same item for one id, with no eligibility check, or null.
4. leagueProjects.test.ts: the content parses; at the nine start populations and a 60,000 balance the docket has 36 items in order (six poleis above 2,000 for the first three buildings, all nine for the Walls and the Port); a polis of exactly 2,000 gets only the Walls and the Port; a taken pair is left out; a balance of 1,499 leaves only the Temple and the Granary; the ids round-trip and a League card id parses to null.

## Commit 4: agenda: the League docket is building projects, and a passed project is paid and built

1. packages/db/src/leagueRevenue.ts exports its cities loader. packages/db/src/leagueProjects.ts, exported from index.ts, reads content/politics/league-buildings.json the same way (memoized, through parseLeagueBuildings) and holds:
   - `leagueDocketFor(worldId)`: ensureLeagueCities, then leagueDocket over the world's poleis (content names, live populations), its league_projects, and the League's balance.
   - `completeLeagueProjects(now = new Date())` for the active world: a cheap read first for a due row (`completed_at IS NULL AND completes_at <= now`), returning at once when there is none, since GET /me/state runs this on every dashboard load. Otherwise ensureLeagueCities, then one transaction that claims the due rows (`UPDATE league_projects SET completed_at = completes_at WHERE world_id = $1 AND completed_at IS NULL AND completes_at <= $2 RETURNING …`) and, for each claimed building with `fortifications` above 0, raises that polis's fortifications with `LEAST(5, fortifications + n)`, row count 1. Returns the claimed rows.
2. packages/db/src/agenda.ts, the League scope only; the party scopes keep their code path exactly:
   - openAgendaCycleIfDue: the League's `card_ids` are the `leagueDocketFor(world.id)` ids, all of them, in order. An empty docket opens a cycle with none, so the year's question goes to the chamber.
   - Drafting to voting: a project id resolves through projectMotion for the vote's title, description and leans (cardLeans); any other drafted id opens the year's question, as when nothing was drafted.
   - Voting to resolved: read the League vote for the year first. While it is still open, leave the cycle in voting; the next pass resolves it. (A pass can take a cycle from drafting straight through voting, or close and advance on different clocks, and a passed project must never be resolved before its vote has closed.) Once it is closed, one transaction, claim first: `UPDATE agenda_cycles SET phase = 'resolved' WHERE id = $1 AND phase = 'voting' RETURNING id`, writing nothing when no row comes back. For a passed project: lock the League's treasuries row (`SELECT … FOR UPDATE`); when the balance covers the cost, insert the league_projects row with `started_at` the cycle's `voting_ends_at` and `completes_at` that plus `seasons` × REAL_MS_PER_SEASON, ON CONFLICT DO NOTHING RETURNING; only with a row back, debit the treasury guarded (`balance = balance - $cost WHERE … AND balance >= $cost`, row count 1) and write its ledger row, `agenda:<project id>` with the negative cost. A failed vote, a project the treasury can no longer cover, the year's question, or a League card from before the deploy: the claim resolves the cycle and nothing else is written.
3. services/agenda.ts: loadAgendaContent also loads league-buildings.json (parseLeagueBuildings) and content/cities/cities.json (parseCitiesContent). AgendaCardView gains optional `group` (the polis's name) and `seasons`. For the League scope, cards resolve a project id through projectMotion (title, description, cost, partyLean, group, seasons) and any other id from the League pool as now. syncAgenda calls completeLeagueProjects after advanceAgendaCycles and counts a completion as a change for broadcastState.
4. The worker's agenda-sweep calls completeLeagueProjects after advanceAgendaCycles; its line gains `built N`.
5. Tests:
   - apps/server/src/services/agenda.test.ts, the two League tests rewritten for projects, with the League treasury credited before the docket opens. The full cycle: the docket is projects; draft the Temple at Massalia, veto it, draft the Walls of Nikaia, pass it. The treasury is down 2,000 with one `agenda:project:nikaia:walls` ledger row; the project starts at the cycle's voting_ends_at and stands 8 seasons later; a second advance writes nothing more. Never overspends: a passed project the treasury can no longer cover writes no project, no debit and no ledger row, and the cycle is resolved. An open vote: advancing a League cycle whose vote is still open leaves it in voting and writes nothing. Completion: before `completes_at` claims nothing; after it, the Walls stand once, Nikaia's fortifications rise by 1, and a second call claims nothing; Walls on a polis already at 5 leave it at 5.
   - routes/government.test.ts: the docket has the 36 projects of the start populations (count it from content, not a literal), each with its `group` and `seasons`; the drafts and vetoes use the docket's project ids.

## Commit 5: server: the projects on the Government tab and the Cities tab

1. services/government.ts: the ledger labels resolve a project id to its title, so a spend reads "Passed measure: The Walls of Nikaia". The member view gains `projects`, the ones under way first by completion, then the built ones by completion:
```ts
   projects: { cityId: string; polis: string; buildingId: string; title: string; status: "building" | "built"; completesAt: string; completesLabel: string }[];
```
   `completesLabel` is `formatGameDate` of `completes_at`, for example "Summer, 292 BC".
2. routes/league.ts GET /cities: each CityView gains `buildings: { buildingId: string; name: string; status: "building" | "built"; completesLabel: string | null }[]`, in content order, `completesLabel` set only while building.
3. Tests: routes/government.test.ts, a league_projects row inserted for the world shows in a member's `projects` with its status and label, and a spend ledger row for it reads "Passed measure: <its title>". routes/league.test.ts, a polis with a project under way and one built shows both with the right status and label.

## Commit 6: cities: stability falls a point a year, and a polis always grows

1. packages/shared/src/league.ts, the drift section: CITY_STABILITY_BASELINE and CITY_STABILITY_STEP give way to `CITY_STABILITY_DECAY = 1`. `driftCity(city, currentYear, startPopulation)`: stability falls by the decay, never below 0; population grows by `Math.round(Math.max(population, startPopulation) * CITY_POP_GROWTH)`; garrison, tax, fortifications and the once-a-year guard as now. The section's comments say so.
2. packages/db/src/leagueDrift.ts passes each city's starting population from the cities content.
3. league.test.ts: the import of CITY_STABILITY_BASELINE goes; the driftCity tests cover the decay (90 to 89, 0 stays 0), growth from 0 (a polis of 0 with a start of 2,000 grows to 40), growth above the start (1,000 with a start of 500 grows to 1,020) and the once-a-year guard.

## Commit 7: web: the docket by polis, the Government's projects, the buildings on the Cities tab

1. api.ts: AgendaCardView gains `group?` and `seasons?`; GovernmentView's member branch gains `projects`; CityView gains `buildings`. The page reads `projects` and `buildings` as `?? []`: Pages can go live before Railway does, and an old server sends neither.
2. AgendaSection.tsx: when the cards carry a `group`, the drafting grid shows the polis's name above its cards, in docket order. A card with `seasons` gets a chip "N seasons". Every cost shows with `toLocaleString()`.
3. GovernmentView.tsx, a Projects card after the treasury: "Under way", one line each, "The Walls of Nikaia · stands Summer, 292 BC"; then "Built", one title per line; "No project yet." when there are none.
4. CitiesView.tsx: under each polis's row, when it has buildings, one muted line: the built ones by name, then each one under way as "Walls (stands Summer, 292 BC)", all joined by " · ".
5. The words in 2 to 4 are mine and yours to change at STOP 1.
6. politics-government.test.tsx: the member fixture gains `projects`; a docket with two polis groups renders both names above their cards and the seasons chip; the Projects card renders both lists; a member view without `projects` still renders. cities-view.test.tsx (new, mocking `api.leagueCities`): a polis with a built building and two under way shows them on one line, a polis without shows none, and a city without `buildings` renders.

## Gate and STOP 1

Run `DATABASE_URL=…/massalia_test pnpm gate` at HEAD after commit 7, then `pnpm audit --audit-level=high`. The gate must end `GATE GREEN: HEAD <sha>, tree clean`; the audit must exit 0. A red from a timeout in a suite this diff does not touch is a STOP with the log; never rerun to get a pass. Commit only on a read exit code.

STOP 1. Report:
- Committed: <SHA> <subject>, one line per commit
- Gate: the last line, suite counts; the audit exit code
- The production reads, and what follows from them: whether any League card ever reached a vote, whether the current year's question is already open, and the docket World 2 would get today (its size, and the poleis above 2,000)
- GET /api/government for a test Archon with one project under way, as JSON
- Every player-facing string this adds or changes, verbatim, for ruling
- Any deviation, as a question for a ruling

## Push (only after I reply "push")

Not in the hour before the 00:00 UTC season rollover. Fast-forward only, plain `git push`. Report:
- remote HEAD
- the CI run with its Gate and Audit steps, and the Pages run
- Railway server and worker on the new SHA; the server's deploy log applying 0071 and skipping every other migration; 0071 in `__massalia_migrations`
- API health
- read only, after the next sync: World 2's League cycle as it stands, any League chamber vote for the current game year (if one exists already, say so: it holds the League's slot for that year), and its league_cities stability values against the STOP 1 reads (the decay lands at the next game year's drift, not before)

A red run is a STOP with the log. Anything off is a STOP: report it and wait. Do not write to production to fix it. I check the tabs in the game myself.

## STOP 1 ruling (9 Oct 2026)

1. The words and the leans are approved as reported: the five names, motion titles and descriptions, the polis headings, the "N seasons" chip, the separators on every cost, the Projects card and the line on the Cities tab.

2. league-buildings.json keeps its { "buildings": [...] } shape, as cities.json does.

3. projects and buildings stay optional in the client's types. Accepted.

4. leagueMeasureTitle, buildingsLine, projectKey, the two getters, the wider TRUNCATE lists and the Port case in the completion test are accepted.

5. The fixture fix in the "member view without projects" test is accepted.

6. The chamber sweep opening nothing in a League agenda year is expected; leave its line as it is. The year-6 cycle keeping its three League cards until it resolves is accepted.

7. Append this ruling verbatim to docs/politics/government-prompt-2a.md under "STOP 1 ruling (9 Oct 2026)", as its own commit: docs: the government prompt 2a's STOP 1 ruling

8. Run the gate and the audit at the new HEAD. If the gate ends GATE GREEN at that HEAD and the audit exits 0, push and report as the prompt's Push section says. Anything else is a STOP. The push must land before 2026-10-13 00:00 UTC, and not in the hour before any 00:00 UTC rollover.
