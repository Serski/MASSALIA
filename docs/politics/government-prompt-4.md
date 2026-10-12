# Government 4: the war motion

Drafted by Claude on 10 Oct 2026 against c3378ee and brought up to f4500fb (raids prompt 6, the rolled plunder) on 11 Oct and to a007920 on 12 Oct (of the files below, the dated cards, party leaders and holdings 1 and 2 changed packages/db/src/agenda.ts, whose lines from 230 on moved up 9, and the raid code: services/mapActions.ts moved down 1 and koinonMuster.ts down 22 around the lines cited; the numbers below are current), from the rulings Argiris approved on 10 Oct. Save this prompt as docs/politics/government-prompt-4.md in the first commit. Read AGENTS.md first. One migration. One concern per commit, staged by path. Recon first and STOP only if something below does not match the code; otherwise build straight through to STOP 1. Before each commit, run the suites its files touch and read the exit code. Commits stay local; no push until I say push.

## What it is

The Archons gain a third motion: war on one nation of the Diplomacy page. Each Spring the Archons put one war to the chamber, chosen from the nations whose bar is below 0; the chamber votes in Summer. A passed war is paid from the League treasury when the vote closes. For the 8 seasons that follow, the nation is at war with the League: its bar shows War, raids on its land no longer sour it and take half again as much plunder. Then peace comes by itself and its bar is set to −100. The war motion runs beside the other two: buildings in Winter and Spring, war in Spring and Summer, festivals in Summer and Autumn.

The first war docket can open in World 2 on 14 Oct 2026 00:00 UTC (year 7's Spring).

## Rulings (Argiris, 10 Oct 2026)

1. The war motion is a fifth agenda scope, 'war': drafted in Spring, voted in Summer, resolved at the Autumn boundary, once a game year. The League's Archons draft it, its Ephors veto it with the League's one veto per term (recorded under the League scope, as the festival's is), and it spends from the League treasury.
2. The docket is every nation of the Diplomacy page whose bar is below 0 and that is not at war, in content order, while the treasury can pay the war's cost. A nation with no row yet counts at its content start.
3. Declaring costs 2,000 drachmae from the League treasury. The motion leans Palaioi.
4. While at war: the nation's at_war flag is set and its bar pinned at −200 (events and raids leave it there); raids on its land roll no opinion loss and take 1.5 times the plunder (drachmae, grain and the spoil), on top of the rates raids prompt 6 rolls and the town's double.
5. Peace comes by itself 8 seasons after the war starts: the flag drops and the bar is set to −100. No peace motion.
6. The war's numbers live in content/politics/league-war.json, its cadence offset in politics-config.json beside the festival's. The state army going to war comes with prompt 5.
7. Everyone sees the war docket in advance on the Cities tab, as for the other two dockets (prompt 3b); the drafted war and a veto stay the Government's until the vote.
8. The words below are Claude's; Argiris rules on them at STOP 1.

## Scope

Six commits; the first also saves this file. Touch only:
- docs/politics/government-prompt-4.md (this file)
- packages/db/migrations/0074_league_wars.sql (new), packages/db/src/schema.ts (the new table, and the comments on the three scope checks)
- content/politics/league-war.json (new), content/politics/politics-config.json (one key in the agenda block)
- packages/shared/src/leagueWars.ts and leagueWars.test.ts (new), packages/shared/src/index.ts (one export line), packages/shared/src/agenda.ts and agenda.test.ts, packages/shared/src/barracks.ts (raidPlunder only) and battle.test.ts (its raidPlunder tests)
- packages/db/src/leagueWars.ts (new), packages/db/src/agenda.ts, packages/db/src/chamber.ts (SCOPE_ORDER), packages/db/src/index.ts (one export line)
- apps/worker/src/index.ts (the agenda-sweep)
- apps/server/src/services/factionOpinion.ts, mapActions.ts and koinonMuster.ts (the raid's opinion and plunder lines only), eventEngine.ts (change_faction_stance only), services/agenda.ts, services/government.ts, services/oligarchy.ts (visibleOpenVotes), services/leagueWorks.ts, routes/agenda.ts, routes/league.ts (GET /diplomacy only), and the tests services/agenda.test.ts, oligarchy.test.ts, mapActions.test.ts, koinonMuster.test.ts, eventEngine.test.ts, routes/government.test.ts, routes/league.test.ts
- apps/web/src/api.ts, apps/web/src/dashboard/panels/AgendaSection.tsx, GovernmentView.tsx, PoliticsPanel.tsx (LeagueAgendaSection only), CitiesView.tsx, DiplomacyView.tsx (FactionStatusBadges only), and the tests politics-government.test.tsx, cities-view.test.tsx, diplomacy-view.test.tsx (new)

Do not touch: the project and festival dockets and their resolve, the chamber tally and closeDueChamberVotes, the party agendas, raidAngers, raid turnout, attacks and conquest, tribute, the Diplomacy page's opinion bands, the League's revenue, AGENTS.md. No production write.

## Phase 0: recon (read only)

Confirm each of these. On any mismatch, STOP 0 and report.
- main is at a007920 or a fast-forward of it, with no local commits that are not on origin/main; say which. The newest migration is 0073_league_festivals.sql; if main has moved, the new file takes the next free number and 0074 below means that number.
- packages/db/migrations/0073_league_festivals.sql widens the three scope checks (agenda_cycles_scope_check, ephor_vetoes_scope_check, chamber_votes_scope_chk) to ('league', 'palaioi', 'dynatoi', 'festival'). faction_relations is unique on (world_id, faction_id) and carries opinion, at_war and the derived stance (schema.ts:1283-1303).
- packages/shared/src/agenda.ts: AGENDA_SCOPES (:14), FESTIVAL_SCOPE (:22), MotionScope (:23), MOTION_SCOPES (:24), treasuryOwnerOf (:28), festivalCadenceSeasonOffset in agendaConfigSchema (:98), draftScopeOffice (:132), vetoScopeOffice (:137), isAgendaYear (:166), agendaCycleSeasons (:177), currentAgendaCycle (:186), nextAgendaDocket (:203). Each of them names "league" and FESTIVAL_SCOPE where the League's motions differ from a party's.
- packages/shared/src/league.ts: OPINION_MIN (−200), opinionBand (:308), applyOpinion, factionOfPolity (:514), raidGrudgeLine (:521: a major power by its name, a people with "The"); FactionDef (:479), parseFactionsContent (:488). content/diplomacy/factions.json: 19 factions; at their content start six are below 0: cadurci −45, volcae −137, allobroges −45, saluvii −45, tarusates −45, carthage −137.
- packages/shared/src/barracks.ts: raidAngers (:455), rateBounds (:460), rollRate (:466), and raidPlunder(raid, kills, isTown, seed) (:477), which rolls each rate once per raid ("plunder", "grain", "spoilRate") and pays `Math.round(kills × rate × mult)` with the town multiplier; the raid schema is strict (:297-317). battle.test.ts tests raidPlunder at :101. The server suites mapActions.test.ts and koinonMuster.test.ts check a plunder with their `expectRolledPlunder(plunder, kills, mult)` helpers.
- packages/db/src/agenda.ts: openAgendaCycleIfDue (:274) and its docket branch (:287-292); advanceAgendaCycles (:361): the measure put to the vote (:381), the year's question for "league" alone (:388), the League motions' resolve (:412) and the parties' (:422); resolveLeagueCycle (:457) with its treasury lock, the projects and festivals inserts ON CONFLICT DO NOTHING RETURNING and the debit with its ledger row `agenda:<motion id>`. packages/db/src/chamber.ts: SCOPE_ORDER (:61); the tally folds the electorate to a party only for the two party scopes.
- apps/server/src/services/agenda.ts: loadAgendaContent (:71-86), leagueMeasureTitle (:109), SCOPES (:115), syncAgenda (:135) with completeLeagueProjects (:161), draftCard's 403 message (:178), ephorTermYear (:221), festivalCardViews (:315), agendaScopeView's cards (:367). services/government.ts: the member view's festival (:69). services/oligarchy.ts: visibleOpenVotes (:250-252). routes/agenda.ts: parseScope (:16), GET / with the public festival (:36). services/leagueWorks.ts: the festival docket (:82-93). routes/league.ts GET /diplomacy: the faction rows seeded on read (:212-218) and atWar (:274).
- apps/server/src/services/factionOpinion.ts: raidOpinion(exec, worldId, polityId, seed) rolls, seeds the faction row from content, locks it and lowers it. mapActions.ts calls it (:660) and raidPlunder (:664) on a raid; koinonMuster.ts at :1080 and :1085. Since holdings 2 (a007920) a raid on another house's holding is refused at launch and turns back at arrival before either call; the won-raid branch is unchanged. eventEngine.ts: change_faction_stance (:265) moves the bar with applyOpinion and logs it.
- apps/worker/src/index.ts: the agenda-sweep loops MOTION_SCOPES (:188) and reports `built` (:194-195).
- apps/web/src/api.ts: AgendaScope (:758), AgendaView (:791), the Government member view's festival (:816), LeagueWorksView (:872), FactionView (:900) with atWar (:911). AgendaSection.tsx: kicker (:45) and effectsPrefix (:47). GovernmentView.tsx: the festival section (:83). PoliticsPanel.tsx: the festival while voting (:705). CitiesView.tsx: LeagueWorks (:53) and its festival card (:93). DiplomacyView.tsx: FactionStatusBadges (:120) with the War badge (:123).

Then these production reads, read only, through `railway run --service Postgres --environment production` with DATABASE_PUBLIC_URL. If they cannot run, say so at STOP 1 and carry on.
- World 2: its id, started_at and the season index now
- its faction_relations: faction_id, opinion, at_war, every row (a faction with no row is at its content start)
- the League's balance
- its agenda_cycles for the scope 'war' (none expected), and its open chamber_votes: scope, title

## Commit 1: db: the League's wars, and a fifth agenda scope (migration 0074)

1. Save this prompt file.
2. packages/db/migrations/0074_league_wars.sql:

```sql
   -- The League's wars (government prompt 4). One row per war the chamber has
   -- passed: the nation, the game year of the motion, what it cost and the
   -- cycle that passed it. starts_at is the instant the vote closed, ends_at
   -- the instant peace comes, ended_at stamped once when it does. One war
   -- declared per world per year, and one open war per nation. The war motion
   -- runs as the agenda scope 'war', so the three scope checks widen to admit
   -- it; the motion spends from the League's treasury. Idempotent, one transaction.
   CREATE TABLE IF NOT EXISTS league_wars (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     world_id uuid NOT NULL REFERENCES worlds(id),
     faction_id text NOT NULL,
     game_year integer NOT NULL,
     cost integer NOT NULL CHECK (cost >= 0),
     agenda_cycle_id uuid REFERENCES agenda_cycles(id),
     starts_at timestamptz NOT NULL,
     ends_at timestamptz NOT NULL,
     ended_at timestamptz,
     UNIQUE (world_id, game_year)
   );
   CREATE UNIQUE INDEX IF NOT EXISTS league_wars_one_open_per_faction ON league_wars (world_id, faction_id) WHERE ended_at IS NULL;
   ALTER TABLE agenda_cycles DROP CONSTRAINT IF EXISTS agenda_cycles_scope_check;
   ALTER TABLE agenda_cycles ADD CONSTRAINT agenda_cycles_scope_check CHECK (scope IN ('league', 'palaioi', 'dynatoi', 'festival', 'war'));
   ALTER TABLE ephor_vetoes DROP CONSTRAINT IF EXISTS ephor_vetoes_scope_check;
   ALTER TABLE ephor_vetoes ADD CONSTRAINT ephor_vetoes_scope_check CHECK (scope IN ('league', 'palaioi', 'dynatoi', 'festival', 'war'));
   ALTER TABLE chamber_votes DROP CONSTRAINT IF EXISTS chamber_votes_scope_chk;
   ALTER TABLE chamber_votes ADD CONSTRAINT chamber_votes_scope_chk CHECK (scope IN ('league', 'palaioi', 'dynatoi', 'festival', 'war'));
```
3. schema.ts: `leagueWars` mirroring the table and the partial index; the comments on agendaCycles, ephorVetoes and chamberVotes name the fifth scope and 0074.

## Commit 2: shared: the war motion, its docket and the fifth scope

1. content/politics/league-war.json:

```json
   {
     "cost": 2000,
     "seasons": 8,
     "opinionBelow": 0,
     "peaceOpinion": -100,
     "plunderMultiplier": 1.5,
     "partyLean": "palaioi",
     "title": "War on {nation}",
     "description": "The League takes up arms against {nation}. Every raid on their land becomes an act of war, and pays like one."
   }
```
2. politics-config.json: the agenda block gains `"warCadenceSeasonOffset": 1`; agendaConfigSchema gains it (non-negative integer).
3. packages/shared/src/agenda.ts: `WAR_SCOPE = "war"`; MotionScope and MOTION_SCOPES gain it. A new `isLeagueMotion(scope)`: true for "league", FESTIVAL_SCOPE and WAR_SCOPE. treasuryOwnerOf, draftScopeOffice, vetoScopeOffice and isAgendaYear use it in place of their "league or festival" tests; agendaCycleSeasons gives "war" warCadenceSeasonOffset, so with 1 it drafts in Spring, votes in Summer and resolves at the Autumn boundary.
4. packages/shared/src/leagueWars.ts, exported from index.ts, all pure:
   - The strict zod schema and `parseLeagueWar`: cost a non-negative integer, seasons a positive integer, opinionBelow and peaceOpinion integers within −200..200, plunderMultiplier at least 1, partyLean palaioi/dynatoi/independent, title and description strings holding `{nation}`.
   - `nationName(faction)`: a major power by its name, a people with "the" ("Carthage", "the Cadurci"), the rule raidGrudgeLine follows.
   - `warMotionId(factionId, year)` gives `war:<factionId>:y<year>`, the cycle's game year; `parseWarMotionId` gives `{ factionId, year }` or null.
   - `warDocket(factions, relations, war, year, balance)`, relations a map of faction id to `{ opinion, atWar }`: one motion per faction, in content order, whose opinion (its relation's, else its content start) is below war.opinionBelow and that is not at war (likewise), while war.cost is within balance; each `{ id, factionId, name, title, description, cost, partyLean, year }`, name the faction's name, title and description with `{nation}` from nationName (title "War on Carthage", "War on the Cadurci").
   - `warMotion(id, factions, war)`: the same item for one id, with no eligibility check, or null.
   - `warEffects(war)`: two lines, `Raids on the enemy's land +<(plunderMultiplier − 1) × 100>% plunder` and `Peace after <span>, at <opinionBand(peaceOpinion).label>`, the span in the words buildingEffects uses (8 seasons read "2 years"; export that helper from leagueProjects.ts rather than copying it). With the content: "Raids on the enemy's land +50% plunder" and "Peace after 2 years, at Hostile".
5. packages/shared/src/barracks.ts: raidPlunder gains a last argument `warMultiplier = 1`, multiplying the drachmae, grain and spoil beside the town multiplier, after the rolled rates and before rounding. The rolls themselves do not change.
6. Tests. leagueWars.test.ts: the content parses and a missing or extra key fails; nationName for Carthage and the Cadurci; the ids; the docket at the content starts with 60,000 is the six nations in content order with "War on the Cadurci" first and "War on Carthage" last; a relation that puts the Ruteni at −1 adds them, one that puts the Cadurci at 0 drops them, one at war drops Carthage; a balance of 1,999 gives none; warEffects verbatim. agenda.test.ts: the war scope's seasons for year 2 are 9, 10, 11; its drafter is an Archon and its vetoer an Ephor; treasuryOwnerOf("war") is "league"; isLeagueMotion; nextAgendaDocket for war: 0 → {0, 1, false}, 1 → {0, 1, true}, 2 → {1, 5, false}. battle.test.ts, beside the raidPlunder test: on the same seed a raid at war rolls the same rates and the same good as at peace; a town raid of 3 kills at war pays exactly 1.5 times the peace amounts (3 × 2 × 1.5 × rate, so whole); warMultiplier 1 pays as before.

## Commit 3: agenda: the Spring docket is wars, a passed war is declared and paid, and peace comes by itself

1. packages/db/src/leagueWars.ts, exported from index.ts: `loadLeagueWar` and `loadFactions` (memoized, from content); `warDocketFor(worldId, year)` (the world's faction_relations rows, the League's balance, warDocket); `warMotionFor(id)`; `activeWars(exec, worldId)` (the rows with ended_at null: faction_id, starts_at, ends_at); and `endLeagueWars(now)`: for the active world, one transaction: claim the rows with ended_at null and ends_at at or before now (UPDATE … SET ended_at = ends_at … RETURNING), and for each set its faction's at_war false, opinion war.peaceOpinion and stance opinionBand of it, checking one row. A cheap read first, so a world with no war due opens no transaction. Returns the claimed rows.
2. packages/db/src/agenda.ts:
   - openAgendaCycleIfDue: the war scope's card_ids are warDocketFor(world, the cycle's gameYear).
   - drafting to voting: a drafted war goes to the vote through warMotionFor, with its title, description and leans. Nothing drafted opens no vote, as for the festival.
   - The League motions' resolve takes `isLeagueMotion(scope)`, the parties' path its negation. resolveLeagueCycle handles a war: under the League treasury lock and canAfford as now, insert the league_wars row (starts_at the cycle's votingEndsAt, ends_at war.seasons later) ON CONFLICT DO NOTHING RETURNING, and with no row back write nothing more; then seed the faction's row from content (ON CONFLICT DO NOTHING) and set at_war true, opinion −200 and stance opinionBand(−200).id on it, checking one row; then the debit and the `agenda:war:<faction>:y<year>` ledger row as for the other motions. A war motion carries no `seasons`, so it must not fall into the projects' branch.
3. packages/db/src/chamber.ts: SCOPE_ORDER is league 0, war 1, festival 2, palaioi 3, dynatoi 4.
4. The worker's agenda-sweep calls endLeagueWars after completeLeagueProjects and reports `peace <n>` in its line.
5. services/agenda.test.ts, a war cycle in year 2, this suite's Palaioi-only chamber passing the Palaioi-leaning motion: with 5,000 seeded, the cycle opens at season 9 with the six nations; draft war:volcae:y2, veto (under "league", counted against the Ephor's one), draft war:carthage:y2; at season 10 the vote opens titled "War on Carthage" with leans palaioi yes; a yes ballot; at season 11 the cycle resolves: spent 2,000, one `agenda:war:carthage:y2` row, a league_wars row from season 11 to season 19, Carthage's relation at_war with −200; a second advance writes nothing. endLeagueWars at season 18 ends nothing; at season 19 it ends the war once (ended_at season 19, Carthage at peace at −100), and a second call ends nothing. A passed war the treasury can no longer cover writes no war, no debit and no ledger row.

## Commit 4: raids: a nation at war takes more plunder and no longer sours

1. services/factionOpinion.ts: raidOpinion returns null when the faction's locked row is at war (the bar stays pinned). A new `raidWarMultiplier(exec, worldId, polityId)`: the land's faction at war (its row, else its content start) gives league-war.json's plunderMultiplier, anything else 1.
2. mapActions.ts and koinonMuster.ts: a won raid passes raidWarMultiplier of its land to raidPlunder. Nothing else in either file changes.
3. eventEngine.ts, change_faction_stance: a faction at war is left as it is, with no effect_log row.
4. Tests. mapActions.test.ts, beside the town raid on Reii: with the Saluvii at war (at_war true, −200), the raid's plunder passes expectRolledPlunder at mult 3 (the town's 2 times the war's 1.5), the wallet and stocks rise by the report's amounts, its report's opinion is null and the Saluvii stay at war at −200. koinonMuster.test.ts: a won muster raid on a town of a nation at war passes expectRolledPlunder at the town multiplier times 1.5 (a town keeps the amounts whole), its shares add up to the totals, and the bar stays. eventEngine.test.ts: change_faction_stance on a faction at war leaves it at −200 and logs nothing; on one at peace it moves as before.

## Commit 5: server: the war docket in the Government tab, before the chamber and on the Cities tab

1. services/agenda.ts: loadAgendaContent loads league-war.json and the factions; `warCardViews(ids)` gives each war motion `{ id, title, description, cost, partyLean, effects: warEffects }`; agendaScopeView's cards take it for "war"; leagueMeasureTitle resolves a war id; draftCard's 403 message and ephorTermYear test isLeagueMotion; syncAgenda runs endLeagueWars after completeLeagueProjects and broadcasts when one ended. agendaScopeView counts the Ephor's vetoes under vetoScopeOf(scope) as vetoCard does (:361 passes the scope itself today), so a veto used on the League's docket hides the veto on the festival's and the war's.
2. services/government.ts: the member view gains `war: AgendaScopeView`, unfiltered. routes/agenda.ts: parseScope accepts "war"; GET / returns `war`, the public view. services/oligarchy.ts: visibleOpenVotes shows the war vote to everyone.
3. services/leagueWorks.ts: works gains `wars: { opensAt, opensLabel, drafting, items, atWar }`: the docket as for the festivals (the cycle's card_ids while drafting with a row, else warDocketFor), each item `{ id, factionId, name, bandLabel }`, name the faction's name and bandLabel the band of its bar now (its row, else its content start); atWar the active wars, each `{ factionId, name, throughLabel }`, throughLabel the game date of ends_at minus 1 ms.
4. routes/league.ts GET /diplomacy: each faction gains `warThroughLabel`, the same label while it is at war, else null.
5. Tests. government.test.ts: in a world in its first Spring, the Archon's `war` holds the six nations with their effects and the citizen's public war scope is empty while drafting; once voting, the public scope shows the drafted war alone; an Ephor who has vetoed on the League's docket this term has youMayVeto false on a drafted war. oligarchy.test.ts, beside "several open votes" (:249): with a war vote and a Palaioi vote open together, a seated Dynatoi member sees the war vote and his ballot with its id lands there. league.test.ts: in the season-1 world (its first Spring) works.wars is drafting with the six nations; a war under way shows in atWar with its throughLabel, drops its nation from the docket, and GET /diplomacy gives that faction its warThroughLabel.

## Commit 6: web: the war motion

1. api.ts: AgendaScope gains "war"; AgendaView and the Government member view gain `war?`; LeagueWorksView gains `wars?`; FactionView gains `warThroughLabel?`.
2. AgendaSection.tsx: the kicker reads "The war motion" for the war scope; the effects prefix is "If it passes:" for the festival and the war. GovernmentView.tsx: an AgendaScopeSection for `view.war`, under the festival's, treasury "none". PoliticsPanel's LeagueAgendaSection renders the public war scope while it is voting.
3. CitiesView.tsx: after the festival docket, while `works.wars` is there, a card of class `works-wars`, label "The war docket"; a note, while drafting "Open now. The Archons choose one this season; the chamber votes next season.", else "Opens <opensLabel>. Shown as it would open today; a raid can sour a nation."; one `works-row` per nation, its name and its band; with no items, "No nation can go on it today."; then for each war under way a note "At war with <name> through <throughLabel>".
4. DiplomacyView.tsx, FactionStatusBadges: the War badge reads "⚔ War through <warThroughLabel>" when the label is there, "⚔ War" otherwise.
5. Tests. politics-government.test.tsx: an Archon sees the war docket with its kicker and each card's "If it passes:" line; a citizen sees the war before the chamber while voting and nothing of it while drafting. cities-view.test.tsx: the war card's notes, rows and at-war line verbatim, its empty line, and a payload without `wars` shows no card. diplomacy-view.test.tsx (new): a faction at war with the label shows "⚔ War through Summer, 291 BC"; without the label "⚔ War"; at peace no badge.

## Gate and STOP 1

Run `DATABASE_URL=…/massalia_test pnpm gate` at HEAD after commit 6, then `pnpm audit --audit-level=high`. The gate must end `GATE GREEN: HEAD <sha>, tree clean`; the audit must exit 0. A red from a timeout in a suite this diff does not touch is a STOP with the log; never rerun to get a pass. Commit only on a read exit code.

STOP 1. Report:
- Committed: <SHA> <subject>, one line per commit
- Gate: the last line, suite counts; the audit exit code
- The production reads, and what follows: the nations World 2's first war docket would hold today, and when it opens
- GET /api/government's `war` scope for a test Archon in a Spring, and GET /api/league/cities `works.wars`, as JSON
- Every player-facing string this adds or changes, verbatim, for ruling
- Any deviation, as a question for a ruling

## Push (only after I reply "push")

Not in the hour before the 00:00 UTC season rollover, and before 2026-10-13 23:00 UTC so year 7's war docket opens at 00:00 on 14 Oct; a deploy during 14 Oct still opens it at the next sync, and after that the first docket is year 8's, on 18 Oct. Fast-forward only, plain `git push`. If CI goes red before Checkout on a registry pull, rerun it once; if Railway then leaves the commit SKIPPED, deploy it as AGENTS.md says (environmentTriggersDeploy, the server first, then the worker). Any other red is a STOP with the log. Report:
- remote HEAD
- the CI run with its Gate and Audit steps, and the Pages run
- Railway server and worker on the new SHA; 0074 in `__massalia_migrations`; the three scope checks' definitions and league_wars_one_open_per_faction from pg_constraint and pg_indexes
- API health
- read only, after the next sync: World 2's war agenda_cycles (none until 14 Oct) and league_wars (none)

Anything off is a STOP: report it and wait. Do not write to production to fix it.

## Rulings on STOP 1 (12 Oct)

1. Keep commit 2's three bridging lines; no squash.
2. The Cities line takes nationName: "At war with the Volcae through …", "At war with Carthage through …".
3. The League ledger row reads "War declared on Carthage" / "War declared on the Cadurci" (nationName), in the place of "Passed measure: …".
4. The docket note reads "Opens <opensLabel>. Shown as it would open today; raids and events can change it."
5. Noted: spanLabel exported from leagueProjects.ts. Fine.
6. War before the festival on the Council tab. Fine.
7. Keep the three extra tests.
8. Keep: the League's shared veto now hides the button, as intended.

Make 2, 3 and 4 one commit, `war: the words as ruled at STOP 1`, with the tests that pin those strings updated. Then append these rulings to docs/politics/government-prompt-4.md as its own docs commit, run the gate at HEAD and the audit, and push as the prompt says (plain git push, not at or after 23:00 UTC) with its full push report, including 0074 in __massalia_migrations and the three scope checks.
