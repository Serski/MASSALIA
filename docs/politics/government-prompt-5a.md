# Government 5a: the League's army stands, and is paid

Drafted by Claude on 13 Oct 2026 against 1212cc5, from the rulings Argiris gave on 13 Oct. Save this prompt as docs/politics/government-prompt-5a.md in the first commit. Read AGENTS.md first. One migration. One concern per commit, staged by path. This prompt has a design STOP: Phase 0 ends at STOP 0 with a short design note, and nothing is written before my ruling on it. After the ruling, build straight through to STOP 1. Before each commit, run the suites its files touch and read the exit code. Commits stay local; no push until I say push.

## What it is

The ten home towns' garrisons (2,050 men) and their 29 pentekonters and 40 triremes stop being numbers in town_military and become the League's own army: units of the four trained types standing in their towns, the fleet at Massalia, paid from the League treasury. This prompt (5a) raises the army, pays it and shows it. Prompt 5b gives the orders: the Archons and Strategoi move it, attack, raid and scout with it, as players do with theirs.

## Rulings (Argiris, 13 Oct 2026)

1. The ten home towns of content/map/town-military.json become League units of the four trained types, split per town 50% hoplites, 25% peltasts, 15% ekdromoi, 10% hippeis, each rounded down, the remainder to the hoplites:

   | Town | Men | Hoplites | Peltasts | Ekdromoi | Hippeis |
   |---|---|---|---|---|---|
   | Massalia | 1,000 | 500 | 250 | 150 | 100 |
   | Emporion | 250 | 126 | 62 | 37 | 25 |
   | Nikaia | 150 | 76 | 37 | 22 | 15 |
   | Olbia | 150 | 76 | 37 | 22 | 15 |
   | Rhoda | 120 | 60 | 30 | 18 | 12 |
   | Agathe | 100 | 50 | 25 | 15 | 10 |
   | Antipolis | 100 | 50 | 25 | 15 | 10 |
   | Arelate | 100 | 50 | 25 | 15 | 10 |
   | Athinopolis | 50 | 26 | 12 | 7 | 5 |
   | Monoikos | 30 | 16 | 7 | 4 | 3 |
   | Total | 2,050 | 1,030 | 510 | 305 | 205 |

2. All 29 pentekonters and 40 triremes are the League's fleet, at Massalia.
3. The League pays the upkeep from its treasury: a flat quarter drachma per man per season, charged once a season as `Math.round(men × 0.25)`, 513 for 2,050 men. Ships cost nothing standing; a voyage's naval supplies come with 5b, at the market price.
4. Men desert when unpaid. If the treasury holds less than the season's upkeep, it pays what it holds, keeps the men that pays for (`floor(paid / 0.25)`), and the rest desert, taken from the largest rows first.
5. No recruiting. The army only shrinks until a later motion raises men.
6. In 5a nobody orders the army; it stands in its towns. In 5b any sitting Archon or Strategos moves it, attacks, raids and scouts with it; nothing marches in Winter; plunder goes to the treasury, the goods sold at the market price; a town the League takes is a League holding, its tribute to the treasury.
7. Every Government member sees the whole army on the Government tab. Everyone else sees, as today, each home town's men and ships in its town panel, now read from the League's army.
8. The words below are Claude's; Argiris rules on them at STOP 1.

## Phase 0: recon (read only), then the design note

First `git fetch`, `git status -sb` and `git log --oneline origin/main..main`. A dirty tree, or any commit on main that is not on origin/main, is a STOP 0: list them. Then confirm at 1212cc5 or a fast-forward of it (say which); the newest migration is 0074_league_wars.sql, so this one is 0075. A behaviour that differs is a STOP 0; a line that moved a few is not.

- content/map/town-military.json: ten towns with owner "massalia": massalia 1000 men, 10 pentekonters, 30 triremes; emporion 250/4/4; nikaia 150/3/2; olbia-provence 150/3/1; rhoda 120/2/1; agathe 100/2/1; antipolis 100/2/1; arelate 100/1/0; athinopolis 50/1/0; monoikos 30/1/0. Totals 2,050, 29, 40.
- content/military/units.json: peltast, ekdromos, hoplite, hippeis, each with `upkeepPerDay` in goods per man. content/military/ships.json: `trade-ship` (Pentekonter) and `galley` (Trireme).
- packages/db/src/schema.ts: players (user_id NOT NULL to users; name, color, house_slug, is_active); player_units (:876: owner_player_id NOT NULL to players, source, unit_id, count, start_count, recruited_season, ready_at, based_at default 'R060', a region id or a holding's base id, the town slug for a town holding; moving_to; mission); player_voyages (:1139); player_marches (:1162); player_holdings (:927); town_military (:1476); treasuries (:672); treasury_ledger (:683) with its claim index. A player's ships are his resources rows of `trade-ship` and `galley`.
- apps/server/src/routes/map.ts, GET /military: the home towns from loadMilitaryOwners and their town_military rows. The other readers of town_military: services/mapPools.ts, packages/db/src/military.ts, packages/db/src/worldLaunch.ts.
- packages/db/src/leagueRevenue.ts: collectLeagueRevenue (:102) with claimAndCredit (:85) and the lock on the League's treasuries row (:129). packages/shared/src/government.ts: treasuryClaimReason (:56). The worker's agenda sweep (apps/worker/src/index.ts:176-197) and the lazy sync on GET /me/state.
- apps/server/src/services/government.ts: governmentView (:70) and the ledger words (:53-66). apps/web/src/dashboard/panels/GovernmentView.tsx.
- apps/server/src/services/barracks.ts: settleBarracks (:596) pays a player's upkeep in goods from his stock, buys the shortfall at the vendor's price from his wallet, and removes rows when he is insolvent. The League's army never goes through it.

The design note, one short paragraph each:

- (a) How the League owns its units and ships, and in 5b its marches, voyages and holdings. My recommendation: one players row per world for the League, marked by a new `players.kind` ('player' or 'league', with a partial unique index on world_id for 'league'), with no character, owning ordinary player_units rows and ship stock, so 5b runs the march, battle, voyage and holding code with a League acting context instead of a copy of it. Its user_id: nullable, or a system users row that can never authenticate (made as a deleted account). Pick one and give the reason, or propose a better model with the reason.
- (b) Every place that reads players, player_units, ship stock or holdings for something a player sees (standings and rankings, admin lists, the market, koinon, referrals, player names, the Chronicle, the map): whether the League's row would show there, and how it is kept out.
- (c) The readers of town_military for the home towns besides GET /military, and what switching the home towns to the League's rows does to each.
- (d) The upkeep: where it runs (my suggestion: `settleLeagueArmy` right after collectLeagueRevenue in the agenda sweep and the lazy sync, claimed by an `army:s<N>` ledger row under the League treasuries lock, with `army:s%` added to the claim index) and the desertion order.
- (e) The seeding: once per world and claim-first. The League row's insert is the claim, and the units and ships are written only in the transaction that inserted it, so a second run, or an army that has deserted to nothing, never raises it again.
- (f) What 5b needs from this model, in a few lines: the acting context, the upkeep kept out of settleBarracks, and the treasury taking what a player's wallet or stock would.

Then these production reads, read only, through `railway run --service Postgres --environment production` with DATABASE_PUBLIC_URL:
- the League treasury's balance
- World 2's town_military rows for the ten home towns (garrison, pentekonters, triremes), against the content above
- whether anything in players would collide with a League row

STOP 0. Report the design note and the reads. Write nothing until I rule.

## The build (after the ruling at STOP 0)

The commits as I expect them; the ruling at STOP 0 may change them.

1. `db: the League as an owner, and the army's upkeep claim (migration 0075)`: players.kind and the partial unique index; user_id as ruled; treasury_ledger's claim index widened by `army:s%`; schema.ts mirrors all of it.
2. `shared: the League's army`: content/military/league-army.json (`upkeepPerManPerSeason: 0.25`, `fleetAt: "massalia"`, and the ten towns' composition from ruling 1 written out per town) with a strict zod schema; pure `armyUpkeep(men, rate)`, `menPaidFor(paid, rate)` and `desertionPlan(rows, deserters)` (largest rows first, ties by based_at then unit_id, each row reduced in that order, never more men than stand); `treasuryClaimReason.army(season)`. Tests: the content's totals (2,050; 1,030; 510; 305; 205), 513 for 2,050 men, a payment of 512 keeping 2,048 men, the plan's order, and a plan that never takes more than stands.
3. `league: the army is raised once and paid each season`: `ensureLeagueArmy(worldId)` per (e): every row source 'trained', ready (ready_at the seeding instant), based_at its town's id, start_count its count; the ships the League's stock. `settleLeagueArmy(now)` per (d): under the lock, claim `army:s<N>`, debit what the treasury pays with that ledger row, apply the desertion plan, and when men desert write one more ledger row `desertion:s<N>` with delta 0 that carries the count. Wired after collectLeagueRevenue in the worker's sweep and the lazy sync. The exclusions from (b). Tests on the test database: the seed run twice raises the army once; a season's upkeep is charged once and a second call writes nothing; a treasury of 100 keeps 400 men, the rest desert from the largest rows, and the balance ends at 0; an army of 0 pays 0 and is never raised again; the League's row is missing from every list (b) names.
4. `server: the home towns' garrisons are the League's army`: GET /military's home towns read the League's men per town and its fleet (garrison the men based there; pentekonters and triremes the fleet at Massalia, 0 elsewhere); the payload's shape does not change. governmentView gains `army: { towns: [{ townId, name, units: { hoplite, peltast, ekdromos, hippeis }, men }], fleet: { at: "Massalia", pentekonters, triremes }, men, upkeepPerSeason, lastDesertion: { men, label } | null }` for every member. Tests: a citizen's /military shows Massalia 1,000 men with 29 pentekonters and 40 triremes, Nikaia 150 with none; a member's army totals 2,050.
5. `web: the League's army on the Government tab`: api.ts types; GovernmentView.tsx gains a card "The League's army" with one row per town ("Massalia · 500 hoplites, 250 peltasts, 150 ekdromoi, 100 hippeis"), "The fleet at Massalia: 29 pentekonters, 40 triremes", "Upkeep: 513 drachmae a season, a quarter drachma a man, paid by the treasury", and, once men have deserted, "Deserted for want of pay: <n> men, <season>". The League ledger reads "Army upkeep" for `army:s<N>` and "Deserted for want of pay: <n> men" for `desertion:s<N>`. Render test.

## Gate and STOP 1

Run `DATABASE_URL=…/massalia_test pnpm gate` at HEAD after the last commit, then `pnpm audit --audit-level=high`. The gate must end `GATE GREEN: HEAD <sha>, tree clean`; the audit must exit 0. A red from a timeout in a suite this diff does not touch is a STOP with the log; never rerun to get a pass. Commit only on a read exit code.

STOP 1. Report:

```
Committed: <SHA> <subject>, one line per commit
Gate: <the gate's last line>, suite counts; audit exit code
Model: the League's row as built, and every exclusion from (b)
Army: GET /api/government's `army` for a test member, as JSON, and a citizen's /military for Massalia and Nikaia
Upkeep: the ledger rows a test season writes, with and without desertion
Words: every player-facing string, verbatim, for ruling
Rulings for Argiris: <each with the reason, or "none">
```

## Push (only after I reply "push")

Not in the hour before the 00:00 UTC season rollover. Fast-forward only, plain `git push`. If CI goes red before Checkout on a registry pull, rerun it once; if Railway then leaves the commit SKIPPED, deploy it as AGENTS.md says (environmentTriggersDeploy, the server first, then the worker). Any other red is a STOP with the log. Report:
- remote HEAD
- the CI run with its Gate and Audit steps, and the Pages run
- Railway server and worker on the new SHA; 0075 in `__massalia_migrations`
- API health
- read only, after the first sync: World 2's League row; its units summed per town and type against ruling 1; its ships (29 and 40); the first `army:s<N>` ledger row (−513) and the treasury's balance

Anything off is a STOP: report it and wait. Do not write to production to fix it: the army is raised and paid by the code at the first sync after the deploy.

## Scope fence

Only what the ruling at STOP 0 lists. No orders, marches, reach, picker, raid, scout or holding changes: those are 5b. Do not touch players' upkeep, settleBarracks, the Barracks panel, the war, the agenda motions or the Chronicle. No recruiting.

## Rulings at STOP 0 (Argiris, 13 Oct 2026)

Save these at the end of docs/politics/government-prompt-5a.md, in the first commit with the prompt. The design note stands as you wrote it, files list included, except where a ruling below changes it. Build straight through to STOP 1.

1. user_id is nullable. Add the check (a 'player' row has a user, the 'league' row has none) and the three guards you named: routes/admin.ts:88, services/referrals.ts:64, packages/db/src/seed.ts:73. No system user.

2. is_active is true, with the filters from (b): standings.ts:34, lobby.ts:87, :130 and :217, worldLaunch.ts:95.

3. The row's name is "The League". How a League holding names its holder is for 5b.

4. The desertion count rides in the reason, `desertion:s<N>:<men>`, delta 0. No new column. The ledger word reads the count from it.

5. No. Desertion thins every row; it does not empty the largest first. desertionPlan(rows, deserters): when the deserters are the whole army, every row goes. Otherwise each row first loses floor(count × deserters / men), and the men still owed come one each from the rows in order of their count before desertion, largest first, ties by based_at then unit_id. A row that reaches 0 is deleted. The upkeep rule stays as written: a treasury that holds the season's upkeep pays it and nobody deserts, even where floor(upkeep / 0.25) is below the men. These tests replace the old ones:
   - A treasury of 100 keeps 400 men: Massalia 193, Emporion 48, Nikaia 29, Olbia 29, Rhoda 24, Agathe 19, Antipolis 19, Arelate 19, Athinopolis 12, Monoikos 8; by type 197 hoplites, 100 peltasts, 62 ekdromoi, 41 hippeis. The balance ends at 0.
   - A payment of 512 keeps 2,048: Massalia's hoplites and peltasts lose one man each.
   - 2,049 men and a treasury of 512: it pays 512 and nobody deserts.
   - The plan never takes more men than a row holds, nor more than the deserters in all.

6. Confirmed: the whole fleet is at Massalia, and the other nine home towns show 0 pentekonters and 0 triremes in their town panels.

7. league_cities.garrison stays as it is, a city stat that grows 2% a year. On the Cities tab its column header changes from "Garrison" to "Levy": the men the city could raise, as a player's levy is in his Barracks. A later motion raises League units from it. Not "Militia", which is the character stat on the sheet, the merc contracts and the ranks. Only the header changes; the API field and the stat keep their names. Its own commit after the army card, `web: the Cities tab's garrison column reads Levy`, with the render test in apps/web/test/cities-view.test.tsx.

The 5b items in (f) are noted for 5b: the march resolution in the /api preHandler, the League's own settle, the treasury in place of creditDrachmae, and the holder words. None of them go in 5a.

## Where to build (Argiris, 13 Oct 2026)

origin/main is now db933ff: today's lobby gutter (72696f2, 36208a1) and the Poison & Assassination guide (d0c3880, db933ff) went out after your STOP 0. None of them touch your files. Other sessions may work in the main clone while you build, so:

- git fetch, then build in your own worktree, on a new branch from origin/main. Never stage, stash or commit files you did not write, and leave the main clone's main alone.
- Run the gate against your own test database, so no other session's suites collide with yours: create massalia_5a_test, point DATABASE_URL at it, and drop it once 5a is pushed.
- At STOP 1, give the branch and the origin/main SHA you built on.
- At the push: git fetch. If origin/main moved after your gate, rebase onto it, show each commit's git patch-id unchanged (AGENTS.md:74), and run the gate again. Then git push origin HEAD:main, a fast-forward, never forced.

## Rulings at STOP 1 (Argiris, 13 Oct 2026)

Append these to docs/politics/government-prompt-5a.md as their own commit. The build stands except for the changes below. Make them in new commits, one concern each, staged by path, with their tests.

1. Keep the name fallback, "The League of Massalia".
2. A ledger row whose delta is 0 shows no amount. No "+0".
3. Keep "a quarter drachma a man". Add a test that fails when upkeepPerManPerSeason in league-army.json is not 0.25, so the words cannot drift from content.
4. Keep the unpaid row; it is the season's claim. At delta 0 it reads "Army upkeep unpaid". With no men standing nothing is due, so the settle writes no row at all, and an army that has deserted to nothing leaves no line each season. Test it.
5. Accept GET /military raising the army, guarded as in 9.
6. Accept: no treasury row, no charge.
7. Accept where the guards and the ledger words landed.
8. Accept the small additions.
9. New: the army must never stop anything else. GET /me/state awaits syncAgenda with no catch, and the worker's agenda sweep runs its steps one after another, so a throw from ensureLeagueArmy or settleLeagueArmy would break every player's dashboard and stop the agenda sweep, which opens the first war docket at tonight's rollover. Wrap the army calls in syncAgenda, in the worker's agenda sweep and in GET /military, each in its own try/catch: log "army: failed <message>" and go on. The settle's transaction has rolled back by then, so the next sync retries it. Test: with the army settle forced to throw, syncAgenda still completes and opens a due cycle.

Words: all as built, except the card's desertion line, which takes the ledger's separator: "Deserted for want of pay: 1,650 men · Winter, 293 BC".

Then the gate at HEAD (it must end GATE GREEN: HEAD <sha>, tree clean) and pnpm audit --audit-level=high (exit 0).

Push: as the prompt and "Where to build" say, and only if it can go out by 21:00 UTC. If it cannot, STOP and hold it for tomorrow: tonight's 00:00 rollover (the new officials, the first war docket) runs through the same sync, and I want some hours of clean sweeps before it.

Push report, besides the prompt's list:
- the first agenda sweep's line from the worker log after the deploy, with "army: paid 513, deserted 0"
- GET /me/state answering 200 in the server log after the deploy
