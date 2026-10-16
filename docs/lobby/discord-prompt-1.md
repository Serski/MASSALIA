# Discord 1: the invite in the Lobby, and under Lobby in the game

Drafted by Claude on 16 Oct 2026 against ff76411. Save this prompt as docs/lobby/discord-prompt-1.md in the first commit. Read AGENTS.md first. Web only: no server change, no migration, no production write. One concern per commit, staged by path. Recon first, and STOP only if something below does not match the code; otherwise build straight through to STOP 1. Commits stay local; no push until I say push.

## Where to build

Other sessions work in the main clone. git fetch, then build in your own worktree on a new branch from origin/main, with your own test database: create massalia_discord_test, point DATABASE_URL at it, and drop it once this is pushed. Never stage, stash or commit files you did not write, and leave the main clone's main alone.

## What it is

The game's Discord is https://discord.gg/wPUJCJNSpN (Argiris, 16 Oct: a valid invite with no expiry and no limit on uses). lobby/links.ts has held an empty DISCORD_INVITE_URL since the Lobby was built, so the frame's Discord link has never shown. Argiris, 16 Oct: a Discord link under the Lobby tab, and in the Lobby itself.

## Rulings (Argiris, 16 Oct 2026)

1. The invite. DISCORD_INVITE_URL becomes "https://discord.gg/wPUJCJNSpN". The Lobby frame's nav then shows "Discord" after Guides on /lobby, /news and /guides, as LobbyFrame.tsx already renders it.
2. In the Lobby. The right column gains a Discord box right under the Guides box, in its style, with no new picture: the title "Discord", the line "Where the houses meet, bargain and plot between seasons." and the link "Join the Discord →".
3. Under the Lobby tab in the game. The sidebar's Lobby button (Dashboard.tsx:384) gets a "Discord" link right under it, in the same style. On phones, the More sheet's Lobby (Dashboard.tsx:495) gets "Discord" right after it.
4. Every Discord link opens the invite in a new tab (target="_blank", rel="noopener noreferrer") and reads the one constant; no other copy of the URL anywhere.

## Phase 0: recon (read only)

First git fetch, git status -sb and git log --oneline origin/main..main in the main clone, then make your worktree. Confirm origin/main at ff76411 or a fast-forward of it (say which).

- apps/web/src/lobby/links.ts and LobbyFrame.tsx (the nav, 59-85; the Discord link, 74-76).
- apps/web/src/lobby/LobbyPage.tsx: RightColumn (347) and its Guides box (353-360); lobby.css's .lobby-guides-* rules (530-576).
- apps/web/src/dashboard/Dashboard.tsx: the sidebar's Guide and Lobby buttons (379-386) and the More sheet's (484-497); dashboard.css .sidebar-guide (4007).
- apps/web/test: every test that reads the Lobby nav or expects no Discord link (an empty invite rendered none), and the dashboard tests that read the sidebar or the More sheet.

## The build

1. `web: the Discord invite in the Lobby`. Rulings 1, 2 and 4. Render tests: the frame's Discord link after Guides, with the invite, the new tab and the rel; the Discord box under the Guides box with its words and link; any test that expected no Discord link now expects it.
2. `web: Discord under Lobby in the game`. Rulings 3 and 4. The Dashboard imports the constant from lobby/links.ts (a one-line module, so the game does not pull the Lobby's bundle). Render tests: the sidebar's Discord link right after its Lobby button; the More sheet's Discord right after its Lobby; both with the invite, the new tab and the rel.

## Gate and STOP 1

Run DATABASE_URL=…/massalia_discord_test pnpm gate at HEAD after the last commit, then pnpm audit --audit-level=high. The gate must end GATE GREEN: HEAD <sha>, tree clean; the audit must exit 0. A red from a timeout in a suite this diff does not touch is a STOP with the log; never rerun to get a pass. Then check it in a browser on a throwaway database: the Lobby on a desktop and at 375 px wide (the header with Discord and no sideways scroll; the box), /news logged out (the header's Discord), the game's sidebar on a desktop and the More sheet on a phone. Click one Discord link and say where it went. Screenshots, then drop that database. Report:

```
Committed: <SHA> <subject>, one line per commit
Branch: <branch>, built on origin/main <SHA>
Gate: <the gate's last line>, suite counts; audit exit code
Browser: what each screenshot shows
Words: every player-facing string added, verbatim
Rulings for Argiris: <each with the reason, or "none">
```

## Push (only after I reply "push")

Not in the hour before the 00:00 UTC season rollover. git fetch; if origin/main moved after your gate, rebase onto it, show each commit's git patch-id unchanged (AGENTS.md:74), and run the gate again. Then git push origin HEAD:main, a fast-forward, never forced. If CI goes red before Checkout on a registry pull, rerun it once; if Railway then leaves the commit SKIPPED, deploy it as AGENTS.md says (environmentTriggersDeploy, the server first, then the worker). Any other red is a STOP with the log. Report: remote HEAD; the CI run with its Gate and Audit steps, and the Pages run; Railway server and worker on the new SHA, no migration; API health; and playmassalia.com serving the new bundle with the invite in it (read the deployed assets; /news needs no login). Then drop massalia_discord_test, remove your worktree and delete the merged branch. Anything off is a STOP: report it and wait.

## Scope fence

Only the files the build names and their tests: links.ts, LobbyPage.tsx, lobby.css, Dashboard.tsx, and dashboard.css if the link needs a rule. No change to the landing page, the auth modal's Discord button, the in-game Guide, the server or content.
