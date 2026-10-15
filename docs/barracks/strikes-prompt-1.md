# Strikes 1: a nation at war marches on Massalia, a place raided too often raids back, and garrisons regrow 30% a season

Drafted by Claude on 15 Oct 2026 against b2b37e9. Save this prompt as docs/barracks/strikes-prompt-1.md in the first commit. Read AGENTS.md first. This is a large change with a migration (0077), so it starts with a design STOP 0: recon, a production read and a design note, then wait for my rulings before any code. No production write. One concern per commit, staged by path. Commits stay local; no push until I say push.

## Where to build

Other sessions work in the main clone. git fetch, then build in your own worktree on a new branch from origin/main, with your own test database: create massalia_strikes_test, point DATABASE_URL at it, and drop it once this is pushed. Never stage, stash or commit files you did not write, and leave the main clone's main alone.

## What it is

Today the nations never act. A war only changes Massalia's side (raids pay 1.5 times and leave the bar alone, the League may raid and attack), and a nation's garrisons and warbands only regrow, 5 men a day. From now on a nation strikes back: in a war, once a season; and any tribe whose town or land is raided too often raids back once. And garrisons regrow 30% of their full strength a season.

## Rulings (Argiris, 15 Oct 2026)

1. Regrowth. A town's garrison and a land's warband regrow 30% of their full strength (the content value) each season, never above full. This replaces the flat 5 a day, on the same per-season, closed-form-on-read clock.
2. A strike is a march by a nation on a Massalian place, shown to everyone 12 hours before it strikes. It has two triggers:
   a. War. Each season while a nation is at war with the League, it may march. The march is called at the season's start and strikes 12 hours later.
   b. Raids. A town or land raided more than 10 times within a game year (96 hours) marches once: the march is called when the 11th raid is counted and strikes 12 hours later. Every raid or attack that met the place's defenders counts (isLeagueFight's sense of a fight), whoever made it: a house, a koinon's muster or the League. The count starts again once the march is called. This trigger is off for a nation while it is at war with the League (its war marches take its place). It applies to every tribe, on the Diplomacy page or not.
3. No march is called, and no strike lands, in Winter.
4. The targets: the Massalian home towns (the League's ten) next to the nation's land, and every holding, the League's or a house's, next to its land or taken from it. "Next to" means the target's region is, or borders by land, a region that holds one of the nation's towns or lands. A place taken from it is a target wherever it is.
5. The choice: the target where its force most outnumbers the men standing there when the march is called. Ties go to a place taken from it, then the nearer, then by name. If its force outnumbers the men nowhere, it stays home: no march.
6. The force: a fifth of the men (garrisons and warbands as they stand) in its towns and lands next to the target. Against a place taken from it, at least that place's full strength. It fights as a tribal warband (battle.json npc.warband).
7. The defenders: every man standing in the target when it strikes (active, not on the road): the League's, the holder's, any guests', and men pledged to a muster gathering there. Each owner's losses are his own.
8. A raid takes nothing but plunder. The raids trigger always raids, and so does a war march on a home town. If the raid wins: from a home town, the League treasury pays 2 drachmae for every raider left standing, and the town's polis loses 2% of its people and 1 stability; from a holding, the holder pays 2 drachmae for every raider left standing, as much as he has (the treasury for a League holding).
9. A war march on a holding is an attack. If it wins, the holding is lost: it returns to its own people as a holding that reverts does, and the survivors fall back by the existing turn-home rules (a house's men to the Massalia region, the League's to the town of Massalia).
10. The enemy's dead come off the garrisons and warbands it drew its force from, in proportion to what each sent, and regrow by ruling 1.
11. Everyone whose men fought, and the holder of the target, gets a report. The march and its result show on the target's map panel for everyone, under the nation on the Diplomacy page, and on the Government tab.
12. The numbers live in content: the fifth, the 12 hours, the 2 drachmae, the 2%, the 1 stability, the 10 raids, the 96 hours and the 30%.

## Claude's calls (Argiris rules on them at STOP 1)

13. A nation has at most one march on the road at a time. A trigger that fires while one is marching waits until it has struck.
14. Raids made before this change goes live do not count toward the 10.
15. A peace that comes while a war march is on the road calls it off, and so does a war that starts while a raids march is on the road. Each has a line.
16. Who the nation is: a Diplomacy faction (factionOfPolity; its land is every place of every polity it has), else the place's owner polity alone. Its name: nationName for a faction, else the polity's name.
17. The battle. An attack is fought as an attack is (battle.json rounds); a raid as a raid is (raid.rounds), except that every defender standing there fights, with no turnout, since they had 12 hours' warning. A raid succeeds only if the raiders win; a stand drives them off. A town's walls stand with its defenders: a home town's from league_cities.fortifications, a held town's as townStats gives them, both under town.wallsDefCap; a land has none. Each defender fights with his own owner's morale (moraleBonusFor), the Temple's included for the League.
18. Arelate is a home town with no polis on the Cities tab: a raid on it costs the treasury alone.
19. Locks, after the muster's launch (koinonMuster.ts, launchMuster, 772-822): every defending owner's player lock in ascending id order (the League's is its player lock), then the League treasuries row, then the rest. Each owner is settled to the strike instant before the battle. A set of owners that changed under the locks starts again. Never write a player's rows without his lock.
20. The march shows "about" its force, rounded to the nearest 10.
21. A house that fought gets an effect_log row and a Barracks report. The League writes no effect_log row: its reports go where its march reports go.
22. The words are Claude's; Argiris rules on them at STOP 1. Propose any not listed.
   - The march: "The {nation} march on {place} with about {n} men. They strike at {time}." The raids trigger's march opens instead: "Raided once too often, the {nation} march on {place} with about {n} men. They strike at {time}."
   - Driven off: "The {nation} struck at {place} and were driven off. {k} of them fell, and {d} of ours."
   - A raid that won on a home town: "The {nation} broke into {place}. They carried off {x} drachmae from the treasury, and {p} of its people were lost."
   - A raid that won on a holding: "The {nation} broke into {place} and carried off {x} drachmae from House {house}." (the treasury, for the League's)
   - A holding lost: "The {nation} stormed {place}. House {house} has lost it." / "The {nation} stormed {place}. The League has lost it."
   - Called off: "The {nation} turned back from {place}."
   - The League ledger row: "Raid by the {nation} on {place}".
   - If the Guide has an entry on raids or on war, one line: "Raid one place more than 10 times in a game year and its people raid back. A nation at war with the League marches on Massalia's towns and holdings once a season."

## Phase 0: recon (read only)

First git fetch, git status -sb and git log --oneline origin/main..main in the main clone, then make your worktree. Confirm origin/main at b2b37e9 or a fast-forward of it (say which).

- apps/server/src/services/mapPools.ts: readRegionWarband (47) and readTownGarrison (113) regrow min(base, stored + whole days × 5) at 57 and 119; content/military/battle.json:10 regen, its schema packages/shared/src/barracks.ts:83 and 319, and battle.test.ts:28.
- content/military/battle.json: rounds, raid.rounds and raid.turnout, town.wallsDefCap, npc.warband. packages/shared/src/battle.ts: resolveBattle (113).
- apps/server/src/services/koinonMuster.ts: resolveMuster (742) and launchMuster (772): the owners' locks in ascending id order, each owner's settle at the instant, OwnersChanged; the arrival's battle and how losses split across owners' rows.
- apps/server/src/services/holdings.ts: holderOf (39), listWorldHoldings (61), settleHoldings (103) and its reversion (117-137).
- apps/server/src/services/leagueOrders.ts: settleLeague, the League's lock order and its ledger; packages/shared/src/leagueOrders.ts:72, isLeagueFight.
- How a war is known: packages/db/src/leagueWars.ts, factionOpinion.ts (74-79), the at_war flag.
- player_marches (packages/db/src/schema.ts, around 1178-1198): kind, region_id, town_id, status, resolved_at, report; koinon_musters' reports; the League's marches. These are the sources for the raids count.
- league_cities (schema.ts:1242): population, stability, fortifications; content/cities/cities.json has nine poleis (no Arelate; Olbia's town is olbia-provence).
- content/map/graph.json (neighbors), town-military.json and region-military.json (owners), content/diplomacy/factions.json (polities), apps/web/public/map2/politics2.json (polity names).
- GET /military (apps/server/src/routes/map.ts:194) and MilitaryPayload (41); the worker's sweeps (apps/worker/src/index.ts, election-sweep at 152 as a pattern).
- apps/web: World2Map.tsx's town and region panels, DiplomacyView.tsx, GovernmentView.tsx, BarracksPanel.tsx.

Then a production read, read only, through railway run --service Postgres --environment production with DATABASE_PUBLIC_URL:

1. Every league_wars row, and the war vote that closed at 16 Oct 00:00 UTC if it has.
2. For each town or land, the raids and attacks that met its defenders in the last 96 hours, the fifteen most raided.
3. Every holding with its holder and the men standing there, by owner.
4. Tolosa's and Nemausus's garrisons as they stand, and the League's men in Agathe and Arelate.

## STOP 0: the design note

Report, then wait for my rulings:

```
Base: origin/main <SHA>; worktree and branch
Production: reads 1 to 4
Schema: 0077 as you would write it (the strikes table: what a march stores, its states, the keys that hold ruling 13 and one war march per nation per season)
Sweep: where calling and striking run (a new worker job, and whether reads drive it too), and the claim that makes a strike resolve once
Locks: the order as you would take it, and each owner's settle
Raids count: its sources, the go-live cut-off, the restart after a march
Battle: how the attack and raid paths are reused, the walls, morale, the split of losses by owner, the enemy's dead off its pools
Views: the GET /military field, the Government tab, the Diplomacy page, the Barracks report
Words: any you would add or change
Rulings for Argiris: <each with the reason, or "none">
```

## The build (after my rulings)

1. `content: garrisons and warbands regrow 30% of their full strength a season` (ruling 1). battle.json's regen becomes shares of full strength; mapPools grows a pool by whole seasons of the share of its full strength, rounded up, never above full; the marker as today. Tests: a 2,300 garrison at 0 reads 690 after a season and 2,300 after four; a 25 warband regrows 8 a season; never above full; part of a season adds nothing.
2. `db: 0077, the strikes`, as ruled at STOP 0.
3. `shared: the strikes' rules and words` (rulings 2-10, calls 13-18 and 20-22), pure. Tests: the Volcae's targets are Agathe and Arelate, and a holding taken from them wherever it is; the choice and the tie order; it stays home when outnumbered everywhere; the force is a fifth of the neighbouring men, and at least a lost place's full strength; the 11th fight within 96 hours fires and the 10th does not; scouts, turn-backs and raids before go-live do not count; the count restarts after a march; the trigger is off at war; nothing in Winter.
4. `server: the strikes are called and fought` (the rest). Tests on the test database: a war march is called at the season's start and strikes 12 hours later; one march per nation at a time; a raid on Agathe is driven off by League and house men together, each owner losing his own; the enemy's dead come off Tolosa and Nemausus in proportion; a raid that wins on Agathe debits the treasury 2 a raider standing with its ledger row and takes 2% of Agathe's people and 1 stability; a raid on Arelate costs the treasury alone; a raids-trigger raid that wins on a house's holding takes 2 a raider standing from the holder, never below zero; a war attack that wins on a house's holding ends it and returns the place to its people, and the holder's and guests' survivors turn home at their settles; the same for a League holding; men who arrive between the call and the strike fight; a peace calls off a war march; two sweeps at once resolve a strike once.
5. `server: what everyone sees of a strike`: the GET /military field, the Government tab, the Diplomacy page, the house's Barracks report and effect_log row. Tests for each, and none of it shows a pool's numbers beyond the march's "about".
6. `web: the strike on the map, the Diplomacy page, the Government tab and the Barracks`. Render tests for each.
7. `docs: the strikes in AGENTS.md`: one line under "Server and data" with the lock order and where calling and striking run.

## Gate and STOP 1

Run DATABASE_URL=…/massalia_strikes_test pnpm gate at HEAD after the last commit, then pnpm audit --audit-level=high. The gate must end GATE GREEN: HEAD <sha>, tree clean; the audit must exit 0. A red from a timeout in a suite this diff does not touch is a STOP with the log; never rerun to get a pass. Then check it in a browser on a throwaway database: a war march on Agathe shown on its map panel, on the Diplomacy page and on the Government tab; after the strike, a house's Barracks report and the League's. Screenshots, then drop that database. Report:

```
Committed: <SHA> <subject>, one line per commit
Branch: <branch>, built on origin/main <SHA>
Gate: <the gate's last line>, suite counts; audit exit code
Browser: what each screenshot shows
Words: every player-facing string, verbatim
Rulings for Argiris: <each with the reason, or "none">
```

## Push (only after I reply "push")

Not in the hour before the 00:00 UTC season rollover. git fetch; if origin/main moved after your gate, rebase onto it, show each commit's git patch-id unchanged (AGENTS.md:74), and run the gate again. Then git push origin HEAD:main, a fast-forward, never forced. If CI goes red before Checkout on a registry pull, rerun it once; if Railway then leaves the commit SKIPPED, deploy it as AGENTS.md says (environmentTriggersDeploy, the server first, then the worker). Any other red is a STOP with the log. Report: remote HEAD; the CI run with its Gate and Audit steps, and the Pages run; Railway server and worker on the new SHA; 0077 applied (the __massalia_migrations row and its time); API health; the worker's new job ready; and, read only, the strikes table (empty, or what the first sweep called), every holding with its holder, and the League's rows, unchanged by the deploy. Then drop massalia_strikes_test, remove your worktree and delete the merged branch. Anything off is a STOP: report it and wait. Do not write to production to fix it.

## Scope fence

Only the files the build names and their tests. No change to the war motion, its vote, cost or peace, the League's orders, war gate or harvest ban, the players' raid, scout and attack rules, the muster's own rules, the holder's tribute and reversion rules, the intel rules, or the Diplomacy opinion rules. One migration, 0077.

## Rulings at STOP 0 (Argiris, 15 Oct 2026)

Append these to docs/barracks/strikes-prompt-1.md in the first commit. Then build as the prompt says, with the changes below, through to STOP 1.

1. Schema 0077 as you wrote it.
2. No worker job: calling and striking run in the campaign resolver, as you propose. A failure in either logs "strikes: failed <message>", is caught, and never fails the request; the next pass tries again. When nothing is due, the hook's added cost stays a few small indexed reads: name them at STOP 1. In the push report, "the worker's new job ready" becomes: the first requests after the deploy answer 200, with no "strikes: failed" in the server log.
3. Locks, the raids count, the battle and the views as you wrote them.
4. Your 1 to 9, 11 and 12 accepted. On your 7: if a holding changed hands before the strike and is still a holding, the strike falls on the holder at the strike instant. He pays, and he gets the report.
5. The raids trigger changes. Your 11 shows why: R057 was fought 56 times in four days, and a fifth of the Sordones' 400 could never outnumber anyone. For the raids trigger only:
   - the force is the raided place's full strength, and its dead come off that place alone;
   - its targets are the Massalian home towns and holdings next to the raided place (its region, or a region bordering it by land);
   - the choice and staying home are as ruling 5.
   War marches are unchanged. The tests follow: a raids march on R057's 11th fight brings 400 and, on today's numbers, picks Agathe (100) over Rhoda (120) and Emporion (250).
6. Your 10: as designed. The Archons see the march 12 hours ahead and can garrison Agathe; if they outnumber the Volcae there, the march goes to the next target or stays home.
7. Words: as proposed, with your changes, except the house's report line, which becomes "{m} of your men were among the defenders, and {l} of them fell."

## Rulings at STOP 1 (Argiris, 15 Oct 2026, 21:50 UTC)

Append these to docs/barracks/strikes-prompt-1.md as their own commit. Then make the one commit below, run the gate at the new HEAD, and push.

1. Your 1 to 8 accepted, and every word as built.
2. On your 2: a restart that weighs a season's war march again is acceptable for now. Keep it on the known gaps.
3. The Guide has no entry on raids or war, so it gains one: `web: the Guide's entry on war and raids`. Title "War & Raids", placed after "The City's Politics". Its render test reads the numbers from content, as guide-intrigue.test.tsx does. The words:
   - "Every town and land remembers its raiders. Raid one place more than 10 times in a game year and its people come back at full strength, against the Massalian town or holding beside it where they most outnumber the men standing there. The march is seen 12 hours before it strikes, and every man standing in that place fights it. A raid that gets through takes 2 drachmae for each raider still standing, from the treasury or from the house that holds the place, and a town loses some of its people."
   - "When the chamber votes a war, raids on the enemy pay half as much again, and the League's army may raid and attack them. The enemy marches too: once a season, except in Winter, on the Massalian town or holding beside its land where it most outnumbers the men standing there. A holding it storms is lost."
   - "Garrisons and warbands win back 30% of their full strength each season."
4. push, tonight. git fetch first: if origin/main has moved since your gate, do not push tonight; STOP and wait for the morning. The push must be out by 22:30 UTC; if the gate at the new HEAD is not green by then, push nothing tonight. If CI goes red before Checkout, rerun it once; if Railway leaves the commit SKIPPED, deploy it as AGENTS.md says, the server first, then the worker. Start nothing after 22:45 UTC, and nothing at all between 23:00 and 00:00 UTC. Report as the prompt lists, as amended at STOP 0, and add, read only, worlds.strikes_from.
