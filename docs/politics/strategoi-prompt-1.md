# Strategoi 1: any man with a Militia above 40 may be Strategos, and the Strategoi are replaced with the elections

Drafted by Claude on 14 Oct 2026 against c00fdfa. This replaces any earlier draft of this prompt; discard it. Save this prompt as docs/politics/strategoi-prompt-1.md in the first commit. Read AGENTS.md first. No migration, no production write. One concern per commit, staged by path. Recon first, and STOP only if something below does not match the code or the read; otherwise build straight through to STOP 1. Commits stay local; no push until I say push.

## Where to build

Other sessions work in the main clone. git fetch, then build in your own worktree on a new branch from origin/main, with your own test database: create massalia_strategoi_test, point DATABASE_URL at it, and drop it once this is pushed. Never stage, stash or commit files you did not write, and leave the main clone's main alone.

## What happened

Argiris, 14 Oct: Ajax Marius, a sitting Archon, tried to appoint Spartakolous, a shipbuilder of no party, as Strategos and could not. The cause is the hoplite rule: appointStrategos refuses a man who was never a hoplite. Argiris rules it goes: any man with a Militia above 40 may be Strategos, and the Strategoi are replaced with the elections.

## The code today, as I read it at c00fdfa (confirm or correct each line)

apps/server/src/services/elections.ts:
- Only a sitting Archon or Ephor of the League appoints a Strategos (isSittingOfficial, 339; a party office does not count). officesView (294-307) offers the Appoint button to them alone, on a vacant seat.
- The picker's list (GET /api/offices/appointees, eligibleAppointees, 520) holds every player seat-holder who is alive, not a regent and holds no office of any kind, League or party. It applies neither the hoplite rule nor the party rule, so it offers men the server then refuses.
- appointStrategos (472) refuses an actor who is not an official (403); an appointment while both seats are filled (409); through appointEligible (431), an unknown or dead man, a man with no oligarch seat, a regent; a man who was never a hoplite (490, 409, "The Strategos must be a soldier or a veteran of the phalanx."); a man of the same party as the other sitting Strategos (409). A man of no party passes the party rule. Nothing stops a man who already holds a League seat, or one abroad on a mercenary contract.
- A Strategos sits until he dies: term_ends_year is null at 508 and 511, and reconcileOffices vacates his seat on death only (412-422). endOpenHistory (350) takes no side for a Strategos, so one Strategos's death also ends the other's open office_history row.
- The worker's election sweep (apps/worker/src/index.ts:152-162) runs openElectionsIfDue and advanceElections but not reconcileOffices. GET /me/state awaits syncElections with no catch (apps/server/src/routes/me.ts:120).
- was_hoplite is written at character creation (character.ts:126) and read only by the Strategos rule (490).
- The sheet's stats with trait bonuses come from sheetStats (apps/server/src/services/traits.ts:76); the mercenary board's gates read them (merc.ts:201-203). A sitting Strategos cannot be sworn abroad (merc.ts:246).

content/politics/politics-config.json:45: "strategoi": { "count": 2, "crossPartyBalance": true }, with its schema in packages/shared/src/oligarchy.ts:49.

apps/web/src/dashboard/panels/PoliticsPanel.tsx: AppointPicker (444-476) loads the list when opened and shows each man's party; onAppoint (623-632) shows the server's refusal as the panel's note. apps/web/src/dashboard/guideContent.tsx:114 says "the Strategoi are appointed."

## Phase 0: recon and production read (read only)

First git fetch, git status -sb and git log --oneline origin/main..main in the main clone, then make your worktree. Confirm origin/main at c00fdfa or a fast-forward of it (say which).

Then, read only, through railway run --service Postgres --environment production with DATABASE_PUBLIC_URL (a script that only reads is fine):

1. Every offices row, League and party: office, side, slot, the holder's name, class and party, acquired_via, term_started_year, term_ends_year.
2. Spartakolous (match the name loosely; the spelling may differ): status, class_id, was_hoplite, party, is_regent, his oligarch_seats row, contract_id, every office he holds, and his Militia as his sheet shows it (base, trait bonuses, total). And the refusal of Ajax's POST /api/offices/appoint-strategos in the server's log, if it is still there.
3. Who would qualify under the rule below today: every living player who holds a seat, is not a regent, holds no League seat, is not abroad, and has a sheet Militia above 40, with his name, class, party and Militia.

If the read shows the appointment failed for a reason other than the hoplite rule, STOP and report it.

## Rulings (Argiris, 14 Oct 2026)

1. Any man with a Militia above 40 (41 or more, as his sheet shows it, trait bonuses included) may be appointed Strategos, of any class, of either party or none. The hoplite rule goes. The number lives in content: politics-config's strategoi gains "militiaAbove": 40. The Militia is checked when he is appointed; a Strategos whose Militia later falls keeps his seat to the end of the term. was_hoplite stays in the schema; correct the comments that call it the Strategos gate.
2. The Strategoi are replaced with the elections. A Strategos serves to the end of the Archons' and Ephors' term in which he was appointed: when the newly elected officials take office, at the office season of the next election cycle (World 2: year 13, Spring 287 BC, 7 Nov 2026 00:00 UTC), both seats fall vacant and the new officials appoint. An appointment records that year as term_ends_year. The Strategoi sitting today (term_ends_year null) go at the same change, whenever they were appointed; no production write, the code derives it. It runs both in the worker's election sweep and in the server's sync, and is idempotent. A failure in it logs "strategoi: failed <message>" and never fails GET /me/state or stops the sweep advancing the elections. His office_history row ends with that year.

## Claude's calls (Argiris rules on them at STOP 1)

3. The list offers exactly the men the server accepts. One pure rule in packages/shared decides who may be appointed, used by the appointment and by the picker's list. For a Strategos: alive; holds an oligarch seat; not a regent; sheet Militia above militiaAbove; holds no League seat (Archon, Ephor or Strategos); not abroad on a mercenary contract; not of the same party as the other sitting Strategos. For an Ephor: alive; holds an oligarch seat; not a regent; of the side's party or none; holds no League seat. A party leader may be appointed to either, as he may stand for League office since 12 Oct, so the list stops leaving out party office holders.
4. Refusals: "A Strategos needs a Militia above 40." (built from militiaAbove; it replaces the hoplite line), "He already holds one of the city's offices.", "He is abroad on a mercenary contract." The other refusals stay as they are.
5. The list shows each man's Militia beside his party: "Militia 55".
6. A Strategos's death or the end of his term closes his own office_history row only.
7. The Guide (guideContent.tsx:114): "the Strategoi are appointed." becomes "the Strategoi are appointed by them, from any citizen with a seat and a Militia above 40, of either party or none, and serve until the term ends."

## The build

1. `server: who may be Strategos, a Militia above 40, one rule for the list and the appointment` (rulings 1, calls 3 and 4). Tests on the test database: a shipbuilder of no party with a seat and a sheet Militia of 41 is listed and appointed; at 40 he is neither, with the new refusal; a trait bonus that lifts him above 40 counts; a former hoplite at 30 is refused; a man of the other Strategos's party is neither; a sitting Archon, Ephor or Strategos is neither, with the new refusal; a man abroad on contract is neither, with the new refusal; a party leader is listed and appointed, as Strategos and as an Ephor of his side; the config test reads militiaAbove 40.
2. `server: the Strategoi are replaced with the elections` (ruling 2, call 6). Tests: appointed in season 30, term_ends_year 13; still seated at the last moment of season 52; vacant after the first sync and, separately, after the first sweep in season 53, his office_history row ended with 13; a Strategos with term_ends_year null goes at the same change; one appointed in season 52 by the outgoing officials goes at season 53; one appointed in season 53 stays to year 19; the death of one Strategos leaves the other's office_history row open; a throw inside the term's end leaves GET /me/state answering 200, with the log line.
3. `web: the appointment list and the Guide` (calls 5 and 7). Render tests: the list shows each man's party and Militia as the server sends them; the Guide line.

## Gate and STOP 1

Run DATABASE_URL=…/massalia_strategoi_test pnpm gate at HEAD after the last commit, then pnpm audit --audit-level=high. The gate must end GATE GREEN: HEAD <sha>, tree clean; the audit must exit 0. A red from a timeout in a suite this diff does not touch is a STOP with the log; never rerun to get a pass. Report:

```
Committed: <SHA> <subject>, one line per commit
Branch: <branch>, built on origin/main <SHA>
Gate: <the gate's last line>, suite counts; audit exit code
Production: reads 1 to 3
Model: the shared rule, where the term's end runs, and how a null term_ends_year is read
Words: every player-facing string added or changed, verbatim
Rulings for Argiris: <each with the reason, or "none">
```

## Push (only after I reply "push")

Not in the hour before the 00:00 UTC season rollover. git fetch; if origin/main moved after your gate, rebase onto it, show each commit's git patch-id unchanged (AGENTS.md:74), and run the gate again. Then git push origin HEAD:main, a fast-forward, never forced. If CI goes red before Checkout on a registry pull, rerun it once; if Railway then leaves the commit SKIPPED, deploy it as AGENTS.md says (environmentTriggersDeploy, the server first, then the worker). Any other red is a STOP with the log. Report: remote HEAD; the CI run with its Gate and Audit steps, and the Pages run; Railway server and worker on the new SHA, no migration; API health; the first GET /me/state after the deploy answering 200 with no "strategoi: failed" in the log; and, read only, every offices row, unchanged by the deploy. Then drop massalia_strategoi_test, remove your worktree and delete the merged branch. Anything off is a STOP: report it and wait. Do not write to production to fix it.

## Scope fence

Only the files the build names and their tests. No change to the Archon and Ephor elections or their vote, the party offices, the mercenary contracts, the League's orders, army or treasury, or the chamber. No migration.
