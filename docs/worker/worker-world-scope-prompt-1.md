Worker world scope, prompt 1: the Olympiad, two sweeps and three jobs stay in the active world
What this builds
Since the flip on 15 Sept 2026 the worker still works World 1. `deliverOlympicNominationToAll` deals the nominate card to every living character in any world, `sweepSpouseDeaths` and `sweepMercenaryContracts` walk every alive character in any world, and the `family-candidate-draw`, `family-child-roll` and `censure-resolve` jobs are keyed by character id and re-arm themselves forever, so World 1's characters keep drawing brides and rolling children on World 2's calendar. The festival sweep was scoped on 17 Sept (migration 0060). This prompt does the rest, with no migration.
Reading the Olympiad for it found a second leak. Every read of `olympic_candidates` and `olympic_votes` keys on `olympiad_game_year` alone, and game years restart at 0 with every world. World 2's first Olympiad, game year 0, is in its voting phase now and closes about 2026-09-22 00:00 UTC. If World 1 had an Olympiad at year 0, World 2's ballot lists World 1's candidates, its voters can vote for them, and the tally on 22 Sept counts World 1's votes and can crown a World 1 character. World 2's next Olympiad is year 8 (13 Oct 2026) and World 1 had one at year 8. So the Olympiad becomes per world here, like the festivals.
Four commits, no migration, no client change:

1. A shared active-world helper in `packages/db`, plus the prompt copy and a parked docs ruling.
2. Olympiad per world: the nominate cards, the ballot, the vote check, the tally, the delegates and the nomination close.
3. The spouse-death and merc-contract sweeps walk the active world only.
4. The worker drops a character job whose character is not in the active world and does not re-arm it.

Rulings (Argiris, 20 Sept 2026):

* No migration. `olympic_candidates` and `olympic_votes` already carry `world_id` (`packages/db/src/schema.ts` 508, 519). Their unique indexes on `(olympiad_game_year, character_id)` and `(olympiad_game_year, voter_character_id)` stay: a character id belongs to one world, so they cannot collide across worlds.
* World 1 rows the worker changed since the flip stay as they are: marriages ended by the sweep, contracts completed, candidates drawn, nominate cards dealt. Nothing is repaired or deleted. World 1 is history.
* No Redis surgery. The World 1 character jobs drain by themselves: each fires once more after the deploy, is dropped, and never re-arms. No job scheduler is removed, no job is deleted by hand.
* A vote a World 2 voter cast for a World 1 candidate, possible only while the ballot was polluted, counts for nothing after the fix (`tallyBallot`, `packages/shared/src/olympiad.ts` 88-91, counts votes for listed candidates only) and the voter does not vote again (a vote is final). If Phase 0 finds any such vote, STOP 0. The ruling comes from Argiris.
* The six private `activeWorld()` copies (`agenda.ts` 53, `chamber.ts` 34, `elections.ts` 57, `leagueDrift.ts` 8, `festival.ts` 23, `olympiad.ts` 39) stay. The new helper is used by the code this prompt touches. The dedup is not this prompt's job.
* The per-character functions the server also calls lazily on read (`deliverOlympicNominationForCharacterId`, `checkSpouseDeath`, `settleMercContract`, `drawFamilyCandidates`, `rollChildrenDue`, `resolveCensureIfExpired`) keep their names, signatures and behaviour. On the server they are only reached for the request's own character, which is in the active world. The guards go on the callers that select across characters (the sweeps) and on the worker.

Dates
World 2 `e873ced5-5435-4b64-a792-0421f72a91df` started `2026-09-15T00:00:00Z`; World 1 `04e99001-d2d2-4acb-ba43-1909233a6772` ended at the flip, 2026-09-15 about 20:08 UTC. The Olympiad (`content/calendar/calendar-config.json`) fires in Summer (season 3) of every eighth year from year 0: nomination 2 real days, voting 3, the Games one period after the tally. Summer 300 BC opened 2026-09-17 00:00 UTC, so World 2's year-0 cycle closed nomination about 2026-09-19 00:00 UTC and closes voting about 2026-09-22 00:00 UTC, at the first hourly olympiad-sweep tick past it. A fix live before that tick tallies clean. Year 8 opens 2026-10-13. If Phase 0 runs after 22 Sept 00:00 UTC, report the tally as found; nothing here undoes it.
Phase 0: recon (no code)
Confirm each reference at HEAD (expected `ce26944`). If any is not as described, STOP 0 with the mismatch before writing anything.

* `packages/db/src/client.ts` 14-25 and 60-65: one pool per URL, cached. No change here.
* `packages/db/src/index.ts`: `export *` from `censures`, `family`, `festival`, `olympiad`, `merc` among others; no `world.ts` exists in `packages/db/src`.
* `packages/db/src/festival.ts`: `activeWorld` 23-27, `charactersOf` 33, the per-character guard in `deliver` 50-53, the scoped select in `fireFestivalsForAll` 67-71. This is the model.
* `packages/db/src/olympiad.ts`: `activeWorld` 39; `getOlympiadByYear` 52 and `ensureOlympiad` 65 already scoped by `olympiads.worldId`; `deliverOlympicNominationToAll` 111 with its living select 117-121 carrying no world; `getOlympiadBallot` 164, where at 179; `castOlympiadVote` 198, world resolved at 199, candidate check 211, prior-vote check 221; `getVoterChoice` 235, where 239; `olympiadDelegates` 246, where 251; `advanceOlympiads` 275, cycles scoped 281-284, the `festival_events` expire update 294-298 keyed on festival and year only; `resolveBallot` 330, candidates 335, votes 339; `deliverGames` 351 goes through `olympiadDelegates`.
* `apps/server/src/services/olympiad.ts` 247-251: the `youAreCandidate` select keyed on year and character; 255 calls `getOlympiadBallot`.
* `packages/db/src/family.ts`: `sweepSpouseDeaths` 347-360, its select 349-353 on `status = 'alive'` with no world; `checkSpouseDeath` 315.
* `packages/db/src/merc.ts`: `sweepMercenaryContracts` 194-211, its select 196-199 on alive plus `contractId not null` with no world; `worldStartedMs(tx, row.worldId)` 144 and 179 reads the character's own world and is fine.
* `packages/db/src/censures.ts`: `resolveCensureIfExpired` 19.
* `apps/worker/src/index.ts`: the `@massalia/db` import at 7; `spouse-death-sweep` 122-130, `merc-contract-sweep` 131-140, `olympiad-sweep` 164-173; `processJob` 248-296 with `censure-resolve` 254-258, `family-candidate-draw` 259-271 (re-arm 265-269, `jobId family-draw:<id>`), `family-child-roll` 272-283 (re-arm 277-281).
* `apps/server/src/services/queue.ts` 31, 45, 59: the producers of the three jobs; callers `services/family.ts` 57 and `services/politics.ts` 11. Unchanged.
* `packages/db/src/festival.test.ts` 30-58: the two-world fixture (`character()` 35-39, worlds 53-54, the TRUNCATE at 51). `packages/db/src/schema.ts`: `olympiads` 492, `olympicCandidates` 506, `olympicVotes` 517, `festivalEvents` 451 (unique 461 on character, festival, year), `marriages` 397, `censures` 752.
* `scripts/gate.sh` 29-36 runs the suites one package at a time.
* No test at HEAD calls `deliverOlympicNominationToAll`, `sweepSpouseDeaths` or `sweepMercenaryContracts`. `packages/shared/src/ballot.test.ts` covers `tallyBallot` only.

Production reads, through `railway run --service Postgres --environment production` with `DATABASE_PUBLIC_URL`, selects only:

1. `select id, name, status, started_at, ends_at from worlds order by started_at;`
Expected: World 1 ended at the flip, World 2 active from 2026-09-15 00:00 UTC to 2027-03-16, no third row.
2. `select world_id, game_year, phase, nomination_ends_at, voting_ends_at, payoff_at from olympiads order by world_id, game_year;`
Expected: World 2 exactly one row, game year 0, phase `voting`, `voting_ends_at` on 2026-09-22 shortly after 00:00 UTC. World 1: report every row and its year.
3. `select world_id, olympiad_game_year, count(*) from olympic_candidates group by 1, 2 order by 1, 2;`
4. `select world_id, olympiad_game_year, count(*) from olympic_votes group by 1, 2 order by 1, 2;`
Reads 3 and 4 answer the question: a World 1 row at year 0 is on World 2's live ballot today. Report as found.
5. `select count(*) from olympic_votes v join player_characters voter on voter.id = v.voter_character_id join player_characters cand on cand.id = v.candidate_character_id where voter.world_id <> cand.world_id;`
Expected: 0.
6. `select count(*) from olympic_candidates c join player_characters pc on pc.id = c.character_id where pc.world_id <> c.world_id;`
Expected: 0.
7. For the record, what the worker did to World 1 since the flip:
`select count(*) from festival_events fe join player_characters pc on pc.id = fe.character_id where pc.world_id = '04e99001-d2d2-4acb-ba43-1909233a6772' and fe.created_at > '2026-09-15T20:08:00Z';`
`select count(*) from marriages m join player_characters pc on pc.id = m.character_id where pc.world_id = '04e99001-d2d2-4acb-ba43-1909233a6772' and m.ended_at > '2026-09-15T20:08:00Z';`
`select count(*) from player_characters where world_id = '04e99001-d2d2-4acb-ba43-1909233a6772' and contract_id is not null;`

STOP 0 only if a reference mismatches, read 3 or 4 shows a World 1 row at year 0, or read 5 is not 0. Otherwise proceed to Phase 1 and put the reads in the STOP 1 report.
Phase 1: the helper, the prompt copy and the parked docs ruling
`packages/db/src/world.ts`, exported from `index.ts`:

* `activeWorld(): Promise<{ id: string; startedMs: number } | null>`, the same select the six private copies make (`worlds.status = 'active'`, `limit(1)`).
* `characterInActiveWorld(characterId: string): Promise<boolean>`: true when the character row exists and its `worldId` is the active world's id; false for an unknown id or no active world.

Test `packages/db/src/world.test.ts`, DB-gated, fixture as `festival.test.ts` 30-58 (two worlds, one character each, the TRUNCATE with CASCADE): true for the live world's character, false for the ended world's, false for a random uuid.
Save this prompt at `docs/worker/worker-world-scope-prompt-1.md`. Append to the end of `docs/buildings/buildings-prompt-1.md`, under a heading `## STOP 1 ruling (18 Sept 2026)`, verbatim:
STOP 1 ruling (Argiris, 18 Sept 2026): the five commits stand (4771f38, f3bc6b1, 83b7249, 916f076, b659f1a). Deviations 1 and 2 are accepted as rulings: a `:has()` row-width rule so the bar spans the row, and the Ledger test's clock regex admitting `01:00:00` since `remainingSeconds` rounds up. Deviation 3, the pre-existing Economy-sheet refetch loop on a device clock ahead of the server, was fixed before the push by a sixth commit anchoring the sheet's completion refetch to the payload's `now` (ce26944 `sheets: the completion refetch counts on the server clock`). All six pushed and live 18 Sept 2026, CI run 35346702571 green, no migration.
Check the five SHAs and the sixth against `git log` before saving; a mismatch is a STOP, not a correction.
Commit: `db: an active-world helper; docs: the prompt copy and the buildings STOP 1 ruling`.
Phase 2: Olympiad per world
In `packages/db/src/olympiad.ts`, every read of `olympic_candidates` and `olympic_votes` carries the active world's id, and the two writes that touch other tables by year are fenced to the world's characters:

* `deliverOlympicNominationToAll` 117-121: add `eq(playerCharacters.worldId, world.id)`; resolve the world once at the top and return 0 without one (`ensureOlympiad` already needs it).
* `getOlympiadBallot` 179, `olympiadDelegates` 251, `resolveBallot` 335 and 339: `and(eq(<table>.worldId, world.id), eq(<table>.olympiadGameYear, gameYear))`; each resolves `activeWorld()` and returns empty without one. `resolveBallot` takes the world id from `advanceOlympiads`, which already holds it, rather than resolving again.
* `castOlympiadVote` 211 and 221, `getVoterChoice` 239: add the world id to the where (the world is already in hand at 199; `getVoterChoice` resolves it).
* `advanceOlympiads` 294-298: the expire update is restricted to the world's characters with `inArray(festivalEvents.characterId, charactersOf(world.id))`, a local `charactersOf` as `festival.ts` 33.
* `apps/server/src/services/olympiad.ts` 247-251: the same world filter on the `youAreCandidate` select (the cycle row at hand carries `worldId`).

`nominateForOlympiad` 140-147 and the vote insert 230 already write `worldId`. No other file changes.
Test `packages/db/src/olympiad-world.test.ts`, DB-gated, fixture as above (TRUNCATE adds `olympiads, olympic_candidates, olympic_votes`), `T0` and the calendar config as `festival.test.ts`, Summer of year 0 at `T0 + 2 * DAY + HOUR`:

* (a) the sweep deals the nominate card to the live world's living characters only: one alive character per world, `deliverOlympicNominationToAll(cfg, summerY0)` returns 1, the ended world's character has no `festival_events` row.
* (b) the ballot is the live world's: an `olympiads` row per world at year 0 in `voting`, a candidate per world at year 0, `getOlympiadBallot(0)` returns one entry, the live one.
* (c) a vote for the ended world's candidate is `unknown_candidate`; a vote for the live one is `ok`.
* (d) the tally crowns inside the world: one vote per world for its own candidate, the ended world's candidate with the higher prestige; `advanceOlympiads(cfg, votingEndsAt + HOUR)` crowns the live candidate only, the ended world's candidate holds no delegate trait, `olympiadDelegates(0)` returns the live one only.
* (e) the nomination close expires only the live world's cards: an unresolved nominate card per world at year 0, the live cycle in `nomination` with `nominationEndsAt` in the past; after `advanceOlympiads` the ended world's card is still unresolved.

Commit: `olympiad: the nominate cards, the ballot, the tally and the delegates stay in the active world`.
Phase 3: the two sweeps

* `sweepSpouseDeaths` (`family.ts` 349-353): resolve `activeWorld()`, return `[]` without one, add `eq(playerCharacters.worldId, world.id)` to the where.
* `sweepMercenaryContracts` (`merc.ts` 196-199): the same, returning `{ checked: 0, completed: 0, died: 0, awarded: 0 }` without an active world.

`checkSpouseDeath` and `settleMercContract` are untouched.
Test `packages/db/src/sweeps-world.test.ts`, DB-gated, same fixture:

* (a) a married character per world, each with an open `marriages` row whose `spouseDeathAge` the wife has passed (seat them as `apps/server/src/services/family-spouse.test.ts` does, with rows inserted through the schema); `sweepSpouseDeaths` returns one death, the live one; the ended world's marriage has no `endedAt` and the character keeps `spouseCandidateId`.
* (b) a character per world with `contractId` set and `contractStartedAt` far enough back that the term is served (one contract from `content/military/contracts.json`, cfg map built as `apps/worker/src/index.ts` 51-54); `sweepMercenaryContracts` reports `checked: 1`, completes the live one, and the ended world's character still holds its `contractId`.

Commit: `sweeps: spouse deaths and mercenary contracts walk the active world only`.
Phase 4: the worker
In `apps/worker/src/index.ts`, import `characterInActiveWorld` at 7. In `processJob`, before the work of `censure-resolve` (254), `family-candidate-draw` (259) and `family-child-roll` (272):

```
if (!(await characterInActiveWorld(characterId))) {
  console.log(`${job.name} for ${characterId}: character not in the active world, dropped (not re-armed)`);
  return;
}
```

The return skips the re-arm, so a World 1 job ends on its next firing. Nothing else in the file changes: no cadence, no scheduler, no sweep wording. No worker test; the helper carries the test and the three guards are the same three lines.
Commit: `worker: a character job outside the active world is dropped, not re-armed`.
Gate and STOP 1
`DATABASE_URL=…/massalia_test pnpm gate` at HEAD after the last commit, ending `GATE GREEN: HEAD <sha>, tree clean`; a run where the DB-gated suites skip is not green. The db suites share one database: TRUNCATE lists carry every table the test writes, with CASCADE, and fixtures read seeded rows back instead of pinning names. No push. Report:

```
Phase 0: <each read against its expected value; reads 3 and 4 in full>
Committed: <SHA> db: an active-world helper; docs: the prompt copy and the buildings STOP 1 ruling
Committed: <SHA> olympiad: the nominate cards, the ballot, the tally and the delegates stay in the active world
Committed: <SHA> sweeps: spouse deaths and mercenary contracts walk the active world only
Committed: <SHA> worker: a character job outside the active world is dropped, not re-armed
Gate: <the gate output, per package, DB-gated suites confirmed run>
Deviations: <each as a ruling for Argiris, or "none">
Post-deploy check: the worker log's first olympiad-sweep tick reads "delivered 0"; within a day the log shows "family-candidate-draw for <id>: character not in the active world, dropped" lines and then none; after 2026-09-22 00:00 UTC the delegate trait's new holders are World 2 characters only; read 5 stays at its Phase 0 value.
```

Scope fence
Do not touch: `packages/db/src/client.ts`, `festival.ts`, `chamber.ts`, `agenda.ts`, `elections.ts`, `leagueDrift.ts`, `worldLaunch.ts`, the six private `activeWorld()` copies, the signatures or bodies of `checkSpouseDeath`, `settleMercContract`, `drawFamilyCandidates`, `rollChildrenDue`, `resolveCensureIfExpired` and `deliverOlympicNominationForCharacterId`, `apps/server/src/services/queue.ts`, any route, any sweep cadence or scheduler, the Redis queue's contents, any content file, `apps/web`, `AGENTS.md`. No migration. No production write of any kind. No refactors along the way.

## STOP 0 ruling (20 Sept 2026)

STOP 0 ruling (Argiris, 20 Sept 2026). Save this ruling verbatim under a heading `## STOP 0 ruling (20 Sept 2026)` at the end of `docs/worker/worker-world-scope-prompt-1.md` when Phase 1 saves the prompt.

1. The cross-world vote. The standing ruling stands. Maximus Livius Fadus's vote for Fatty counts for nothing once the fix is live and he does not vote again. No production write, now or after the deploy. Nothing in the prompt changes for it.
2. `apps/server/src/services/merc.test.ts:157`. The prompt's recon line was wrong; the test exists and stays untouched. Its fixture seats one active world, so Phase 3 should leave it green. If it goes red under Phase 3, STOP with the failure. Do not edit it.
3. World 1's year-24 Olympiad stays in `nomination` forever. No action. Its three candidates are World 1 characters and Phase 2 keeps them off every World 2 read.
4. The 104 cards dealt to World 1 characters since the flip stay, under the standing ruling.
5. Post-deploy check, replacing the delegate line in the report: after the first olympiad-sweep tick past 2026-09-22 00:25 UTC, every holder of the delegate trait granted that day is a World 2 character and Fatty holds none. The winners themselves are not predicted, since World 2 players can still vote until the tick.

Proceed from Phase 1. The push prompt follows the STOP 1 report; the deploy must be live before 2026-09-22 00:25 UTC.
END OF RULING
