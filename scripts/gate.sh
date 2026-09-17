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
