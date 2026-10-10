# Raids 6: the plunder per kill rolls in a range, and pays less

Save this prompt as docs/barracks/raids-prompt-6.md in the first commit. Read AGENTS.md first. Repo HEAD when this was drafted: c3378ee. No migration. One concern per commit, staged by path. Recon first and STOP only if something below does not match the code; otherwise build straight through to STOP 1. Before each commit, run the suites its files touch and read the exit code. Commits stay local; no push until I say push.

## What it is

A won raid pays per enemy killed: today 50 drachmae, 5 grain and 5 of a third good a kill, doubled at a town. On 10 October two players with hired bands raided Reii fourteen times in a day for 4,900 drachmae and 490 grain, more than half a year of a building's income. From now on each of the three rates is rolled once per raid inside a range, and the ranges are lower:

```json
"plunderPerKill": { "min": 20, "max": 30 },
"grainPerKill": { "min": 1, "max": 3 },
"spoilPerKill": { "min": 1, "max": 3 }
```

## Rulings (11 Oct 2026)

1. One roll per raid per rate, not per kill. A raid pays `kills × rate × townMultiplier`, where `rate` is a whole number drawn once for that raid between `min` and `max` inclusive. So a five-kill raid at a town pays 10, 20 or 30 grain, never 17.
2. The roll is on the battle's own seed through `seededRoll`, as the third good already is, with its own seed part per rate: `[seed, "plunder"]`, `[seed, "grain"]` and `[seed, "spoilRate"]`. Not `"spoil"`: that part already picks the third good, and sharing it would tie the amount to the good (olive oil would always come in the smallest amount). The same battle always pays the same.
3. A plain number stays valid and means a fixed rate, so `"plunderPerKill": 50` keeps today's behaviour exactly. The schema accepts a non-negative number, or `{ min, max }` with both whole numbers and `0 ≤ min ≤ max`.
4. The town multiplier applies after the roll, on all three, as today. The third good is still drawn once per raid from `spoilGoods`.
5. The koinon muster pays through the same function and gets the same roll; its split by shares is untouched.
6. The three numbers are the only balance change. `townPlunderMultiplier`, the turnout, the opinion roll and the march clock do not move.

## Phase 0: recon (read only)

Confirm at c3378ee or a fast-forward of it (say which); any mismatch is a STOP 0.

- `packages/shared/src/barracks.ts`: the raid block of `BattleContent` at 67-76 with its comment at 60-66 (`plunderPerKill`, `grainPerKill`, `spoilPerKill` typed `number` at 70-72), its zod at 285-287 (`z.number().nonnegative()`), `seededRoll` at 409, `raidTurnout` using `[seed, "turnout"]` (431), `raidAngers` using `[seed, "opinion"]` (443), `RaidPlunder` and `raidPlunder(raid, kills, isTown, seed)` at 446-455 using `[seed, "spoil"]` for the good (449). No other code in apps/ or packages/ reads the three fields outside the tests below.
- Callers: `apps/server/src/services/mapActions.ts:663` and `apps/server/src/services/koinonMuster.ts:1063`, both passing the battle's seed.
- Tests that pin the rates: `packages/shared/src/battle.test.ts:26` (the raid block of battle.json) and its `raidPlunder` test at 101-117 (500 / 50 / 50 for ten kills); `apps/server/src/services/koinonMuster.test.ts:718` and `:952` (`killed × rate (× mult)` from the content); `apps/server/src/services/mapActions.test.ts` at 375-378, 390, 413-414 and 913-915 (50 and 5 written out, in the plunder, the wallet, the stocks and the report line). `apps/server/src/routes/map.test.ts:152` only asks for drachmae above 0.
- `content/military/battle.json:9`, the raid block, with the three plain numbers.
- Nothing in `apps/web/src`, `content/` or the guides states the per-kill numbers (the reports carry amounts, not rates).

## Commit 1: `shared: the plunder per kill may roll in a range`

1. Save this prompt as docs/barracks/raids-prompt-6.md.
2. `barracks.ts`:
   - `RateOrRange = number | { min: number; max: number }` for the three fields, in the type and the zod: a non-negative number, or an object `.strict()` (so a misspelt key fails the boot) of two non-negative whole numbers with `min ≤ max`.
   - Pure `rateBounds(rate)`: `{ min: rate, max: rate }` for a number, the range as it is otherwise.
   - Pure `rollRate(rate, seedParts)`: a plain number as it is; otherwise `min + floor(seededRoll(seedParts) × (max − min + 1))`.
   - `raidPlunder` draws the three rates with the seed parts of ruling 2, then pays as today (`Math.round(kills × rate × mult)`). Update the comment at 60-66 to say the rates are rolled once per raid.
3. `koinonMuster.test.ts:718` and `:952`: the new type no longer multiplies, so these two expectations change in this commit. Assert instead that each of the plunder's three amounts is `killed × mult × r` for a whole `r` within `rateBounds` of its content rate (mult 1 on land, the town multiplier at a town), and keep the assertions that the parts add up to the totals. With today's plain numbers this pins the same totals as before.
4. `battle.test.ts`: the existing `raidPlunder` test still passes unchanged, since the shipped content is still plain numbers in this commit. Add a range test on a hand-built raid block (plunder 20..30, grain 1..3, spoil 1..3): over 400 seeds every value from min to max is drawn for each rate; every good is drawn with every spoil rate (the two are not tied); the same seed always gives the same plunder; a five-kill town raid pays exactly 10, 20 or 30 grain; `{ min: 2, max: 2 }` pays as the plain `2`; rateBounds of a number and of a range; the zod refuses `min > max`, a fraction and a stray key.
5. Suites: `pnpm --filter @massalia/shared test`, then the server's `mapActions.test.ts` and `koinonMuster.test.ts`. Exit codes read directly.

## Commit 2: `content: a raid pays 20 to 30 drachmae and 1 to 3 grain and goods a kill`

1. `content/military/battle.json`: the three ranges from the top, nothing else on the line.
2. `battle.test.ts:26`: the pinned raid block carries the three ranges. The `raidPlunder` test at 101: keep its shape, but build its expectations from the rolled rates: for ten kills on seed "s", drachmae is `10 × r` for a whole `r` in 20..30, grain `10 × g` with `g` in 1..3, spoil `10 × s` with `s` in 1..3; the town case is exactly double each; zero kills pays zero; the same seed repeats; the four goods are still each drawn at least 80 times in 400 seeds.
3. `mapActions.test.ts`, the region raid (375-378, 390, 413-414) and the town raid on Reii (913-915): assert each amount of the report's plunder as in commit 1 (a whole rate within its bounds, times the kills, times 2 at the town), and build the wallet, the stock and the report line's expectations from the report's own amounts in place of `killed × 50` and `killed × 5`.
4. Suites as in commit 1.

## Gate and STOP 1

Run `DATABASE_URL=…/massalia_test pnpm gate` at HEAD after commit 2, then `pnpm audit --audit-level=high`. The gate must end `GATE GREEN: HEAD <sha>, tree clean`; the audit must exit 0. A red from a timeout in a suite this diff does not touch is a STOP with the log; never rerun to get a pass. Commit only on a read exit code.

STOP 1. Report:

```
Committed: <SHA> shared: the plunder per kill may roll in a range
Committed: <SHA> content: a raid pays 20 to 30 drachmae and 1 to 3 grain and goods a kill
Gate: <the gate's last line>, suite counts; audit exit code
Rates: the three ranges as battle.json now has them
Roll: the three seed parts, and the five-kill town example's three possible grain amounts
Deviations, as questions for a ruling: <each with the reason, or "none">
```

## Push (only after I reply "push")

Not in the hour before the 00:00 UTC season rollover. Fast-forward only, plain `git push`. If CI goes red before Checkout on a registry pull, rerun it once; if Railway then leaves the commit SKIPPED, deploy it as AGENTS.md says (environmentTriggersDeploy, the server first, then the worker). Any other red is a STOP with the log. Report:
- remote HEAD
- the CI run with its Gate and Audit steps, and the Pages run
- Railway server and worker on the new SHA; no migration applied
- API health
- read only, after the first won raid resolved after the deploy: the newest `player_marches` row with `kind = 'raid'`, `resolved_at` after the deploy and `report->>'winner' = 'attacker'`, its kills and `report->'plunder'`, and whether each amount is a whole rate within its range times the kills (times 2 at a town)

Anything off is a STOP: report it and wait. Do not write to production to fix it.

## Scope fence

Only `barracks.ts` (the three fields, `rateBounds`, `rollRate`, `raidPlunder` and its comment), `battle.json`'s three numbers, and the three test files named (`battle.test.ts`, `koinonMuster.test.ts`, `mapActions.test.ts`). Do not touch the turnout, the opinion roll, the town multiplier, the march, the two callers, the Chronicle or muster lines, the client or any stylesheet. No migration. No other balance number.

## STOP 1 ruling (Argiris, 11 Oct 2026)

- Deviation 1: keep the two suite helpers.
- Deviation 2: keep the refusal of a negative plain number.
- Deviation 3: accepted as written.
- The two commits left on no branch (8b44b4a, c4b7ef8) are known and wanted gone; leave them.

Append this ruling to docs/barracks/raids-prompt-6.md as its own commit, run the gate at that HEAD and read its last line, then push at or after 00:15 UTC, following the Push section of the prompt. Report as it says.
