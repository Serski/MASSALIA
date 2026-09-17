# MASSALIA — guide for agents and contributors

## What this is

MASSALIA is a browser strategy RPG set in the Greek colony of Massalia around 300 BC: each player leads a house, trades, schemes and holds office in a 300-seat oligarchy, one game season per real day. It is a pnpm/TypeScript monorepo — a Fastify API (`apps/server`), a Vite/React client (`apps/web`), a BullMQ worker (`apps/worker`), Drizzle schema and migrations (`packages/db`), pure shared rules (`packages/shared`) and data-driven content under `content/`. The server decides everything; the client renders state and sends intent.

## Deploy topology

- **Web** — static build on GitHub Pages at `playmassalia.com`, published by `.github/workflows/pages.yml` only after a green `CI` run on `main` (`workflow_run`).
- **Server** — `apps/server` on Railway (Railpack builder, start `pnpm railway:start`, which applies pending migrations and then starts the server, health check `/health`) at `api.playmassalia.com`. Railway deploys a commit only after its CI check passes. Applied migrations are recorded in `__massalia_migrations`.
- **Worker** — `apps/worker` on Railway, built from `apps/worker/Dockerfile` (Node 22 + PostgreSQL 18 client), start `pnpm --filter @massalia/worker start`.
- **Postgres 18** and **Redis** — Railway services (`DATABASE_URL`, `REDIS_URL`).
- **Email** — Resend (`RESEND_API_KEY`, `EMAIL_FROM`); unset means links are logged, not sent.
- **Analytics** — Plausible, loaded from `plausible.io` (allowed by the CSP in `apps/web/index.html`).
- **Backups** — the worker runs `pg_dump` nightly at 03:30 UTC to an S3-compatible bucket (`BACKUP_S3_*`), keeping 30 days; `scripts/restore.sh` is the restore drill.

## Invariants

- The server is authoritative: no outcome (roll, price, ownership, eligibility) is decided client-side.
- Every transaction that mutates a player's wallet, resources, pops, buildings, stats, traits or cards calls `lockPlayer(tx, playerId)` first (`apps/server/src/services/lock.ts`).
- Money and stock writes are relative and guarded — `SET drachmae = drachmae - X WHERE drachmae >= X` — and the affected row count is checked.
- Resolving any card, event, festival or Olympiad is claim-first: a conditional `UPDATE … WHERE resolved = false RETURNING` inside the same transaction as its effects; a lost claim applies nothing.
- Content JSON under `content/` is validated with zod at server boot; a malformed file fails the boot.
- The Lobby's news is content too: `content/news/news.json`, parsed by `packages/shared/src/news.ts` and loaded at boot by `apps/server/src/services/news.ts`; the client fetches the file from `/content/news/news.json`.
- Migrations are append-only SQL files in `packages/db/migrations`, applied in name order, one transaction each; never edit an applied file.
- Military numbers (garrison, pentekonters, triremes, warband) never ship under `apps/web/public`; `apps/web/test/public-leak-guard.test.ts` enforces it.
- `MAP_MUTATIONS_ENABLED` stays `false` until movement, war, occupation and authorization rules are real.
- 5xx responses never carry internal messages: `errorHandler.ts` logs the error and answers `{ error: "Something went wrong." }`.
- Sessions are the signed `httpOnly` cookie only; there is no bearer-token path.

## How to run

```bash
pnpm install
pnpm --filter @massalia/shared build && pnpm --filter @massalia/db build
docker compose up -d            # Postgres + Redis (docker-compose.yml)
cp .env.example .env            # DATABASE_URL, REDIS_URL, SESSION_SECRET, WEB_ORIGIN, VITE_API_URL
pnpm db:migrate && pnpm db:seed
pnpm dev:api                    # API on :3001
pnpm dev:web                    # Vite on :5174
```

- The gate is one command: `DATABASE_URL=postgres://…/massalia_test pnpm gate` (`scripts/gate.sh`). It builds every package, lints, migrates the test database and runs the suites one package at a time, stopping at the first failure. It refuses to start without a `*_test` database. CI runs the same script.
- Never run the suites side by side: they share one `*_test` database and the server suite truncates it. Root `pnpm test` is pinned to one package at a time for that reason.
- Tests need Postgres. The server, db and worker integration suites are **DB-gated**: they run only when `DATABASE_URL` points at a database whose name contains `_test` (they `TRUNCATE` it). Create `massalia_test`, migrate it, then `DATABASE_URL=…/massalia_test pnpm --filter @massalia/server test`. CI does exactly this against a `postgres:16` service. CI stays on 16 because the runner's `pg_dump` is 16 and refuses a newer server (the worker's backup test); docker-compose and Railway run 18, so SQL that needs 17 or later fails CI.
- The worker's backup test runs the real `pg_dump` against that database when the binary is on `PATH`; `PG_DUMP=/path/to/pg_dump` overrides it.
- Route tests build a minimal Fastify app with `@fastify/cookie` and `app.inject()`; mint a session by inserting the sha256 of a raw token into `sessions` and sending `cookie: massalia_session=${app.signCookie(raw)}`.

## Admin tooling

- The admin API lives under `/admin/*` (`apps/server/src/routes/admin.ts`): `requireAdmin` needs a valid, unbanned session whose user has `is_admin`; every call — reads included — writes an `admin_audit` row. The web page is `/admin` (`apps/web/src/AdminPage.tsx`): user search, the same-IP cluster view (users sharing a register/login IP in the last 30 days, from `auth_events`), ban/unban with a reason, delete sessions, adjust drachmae (relative, under the player lock, logged to `effect_log`), rename (same sanitiser and uniqueness as creation), and a character's `effect_log` / `interactions`.
- **Making an admin** is manual and needs the database URL — there is no API for it on purpose:

  ```bash
  DATABASE_URL=postgres://… pnpm --filter @massalia/db exec tsx ../../scripts/make-admin.ts you@example.com
  # add --revoke to remove the flag
  ```

  For production, run it through `railway run` (or against a `railway connect` tunnel) with the Postgres service's URL.
- Bans: `users.banned_at` + `ban_reason`. A banned user's sessions no longer authenticate (401 everywhere), login answers 403 with the reason, and `/auth/me` answers 403 with the reason so the client can show it.

## Commit discipline

- One item per commit. Stage only that item's files with `git add <path>`; never `git add -A` and never `git rm` ahead of the commit that removes the last import — a staged deletion rides along in whatever commit comes next.
- Every commit must build: typecheck and lint clean, suites green. Push only when the workspace builds at every commit, and read exit codes directly — a `| tail` or `| grep` hides a failing `pnpm lint`.
- Commit messages say what changed and why; the follow-up, if any, goes in the message.

## Working a prompt

- Work arrives as a prompt file with phases, STOP gates, a scope fence and a report template. Save it verbatim under `docs/<area>/` in the first commit. Stop at every STOP and wait; never carry on past one.
- Touch only what the prompt names. Anything else, and any departure from the prompt, goes in the report as a "Ruling for Argiris" item with the reason. Never settle it silently.
- Design, balance and player-facing wording are Argiris's rulings. Balance numbers live in content JSON, never in code.
- Commits stay local. A push happens only under a separate push prompt, as plain `git push`: never `--force`, never a rewrite of pushed history. Unpushed commits may be amended or rebased, with `git patch-id` showing the diff unchanged.
- The push gate is a `pnpm gate` run that ends `GATE GREEN … tree clean` at the HEAD being pushed, after the last commit. Earlier runs and per-package runs do not count.
- Every report lists each commit as `Committed: <SHA> <subject>` and quotes the gate's last line.
- A failing test is fixed, never rerun until it passes. A CI run that is red only on test timeouts is fixed forward with one test-config commit per package raising `testTimeout` / `hookTimeout`, no source change. A red commit on `main` is fixed forward; Railway and Pages skip red commits, so production is untouched.
- Production reads go through `railway run --service Postgres --environment production` with `DATABASE_PUBLIC_URL`. A production write is a guarded script (BEFORE and AFTER selects, one transaction, row-count checks, `--dry-run` first) that Argiris runs himself or allows for the session. Confirm a deployed migration with a select on `__massalia_migrations`.

## Web client

- `react-hooks/rules-of-hooks` is a lint error in `apps/web`: every hook sits above the first early return. Never disable it inline. A hook placed after an early return in `World2Map.tsx` blacked out the map for every player on 10 Sept 2026.
- A change to the map or the dashboard needs a render test in `apps/web/test` before push. "Not verified in the browser" is not an acceptable report line.
- Render tests stay cheap: the web suite runs at vitest's 5 s default with files in parallel. Use plain DOM selectors, not role queries with regex names over long lists, and wait for real state (a button enabling), never a fixed delay.
- Routes that settle (`GET /api/barracks`, `GET /api/map/reach`) run `settleAll` under the player lock: fetch on open and after an action, never on an interval.
- Check `apps/web/public` for an existing brand asset before creating one.

## Server and data

- Compute a guarded stock draw in SQL (`LEAST(amount, demand)`, as `services/barracks.ts` does), never from a JS read of the numeric column: a double can read a hair above the stored value, the `amount >= draw` guard then rejects, the settle throws and every settling route answers 500 for that player.
- The calendar restarts with every world. Anything keyed on game time (`game_year`, season, term) also carries `world_id` or a character or player id, in its unique index and in every query that groups by it.
- Exactly one world is `active` at any instant. Characters, players and names are per world.
- A new Chronicle kind touches five places together: the `ChronicleType` union, `TYPE_ORDER` and `CHRONICLE_EFFECT_LOG_KINDS` in `packages/shared/src/chronicle.ts`, the renderer in `apps/web/src/dashboard/panels/FamilyPanel.tsx`, and the client's own `ChronicleType` in `apps/web/src/api.ts`.
- A db package test imports only from `packages/db/src` (the tsconfig `rootDir`): a script's core lives in `src`, with a thin CLI shell in `scripts/`.
- Naming traps: the stat is `militia`, not "military". `merc.ts`, `contracts.json` and `merc-cards.json` are the Hoplite's personal contracts and have nothing to do with Barracks bands. The goods `trade-ship` and `galley` are the Pentekonter and the Trireme.

## Tests

- The DB suites share one `massalia_test` and never truncate `houses`: read seeded rows back instead of pinning literal names.
- A test that seats an heir creates its own world: `uniquePlayerName` appends a numeral ("Kleon II") instead of failing, so a name drawn by an earlier test changes what a later one gets.

## Map truth

- The playable map is **world 2**: 140 land regions, 33 sea regions, 2 fog regions and 105 towns, drawn by hand and derived deterministically by `tools/map-gen/build_world2.py` from the committed Photoshop sources — the PSD is the source of truth for geometry; edit it, rebuild, never hand-edit `world2.json`.
- Region ids (`R001`…`R140`) are internal; players only ever see the names in `apps/web/public/map2/names2.json`.
- `politics2.json` holds 77 polities (Massalia, Carthage, the Roman Republic, Greek, Italic, Gaulish and Iberian peoples, plus `unclaimed`) and the region→polity ownership.
- The old 1,023-cell ProvinceMap is gone: `/api/world`, `MapCanvas`, `mapDataProvider`, `ProvinceMap.tsx` and `apps/web/public/map/*` are all deleted. What is left of that era is server-side and dead behind `MAP_MUTATIONS_ENABLED`: `services/mapWar.ts`, the conquer route and `MAP_WORLD_ID` in `routes/map.ts`, and the `map_*` tables. Do not build on them.
- `docs/MAP.md` predates the live map actions: where it calls the Attack / Raid / Scout buttons inert, the code is the truth (`services/mapActions.ts`, `POST /api/map/act`).
