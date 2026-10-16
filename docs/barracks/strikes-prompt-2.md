# Strikes 2: the alarm, for the Government and for the holder

Drafted by Claude on 15 Oct 2026 against 5c802dd. This replaces any earlier draft of this prompt; discard it. Save this prompt as docs/barracks/strikes-prompt-2.md in the first commit. Read AGENTS.md first. No migration, no production write. One concern per commit, staged by path. Recon first, and STOP only if something below does not match the code; otherwise build straight through to STOP 1. Commits stay local; no push until I say push.

## Where to build

Other sessions work in the main clone. git fetch, then build in your own worktree on a new branch from origin/main, with your own test database: create massalia_strikes2_test, point DATABASE_URL at it, and drop it once this is pushed. Never stage, stash or commit files you did not write, and leave the main clone's main alone.

## What it is

Since Strikes 1 a march shows only where a player goes to look: the target's map panel, the Diplomacy page and the Government tab. Nobody is told. Argiris, 15 Oct: the officials get a notification on the Politics tab, as the daily cards have on Court; and the player who holds the target gets an incoming attack in his Barracks, as the reports of his own troops moving in and out appear there. Nothing for anyone else, and no banner.

## Rulings (Argiris, 15 Oct 2026)

1. The Government. A sitting Archon, Ephor or Strategos sees a badge on the Politics nav item while any march is on the road: the number of marches, in Court's badge style (nav-badge, not subtle), not Family's. The Government tab inside Politics carries the same count. The badge goes when the marches have struck. When there is no march, the Politics badge is the koinon count as today.
2. The holder. While a march is on the road against a holding of his, its holder sees it at the top of his Barracks reports, where his troops' moves and reports are: tagged "INCOMING", with its march line as Strikes 1 words it, a countdown to the strike, and "Show on map", which opens the Atlas on the place. When it strikes, the entry goes and his strike report takes its place.
3. The holder also gets a badge on the Barracks nav item: the number of marches on the road against his holdings, in Court's badge style.
4. On phones, Politics and Barracks sit under More: the More tab's badge adds these counts, as hiddenBadgeCount adds the others (Dashboard.tsx:189).
5. No sound, no pop-up, no banner, and nothing for players the march does not concern in these ways.

## Phase 0: recon (read only)

First git fetch, git status -sb and git log --oneline origin/main..main in the main clone, then make your worktree. Confirm origin/main at 5c802dd or a fast-forward of it (say which).

- apps/server/src/services/strikes.ts: strikeViews (638), the march line, and how a march knows its target's holder.
- apps/server/src/routes/me.ts: GET /me/state and its nav counts (familyPending 112, koinonPending 115, the response around 226-245); how a character's sitting offices are read (the Government tab's membership).
- apps/web/src/dashboard/Dashboard.tsx: the nav items (29-37), Court's badge (186, 358 and 436), Family's and Politics' (359-360), the More tab's count (189 and 465).
- apps/web/src/dashboard/panels/BarracksPanel.tsx: the reports list and its tags (the strike report's "STRIKE"); PoliticsPanel's tabs and how the Government tab is labelled.

## The build

1. `server: the alarms on GET /me/state`. /me/state gains `strikeAlarms`: `government`, the number of marches on the road, for a sitting Archon, Ephor or Strategos, else 0; and `incoming`, the marches on the road against the viewer's own holdings, each with its id, the nation's and the place's names, the target's ids, "about", the strike instant and the march line. With nothing on the road it costs one small indexed read. A failure in it logs "strikes: failed <message>" and gives 0 and an empty list; it never fails /me/state. Tests: an official counts every march on the road; a player with no seat counts none; a holder sees the march on his holding and not one on another's; a guest with men in that holding sees nothing; both clear when the march strikes or is called off; a throw leaves /me/state at 200.
2. `web: the Politics badge for the Government, and the incoming attack in the Barracks`. Rulings 1 to 4. Render tests: the Politics badge in Court's style with the count, and the koinon count when nothing marches; the Government tab's count; the Barracks entry with its tag, line, countdown (from the server's clock, as the map's countdowns are) and "Show on map"; the Barracks badge; the More tab's count; nothing for a player with no seat and no holding under march.

## Gate and STOP 1

Run DATABASE_URL=…/massalia_strikes2_test pnpm gate at HEAD after the last commit, then pnpm audit --audit-level=high. The gate must end GATE GREEN: HEAD <sha>, tree clean; the audit must exit 0. A red from a timeout in a suite this diff does not touch is a STOP with the log; never rerun to get a pass. Then check it in a browser on a throwaway database: a march on a house's holding seen by its holder (the Barracks entry and badge) and by a sitting Archon (the Politics badge and the Government tab), and by a plain player (nothing); after the strike, the badges gone and the holder's report in place. Screenshots, then drop that database. Report:

```
Committed: <SHA> <subject>, one line per commit
Branch: <branch>, built on origin/main <SHA>
Gate: <the gate's last line>, suite counts; audit exit code
Browser: what each screenshot shows
Words: every player-facing string added, verbatim
Production: read only, the strikes table and the war with the Volcae as they stand
Rulings for Argiris: <each with the reason, or "none">
```

## Push (only after I reply "push")

Not in the hour before the 00:00 UTC season rollover. git fetch; if origin/main moved after your gate, rebase onto it, show each commit's git patch-id unchanged (AGENTS.md:74), and run the gate again. Then git push origin HEAD:main, a fast-forward, never forced. If CI goes red before Checkout on a registry pull, rerun it once; if Railway then leaves the commit SKIPPED, deploy it as AGENTS.md says (environmentTriggersDeploy, the server first, then the worker). Any other red is a STOP with the log. Report: remote HEAD; the CI run with its Gate and Audit steps, and the Pages run; Railway server and worker on the new SHA, no migration; API health; GET /me/state answering 200 with no "strikes: failed" in the log; and, read only, the strikes table. Then drop massalia_strikes2_test, remove your worktree and delete the merged branch. Anything off is a STOP: report it and wait. Do not write to production to fix it.

## Scope fence

Only the files the build names and their tests. No change to how marches are called or fought, their numbers, their words, the reports, the map panel's lines, the Diplomacy page or the Government tab's card. No migration.
