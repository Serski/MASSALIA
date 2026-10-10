# Government 3: the festival motion

Drafted by Claude on 10 Oct 2026 against 57ec42a from the design doc's rulings of 9 Oct; the open points were ruled by Argiris on 10 Oct (below). Save this prompt as docs/politics/government-prompt-3.md in the first commit. Read AGENTS.md first. One migration. One concern per commit, staged by path. Recon first and STOP only if something below does not match the code; otherwise build straight through to STOP 1. Before each commit, run the suites its files touch and read the exit code. Commits stay local; no push until I say push.

## What it is

Each Summer the Archons put one festival to the chamber for the coming year, chosen from the festivals the coming year allows and the League treasury can afford. The chamber votes in Autumn. A passed festival is paid from the League treasury when the vote closes, and for the four seasons of the coming year every character of the festival's classes draws 10 drachmae a season, through the same settle that pays the buildings' grants. The festival motion runs beside the building motion: the League keeps its Winter docket of projects, and gains a Summer docket of festivals.

## Rulings (design doc, 9 Oct 2026)

- A festival motion each Autumn for the coming year: the Archons name a festival; if passed, its classes get +10 a season for the year.
- The festivals and their classes: Dionysia (Hetairai, Philosophers), Artemisia (Priests, Landowners), Apollo (Traders, Shipbuilders), Olympiad (Hoplites), the Olympiad only in its years.
- An Ephor's veto, one per term, still applies.

## Rulings (Argiris, 10 Oct 2026)

1. **The amount** is each festival's fixed cost, set per festival in content and paid from the League treasury when the vote closes; the Archons choose only the festival.
2. **The costs.** The Artemisia 600, the Olympiad 800, the others less. The content below puts the Dionysia and the Festival of Apollo at 500 each; the exact figures are Argiris's at STOP 1, content only.
3. **The veto is shared.** A festival veto is recorded under the League scope, so an Ephor's one veto per term covers the project motion and the festival motion together.
4. **The timing** stands: drafted in Summer, voted in Autumn, resolved at the Winter boundary, so the festival year is exactly the coming game year.
5. **The leans** stand: all four festivals independent.
6. **The words** below are Claude's; Argiris rules on them at STOP 1 as usual.

## Scope

Six commits; the first also saves this file. Touch only:
- docs/politics/government-prompt-3.md (this file)
- packages/db/migrations/0073_league_festivals.sql (new) and packages/db/src/schema.ts (the new table, and the comment on the three scope checks)
- content/politics/league-festivals.json (new), content/politics/politics-config.json (one key in the agenda block)
- packages/shared/src/leagueFestivals.ts and leagueFestivals.test.ts (new), packages/shared/src/index.ts (one export line), packages/shared/src/agenda.ts (AGENDA_SCOPES, the agenda config schema, draftScopeOffice, vetoScopeOffice, isAgendaYear, agendaCycleSeasons, and a new treasuryOwnerOf) and agenda.test.ts (the cadence and office tests)
- packages/db/src/leagueFestivals.ts (new), packages/db/src/leagueProjects.ts (leagueClassPayFor and leagueClassGrantsFor), packages/db/src/agenda.ts, packages/db/src/index.ts (one export line)
- apps/worker/src/index.ts (the agenda-sweep's scope list)
- apps/server/src/services/agenda.ts, services/government.ts, routes/agenda.ts (parseScope), and the tests services/agenda.test.ts, services/buildings.test.ts, routes/government.test.ts
- apps/web/src/api.ts, apps/web/src/dashboard/panels/AgendaSection.tsx (the kicker), GovernmentView.tsx, PoliticsPanel.tsx (LeagueAgendaSection only), apps/web/test/politics-government.test.tsx

Do not touch: the building projects' docket, resolve and completion, the chamber tally and closeDueChamberVotes, openChamberVoteIfDue, the party agendas and their card files, the player festivals and the choregos (services/festival.ts, events-festivals.json), the Olympiad itself, settleLeagueGrants's claim, the League's revenue rules, AGENTS.md. No production write.

## Phase 0: recon (read only)

Confirm each of these. On any mismatch, STOP 0 and report.
- main is at 57ec42a or a fast-forward of it; say which. The newest migration is 0072_league_building_dues.sql. If main has moved, the new file takes the next free number, and 0073 below means that number.
- packages/db/migrations/0023_agenda_treasury.sql: agenda_cycles.scope (:40), ephor_vetoes.scope (:58) and chamber_votes.scope (:75, named chamber_votes_scope_chk) each carry `CHECK (scope IN ('league', 'palaioi', 'dynatoi'))`; no later migration touches those checks. In Postgres the two inline ones are named agenda_cycles_scope_check and ephor_vetoes_scope_check (pg_constraint on the test database). treasuries.owner and treasury_ledger.owner have the same check (:10, :20) and stay as they are: the festival motion spends from the League's treasury.
- packages/shared/src/agenda.ts: AGENDA_SCOPES (:14-15); agendaConfigSchema (:72-82) with partyCadenceSeasonOffset (:79); draftScopeOffice (:113) and vetoScopeOffice (:118) give the League's Archons and Ephors for "league" and the party offices otherwise; isAgendaYear (:147-148) and agendaCycleSeasons (:158-159) treat every scope but "league" as a party; currentAgendaCycle (:167). cardLeans (:48) takes `Pick<AgendaCard, "partyLean">`.
- packages/db/src/agenda.ts: TreasuryOwner (:51); openAgendaCycleIfDue (:279) builds the League's docket from leagueDocketFor and a party's from its pool (:291); advanceAgendaCycles (:362): the drafting-to-voting measure (:382) and the year's question for the League (:389); the League's claim-first resolve (:411, resolveLeagueCycle :451) and the parties' path (:429 `const owner: TreasuryOwner = scope`); setDraftedCard (:312), setVeto (:323), vetoesUsedThisTerm (:336), getAgendaCycle (:259). The election helper at :540-541 maps "league" to the League offices and anything else to a party.
- packages/db/src/chamber.ts: closeDueChamberVotes (:116); the tally folds the electorate to a party only for the two party scopes (:146), so any other scope votes the whole chamber.
- packages/db/src/leagueProjects.ts: leagueClassPayFor (:62-66) and leagueClassGrantsFor (:68-72) pay from the projects alone; projectTimings (:54). packages/shared/src/leagueProjects.ts: leagueClassPay (:175), LeagueClassGrant (:188), leagueClassGrants (:197), CLASS_PLURALS (:151), the private holds (:167) and spanLabel (:249).
- apps/server/src/services/buildings.ts: settleLeagueGrants (:631) pays through leagueClassPayFor (:663); mine fills leagueGrants through leagueClassGrantsFor (:1054). Neither names a source, so a festival paid through the same two functions reaches the settle and the Economy view unchanged.
- apps/server/src/services/agenda.ts: SCOPES (:95); syncAgenda loops it (:126); draftCard (:145) and vetoCard (:169) take the scope; leagueCardViews (:266); publicLeagueView (:290); agendaScopeView (:303) sets `const owner: TreasuryOwner = scope` (:307); leagueMeasureTitle (:91). routes/agenda.ts parseScope (:15-16). services/government.ts: the member view's `league` (:46, :57).
- apps/worker/src/index.ts: the agenda-sweep opens the three scopes (:188).
- content/calendar/calendar-config.json: the Olympiad entry has cadenceYears 8 and season 3; packages/shared/src/olympiad.ts olympiadConfig (:36) and olympiadFiringAt (:57-59): an Olympiad year is one where `yearInGame % cadenceYears === 0`. The player festivals (fest-dionysia season 1, fest-artemisia 2, fest-apollo 4) carry no display names in content; the names below are new content.
- apps/web/src/api.ts: AgendaScope (:756), AgendaScopeView (:768). AgendaSection.tsx: the kicker (:45) names only "league" and the parties. GovernmentView.tsx: the League docket section (:82). PoliticsPanel.tsx: LeagueAgendaSection renders the league scope alone.
- apps/server/src/services/agenda.test.ts: the League tests (:108-:230) with leagueVote (:103); routes/government.test.ts: the Archon's docket test (:139), the voting world (:238-:239).

Then these production reads, read only, through `railway run --service Postgres --environment production` with DATABASE_PUBLIC_URL. If they cannot run, say so at STOP 1 and carry on.
- World 2's agenda_cycles: scope, game_year, phase, every row (the festival scope must have none)
- its chamber_votes for the current game year: scope, status, agenda_card_id
- the League's balance
- its characters still alive, counted by class_id (how many each festival would reach)
- the current game year and season, from started_at

## Commit 1: db: the League's festivals, and a fourth agenda scope (migration 0073)

1. Save this prompt file.
2. packages/db/migrations/0073_league_festivals.sql:
```sql
   -- The League's festivals (government prompt 3). One row per festival the
   -- chamber has passed: the festival, the game year it is held in, what it cost
   -- and the cycle that passed it. starts_at is the first instant of that year,
   -- ends_at the first instant of the next. One festival per world per year.
   -- The festival motion runs as the agenda scope 'festival', so the three
   -- scope checks of 0023 widen to admit it; the treasury owners stay as they
   -- are, the motion spends from the League's. Idempotent, one transaction.
   CREATE TABLE IF NOT EXISTS league_festivals (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     world_id uuid NOT NULL REFERENCES worlds(id),
     festival_id text NOT NULL,
     game_year integer NOT NULL,
     cost integer NOT NULL CHECK (cost >= 0),
     agenda_cycle_id uuid REFERENCES agenda_cycles(id),
     starts_at timestamptz NOT NULL,
     ends_at timestamptz NOT NULL,
     UNIQUE (world_id, game_year)
   );
   ALTER TABLE agenda_cycles DROP CONSTRAINT IF EXISTS agenda_cycles_scope_check;
   ALTER TABLE agenda_cycles ADD CONSTRAINT agenda_cycles_scope_check CHECK (scope IN ('league', 'palaioi', 'dynatoi', 'festival'));
   ALTER TABLE ephor_vetoes DROP CONSTRAINT IF EXISTS ephor_vetoes_scope_check;
   ALTER TABLE ephor_vetoes ADD CONSTRAINT ephor_vetoes_scope_check CHECK (scope IN ('league', 'palaioi', 'dynatoi', 'festival'));
   ALTER TABLE chamber_votes DROP CONSTRAINT IF EXISTS chamber_votes_scope_chk;
   ALTER TABLE chamber_votes ADD CONSTRAINT chamber_votes_scope_chk CHECK (scope IN ('league', 'palaioi', 'dynatoi', 'festival'));
```
3. schema.ts: `leagueFestivals` mirroring the table; the comments on agendaCycles, ephorVetoes and chamberVotes name the fourth scope and 0073.

## Commit 2: shared: the festivals, the Summer docket and the fourth scope

1. content/politics/league-festivals.json, `{ "festivals": [ … ] }` in this order:

   | id | name | title | classes | cost | bonusPerSeason | olympiadOnly | partyLean |
   |---|---|---|---|---|---|---|---|
   | dionysia | Dionysia | A Dionysia for {year} | hetaira, philosopher | 500 | 10 | false | independent |
   | artemisia | Artemisia | An Artemisia for {year} | priest, landowner | 600 | 10 | false | independent |
   | apollo | Festival of Apollo | A Festival of Apollo for {year} | trader, shipbuilder | 500 | 10 | false | independent |
   | olympiad | Olympiad | The Olympiad of {year} | hoplite | 800 | 10 | true | independent |

   Descriptions:
   - dionysia: "Wine, masks and a chorus the city will hum for a year. The hetairai and the philosophers keep the best seats."
   - artemisia: "A year of processions to the goddess of the city. Her priests and the landowners who feed her altars prosper."
   - apollo: "Games and markets under the god of the harbor. The traders and the shipwrights make the year's best trade."
   - olympiad: "The League sends its athletes to Olympia and feasts their return. The hoplites train in the open all year."

   `{year}` is the festival year's label, "299 BC". The Dionysia's and the Festival of Apollo's costs are placeholders under ruling 2.
2. politics-config.json: the agenda block gains `"festivalCadenceSeasonOffset": 2`; agendaConfigSchema gains it (non-negative integer); packages/shared/src/agenda.test.ts pins it.
3. packages/shared/src/agenda.ts:
   - AGENDA_SCOPES gains "festival". `treasuryOwnerOf(scope)`: "league" for "league" and "festival", the party for a party.
   - draftScopeOffice and vetoScopeOffice treat "festival" as "league": the League's Archons draft, its Ephors veto.
   - isAgendaYear: "festival" uses leagueCadenceGameYears. agendaCycleSeasons: "festival" uses festivalCadenceSeasonOffset, so with 2 it drafts in Summer, votes in Autumn and resolves at the Winter boundary of the coming year.
4. packages/shared/src/leagueFestivals.ts, exported from index.ts, all pure:
   - The zod schema and `parseLeagueFestivals` (strict; unique ids; classes a non-empty list of CLASS_IDS; cost a non-negative integer; bonusPerSeason a positive integer).
   - `festivalMotionId(festivalId, year)` gives `festival:<id>:y<year>`; `parseFestivalMotionId` gives `{ festivalId, year }` or null.
   - `festivalDocket(festivals, year, olympiadYear: boolean, balance)`: one motion per festival the coming `year` allows (an olympiadOnly festival only when `olympiadYear`) within `balance`, in content order; each `{ id, festivalId, title, description, cost, classes, bonusPerSeason, partyLean, year }`, the title with `{year}` filled from `START_YEAR_BC - year`.
   - `festivalMotion(id, festivals)`: the same item for one id, no eligibility check, or null.
   - `FestivalSpan`: `{ festivalId: string; year: number; startsAt: number; endsAt: number }`. `festivalClassPay(spans, festivals, classId, worldStartMs, fromSeason, toSeason)`: for each season in the range whose first instant lies in `[startsAt, endsAt)` of a span whose festival names the class, its bonusPerSeason. `festivalClassGrants(spans, festivals, classId, atMs)`: the spans holding atMs for the class, as LeagueClassGrant (title the motion's, perSeason the bonus, untilMs endsAt).
   - `festivalEffects(festival)`: one line, `"<CLASS_PLURALS joined by ' and '> +<bonus> dr a season for the year"`, for example "Hetairai and Philosophers +10 dr a season for the year".
5. Tests: leagueFestivals.test.ts covers the content, the ids, a docket for a plain year (three festivals), an Olympiad year (four), a balance of 499 (none), a taken year is not the docket's concern; the pay for a Priest over an Artemisia held in year 2 (seasons 8 to 11: 40, with 10 for season 8 alone and 0 for seasons 12 on); the grants at a season inside and outside the year; the effect lines verbatim. agenda.test.ts: the festival scope's seasons for year 2 are 10, 11, 12; its drafter is an Archon and its vetoer an Ephor; treasuryOwnerOf.

## Commit 3: agenda: the Summer docket is festivals, and a passed festival is paid and held

1. packages/db/src/leagueFestivals.ts, exported from index.ts: `loadLeagueFestivals` (memoized, from content); `festivalDocketFor(worldId, year, calendarCfg)` (the League's balance, the Olympiad rule from the calendar's Olympiad entry); `festivalMotionFor(id)`; `festivalSpans(exec, worldId)` (every league_festivals row as a FestivalSpan).
2. packages/db/src/agenda.ts, the festival scope: openAgendaCycleIfDue builds its card_ids from festivalDocketFor for the coming year (the cycle's gameYear + 1); drafting to voting puts the festival motion to the vote with its title, description and leans; voting to resolved runs the League's claim-first path (resolveLeagueCycle generalised to the owner "league"), inserting the league_festivals row for the coming year with starts_at the first instant of that year and ends_at a year later, ON CONFLICT DO NOTHING RETURNING, and only with a row back debiting the treasury and writing `agenda:<motion id>`. A festival veto is recorded under scope "league" (ruling 3, shared), so vetoesUsedThisTerm for the League counts it.
3. packages/db/src/leagueProjects.ts: leagueClassPayFor adds festivalClassPay over festivalSpans; leagueClassGrantsFor appends festivalClassGrants. Nothing in buildings.ts changes.
4. The worker's agenda-sweep opens the four scopes.
5. Tests: agenda.test.ts, a festival cycle for year 2: open at season 10 with the three festivals, draft the Artemisia, veto, draft the Dionysia, pass; the treasury is down 500 with one `agenda:festival:dionysia:y3` row; the league_festivals row spans seasons 12 to 15; a second advance writes nothing; a Hetaira's leagueClassPayFor over seasons 12 to 15 is 40 and a Priest's 0; the Ephor's veto counts against the League's one per term. buildings.test.ts: a Hetaira created at T0 with a Dionysia held in year 1 collects 40 over the year through settleAll, and mine lists it with the motion's title.

## Commit 4: server: the festival docket in the Government tab, the festival before the chamber

1. services/agenda.ts: SCOPES gains "festival"; agendaScopeView's owner is treasuryOwnerOf(scope); festival ids resolve through festivalMotionFor for the cards (title, description, cost, partyLean, effects); publicLeagueView applies to the festival scope too; leagueMeasureTitle resolves a festival id. routes/agenda.ts: parseScope accepts "festival"; GET / returns `festival` as the public view. services/government.ts: the member view gains `festival: AgendaScopeView`, unfiltered.
2. routes/government.test.ts: in a world in its first Summer, the Archon's `festival` carries the three festivals (four in an Olympiad year) with their effects; the citizen's public festival scope is empty while drafting and shows the drafted festival alone once voting.

## Commit 5: web: the festival docket and the festival before the chamber

1. api.ts: AgendaScope gains "festival"; GovernmentView's member branch gains `festival?`; AgendaView gains `festival?`.
2. AgendaSection.tsx: the kicker reads "The festival of the coming year" for the festival scope. GovernmentView.tsx: a second AgendaScopeSection for `view.festival ?? null`, under the League docket, treasury "none". PoliticsPanel's LeagueAgendaSection also renders the public festival scope while it is voting.
3. politics-government.test.tsx: an Archon sees both dockets with their kickers; a citizen sees the festival before the chamber while voting and nothing while drafting.

## Commit 6: the words, on the ledger

services/government.ts: a `festival:` measure's ledger line reads "Festival held: <title>". government.test.ts checks it.

## Gate and STOP 1

Run `DATABASE_URL=…/massalia_test pnpm gate` at HEAD after commit 6, then `pnpm audit --audit-level=high`. The gate must end `GATE GREEN: HEAD <sha>, tree clean`; the audit must exit 0. A red from a timeout in a suite this diff does not touch is a STOP with the log; never rerun to get a pass. Commit only on a read exit code.

STOP 1. Report:
- Committed: <SHA> <subject>, one line per commit
- Gate: the last line, suite counts; the audit exit code
- The production reads, and what follows: when World 2's first festival docket opens (the Summer of the current year, if it has not passed) and which festivals it would hold
- GET /api/government's `festival` scope for a test Archon in a Summer, as JSON
- Every player-facing string this adds or changes, verbatim, for ruling
- Any deviation, as a question for a ruling

## Push (only after I reply "push")

Not in the hour before the 00:00 UTC season rollover. Fast-forward only, plain `git push`. Report as the earlier Government pushes did: remote HEAD, the CI run with its Gate and Audit steps, the Pages run, Railway server and worker on the new SHA, 0073 in `__massalia_migrations` and the three scope checks' new definitions from pg_constraint, API health, and after the next sync World 2's agenda_cycles for the festival scope. A red run is a STOP with the log. Do not write to production to fix it.

## STOP 1 ruling (10 Oct 2026)

1. The words are approved as reported, with one change: a festival's effect line reads "If it passes: <effects>" on its card and before the chamber. A project keeps "When it stands: <effects>".

2. The Dionysia and the Festival of Apollo at 500 are approved, with the Artemisia at 600 and the Olympiad at 800.

3. Deviations 1 to 6 are accepted.

4. The leans. With the NPC blocs at 50 Palaioi, 50 Dynatoi and 10 independent, a measure leaning independent opens at 10 yes against 100 no, and even with every swayable NPC flipped it needs about 50 more player yes votes than no; a measure leaning a party opens at 50 against 60. Commit: content: the festivals and the Granary lean to a party. league-festivals.json: the Artemisia and the Olympiad lean palaioi, the Dionysia and the Festival of Apollo dynatoi. league-buildings.json: the Granary leans palaioi. The tests that pin the old leans follow. The festival cycle test may keep or drop its cleared NPC seats; your call.

5. The chamber shows one open vote. openChamberVote (packages/db/src/chamber.ts) returns any open vote of the world, limit 1 with no order, and both GET /api/oligarchy/votes and castChamberBallot use it. The festival vote is open in Autumn, when the party votes are open too, so a player would see one of them at random and his ballot would land on it. Two commits:
   a. chamber: every open vote, and a ballot names its vote
      - packages/db/src/chamber.ts: openChamberVotes() returns every open vote of the active world, ordered league, festival, palaioi, dynatoi, then by opens_at. openChamberVote() returns the first of them.
      - apps/server/src/services/oligarchy.ts: chamberVotesView gains `openVotes`, the open votes this character may see: the League's and the festival's for everyone, a party's only for that party's members; each with yourBallot and youMayVote (holds a seat). `open` becomes the first of openVotes, or null.
      - castChamberBallot takes an optional voteId. With it, an id not among the character's open votes answers 404 "No such vote is open." and writes nothing; an open vote past its closes_at answers 409 as today. Without it, the ballot goes to the first of the character's open votes, as an old client expects.
      - apps/server/src/routes/oligarchy.ts: POST /vote reads an optional voteId (a uuid string) and passes it.
      - Tests: a festival vote and a Palaioi vote open at once. A seated Palaioi member sees both, the festival first; a seated Dynatoi member sees only the festival; `open` is the festival for both. The Palaioi member's ballot with the Palaioi vote's id lands there, with the festival's id there, and with no id on the festival. The Dynatoi member's ballot with the Palaioi vote's id answers 404 and writes nothing.
   b. web: every open vote in the chamber, and a festival's line reads "If it passes"
      - api.ts: ChamberVotesView gains `openVotes?`; castChamberVote(choice, voteId?) sends voteId.
      - PoliticsPanel.tsx: the chamber renders each of `openVotes ?? (open ? [open] : [])` as its own card, with its own countdown, ballot buttons and ledger (one component per vote, so the countdown hook is never called in a loop); a ballot sends that vote's id.
      - AgendaSection.tsx: the effects line's prefix is "If it passes:" for the festival scope and "When it stands:" otherwise.
      - Tests: two open votes render two cards and each ballot sends its own vote's id; a payload without openVotes renders `open` as before; a festival card reads "If it passes:" and a project card "When it stands:".

6. AGENTS.md, its own commit: AGENTS.md: deploying a skipped commit, and where migrations run
   - The Server line under Deploy topology says what Railway runs today in place of `pnpm railway:start`: the pre-deploy command `pnpm db:migrate && pnpm db:seed` and the start command `pnpm --filter @massalia/server start` (check both with the CLI). It also says that Railway decides a commit's deployment at the push, from the CI check's first outcome: a commit whose CI went red is SKIPPED, and a green rerun does not deploy it.
   - Under Working a prompt, one line: "When CI fails before Checkout (an infrastructure fault), rerun it once. When the rerun is green, deploy the head of main with the public API's environmentTriggersDeploy (input: environmentId, projectId, serviceId): the server first, then the worker once the server is live and __massalia_migrations shows the new migration. `railway redeploy` redeploys the last successful deployment, never a skipped one, and `railway up` ships the local tree; use neither."

7. Append this ruling verbatim to the festival prompt's file under docs/politics/, under "STOP 1 ruling (10 Oct 2026)", as its own commit: docs: the festival prompt's STOP 1 ruling

8. Run the gate and the audit at the new HEAD. If the gate ends GATE GREEN at that HEAD and the audit exits 0, push and report as the prompt's Push section says, plus the number of player-held seats in World 2. Push before 23:00 UTC today so the first festival docket opens at 00:00 UTC. If you cannot push by 22:30 UTC, push after 00:15 UTC on 11 Oct instead, and say whether year 6's festival cycle still opens when the deploy lands in its Summer.

9. If CI fails before Checkout, rerun it once; if the rerun is green and Railway leaves the commit SKIPPED, deploy it as item 6 says, the server first, then confirm 0073 in __massalia_migrations. Anything else red is a STOP with the log.
