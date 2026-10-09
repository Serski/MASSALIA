# Content route 1: /content/ serves only the two files the client reads

Save this prompt as docs/tooling/content-route-prompt-1.md in the first commit. Read AGENTS.md first. Drafted against a911188, which is origin/main; your local main may be one content commit ahead (627a9b4). No migration. One concern per commit, staged by path. Recon first and STOP only if something below does not match the code; otherwise build straight through to STOP 1. Commits stay local; no push until I say push.

## What it is

apps/server/src/index.ts:93-97 mounts the whole content/ directory at /content/ and lets any .json file through. Anyone can read https://api.playmassalia.com/content/map/town-military.json today (checked 9 Oct), and with it region-military.json, the battle and unit numbers, and every event and story file, including the branches and rewards the story API is careful never to send. The client reads two of these files: age/age-config.json and news/news.json. After this prompt the mount serves those two and answers 404 for everything else.

## Scope

Two commits; the first also saves this file. Touch only:
- docs/tooling/content-route-prompt-1.md (this file)
- apps/server/src/publicContent.ts (new)
- apps/server/src/index.ts (the mount at :91-:97 becomes one call)
- apps/server/src/routes/public-content.test.ts (new)
- AGENTS.md (one invariant line)

Do not touch: content/, the web client, rateLimit.ts and its test, the news and age loaders. No production write.

## Phase 0: recon (read only)

Confirm each of these. On any mismatch, STOP 0 and report.
- apps/server/src/index.ts:93-97 registers @fastify/static with root content/, prefix "/content/" and `allowedPath: (pathName) => pathName.endsWith(".json")`, after registerRateLimit (:90), with its comment at :91-:92.
- The lockfile resolves @fastify/static 10.1.5. In that version the wildcard handler calls `allowedPath(normalizedPathname, root, request)` (index.js:359); the pathname is the URL path after the prefix, with a leading slash, posix-normalized (:274, :653) and not URI-decoded (:944). A false answer is `reply.callNotFound()`, a 404.
- The web client fetches only /content/age/age-config.json (apps/web/src/api.ts:520) and /content/news/news.json (:575). Nothing in apps/, packages/ or scripts/ calls reply.sendFile or reply.download.
- rateLimit.ts:67 exempts every /content/ path, and rate-limit.test.ts probes its own /content/x.json route, not this mount.

## Commit 1: server: /content/ serves only the two files the client reads

1. Save this prompt file.
2. apps/server/src/publicContent.ts:
   - `PUBLIC_CONTENT_FILES = ["/age/age-config.json", "/news/news.json"] as const`, with a comment naming the two client calls that read them, and saying that a file the client needs later is added to this list and nowhere else.
   - `registerPublicContent(app, root = <repo root>/content)`: the same @fastify/static registration as today, with `allowedPath` an exact match against that list. An encoded or dotted spelling of an allowed file falls outside the list and answers 404; the client never sends one.
3. index.ts: the mount becomes `await registerPublicContent(app)` in the same place in the boot order, and the comment above it says only the listed files are served.
4. apps/server/src/routes/public-content.test.ts (new; no database, so it is not DB-gated): a minimal Fastify app with registerPublicContent over the real content directory.
   - GET /content/age/age-config.json and /content/news/news.json answer 200 with a JSON content type, and each body parses to the file on disk.
   - Walk content/ recursively: every other .json file answers 404, by GET and by HEAD. town-military.json and region-military.json also get an assertion of their own, so a reader sees why the test exists.
   - /content/news/../map/town-military.json and /content/map%2Ftown-military.json answer anything but 200.
   - /content/ and /content/news/ answer 404.

## Commit 2: AGENTS.md: the content mount's rule

Under Invariants, after the line on military numbers: "The API's /content/ mount serves only the files listed in apps/server/src/publicContent.ts (today age/age-config.json and news/news.json), and apps/server/src/routes/public-content.test.ts expects 404 for every other file under content/. A file the client needs is added to that list; the mount is never widened."

## Gate and STOP 1

Run `DATABASE_URL=…/massalia_test pnpm gate` at HEAD after commit 2, then `pnpm audit --audit-level=high`. The gate must end `GATE GREEN: HEAD <sha>, tree clean`; the audit must exit 0. A red from a timeout in a suite this diff does not touch is a STOP with the log; never rerun to get a pass. Commit only on a read exit code.

STOP 1. Report:
- Committed: <SHA> <subject>, one line per commit
- Gate: the last line, suite counts; the audit exit code
- `git log --oneline origin/main..HEAD`: every commit the push would carry. For any that is not from this prompt (627a9b4, the Trader story, if it is still unpushed), its diff stat and what you know of its review. I say at push whether it ships with this.
- How many content files the test walked and found closed
- Any deviation, as a question for a ruling

## Push (only after I reply "push")

Not in the hour before the 00:00 UTC season rollover. Fast-forward only, plain `git push`. Report:
- remote HEAD
- the CI run with its Gate and Audit steps, and the Pages run
- Railway server and worker on the new SHA, the deploy log showing every migration skipped
- API health
- from outside, the status code of each of these: https://api.playmassalia.com/content/map/town-military.json, /content/map/region-military.json, /content/military/battle.json and one file under /content/stories/ must answer 404; /content/news/news.json and /content/age/age-config.json must answer 200

A red run is a STOP with the log. A closed file answering anything but 404, or an open one anything but 200, is a STOP: report it and wait. I check the Lobby news and a character's age in the game myself.

## STOP 1 ruling (9 Oct 2026)

1. The index.ts cleanup is accepted: path, fileURLToPath, __dirname, repoRoot and the fastifyStatic import existed only for the mount, so they go with it. The two library line numbers that sit a few lines off are accepted too.

2. 627a9b4 (Salt in the Wine) does not ship with this. Its six frames are not in yet, and the content fix goes out on its own.
   - Keep the story on a local branch: git branch story/salt-in-the-wine 627a9b4
   - Rebuild main without it: git rebase --onto origin/main 627a9b4 main
   - git patch-id for the two content commits must match before and after the rebase. Report both pairs.
   - The content walk loses the story's file: expect 64 files walked, 2 served, 62 closed. If the test pins a count, that is a STOP.

3. Append this ruling verbatim to docs/tooling/content-route-prompt-1.md under "STOP 1 ruling (9 Oct 2026)", as its own commit: docs: the content route prompt's STOP 1 ruling

4. Run the gate and the audit at the new HEAD. If the gate ends GATE GREEN at that HEAD, the audit exits 0 and the patch-ids match, push and report as the prompt's Push section says, plus the branch the story is kept on and its SHA. Anything else is a STOP. The story branch stays local.
