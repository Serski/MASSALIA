# Government 5b: the League's army takes orders

Drafted by Claude on 13 Oct 2026 against 086270c, from the rulings Argiris gave on 13 Oct. Save this prompt as docs/politics/government-prompt-5b.md in the first commit. Read AGENTS.md first. This prompt has a design STOP: Phase 0 ends at STOP 0 with a design note, and nothing is written before my ruling on it. After the ruling, build straight through to STOP 1. One concern per commit, staged by path. Before each commit, run the suites its files touch and read the exit code. Commits stay local; no push until I say push.

## Where to build

Other sessions work in the main clone. git fetch, then build in your own worktree on a new branch from origin/main, and run the gate against your own test database: create massalia_5b_test, point DATABASE_URL at it, and drop it once 5b is pushed. Never stage, stash or commit files you did not write, and leave the main clone's main alone. At STOP 1, give the branch and the origin/main SHA you built on.

## What it is

Prompt 5a raised the League's army and pays it: 2,050 men of the four trained types in the ten home towns, and 29 pentekonters and 40 triremes, all owned by the world's players row of kind 'league'. Nobody can order it yet. This prompt gives the orders. A sitting Archon or Strategos moves the army between the League's towns, and scouts, raids and attacks with it from the World map, as a player does with his own men. The treasury pays for the voyages and takes the plunder and the tribute. The first war docket opens tonight; a war voted on 15 Oct starts on 16 Oct, so this should be live by then.

## Rulings (Argiris, 13 Oct 2026)

1. Any sitting Archon or Strategos gives orders. Not an Ephor, not anyone else. The server checks the seat at every order; the client only hides what the server would refuse.
2. The orders are a player's: Move, Scout, Raid and Attack, with the same reach, force picker, march and crossing times, battle, plunder and conquest rules as a player's men. Whole rows or part of a trained row, from one base.
3. Raid and Attack only on land of a nation the League is at war with, by the chamber's war vote. This is checked when the order is given and again when the party arrives: a party that arrives after the peace turns back, as one that finds another house's holding does. Scout goes anywhere a player's scouts may.
4. Nothing sets out in Winter, moves included: "The passes are closed until spring." A party already on the road finishes it.
5. The League's places are the ten home towns (Massalia's by its town slug, where 5a based its men) and the League's holdings. Its men move only between them.
6. The treasury is the League's purse. A voyage's naval supplies are bought at the market's price, what a player pays the vendor that season, and the order is refused when the treasury cannot pay. Plunder's drachmae go to the treasury, and its goods are sold at the market's price, what the vendor pays a player that season. A League holding's tribute goes to the treasury the same way. Each is a row on the League ledger.
7. A town or land the League takes is a League holding: "Held by The League" on every map, painted Massalia's like any holding, kept by a garrison and paying tribute by the same rules as a house's. No house may raid or attack it ("The League holds this town." / "The League holds this land."), and the League may not raid or attack a house's holding ("Another house holds this town." / "Another house holds this land.").
8. Every Government member sees the whole army on the Government tab: the men in each town and holding, every party on the road, the fleet in port and at sea, the latest orders with who gave them, and the latest reports. Everyone else sees, as today, the home towns' garrisons (the men standing there, not those on the road) and who holds what. What a League party sees (a scout's snapshot, or the place as a fight left it) goes on its report and into the intel of the house of the official who ordered it.
9. Orders are given on the World map. A sitting Archon or Strategos sees a switch: "Your house" or "The League's army". In the League's mode the map's buttons, the force picker, the reach and SEND MEN HERE act for the League: its men, its ships and its places.
10. No recruiting and no levy; a later motion raises men. The upkeep stays as 5a built it.
11. The words in this prompt are Claude's; Argiris rules on them at STOP 1.

## Phase 0: recon (read only), then the design note

First git fetch, git status -sb and git log --oneline origin/main..main in the main clone, then make your worktree. Confirm origin/main at 086270c or a fast-forward of it (say which); the newest migration is 0075_league_army.sql, so a migration here is 0076. A behaviour that differs from the list below is a STOP 0; a line that moved a few is not.

- apps/server/src/services/mapActions.ts. act (324): Winter refused at 336; the targets at 343-361, a raid or an attack on another house's holding refused at 352 and 360. selectForce (258). splitRows (292) writes a barracks_split effect_log row under a character. characterOf (219) throws "map action: player has no character". takeSupplies (436) draws the naval supplies from the owner's stock; sailHulls (461). resolveMarch (517): the owner's lock (530), settleAll at the arrival (544), characterOf (567), the turn-back on a holder (580), writeIntel by the character's dynasty (611, 617, 688), battle_loss and map_report effect_log rows (644, 730), the plunder credited through creditDrachmae and creditGood (668-670), the conquest (676-677), composure (734). move (777): no Winter check, characterOf (836), a map_action effect_log row (872).
- apps/server/src/services/koinonMuster.ts: dueCampaigns (1206) and resolveDueCampaigns (1217) resolve every due march of any owner before any /api, /me or /admin request (the preHandler at 1243). A resolve that throws is tried again after a minute, without end, so a League march that throws never comes home.
- apps/server/src/services/buildings.ts: ActingContext (156), settleAll (783). apps/server/src/services/barracks.ts: settleBarracks (596) needs a character (characterIdFor, 162, throws without one) and charges upkeep in goods with insolvency (671-775), so it must never run for the League. The parts the League does need: hulls home from sea (638-654), arrivals (807-820), the merge (822-846), holdings and tribute (848-854).
- apps/server/src/services/holdings.ts: holderOf (39), listWorldHoldings (59), settleHoldings (100), insertConquest (141) and insertTownConquest (149), and settleTribute (183), which pays through creditDrachmae and creditGood (85, 90): a character's wallet and a player's stock.
- apps/server/src/services/mapReach.ts: homePlaces (83) leaves out the Massalia town; basesOf (111) always gives the Massalia region, R060; moveTargetsOf (145); reachView (157).
- apps/server/src/services/factionOpinion.ts: raidWarMultiplier (69) reads whether a land's nation is at war: factionOfPolity, then faction_relations.at_war, else the content start.
- packages/db/src/leagueArmy.ts: leaguePlayerId (47); the men based at town slugs (92); settleLeagueArmy (156) locks the League's treasuries row (177) and then its unit rows (180).
- apps/server/src/routes/map.ts: GET /military (135) counts the League's men by based_at, the men on the road included (174); /reach (212); /act (254).
- apps/server/src/services/government.ts: armyView (124) counts by based_at over the ten home towns only (131). apps/server/src/services/agenda.ts: heldOffices (159); syncAgenda's guarded army call (186). The offices table (packages/db/src/schema.ts:612): office 'archon' or 'strategos', holder_character_id.
- packages/shared/src/buildings.ts: vendorUnitPrice (268). "buy" is what a player pays, the band's sell price times the season's coefficient; "sell" is what he gets.
- apps/web/src/map/World2Map.tsx: the holder lines (37-46); the picker's state (419-424); openPicker (1196); the region and town buttons (1168, 1227); ForcePicker (1680), which posts api.mapAct or api.mapMove (1838). apps/web/src/map/mapActions.ts. apps/web/src/dashboard/panels/GovernmentView.tsx: the army card (91-110).

The design note, one short paragraph each:

- (a) The League's acting context: one context that act, move, resolveMarch and the reach take for the League, and, for each place in the list above that assumes a character, what it does for the League instead. The League writes no effect_log row: it has no character.
- (b) The League's settle: hulls home, arrivals, the merge, holdings kept or reverted, and tribute into the treasury; never settleAll or settleBarracks. Where it runs: in every League order and League march resolve, under the League's lock; and on the reads that show the army (the sync, GET /military, the Government view, the League's map view), behind a cheap read of whether anything is due, so a map load never queues on the League's lock. Guarded as 5a's army calls are: a failure is logged and stops nothing else.
- (c) One lock order for every write to the League's men or its treasury: the League's player lock first (pg_advisory_xact_lock(hashtext(id)), as lockPlayer takes it), then the treasuries row. Today settleLeagueArmy takes the treasuries row and then the unit rows, while an order would take the unit rows and then pay from the treasury. Say how the two are put in one order, and give the test: an order and the army settle at once, and neither deadlocks.
- (d) The treasury as the purse: the ledger reasons and their words for plunder, tribute and naval supplies; which of them could be written twice and how each is claimed once; vendorUnitPrice's direction for each.
- (e) The war gate: how a place's nation and its war are read at the order and at the arrival, and the refusal's words. The map's buttons in the League's mode carry the same reasons.
- (f) The record of an order: who gave it, his seat, what, from where, to where, when, and its march. My recommendation: a table league_orders (migration 0076) carrying the march's id, read at the resolve for the orderer's house (ruling 8) and by the Government tab. Or a better model, with the reason.
- (g) The views: GET /military and the Government view counting standing men only; the army card's new shape (each town and holding with its men, the parties on the road, the fleet in port and at sea, the latest orders, the latest reports); the League's map view (one GET for a commander with the bases, force, fleet, reach, move targets, campaign and roster, and 403 for anyone else); and one POST for every order, with the body of /api/map/act, move included.
- (h) The map's League mode: where the switch lives, how World2Map swaps its reach, roster, fleet, move targets and submit without moving a hook below an early return (AGENTS.md, rules-of-hooks), and which render tests prove it.
- (i) Every other place that reads player_marches, player_voyages, player_holdings or player_units by owner for something a player sees (the Barracks, the Chronicle, intel, admin, koinon, standings), and whether the League's rows would show there.

Then these production reads, read only, through railway run --service Postgres --environment production with DATABASE_PUBLIC_URL:
- the League's row; its men by town and type; its ships; any League march, voyage or holding (none expected)
- the League treasury's balance
- every faction at war, and the war cycle's state
- the sitting Archons and Strategoi, by name and seat

STOP 0. Report the design note and the reads. Write nothing until I rule.

## The build (after the ruling at STOP 0)

The commits as I expect them; the ruling at STOP 0 may change them.

1. `db: the record of the League's orders (migration 0076)`, as (f) is ruled; schema.ts mirrors it.
2. `shared: the League's orders`: the ledger reasons and their words in treasuryReasonLabel, the war gate's refusal, and the holder refusals for a League holding, as pure helpers with tests.
3. `league: the army's settle, in one lock order`: the League's settle per (b), and settleLeagueArmy in the lock order of (c). Tests: hulls come home to the League's stock; arrivals and the merge; a League holding with no men for a day reverts; a League town holding pays its tribute to the treasury once for each whole day, and a land holding's grain and timber are sold at the market's price; an order and the army settle at once, and neither deadlocks; the settle on a read takes no lock when nothing is due.
4. `server: the League's army takes orders`: the context of (a) through act, move and resolveMarch; the seat check; the war gate at the order and at the arrival; Winter for moves; naval supplies bought from the treasury; plunder to the treasury; a conquest as a League holding; what a party saw into the orderer's intel; the routes of (g); the holder refusals both ways. Tests on the test database: an Ephor and a citizen are refused; a raid on a nation at peace is refused, and one on a nation at war fights and credits the treasury with the drachmae and the goods at the market's price in one ledger row; a party that arrives after the peace turns back; an attack takes a town as a League holding that every map shows as "Held by The League"; a League march resolves through the campaign hook with no character, and its men come home; a move in Winter is refused; a voyage the treasury cannot pay for is refused and writes nothing; a house cannot raid or attack a League holding, and the League cannot raid or attack a house's; GET /military counts only the men standing in a town.
5. `server: the Government tab sees the whole army`: governmentView's army per (g), with its tests.
6. `web: the League's army on the map`: the switch and the League's mode per (h). Render tests: the switch shows for an Archon and a Strategos, never for an Ephor or a citizen; in the League's mode the picker lists the League's rows and posts the League's order; Attack and Raid are greyed with the war gate's words on a nation at peace; SEND MEN HERE shows on a League town; the house's mode is unchanged.
7. `web: the Government tab's army card`: each place, the parties on the road, the fleet at sea, the latest orders and reports. Render test.

## Gate and STOP 1

Run DATABASE_URL=…/massalia_5b_test pnpm gate at HEAD after the last commit, then pnpm audit --audit-level=high. The gate must end GATE GREEN: HEAD <sha>, tree clean; the audit must exit 0. A red from a timeout in a suite this diff does not touch is a STOP with the log; never rerun to get a pass. Commit only on a read exit code.

STOP 1. Report:

```
Committed: <SHA> <subject>, one line per commit
Branch: <branch>, built on origin/main <SHA>
Gate: <the gate's last line>, suite counts; audit exit code
Model: the League's context and settle as built, the lock order, and every exclusion from (i)
Orders: a test raid at war, from order to ledger: the order's record, the march, the report, the ledger rows, the treasury before and after
Conquest: a test attack's League holding as GET /military shows it, and its first tribute row
Words: every player-facing string, verbatim, for ruling
Rulings for Argiris: <each with the reason, or "none">
```

## Push (only after I reply "push")

Not in the hour before the 00:00 UTC season rollover. git fetch; if origin/main moved after your gate, rebase onto it, show each commit's git patch-id unchanged (AGENTS.md:74), and run the gate again. Then git push origin HEAD:main, a fast-forward, never forced. If CI goes red before Checkout on a registry pull, rerun it once; if Railway then leaves the commit SKIPPED, deploy it as AGENTS.md says (environmentTriggersDeploy, the server first, then the worker). Any other red is a STOP with the log. Report:
- remote HEAD
- the CI run with its Gate and Audit steps, and the Pages run
- Railway server and worker on the new SHA; 0076 in __massalia_migrations, if there is one
- API health
- read only, after the deploy: the League's men by place and its ships (the deploy moves nothing), the treasury's balance, and no "army: failed" or failed campaign resolve in the server log

Then drop massalia_5b_test, remove your worktree and delete the merged branch. Anything off is a STOP: report it and wait. Do not write to production to fix it.

## Scope fence

Only what the ruling at STOP 0 lists. No recruiting, no levy, no new unit or ship types. Do not change the battle, plunder, reach, march-time or conquest rules, the war motion, the players' upkeep, settleBarracks (beyond keeping the League out of it), the koinon's musters or the Chronicle. MAP_MUTATIONS_ENABLED stays false.

## Rulings at STOP 0 (Argiris, 13 Oct 2026)

Save these at the end of docs/politics/government-prompt-5b.md, in the first commit with the prompt. The design note stands as you wrote it, files list included, except where a ruling below changes it. Build straight through to STOP 1.

1. Yes: the League's moves are refused in Winter, and a player's move keeps no Winter check. The fence holds for players.
2. Yes, that is the intent. The League makes war only on the nineteen nations of the Diplomacy page, and only once the chamber has voted it: 44 of the 95 foreign towns belong to those nations, 23 of them Carthage's. Unclaimed land and the peoples no nation holds stay the houses' to raid; the League may scout there and nothing more. Give the refusal there its own words, for ruling at STOP 1.
3. Keep the player's rule: the escort sails unless the commander chooses his hulls in the picker, as a player can. In the League's mode the picker shows, before he sends, the naval supplies the voyage takes, what they cost the treasury in drachmae, and the treasury's balance.
4. Accept. Every man is paid and every man can desert, on the road or standing. A party thinned on the road arrives smaller, and a row that is gone is men who left on the road, as resolveMarch already reads it.
5. Yes: open koinonMuster.ts for those two strings and their tests, nothing else in it.
6. Accept the files, with koinonMuster.ts for ruling 5.

Three more, on the design note:

7. The war gate read from league_wars at the instant is accepted. For a League party that one answer drives three things: the gate, the war's plunder multiplier and the opinion roll (none at war), so they never disagree while faction_relations.at_war waits for the sync. A house's raid keeps reading the flag as today. No nation starts at war in content, so league_wars is the whole truth for the League.
8. The Temple of Artemis's morale is every army's in the world, the League's included; only the altar is a house's. Keep moraleBonusFor in the League's battle path, and test a League battle with the Temple standing.
9. The cheap read in (b) covers both of a holding's markers: the tribute marker and the empty-for-a-day one.

## Rulings at STOP 1 (Argiris, 14 Oct 2026)

Append these to docs/politics/government-prompt-5b.md as their own commit. Build the changes below as new commits, one concern each, staged by path, with their tests. Then run the gate, take the screenshots again, and STOP again with the same report. No push yet.

Argiris, 14 Oct: the Archons and Strategoi may not use the army and the fleet for their own gain, and commanding the army must be different from choosing their own troops. So:

1. No personal intel. What a League party sees goes to the League, not to the orderer's house: on its report, on the Government tab for every member, and on the map in the League's mode, where a place's panel shows the League's last sighting of it with its date. Remove the write to the orderer's dynasty. This replaces that part of ruling 8 of the prompt.
2. Nothing the army takes reaches an official. Plunder and tribute go to the treasury, League hulls carry only League men, and League men stand only in the League's places, as built. Add the tests that prove a mix is refused both ways: a League order naming a house's row, and a house order naming a League row.
3. No harvest of the League's work. For a year (96 hours) after the League's army fights at a town or land, the house of a sitting Archon or Strategos may not raid or attack it. A fight is a raid or an attack that met the defenders, not a scout, a turn-back or a landing driven off. The server refuses it at the house's order, and the map greys Raid and Attack with the same words in the house's mode. Propose the words. A koinon muster is left alone; name it as a known gap.
4. The League's orders get their own sheet, apart from the house's force picker. In the League's mode a place's buttons open an order sheet of the League's own: the League's colour and crest at its head; the line "Ordered by <name>, <seat>"; the League's men standing in each of its places, chosen by type and number; the hulls; the cost to the treasury and its balance; and a button that gives the order. The house's force picker stays as it is. Switching modes closes any open sheet or picker and drops its choice. While the League's mode is on, a band across the map in the League's colour says so. Propose the sheet's words.

On your list:

5. Your 1, 2, 3, 4, 5, 7, 8 and 9: accepted.
6. Your 6: the order keeps the official's name as it was given. 0076 has never been applied outside your test database, so add the column to it in a new commit, recreate massalia_5b_test, and say so in the report.
7. Your 10: yes, one line in AGENTS.md under "Server and data", in its own docs commit: the League's army is the players row of kind 'league', with no character; it writes no effect_log row and never runs settleAll or settleBarracks; every write to its men or its treasury takes its player lock first, then its treasuries row.

Words:

8. Mid-sentence it is "the League", lower case: "Held by the League", "Held by the League · tribute 120 dr a day", "Held by the League · garrison too small for tribute (15 men needed)", "Held by the League · 15 grain, 8 timber a day", "Held by the League.", "· held by the League". At the start of a sentence, "The League".
9. "The League makes war on nations alone, and this land answers to none." becomes "The League makes war only on nations, and no nation holds this land."
10. Every other string as built, except those the new sheet replaces.

The first war can start on 16 Oct 00:00 UTC, so come back today if you can.
