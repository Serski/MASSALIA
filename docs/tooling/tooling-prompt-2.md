# MASSALIA: Tooling, prompt 2: the gate stops overloading the Mac

Read `AGENTS.md` first. Pull `main` (baseline `a51a1fd`). Commit locally. Push only as Phase 3 says.

## What this prompt does

The local gate has gone red three times in two days on timeouts alone, never on an assertion. On 4 Oct a run that started at a 1-minute load of 14.78 ended at 325.75, and the reds were in the web suite. The server and db suites already run one file at a time (`fileParallelism: false` in their configs). The web suite does not: vitest 3.2.6 starts a worker per core by default, and every web test file boots jsdom and React. This prompt caps the web suite at two workers, measures before and after on a quiet machine, and fixes the one AGENTS.md line that still describes the old setup.

No game code changes. No timeout changes.

Save this prompt as `docs/tooling/tooling-prompt-2.md` in the first commit.

## Facts from the repo (Phase 0 confirms; stop only on contradiction)

- `scripts/gate.sh` runs build, lint, migrate, then the five suites one package at a time (shared, server, db, web, worker) and stops at the first failure.
- `apps/server/vitest.config.ts` and `packages/db/vitest.config.ts` set `fileParallelism: false` with 30 s test and hook timeouts.
- `apps/web/vite.config.ts` has a `test` block with `testTimeout: 15_000` and `hookTimeout: 30_000`, and no pool or worker setting.
- `packages/shared` and `apps/worker` have no vitest config file.
- vitest is 3.2.6 (`pnpm-lock.yaml`).
- `AGENTS.md`, section "Web client": "Render tests stay cheap: the web suite runs at vitest's 5 s default with files in parallel." The 5 s is out of date (15 s since 21 Sept).

## How to measure

Every measurement uses the same sampler, run in a second shell for the length of the step and never committed:

```bash
while sleep 10; do echo "$(date +%T) $(sysctl -n vm.loadavg)"; done > /tmp/load-<label>.log
```

Start a measured run only when the 1-minute load is below 20. Report the starting figure, the peak 1-minute figure and the duration.

## Phase 0: measure as it is

1. Report `sysctl -n hw.ncpu` and `sysctl -n hw.perflevel0.physicalcpu`.
2. Report how many workers vitest 3.2.6 starts for the web suite by default: watch the process list during a run and count the vitest worker processes.
3. Run `pnpm --filter @massalia/web test` alone, sampled. Report the duration, the peak load and the result.
4. Run `pnpm --filter @massalia/shared test` alone, sampled. Report the same.

No STOP here unless a fact above is wrong.

## Phase 1: the cap

1. **Docs.** This prompt verbatim at `docs/tooling/tooling-prompt-2.md`. Commit `docs: tooling prompt 2`.
2. **Web.** In the `test` block of `apps/web/vite.config.ts`, add `maxWorkers: 2` with a comment giving the reason: the render tests boot jsdom per file, and a worker per core overloaded a laptop during the gate. If vitest 3.2.6 does not honour `maxWorkers` for its default pool, use the setting it does honour (for the forks pool, `poolOptions.forks.maxForks: 2`) and say which in the report. Confirm the cap by counting worker processes during a run. Commit `test: the web suite runs at most two files at a time`.
3. **Shared, only if Phase 0 showed it peaking above 40.** Create `packages/shared/vitest.config.ts` with the same cap and nothing else. Commit `test: the shared suite runs at most two files at a time`. If it peaked at 40 or below, leave shared alone and say so.
4. **AGENTS.md.** Replace the "Render tests stay cheap" sentence with one that is true now: the web suite runs at a 15 s test budget, two files at a time. Keep the rest of that bullet (plain DOM selectors, waiting on real state). Commit `docs: AGENTS.md says how the web suite runs`.

Measure again: the web suite alone (and shared alone if you capped it), sampled, the same way as Phase 0.

## Phase 2: the gate, measured

Run the full `pnpm gate` at HEAD once, sampled from start to end, starting below 20. Report the starting figure, the peak, the total duration, the duration of each suite step (from the gate's step lines and the sampler's timestamps), and the gate's last line.

## Phase 3: push or stop

- **GATE GREEN at HEAD, tree clean:** push, plain fast-forward `git push`. Report remote HEAD and the CI run with its Gate step and suite counts. No migration, so Railway and Pages only need a SUCCESS line each.
- **Red on timeouts only:** STOP with the log and the sampler file. No rerun, no timeout change.
- **Red on anything else:** STOP with the log.

## Scope fence

Touch only:

- `docs/tooling/tooling-prompt-2.md`;
- `apps/web/vite.config.ts` (the `test` block only);
- `packages/shared/vitest.config.ts` (new, and only under Phase 1 step 3);
- `AGENTS.md` (the one sentence).

No source, test file, timeout, CI workflow or `scripts/gate.sh` change.

## Final report

```
TOOLING 2
cores: hw.ncpu / performance cores
default web workers: N
                       before (start / peak / duration)    after
web alone:             … / … / …                           … / … / …
shared alone:          … / … / …                           … (or "not capped")
gate:                  (not measured before)                … / … / …, per step: …
setting used: maxWorkers or poolOptions.forks.maxForks
RULINGS FOR ARGIRIS: any departure, with the reason
Committed: <SHA> <subject>, one line per commit, in order
GATE: the gate's last line at HEAD
CI: run id, Gate step result, suite counts
```
