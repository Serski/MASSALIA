# Holdings 4: a koinon's muster may gather in a house's holding, and the League's army may stand in one

Drafted by Claude on 15 Oct 2026 against 695e911. Save this prompt as docs/barracks/holdings-prompt-4.md in the first commit. Read AGENTS.md first. No migration, no production write. One concern per commit, staged by path. Recon first, and STOP only if something below does not match the code; otherwise build straight through to STOP 1. Before each commit, run the suites its files touch and read the exit code. A map change needs a render test (AGENTS.md). Commits stay local; no push until I say push.

## Where to build

Other sessions work in the main clone. git fetch, then build in your own worktree on a new branch from origin/main, with your own test database: create massalia_holdings4_test, point DATABASE_URL at it, and drop it once this is pushed. Never stage, stash or commit files you did not write, and leave the main clone's main alone.

## What it is

Since holdings prompt 3 every house may move men into another house's holding (Reii, Salyes) and keep them there. Two things still cannot: a koinon's muster cannot gather there, and the League's army cannot move there.

## Rulings (Argiris, 15 Oct 2026)

1. A koinon's muster may gather in any house's holding, a town or a land, as it gathers at Massalia's own places. Members move men there with the ordinary Move, as holdings prompt 3 allows, and pledge them there.
2. The League's army may move into any house's holding and stand there, as a house may. While its men stand there the place is a base for the League: they may set out from it to scout, raid or attack under the League's war rules (unchanged), and move on or home from it.

## Claude's calls (Argiris rules on them at STOP 1)

3. The holder keeps his holding exactly as it is. League men and a muster's men count for nothing in it: the minimum garrison for its tribute and the day without a garrison after which it reverts count his own men alone (holdings prompt 3, rule 2). His views do not change, and a guest learns nothing new about the holding.
4. The League's holdings stay the League's alone, as holdings prompt 3 ruled: no house moves men into them, and so no muster gathers in one.
5. The League's men turn for home as a house's do. League men standing in, or arriving at, a place the League may no longer stand in (a house's holding that reverted, or one of its own that reverted) turn for the town of Massalia. They reach it after as long as a move from that place would take, and need no ships and no naval supplies. The League's own settle (settleLeague) does this for its rows. It writes no effect_log row, as the League writes none; its settle result counts the rows turned.
6. A muster whose gathering place is no longer one every house may stand in when it launches (its holding reverted, or passed to the League) stands down at the launch with the reason "The gathering place is no longer Massalia's." Its pledges are freed as at any stand-down, and each owner's next settle turns his men home (holdings prompt 3, rule 4). Survivors on the road back to a gathering place that reverted turn home when they arrive, as built.
7. The words. LEAGUE_MOVE_REFUSAL, "The League's men move only between its towns and its holdings.", becomes "The League's men move only between its towns and Massalia's holdings." The stand-down reason is in call 6. The house's refusal stays "Men may only be sent to Massalia's own ground or to a house's holding." The muster's gathering list keeps its order: Massalia first, then the rest by name, the houses' holdings among them.
8. The map. In the League's mode, a house's holding shows SEND MEN HERE beside its actions, and it opens the League's order sheet for a move, as on the League's own places. In the house's mode nothing changes.

## Phase 0: recon (read only)

First git fetch, git status -sb and git log --oneline origin/main..main in the main clone, then make your worktree. Confirm origin/main at 695e911 or a fast-forward of it (say which). A behaviour that differs from this list is a STOP 0; a line that moved a few is not.

- apps/server/src/services/koinonMuster.ts: gatherPlace (109) takes the Massalia region and the home places only; gatherPlaces (116) lists them; openMuster (209) refuses anything else with "Choose a gathering place on Massalia's own ground." (212); musterTargets (397) lists targets from a gathering place; the launch's standDown (845) and its checks (853-858); the survivors' road home to the gathering place (1102-1109).
- apps/server/src/services/barracks.ts: settleBarracks turns home a house's rows arriving at, or standing in, a place it may no longer stand in (854-877); a pledged row is exempt until its muster frees it.
- apps/server/src/services/mapReach.ts: basesOf (130) returns the League's bases at 146, before any guest base; guestPlaces (158) is every house's holding, never the League's; housePlaces (168); moveTargetsOf (195) gives the League its ten home towns and its own holdings only.
- apps/server/src/services/leagueOrders.ts: settleLeague (127) lands the League's arrivals with no check of the place (143-149), and its settleHoldings step reverts an empty League holding with no turn-home for League men standing there. packages/shared/src/leagueOrders.ts:49, LEAGUE_MOVE_REFUSAL.
- apps/server/src/services/mapActions.ts: move (875), its refusal (906).
- apps/web/src/map/World2Map.tsx: sendMenBeside (1344) reads a move target of kind "guest"; in the League's mode the map reads leagueMapView's moveTargets. apps/web/src/dashboard/panels/KoinonView.tsx: the gathering list from GET /api/koinon/muster/targets.

Then a production read, read only, through railway run --service Postgres --environment production with DATABASE_PUBLIC_URL: every player_holdings row with its holder; any open or marching muster with its gathering place and target; where the League's rows stand and any on the road.

## The build

1. `server: a koinon's muster may gather in a house's holding` (rulings 1, calls 3, 4 and 6). Tests on the test database: a muster opens at another house's town holding and at a land holding; members move men there, their own holding or as guests, and pledge them; its targets are listed from there; it launches and fights from there; a League holding is no gathering place, with the refusal above; a muster whose gathering holding reverted before the launch stands down with the new reason, and each owner's next settle turns his men home; survivors on the road back to a gathering holding that reverted turn home on arrival; the holder's garrison count, tribute and reversion ignore every guest.
2. `server: the League's army may stand in a house's holding` (ruling 2, calls 3, 5 and 7). Tests: a League move into a house's town holding and into a land holding; the men stand there, the place is a League base, and a raid sets out from it at war; outside a war, Raid and Attack from there are refused as anywhere; the holder's garrison count, tribute and reversion ignore League men, and GET /military's holdings and the holder's views do not change; when the holding reverts, the League's settle turns its men there for the town of Massalia with a move's time, no ships and no supplies drawn; League men on the road to a holding that reverted turn on arrival; the same for a League holding that reverts; a house still cannot move men into a League holding; a League move to any other foreign place is refused with the new words; the no-mix tests of 5b still pass.
3. `web: the League's men to a house's holding, and the muster's gathering list` (call 8). Render tests: in the League's mode a house's holding shows SEND MEN HERE beside its actions and opens the League's order sheet for a move; in the house's mode it is unchanged; the gathering list shows the houses' holdings.

## Gate and STOP 1

Run DATABASE_URL=…/massalia_holdings4_test pnpm gate at HEAD after the last commit, then pnpm audit --audit-level=high. The gate must end GATE GREEN: HEAD <sha>, tree clean; the audit must exit 0. A red from a timeout in a suite this diff does not touch is a STOP with the log; never rerun to get a pass. Report:

```
Committed: <SHA> <subject>, one line per commit
Branch: <branch>, built on origin/main <SHA>
Gate: <the gate's last line>, suite counts; audit exit code
Model: where the gathering places, the League's bases and its move targets now come from, and the League's turn-home as built
Production: the read above
Words: every player-facing string added or changed, verbatim
Rulings for Argiris: <each with the reason, or "none">
```

## Push (only after I reply "push")

Not in the hour before the 00:00 UTC season rollover. git fetch; if origin/main moved after your gate, rebase onto it, show each commit's git patch-id unchanged (AGENTS.md:74), and run the gate again. Then git push origin HEAD:main, a fast-forward, never forced. If CI goes red before Checkout on a registry pull, rerun it once; if Railway then leaves the commit SKIPPED, deploy it as AGENTS.md says (environmentTriggersDeploy, the server first, then the worker). Any other red is a STOP with the log. Report: remote HEAD; the CI run with its Gate and Audit steps, and the Pages run; Railway server and worker on the new SHA, no migration; API health; no "army: failed" in the server log after the deploy; and, read only, every holding with its holder and where the League's rows stand, unchanged by the deploy. Then drop massalia_holdings4_test, remove your worktree and delete the merged branch. Anything off is a STOP: report it and wait. Do not write to production to fix it.

## Scope fence

Only the files the build names and their tests. Do not touch the holder's tribute, reversion or garrison rules, the muster's targets, its battle or its plunder, the League's war gate, its harvest ban or its no-mix rules, the conquest, raid, scout or battle rules, the intel rules or the Chronicle. No migration.

## Rulings at STOP 1 (Argiris, 15 Oct 2026)

Append these to docs/barracks/holdings-prompt-4.md as their own commit, then run the gate at the new HEAD.

1. Your 1: the test change accepted. The League may stand in a sitting official's own house's holding; its men count for nothing to him, so there is no bar.
2. Your 2 to 7 accepted, and every word as built. The new read in leagueDue runs inside settleLeagueQuietly, so a failure there logs "army: failed" and never fails GET /me/state.
3. Your 8: yes, a browser check this time, on a throwaway database. As a sitting Archon in the League's mode, open a house's holding, use SEND MEN HERE, give the move on the League's order sheet, and show the men arrived and the place listed among the League's places. Then open a muster in the koinon form with a house's holding as the gathering place. Screenshots in the report, then drop that database. If anything in the check is off, STOP before the push.

push, after the check. It must be out by 21:00 UTC today; if it is not, do not push tonight, and wait for my word in the morning. Report as the prompt lists.
