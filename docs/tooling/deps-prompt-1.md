# Deps 1: the workflow actions, then the minor and patch group, with caution

Save this prompt as docs/tooling/deps-prompt-1.md in the first commit. Read AGENTS.md first. Repo HEAD when this was drafted: 0f445a9. No migration and no source change. One concern per commit, staged by path. Two parts, each with its own gate, STOP and push, so the build pipeline and the game's libraries never change in the same deploy. Recon first and STOP only if something below does not match; otherwise build straight through to STOP 1. Commits stay local; no push until I say push.

## Rulings (7 Oct 2026, from the deps recon)

- Take Dependabot #26 (the minor-and-patch group, 21 updates) and #9 (@eslint/js 9.39.5) in one deps commit, rebuilt on main rather than merged from their branches.
- Take the five Action majors in one workflow commit: #5 actions/checkout, #6 actions/setup-node, #3 pnpm/action-setup, #4 actions/upload-pages-artifact, #18 actions/deploy-pages.
- From now on Dependabot groups GitHub Actions bumps into one PR.
- With caution: the workflow changes go live first and on their own. The library batch follows only after a local browser check, and its deploy is compared against a baseline of the live API and watched in the server log.
- TypeScript 6 (#8) gets its own prompt later, and #8 stays open until then. The npm majors without a PR (eslint 10, vite 8, vitest 5, zod 4, bullmq 6, ioredis 6, TypeScript 7 and the rest) are not taken now.

## Scope

Three commits; the first also saves this file. Touch only:
- docs/tooling/deps-prompt-1.md (this file)
- .github/workflows/ci.yml and .github/workflows/pages.yml
- .github/dependabot.yml
- package.json (the root manifest) and pnpm-lock.yaml

Do not touch: any workspace package's package.json, any tsconfig, any source or test file, AGENTS.md. If a bump needs a source or test change to pass the gate, STOP with the failure. No production write.

## Phase 0: recon (read only)

Confirm each of these. On any mismatch, STOP 0 and report.
- main is at 0f445a9 or a fast-forward of it; say which.
- #26's diff touches only the root package.json (prettier) and pnpm-lock.yaml, and #9's only the root package.json (@eslint/js) and pnpm-lock.yaml.
- Since #26's base commit, main has not changed package.json or pnpm-lock.yaml: `git diff <#26 base> origin/main -- package.json pnpm-lock.yaml` is empty.
- Each Action PR changes only `uses:` refs in ci.yml or pages.yml. Note the exact ref each one sets.

Then record the live baseline, read only, for the comparisons below:
- the file name of the main JS bundle playmassalia.com serves
- the response headers of `GET https://api.playmassalia.com/health`
- the response to a CORS preflight from the site: `curl -si -X OPTIONS https://api.playmassalia.com/auth/me -H "Origin: https://playmassalia.com" -H "Access-Control-Request-Method: GET"`

## Part 1: the pipeline

### Commit 1: ci: the workflow actions to their current majors

1. Save this prompt file.
2. In ci.yml and pages.yml, every `uses:` ref goes to the version its Dependabot PR sets: actions/checkout (#5), actions/setup-node (#6), pnpm/action-setup (#3), actions/upload-pages-artifact (#4), actions/deploy-pages (#18). No input changes: `node-version: 22`, `cache: pnpm`, pnpm `version: 10.11.0`, and the Pages artifact path `apps/web/dist` all stay as they are.

### Commit 2: ci: Dependabot groups the Actions bumps

.github/dependabot.yml: the github-actions entry gains one group covering every action:

```yaml
    groups:
      actions:
        patterns:
          - "*"
```

The npm entry is unchanged.

### Gate and STOP 1

Run `DATABASE_URL=…/massalia_test pnpm gate` at HEAD after commit 2, then `pnpm audit --audit-level=high`. The gate must end `GATE GREEN: HEAD <sha>, tree clean`; the audit must exit 0. A red from a timeout in a suite this diff does not touch is a STOP with the log; never rerun to get a pass. Commit only on a read exit code. The local gate does not run the workflows; CI after the push is their test.

STOP 1. Report:
- Committed: <SHA> <subject>, one line per commit
- Gate: the last line, suite counts; the audit exit code
- Every `uses:` line of both workflows, verbatim
- The baseline from Phase 0
- Any deviation, as a question for a ruling

### Push 1 (only after I reply "push")

Fast-forward only, plain `git push`. Report:
- remote HEAD
- the CI run on the new HEAD: Gate and Audit steps, and the action refs its log shows
- the Pages run with the new upload and deploy actions, and whether the live main bundle's file name matches the baseline (the game code did not change, so it should; a different name is reported with what you find, not a STOP)
- `/og-image.jpg` and `/content/news/news.json` on playmassalia.com answering 200 (from upload-pages-artifact v4 on, dotfiles are left out of the artifact, so check the site still has everything)
- Railway server and worker on the new SHA, the deploy log showing every migration skipped
- API health

A red CI or Pages run is a STOP with the log. Railway and Pages skip red commits, so production stays where it was and the fix goes forward.

Then close #3, #4, #5, #6 and #18, each with a one-line comment naming the commit that took it, unless Dependabot has already closed it. Then STOP. Part 2 starts only when I say so.

## Part 2: the library batch

### Commit 3: deps: the minor and patch group (#26) and @eslint/js 9.39.5 (#9)

1. Bring in the root package.json and pnpm-lock.yaml exactly as they stand at #26's head (`git fetch origin pull/26/head`, then check out those two files from it onto main).
2. Set the @eslint/js specifier in the root package.json to the value #9's diff gives it, and run `pnpm install` once to resolve it.
3. Nothing else may move. Compare every resolved version in the lockfile against main: the only changes allowed are #26's 21 packages at #26's versions and @eslint/js at 9.39.5. Any other version change is a STOP with the list.
4. `pnpm install --frozen-lockfile` succeeds from an empty node_modules.

Message: `deps: the minor and patch group of 6 Oct (#26) and @eslint/js 9.39.5 (#9), root manifest and lockfile only`.

### Gate, local browser check and STOP 2

1. Run the gate at HEAD after commit 3 and the audit, as in Part 1.
2. Then a browser check on the local stack, never against production: `pnpm dev:api` and `pnpm dev:web` on a local database, with `WEB_ORIGIN` set to the dev web origin so CORS and the session cookie work as they do live. Log in with a local account (with `RESEND_API_KEY` unset the verification link is printed in the server log), load the dashboard, open the Barracks, the Market and the Atlas, log out, and log in again. The cookie, CORS and rate-limit plugins are in this batch, and login is what the tests cover least. If the local stack cannot start (Postgres or Redis missing), say so at STOP 2 with the reason; do not install system services without asking.

STOP 2. Report:
- Committed: <SHA> <subject>
- Gate: the last line, suite counts; the audit exit code
- `pnpm outdated -r` after the batch: only majors left
- The browser check step by step: every server error line, every browser console error, and whether the session cookie was set at login and cleared at logout
- The revert command for commit 3, ready but not run
- Any deviation, as a question for a ruling

### Push 2 (only after I reply "push")

Not in the hour before the 00:00 UTC season rollover. Fast-forward only, plain `git push`. Report:
- remote HEAD
- the CI run with its Gate and Audit steps, and the Pages run
- Railway server and worker on the new SHA, the deploy log showing every migration skipped
- API health
- the CORS preflight and the `/health` headers again, against the baseline, with any difference named
- the server log for the 15 minutes after the deploy against the 15 minutes before it: the count of 5xx responses and any error line that is new

A red run is a STOP with the log. Anything off in the comparison or the log is a STOP too: report it and wait. Do not revert on your own.

Then close #26 and #9, each with a one-line comment naming the commit that took it, unless Dependabot has already closed it. Leave #8 open. Report each PR's final state.
