# Military 6a: skirmishers can't hold ground, the alert at half, strikes that can't empty their place, the holdings cap, two-round raids

Base: origin/main 874af75. Before Phase 0, git fetch, check git log and ListAgents for parallel work, and build in your own worktree from origin/main. If a migration turns out unavoidable, it is 0079 or later (0078_ship_builds.sql is taken).
Save this prompt verbatim as docs/military/military-6a-prompt-1.md in the first commit.

## Why
- Skirmishers can't be touched. A row with msl >= 4 and spd above the enemy's headcount-weighted spd fires every round and stays out of melee. A holding defended only by skirmishers can never be stormed: a 460-man Volcae strike against HungryJack's 113 skirmishers in Nemausus ends "stand" every time.
- Raids empty towns bit by bit. Corsi went from 100 to 0.
- Raid strike-backs drain their own town. They send the place's full strength even when its garrison is lower, and their dead come off that garrison. Vienna (86 of 120) sends 120 and is expected to fall to about 2.
- One-round raids never break the sally. 137 men against the 37 who come out kill 11 and lose 4.5; the 37 hold. Players read that as broken.
- One house can sprawl over the map; one already holds 3 places.

## Rulings (Argiris, 18 and 21 Oct)
1. Skirmishers can't hold ground. In attack mode, a battle that ends with neither side broken ("stand") is an attacker win when every defender row still on the field (count > 0, not broken) skirmished in the last round. If any non-skirmishing defender row is still standing, the stand holds as today. Raid mode is unchanged. It applies to every defender, a house's, the League's or an NPC place's. It goes in resolveBattle (packages/shared/src/battle.ts), so player attacks, koinon musters, League orders and strikes all get it; the fence on the resolver is lifted for this rule only. Survivors of a holding lost this way follow the existing stormed path (strikes.ts:587: they fall back at their owners' next settles).
2. On alert at half. A place no house holds, at or below 50% of its full strength, is on alert. Only Scout and Attack are available there. The server refuses a raid order from a house, a koinon muster or the League. A raid already on the road when the place goes on alert turns back at arrival: no fight, nothing gained, naval supplies spent at sailing stay spent, and it is NOT a fight for the strike-back count (the existing "turned_back" winner in mapActions.ts may serve). The alert lifts when regrowth takes the place above half. Attacks still fight the whole pool. The threshold is a content number (0.5). Build the test as one shared function (pool, full, share) used by raids, musters, League orders, strikes and the map payload: 6b will move it to a sally pool.
   - Wording (Argiris): "{Place} is on alert, gates are shut." on the map and as the line of a raid that turned back.
   - Visibility: shown to everyone on the map.
3. Strikes can't empty their place. A strike draws at most what each place actually has (never more than full), and its dead never take a drawn pool below half. A place on alert doesn't march. A raids strike called while its place is on alert is called at the first whole day of the pool's own regrowth clock (mapPools.ts) that takes it above half, then raidsCallAt's Winter rule applies. A war strike leaves an alert pool out of its draws.
4. Bug fix. When a strike chooses a target (targetsAt → standingAt, apps/server/src/services/strikes.ts:136), a unit whose arrival has passed counts as standing at its destination even if its owner isn't settled: mirror ownersAt's query (strikes.ts:415: moving_to = the place, arrives_at <= at, no march or muster mission). ownersAt already counts these rows; confirm and leave it.
5. A house holds at most 2 places, towns and lands together. The number lives in content (battle.json, beside tribute). A house's attack launched at the cap is refused with "Your house holds all it can: 2 places.", and Attack is disabled on the map with the same line (reachView). An attack already on the road when its house reaches the cap turns back at arrival: no fight, nothing gained or lost, naval supplies spent at sailing stay spent. Holdings above the cap today stay as they are (no production write); that house takes no new place until it is below the cap. The League has no cap. A holding is given up the existing way: withdraw the garrison and it reverts after a full day. Holdings are created in one place (mapActions.ts:774, insertConquest / insertTownConquest); koinon musters do not conquer.
6. Raids fight two rounds. content/military/battle.json raid.rounds 1 → 2, read by resolveBattle as cfg.raid.rounds. This covers every raid an attacker sends: a house's, a koinon muster's and the League's. Strikes fought in raid mode (raids strikes and any strike on a home town, strikes.ts:234) keep one round: add raidRounds: 1 to content/military/strikes.json and pass it to resolveBattle in strikes.ts as config { ...battle, raid: { ...battle.raid, rounds: c.raidRounds } }. A strike's defenders choose nothing, and two rounds would double their dead. The turnout rule is unchanged (half to all of the men sent, between a fiftieth and a quarter of the place). packages/shared/src/battle.test.ts:26 pins the raid block with rounds: 1; update that pin in the commit that changes the content.
7. Unchanged: NPC stats (battle.json npc.garrison / npc.warband stay single rows; varied rosters come in 6b). Officials may order League men anywhere, including their own holdings. Strikes fought as raids keep raid mode and one round. Plunder, regrowth and every other resolver constant.

## Where it lives today
- Resolver: packages/shared/src/battle.ts. Only ruling 1 changes it. Calibration harness: pnpm --filter @massalia/shared battle:calibrate (ten matchups; #3 is raid mode, the other nine attack mode).
- NPC stats: content/military/battle.json npc.garrison / npc.warband. Read at apps/server/src/services/mapActions.ts:677, koinonMuster.ts:1043 and strikes.ts:506.
- Raid turnout: raidTurnout (packages/shared/src/barracks.ts:445). Called at mapActions.ts:721 and koinonMuster.ts:1060.
- Strike force and dead: warForce (shared/strikes.ts:115), raidsForce (:127, sends full), deadOffDraws (:133). The strike's mode is chosen at strikes.ts:234; its battle at strikes.ts:508. The pools are written in strikes.ts after resolveBattle.
- Pools: apps/server/src/services/mapPools.ts (readTownGarrison, readRegionWarband, write*, regrownPool on each pool's own daily clock).
- Map: GET /api/map/military (routes/map.ts; the alert flag goes on this payload beside strikes) and GET /api/map/reach (reachView, services/mapReach.ts; Raid disabled with the alert line, Attack disabled with the cap line). Raid orders go through act (mapActions.ts:339), openMuster (koinonMuster.ts:211) and the League raid order in services/leagueOrders.ts. Web: apps/web/src/map/World2Map.tsx and apps/web/src/map/mapActions.ts.
- Holdings: services/holdings.ts (listHoldings, insertConquest, insertTownConquest, settleHoldings).

## Invariants (AGENTS.md)
- Balance numbers live in content, never in code.
- Military numbers never ship under apps/web/public (apps/web/test/public-leak-guard.test.ts). The alert is a boolean on the API payload, not a number.
- Content is zod-validated at boot.
- lockPlayer and claim-first rules stay as they are. No migration unless one is unavoidable; if one is, it is append-only and must run on Postgres 16 (CI).
- A map change needs a render test in apps/web/test before push.

## Measured today (Claude, resolveBattle at 874af75 content, 2,000 seeds; recheck)
- Strike: 460 warband vs 113 peltasts (walls 2) stand 100%; with ruling 1, attacker 100%. 120 warband vs 113 peltasts: defender 100% either way.
- Conquest: 120 hoplites vs a town of 50 (walls 2) win 100% before and after ruling 1. 137 ekdromoi vs a town of 73 (walls 2) win 100%, losing 22; vs the full 147, defender 100%.
- Raids at two rounds, quarter cap: 137 ekdromoi vs a town of 147 (walls 2) meet 37, kill 20, lose 7, the sally breaks 100% (today 11, 4.5, 14%). Raids to bring that town to the alert: 6 either way, 23 men lost on the way either way.
- Small raids, two rounds against one, quarter cap: peltasts improve (10 vs a tribe of 400: 81% → 99%; 20 vs a town of 100 with walls 2: 69% → 100%); ekdromoi stay within 5 points of today (10/20/30/50 vs town: 21/22/22/67% → 23/18/18/74%; vs tribe: 49/84/94/100% → 61/91/97/100%).
- Calibration #3 (20 peltasts raid 40 warband): attacker win at one round and two; kills 2.2 → 4.2, losses 1.0 → 1.0.
- Why strikes fought as raids keep one round: at two, 100 warband vs 60 ekdromoi (walls 2) strike wins 31% → 73%, defenders' dead 8.8 → 15.7; 120 warband vs 30 hoplites (walls 2) defenders' dead 7.7 → 15.5.

## Phases
- Phase 0: read the code above. Report anything that contradicts this brief. → STOP 0
- Phase 1: ruling 1 in battle.ts with unit tests, raid.rounds 2 in content and the strikes' raidRounds 1. Show battle:calibrate before and after (the nine attack-mode matchups must not change; #3 changes as measured above), and resolveBattle tables: strikes of 120, 230 and 460 warband against 40, 113 and 200 peltasts and against 80 peltasts + 40 hoplites (walls 0 and 2); 120 hoplites vs towns of 50 and 100; the small-raid table above at one and two rounds; 137 ekdromoi vs a town of 147 breaking the sally in 95% or more of seeds; a raids strike of 100 warband vs 60 ekdromoi (walls 2) unchanged from today. Propose the alert wording for a townless region ("gates" doesn't fit). → STOP 1 (Argiris rules)
- Phase 2: shared code: the alert function and its threshold in content, the strike draw cap and dead floor, the raids-strike wait, the holdings cap number; unit tests.
- Phase 3: server: raids, musters, League orders, strikes (including raidRounds), the targeting fix, the map payloads, the holdings cap; route and service tests, including a raid in flight when the place goes on alert, the race between a raid and the alert, a raids strike that waits out an alert, a strike that storms a skirmisher-only holding, a raids strike fought in one round, the cap refused at launch, an attack that turns back when the cap fills on the road, and a house above the cap keeping its holdings.
- Phase 4: web: the alert on the map, Raid disabled with the alert line, Attack disabled with the cap line, with a render test.
- Phase 5: the gate (DATABASE_URL=…_test pnpm gate, ending "GATE GREEN … tree clean") and pnpm audit --audit-level=high. → STOP 2. No push without a separate push prompt.

## Scope fence
Only what is above. Not in scope: NPC rosters and the sally pool (6b), the levy, sieges and mercenary pay (Military 7), the region levy bonus, regrowth of held places' pools, strike battle rules beyond raidRounds, officials and the League, any resolver change beyond ruling 1, any turnout change. Anything else is a "Ruling for Argiris" item in the report.

## Report
- Each commit as Committed: <SHA> <subject>, one item per commit.
- The gate's last line, quoted.
- Departures from this brief as "Ruling for Argiris" items.
- The STOP 1 tables, rerun on the final code.

## Rulings at STOP 0 (Argiris, 21 Oct 2026)

Where the code differs:
1. Calibration: run the script with the server package's tsx. No lockfile change in 6a; keep it as a Ruling for Argiris item.
2. The League's raid goes through act with a League context: accepted. One alert check in act covers both.
3. Ruling 1 changes only strikes today: accepted. Koinon musters are raid-only (koinonMuster.ts:235), so ruling 1 never reaches them.
4. The alert and the cap outside the reach verdicts: accepted as planned (per-place alert lines keyed by town and region, a cap line, act checks both, /military gets alert: { towns, regions } as true flags with no write during the GET). The /military flag and act must read the pool through the same regrownPool reading, so the map and the refusal agree at the same instant. Add one test where both agree on a pool that regrows across half.
Re-pinned tests: accepted. In the STOP 1 report, list each re-pinned assertion, old → new, by suite, so a re-pin can't hide a bug.

Questions:
1. A muster that launches into an alert stands down at the launch with the alert line: nothing sails, no supplies are spent, and its pledged rows are released the way a lost gathering place does. A muster already marching when the alert falls turns back at arrival (ruling 2).
2. The muster target list leaves out places on alert: yes.
3. The report line of an attack turned back at the cap: "Turned back from {Place}. Your house holds all it can: 2 places." (the number from content).
4. The strike floor is half of full rounded up, and a place may land exactly on the alert. Dead below a pool's floor come off no pool and are not moved onto other pools: accepted.

Your defaults are all accepted: "alert": { "share": 0.5 } and "holdings": { "maxPerHouse": 2 } in battle.json; a held place, the League's included, is never on alert; on alert only Raid is greyed; the raids-strike wait is recomputed each pass from the pool's clock and not stored.

Go on to Phase 1 and stop at STOP 1.

## Rulings at STOP 1 (Argiris, 21 Oct 2026)

1. The mixed garrison falling once its line breaks: accepted. Ruling 1 stands as written: a line that breaks loses the walls.
2. The re-pins and the new strikes test: accepted.
3. Alert wording for a townless land: "{Place} is on alert, the herds are driven into the hills."
4. Calibration through the server's tsx, no lockfile change: accepted.

Go on through Phases 2 to 5 and stop at STOP 2. In the STOP 2 report, include a browser check of a town and a land on alert (the map flag, Raid greyed with each line), Attack greyed with the cap line for a house at 2 places, and a raid turned back at arrival.
