# Holdings 3: every house may stand in another house's holding

Drafted by Claude on 14 Oct 2026 against cb03563. Save this prompt as docs/barracks/holdings-prompt-3.md in the first commit. Read AGENTS.md first. No migration, no production write. One concern per commit, staged by path. Recon first, and STOP only if something below does not match the code; otherwise build straight through to STOP 1. Before each commit, run the suites its files touch and read the exit code. A map change needs a render test (AGENTS.md). Commits stay local; no push until I say push.

## Where to build

Other sessions work in the main clone. git fetch, then build in your own worktree on a new branch from origin/main, and run the gate against your own test database: create massalia_holdings3_test, point DATABASE_URL at it, and drop it once this is pushed. Never stage, stash or commit files you did not write, and leave the main clone's main alone. At STOP 1, give the branch and the origin/main SHA you built on.

## What it is

Today a house may send men only to the Massalia region, Massalia's home places and its own holdings. Two places are held by houses now: the town of Reii and the land of Salyes (R046). No other house may set foot in either.

Ruling (Argiris, 14 Oct 2026): a holding is Massalia's land. Every house may move men into another house's holding and keep them there. The holder keeps it as it is: he alone holds it and he alone collects its tribute.

## Rulings

1. Every house may move men to another house's holding, a town or a land, and keep them there. While its men stand there the place is a base for that house, as a home place is: they may set out from it to scout, raid or attack, and move on or home from it.
2. The holder keeps the holding exactly as it is. Only his own men count for it: the minimum garrison for its tribute and the day without a garrison after which it reverts count his men alone, never a guest's. His holding view, tribute and reversion do not change.
3. A guest learns nothing new about the holding: no garrison, no tribute, no dates. His own men there are his to see, as anywhere.
4. When a holding reverts it is no longer Massalia's. A house's men standing in a place it may no longer stand in, or arriving at one, turn for the Massalia region: they reach it after as long as a move from that place would take, and need no ships and no naval supplies. Each house's own settle does this for its own rows; it never writes another player's rows. The same rule covers a house's men on the road to its own holding when it reverts before they arrive, which today would leave them standing in a place that is no longer a base.
5. The League's holdings stay the League's alone: no house may move men into them. An Archon could otherwise use a town the League's army took as his own house's forward base.
6. The map. On another house's holding the panel keeps its holder line and its actions (Scout; Raid and Attack greyed with the server's sentences) and adds SEND MEN HERE. A guest's men there read "Your men here: …". Nothing the map paints changes: another house's holding is never "Held by your house" and never takes the viewer's legality.
7. The words are Claude's; Argiris rules on them at STOP 1. The move's refusal "Men may only be sent to Massalia's own ground or a holding of yours." becomes "Men may only be sent to Massalia's own ground or to a house's holding."

## Phase 0: recon (read only)

First git fetch, git status -sb and git log --oneline origin/main..main in the main clone, then make your worktree. Confirm origin/main at cb03563 or a fast-forward of it (say which). A behaviour that differs from this list is a STOP 0; a line that moved a few is not.

- apps/server/src/services/mapReach.ts: BaseKind (50) is "massalia" | "colony" | "conquest" | "home". basesOf (128): a house's bases are the Massalia region, its own holdings with their HoldingView, and the home places where it has men standing. moveTargetsOf (168): the Massalia region, the home places and the house's own holdings. reachView (186) and its `excluded` set (208).
- apps/server/src/services/mapActions.ts: move (875) takes its destination from view.moveTargets (905-906). act (339) refuses a raid or an attack on another house's holding (377-389).
- apps/server/src/services/barracks.ts: settleBarracks lands a row at its movingTo with no check of the place (arrivals, 807-820), then settles holdings (848-851).
- apps/server/src/services/holdings.ts: listHoldings by owner (43), listWorldHoldings (61), garrisonCount counts the owner's own rows (74), settleHoldings (103).
- apps/web/src/map/World2Map.tsx: isHolding (580) reads a base of kind colony or conquest as the viewer's own holding (paint, legality, "Held by your house"). SEND MEN HERE replaces the action row on any move target (1340-1350; the region panel 1409-1427; TownPanel's canSendMen). apps/web/src/dashboard/panels/BarracksPanel.tsx ranks places by kind (794-797).
- A League context gets none of these places (5b).

Then a production read, read only, through railway run --service Postgres --environment production with DATABASE_PUBLIC_URL: every player_holdings row with its holder's name, and any house's rows based at another house's holding (none expected).

## The build

1. `server: a house may stand in another house's holding`. A new base kind for another house's holding (my suggestion: "guest"), with holding: null. basesOf adds it where this house's men stand; moveTargetsOf adds every other house's holding, never the League's. The move's refusal words per ruling 7. Rule 4 in settleBarracks, before the merge, with one effect_log row for each row that turns home. Tests on the test database: a house moves men into another house's town holding and into its land holding; they stand there and the place is a base, and a raid sets out from it; the holder's garrison count, tribute and reversion ignore the guests; when the holding reverts, the guest's own settle turns his men for the Massalia region with a move's time and no ships; men on the road to a holding that reverted turn home when they arrive, and so do a house's men on the road to its own holding; a house cannot move men into a League holding; GET /military's holdings and the holder's views do not change.
2. `web: another house's holding is a place to send men`. SEND MEN HERE beside the action row on another house's holding, town or land; a guest base never painted or read as the viewer's own; the Barracks lists a guest base after the house's own holdings. Render tests for each, and the viewer's own holding unchanged.

## Gate and STOP 1

Run DATABASE_URL=…/massalia_holdings3_test pnpm gate at HEAD after the last commit, then pnpm audit --audit-level=high. The gate must end GATE GREEN: HEAD <sha>, tree clean; the audit must exit 0. A red from a timeout in a suite this diff does not touch is a STOP with the log; never rerun to get a pass.

STOP 1. Report:

```
Committed: <SHA> <subject>, one line per commit
Branch: <branch>, built on origin/main <SHA>
Gate: <the gate's last line>, suite counts; audit exit code
Model: the new base kind, where basesOf and moveTargetsOf add it, and the turn-home rule as built
Production: the holdings and their holders as read
Words: every player-facing string, verbatim, for ruling
Rulings for Argiris: <each with the reason, or "none">
```

## Push (only after I reply "push")

Not in the hour before the 00:00 UTC season rollover. git fetch; if origin/main moved after your gate, rebase onto it, show each commit's git patch-id unchanged (AGENTS.md:74), and run the gate again. Then git push origin HEAD:main, a fast-forward, never forced. If CI goes red before Checkout on a registry pull, rerun it once; if Railway then leaves the commit SKIPPED, deploy it as AGENTS.md says (environmentTriggersDeploy, the server first, then the worker). Any other red is a STOP with the log. Report: remote HEAD; the CI run with its Gate and Audit steps, and the Pages run; Railway server and worker on the new SHA, no migration; API health; and, read only, every holding with its holder, unchanged by the deploy. Then drop massalia_holdings3_test, remove your worktree and delete the merged branch. Anything off is a STOP: report it and wait. Do not write to production to fix it.

## Scope fence

Only the files the build names and their tests. Do not touch the holder's tribute, reversion or garrison rules, the conquest, raid, scout or battle rules, the League's orders or its holdings, the koinon's musters, the intel rules or the Chronicle. No migration.
