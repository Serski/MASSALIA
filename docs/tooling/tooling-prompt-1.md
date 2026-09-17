# Tooling, prompt 1: hooks lint, one gate script, the agent guide

## What this builds

Four tooling changes. No source change, no test change, no migration.

1. `react-hooks/rules-of-hooks` becomes a lint error in `apps/web`. The 10 Sept 2026 Atlas blackout (React #310, a countdown hook after an early return in `World2Map.tsx`) is exactly what this rule fails at lint time.
2. One gate command, `pnpm gate` (`scripts/gate.sh`): build, lint, migrate the test database, then the suites one package at a time. Root `pnpm test` is pinned to one package at a time as well.
3. CI runs that same script, so green locally and green in CI mean the same thing.
4. `AGENTS.md` gains the standing working rules, `CLAUDE.md` imports it so Claude Code loads it at the start of every session, and `.claude/` is ignored.

Rulings (Argiris, 17 Sept 2026, by handing this prompt over):

- Only `rules-of-hooks` is enabled, as an error, for `apps/web` only. `exhaustive-deps` stays off: fixing dependency arrays changes behaviour and is not tooling. The plugin is `eslint-plugin-react-hooks@^5.2.0`, the line with no dependencies of its own, so `pnpm audit` gains no surface.
- The gate refuses to run unless `DATABASE_URL` contains `_test`, the same check the DB-gated suites use (`describe.runIf(dbUrl.includes("_test"))`). A run with skipped suites can no longer look green.
- The gate runs `pnpm -r build` (a superset of CI's three `tsc --noEmit` steps, since it also runs the Vite build), `pnpm -r lint`, `pnpm db:migrate`, then the five suites in CI's present order: shared, server, db, web, worker. Audit stays a CI-only step after the gate.
- CI stays on `postgres:16`. The runner's `pg_dump` is 16 and refuses a newer server, and the worker's backup test runs it against the service container.
- The CI workflow keeps its name `CI` and its job id `ci`: `pages.yml` triggers on the workflow name and Railway waits on the check.
- The new `AGENTS.md` is delivered with this prompt as a separate file and goes in unchanged.

## Facts from the repo (at bbdb76e; Phase 0 confirms, stop only on contradiction)

- `eslint.config.js` at the root is the only ESLint config (flat config, `tseslint.config(...)`, one rules block). Every package lints with `eslint src` from its own folder and resolves to that root file, so a `files` glob is relative to the repo root.
- Probed at bbdb76e with `eslint-plugin-react-hooks@5.2.0` on ESLint 9 and the exact block in Phase 1: `react-hooks/rules-of-hooks` passes clean over `apps/web/src`, and a throwaway component with a `useState` after an early return fails with exit 1.
- Root `package.json` has `"test": "pnpm -r test"`. pnpm's default workspace concurrency is above 1 on a multi-core machine, so the server, web and worker suites overlap on one `massalia_test` while the server suite truncates it. `--workspace-concurrency=1` serialises them (checked on pnpm 10.11.0).
- `apps/server/vitest.config.ts` and `packages/db/vitest.config.ts` already set `fileParallelism: false`. The overlap is between packages, never within one.
- `.github/workflows/ci.yml`: one job `ci`, service `postgres:16`, env `DATABASE_URL=postgres://postgres:postgres@localhost:5432/massalia_test`. Steps: Checkout, Setup pnpm (10.11.0), Setup Node (22), Install dependencies, Build shared package, Build db package, Typecheck server, Typecheck web, Typecheck worker, Lint, Test shared, Create test database, Migrate test database, Test server, Test db, Test web, Test worker, Audit.
- `apps/web/src/api.ts` lines 1-5 throw on a missing `VITE_API_URL` only when the built bundle is evaluated in a browser (`import.meta.env.PROD`), never during `vite build`, so the build needs no env in CI.
- `apps/worker/src/jobs/backup.test.ts` lines ~101-102: the integration block runs when `pg_dump --version` succeeds and the URL contains `_test`. `apps/worker/Dockerfile` states the client-version rule.
- `CLAUDE.md` is three lines with a markdown link to `AGENTS.md`. Claude Code reads `CLAUDE.md`, not `AGENTS.md`, and a link is not an import; `@AGENTS.md` on its own line is. Block-level HTML comments in `CLAUDE.md` are stripped before it is loaded. Source: https://code.claude.com/docs/en/memory
- `AGENTS.md` line 72 says `apps/web/src/map/ProvinceMap.tsx` and `apps/web/public/map/*` still exist. Neither is in `git ls-files`.
- `docs/ARCHITECTURE.md` line ~61 gives the server start command as `pnpm railway:start` (migrate, then start), and root `package.json` defines `railway:start`. `AGENTS.md` still names the bare server start.
- `.gitignore` has no `.claude/` line.

## Phase 0: recon (no code)

Confirm each fact above. Also:

- `git ls-files .claude` prints nothing. If anything under `.claude/` is tracked, STOP 0.
- Read the delivered `AGENTS.md` against the repo. Every path, function name, constant and command it cites must exist as written, in particular: `scripts/gate.sh` and `pnpm gate` (built in Phase 2), `__massalia_migrations` (`packages/db/src/migrate.ts`), `LEAST(` in `apps/server/src/services/barracks.ts`, `ChronicleType`, `TYPE_ORDER` and `CHRONICLE_EFFECT_LOG_KINDS` in `packages/shared/src/chronicle.ts`, `chronicleRenderers` in `apps/web/src/dashboard/panels/FamilyPanel.tsx`, `ChronicleType` in `apps/web/src/api.ts`, `uniquePlayerName` in `apps/server/src/services/playerNames.ts`, `settleAll` behind `GET /api/barracks` and `GET /api/map/reach`, `content/military/contracts.json` and `merc-cards.json`, `services/mapWar.ts`, `MAP_WORLD_ID` in `apps/server/src/routes/map.ts`, `services/mapActions.ts` and `POST /api/map/act`. A wrong fact is a STOP 0 item, never something to fix silently.

If anything is not as described, STOP 0 with the mismatch before writing anything.

## Phase 1: hooks lint (one commit)

1. Save this prompt verbatim as `docs/tooling/tooling-prompt-1.md`.
2. `pnpm add -Dw eslint-plugin-react-hooks@^5.2.0` (a root devDependency, beside `eslint`).
3. `eslint.config.js`: import the plugin at the top and add one block after the existing rules block, as the last argument of `tseslint.config(...)`:

```js
import reactHooks from "eslint-plugin-react-hooks";
```

```js
  {
    // A hook after an early return blacked out the map for every player on
    // 10 Sept 2026 (React #310). This fails it at lint, on every component.
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: { "react-hooks/rules-of-hooks": "error" }
  }
```

   Register the plugin object and that one rule only. Do not spread any of the plugin's preset configs.
4. `pnpm -r lint` must exit 0. If `rules-of-hooks` reports anything, STOP with each file:line. Do not fix, do not disable, do not downgrade to a warning.
5. Prove the rule is live. Create `apps/web/src/__hooks_probe.tsx`:

```tsx
import { useState } from "react";
export function Probe({ on }: { on: boolean }) {
  if (!on) return null;
  const [n] = useState(0);
  return <span>{n}</span>;
}
```

   Run `pnpm --filter @massalia/web lint` and see it fail naming `react-hooks/rules-of-hooks`. Delete the file and run the lint again green. The probe is never staged.

Stage `eslint.config.js`, `package.json`, `pnpm-lock.yaml` and the prompt copy.

Commit: `lint: react-hooks/rules-of-hooks is an error in apps/web`.

## Phase 2: the gate (two commits)

1. `scripts/gate.sh`, exactly this, executable (`chmod +x`):

```bash
#!/usr/bin/env bash
# The gate: the one command that decides whether a commit may be pushed. CI runs
# this same script (.github/workflows/ci.yml), so green here and green in CI mean
# the same thing. Steps run one after another and the first failure stops the run.
# The DB suites share one *_test database and the server suite truncates it, so
# no two suites may run side by side; that is why the gate is not `pnpm -r test`.
# A new workspace package with tests must be added to the list below.
set -euo pipefail
cd "$(dirname "$0")/.."

case "${DATABASE_URL:-}" in
  *_test*) ;;
  *)
    echo "gate: DATABASE_URL must point at a *_test database. Without one the DB suites skip, and a run with skipped suites is not green." >&2
    exit 1
    ;;
esac

sha="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then tree="dirty"; else tree="clean"; fi
echo "gate: HEAD ${sha}, tree ${tree}"

step() {
  echo
  echo "gate: $*"
  "$@"
}

step pnpm -r build
step pnpm -r lint
step pnpm db:migrate
step pnpm --filter @massalia/shared test
step pnpm --filter @massalia/server test
step pnpm --filter @massalia/db test
step pnpm --filter @massalia/web test
step pnpm --filter @massalia/worker test

echo
if [ "${tree}" = "clean" ]; then
  echo "GATE GREEN: HEAD ${sha}, tree clean"
else
  echo "GATE GREEN: HEAD ${sha}, tree dirty (not a push gate: commit, then run it again)"
fi
```

2. Root `package.json` scripts: add `"gate": "bash scripts/gate.sh"`, and change `"test"` to `"pnpm -r --workspace-concurrency=1 test"`.
3. Run `pnpm gate` for real against the migrated `massalia_test`. Then run it once with `DATABASE_URL` unset and once with a URL that lacks `_test`: both must exit 1 before any step starts.

Commit: `gate: one script, the suites one package at a time`.

4. `.github/workflows/ci.yml`: leave everything down to and including "Install dependencies" as it is, the `services` and `env` blocks included. Replace the steps from "Build shared package" through "Test worker" with these two, and keep "Audit" as the last step:

```yaml
      # The DB suites are gated on a *_test database and truncate it between tests.
      - name: Create test database
        run: psql "postgres://postgres:postgres@localhost:5432/postgres" -c "CREATE DATABASE massalia_test"

      # The same command an agent runs before a push (scripts/gate.sh): build, lint,
      # migrate the test database, then the suites one package at a time.
      - name: Gate
        run: pnpm gate
```

   The resulting step list is: Checkout, Setup pnpm, Setup Node, Install dependencies, Create test database, Gate, Audit. Do not rename the workflow (`CI`) or the job (`ci`). Do not touch `pages.yml`.
5. If a YAML parser is already at hand (python3 with `yaml`, or a `yaml` package already in `node_modules`), parse the file with it. Install nothing for this.

Commit: `ci: run the gate script`.

## Phase 3: the agent guide (two commits)

1. `AGENTS.md`: replace it with the delivered file, unchanged. If Argiris already placed it at the repo root it shows as modified in `git status`: use it as it is. If it was attached or pasted into the session, write it to the repo root unchanged. It is 107 lines with these sections in order: What this is, Deploy topology, Invariants, How to run, Admin tooling, Commit discipline, Working a prompt, Web client, Server and data, Tests, Map truth. Do not reword it.
2. `CLAUDE.md`, the whole file:

```markdown
<!-- AGENTS.md is the single guide for agents in this repository. Claude Code reads CLAUDE.md, not AGENTS.md, so this file imports it and the guide loads at the start of every session. -->
@AGENTS.md
```

Commit (both files): `agents guide: working rules, CLAUDE.md imports it`.

3. `.gitignore`: add a `.claude/` line after `.DS_Store`.

Commit: `gitignore: .claude/`.

## Gate and STOP 1

`DATABASE_URL=…/massalia_test pnpm gate` at HEAD after the last commit, tree clean. No push. Report:

```
Committed: <SHA> lint: react-hooks/rules-of-hooks is an error in apps/web
Committed: <SHA> gate: one script, the suites one package at a time
Committed: <SHA> ci: run the gate script
Committed: <SHA> agents guide: working rules, CLAUDE.md imports it
Committed: <SHA> gitignore: .claude/
Rule check: <the probe failed lint naming react-hooks/rules-of-hooks, then was deleted>
Gate refusals: <exit codes of the two refused runs>
Gate: <last line of pnpm gate, and the wall-clock time of the run>
Deviations: <each as a ruling for Argiris, or "none">
Noticed, not touched: <anything stale or wrong seen on the way, docs/MAP.md included>
For Argiris: in the next Claude Code session run /context and check that CLAUDE.md and AGENTS.md are both listed under Memory files.
```

## Scope fence

Do not touch: anything under `apps/*/src`, `packages/*/src`, `apps/web/test` or `content/` (the probe file is created and deleted, never committed); any vitest config or timeout; `pages.yml`; the Postgres version in CI; the workflow name and the job id; any other lint rule, `exhaustive-deps` included; any dependency other than the one plugin; `.claude/rules`, hooks or settings; `docs/MAP.md` and `docs/ARCHITECTURE.md`. No migration. Not in this prompt: the festival world key, the worker sweeps, `listEvents()` memoisation, the `World2Map.tsx` split, the duplicated types in `apps/web/src/api.ts`. No refactors along the way.

END OF PROMPT
