# MASSALIA — guide for agents and contributors

## What this is

MASSALIA is a browser strategy RPG set in the Greek colony of Massalia around 300 BC: each player leads a house, trades, schemes and holds office in a 300-seat oligarchy, one game season per real day. It is a pnpm/TypeScript monorepo — a Fastify API (`apps/server`), a Vite/React client (`apps/web`), a BullMQ worker (`apps/worker`), Drizzle schema and migrations (`packages/db`), pure shared rules (`packages/shared`) and data-driven content under `content/`. The server decides everything; the client renders state and sends intent.

## Deploy topology

- **Web** — static build on GitHub Pages at `playmassalia.com`, published by `.github/workflows/pages.yml` only after a green `CI` run on `main` (`workflow_run`).
- **Server** — `apps/server` on Railway (Railpack builder, start `pnpm --filter @massalia/server start`, health check `/health`) at `api.playmassalia.com`. Railway deploys a commit only after its CI check passes.
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

- `pnpm -r lint`, and `tsc -p tsconfig.json --noEmit` in `apps/server`, `apps/web`, `apps/worker` — CI runs all of them.
- Tests need Postgres. The server, db and worker integration suites are **DB-gated**: they run only when `DATABASE_URL` points at a database whose name contains `_test` (they `TRUNCATE` it). Create `massalia_test`, migrate it, then `DATABASE_URL=…/massalia_test pnpm --filter @massalia/server test`. CI does exactly this against a `postgres:16` service.
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

## Map truth

- The playable map is **world 2**: 140 land regions, 33 sea regions, 2 fog regions and 105 towns, drawn by hand and derived deterministically by `tools/map-gen/build_world2.py` from the committed Photoshop sources — the PSD is the source of truth for geometry; edit it, rebuild, never hand-edit `world2.json`.
- Region ids (`R001`…`R140`) are internal; players only ever see the names in `apps/web/public/map2/names2.json`.
- `politics2.json` holds 77 polities (Massalia, Carthage, the Roman Republic, Greek, Italic, Gaulish and Iberian peoples, plus `unclaimed`) and the region→polity ownership.
- The old 1,023-cell ProvinceMap and its world stream are retired: `/api/world` is gone and `MapCanvas`/`mapDataProvider` are deleted. `apps/web/src/map/ProvinceMap.tsx` and `apps/web/public/map/*` still sit unmounted pending deletion — do not wire them back. See `docs/MAP.md`.
