# Vitest 4: drop tinypool, remove the temporary audit ignore

Written 6 Oct 2026 as the follow-up to the deps commit that made the audit green
before the Sentinum push. That commit is a bridge, not a fix. This prompt removes it.

## Why

On 5 Oct 2026 two critical advisories were published against tinypool 1.1.1,
the worker pool vitest 3.2.x uses for its test processes:

- GHSA-5gmw-xhrv-c9v3 Tinypool: Prototype Pollution gadget in worker options leads to RCE (patched >= 2.1.1)
- GHSA-85c8-ppgw-ccpr Tinypool: Prototype Pollution gadget to RCE in run() options (patched >= 2.1.2)

vitest 3.2.x pins tinypool ^1.1.1, so no in-range update reaches the patch.
tinypool is dev only (the test runner's worker pool); it is never executed in
production. By ruling of Argiris on 6 Oct 2026 the two advisory ids, and only
those ids, are ignored in the root package.json:

```json
"pnpm": { "auditConfig": { "ignoreGhsas": ["GHSA-5gmw-xhrv-c9v3", "GHSA-85c8-ppgw-ccpr"] } }
```

That ignore is TEMPORARY. It must be removed by this prompt, and no further id
may be added to it without a ruling.

## Scope

One commit, `deps: vitest 4, the tinypool audit ignore removed`. No source change
to any package under apps/ or packages/ beyond test configuration. Touch only:
- package.json (vitest `^4`, and delete the `pnpm.auditConfig` block entirely)
- packages/shared/package.json (vitest `^4`)
- pnpm-lock.yaml
- packages/db/vitest.config.ts and apps/server/vitest.config.ts, only if vitest 4 requires a config change
- docs/tooling/vitest-4-upgrade-prompt-1.md (this file; add the report at the end)

## Phase 0: recon (read only)

- `npm view vitest version` and `npm view 'vitest@^4' version | tail -1`: use the latest 4.x (4.1.11 when this was written). Its `engines.node` is `^20 || ^22 || >=24`; CI and Railway run Node 22.
- Confirm that vitest 4.x does not depend on tinypool (`npm view vitest@<4.x> dependencies.tinypool` prints nothing). If it does and the version is >= 2.1.2, that is also fine. If it pins < 2.1.2, STOP 0.
- Read the vitest 4 migration guide (https://vitest.dev/guide/migration) for: `workspace` replaced by `projects`, spy and mock changes, `environment` defaults, `poolOptions` changes. List which of these the repo's two vitest.config.ts files and test suites use.

## Commit

1. `pnpm --filter massalia add -D vitest@^4` at the root and `pnpm --filter @massalia/shared add -D vitest@^4`. Both package.json lines change to the same `^4.x.y`.
2. Delete the whole `pnpm` block from package.json. Nothing else in it must have been added by then; if something was, STOP and report.
3. `pnpm install` so the lockfile drops tinypool 1.1.1. `pnpm why -r tinypool` must print nothing, or only a version >= 2.1.2.
4. Fix any test failure that comes from the vitest 4 migration with a test-config or test-code change only. A source change under src/ is out of scope: STOP and report it as a ruling.
5. `pnpm audit --audit-level=high` must exit 0 with no ignore in place.

## Gate

`DATABASE_URL=…/massalia_test pnpm gate` at HEAD after the commit, ending `GATE GREEN: HEAD <sha>, tree clean`. Then `pnpm audit --audit-level=high` again, exit 0.

STOP 1. Report:
- Committed: <SHA> <subject>
- Gate: last line, suite counts
- The vitest version, and `pnpm why -r tinypool` output
- Every test-config change, with the migration-guide item it answers
- Any deviation, as a question for a ruling

## Push

Only after Argiris replies "push". Plain fast-forward push to main. Report CI (Gate and Audit steps), Railway server and worker on the new SHA, Pages green.
