# Architecture

MASSALIA is a TypeScript monorepo: app packages (`apps/server`, `apps/web`, `apps/worker`) over shared domain packages (`packages/shared`, `packages/db`) and data-driven content (`content/`). This document describes production as it runs today.

## Packages

- `apps/server`: Fastify API — sessions, rate limiting, the authoritative game services, the world 2 map read, the map realtime stream.
- `apps/web`: Vite React client. React owns the HUD and panels; the world 2 map is a framework-agnostic SVG component fed by static assets plus one authenticated read.
- `apps/worker`: BullMQ worker — the recurring sweeps (festivals, elections, agenda, Olympiads, mercenary contracts, spouse deaths, league drift), per-character scheduled jobs, and the nightly backup.
- `packages/shared`: pure rules and types — stats, traits, events, elections, the map-action matrix, tick math. No I/O.
- `packages/db`: Drizzle schema, the append-only SQL migrations, seeds, and the DB-level services the worker calls.
- `content`: JSON validated at boot — events, traits, buildings, calendar, politics, family, age, interactions, military pools, the world 2 map data.

## Tick model

There is no real-time loop. Actions persist completion timestamps and resources accrue lazily on read (`amount + ratePerSecond × secondsSinceLastUpdate`). One game season is one real day. The worker only resolves moments that must happen at a fixed time and sweeps that must happen even when nobody is online.

## Server authority and the mutation rules

The client renders server state and sends intent; it never decides an outcome. Every mutating path follows the same three rules:

1. **Player lock.** Any transaction that touches a player's wallet, resources, pops, buildings, stats, traits or cards calls `lockPlayer(tx, playerId)` first — a transaction-scoped advisory lock keyed on `players.id` (`apps/server/src/services/lock.ts`). Reads before the lock are reads from before the previous writer committed, which is exactly the race it closes. First-login provisioning (`ensureCharacterRow`) and hostile actions (poison, assassinate, spymaster posture) run under it too.
2. **Guarded relative writes.** Money and stock move by `SET x = x - N WHERE x >= N` (or the resource equivalent) with the affected row count checked — the second line of defence even if a caller forgets the lock.
3. **Claim-first resolution.** A daily card, event, festival or Olympiad is resolved by a conditional `UPDATE … WHERE resolved = false RETURNING` inside the same transaction as its effects; whoever loses the claim applies nothing and returns the already-resolved answer.

Other invariants: content JSON is validated with zod at boot (a malformed file fails the boot); migrations are append-only SQL files applied in name order, one transaction each, recorded in `__massalia_migrations`; 5xx responses are logged and answered with a fixed `{ error }` so no SQL, path or stack reaches a client (`errorHandler.ts`); military numbers never ship under `apps/web/public`.

## Sessions

Sessions are **cookie-only**. `POST /auth/register`, `/auth/login` and `/auth/reset-password` store the sha256 of a random token in `sessions` and set `massalia_session` — signed, `httpOnly`, `SameSite=Lax`, `Secure` when `WEB_ORIGIN` is https, 30-day `maxAge`, path `/`. The web app (`playmassalia.com`) and the API (`api.playmassalia.com`) share a registrable domain, so the cookie is same-site and flows on every credentialed request and on the map `EventSource`. There is no bearer-token path: an `Authorization` header is ignored. The web build carries a Content-Security-Policy (`apps/web/index.html`) that allows scripts only from itself and Plausible and connections only to itself, the API and Plausible; a Vite plugin swaps the API origin for non-production builds.

Passwords are bcrypt (cost 12). Password reset and email verification use the same token discipline (random token emailed, only its hash stored, newest-only, single-use, 60 min / 24 h). Email goes through Resend; without `RESEND_API_KEY` the links are logged instead.

## Lobby

`/lobby` is the account-level page between the landing and the game (`apps/web/src/lobby/`): a three-column front — the viewer's character card (the aged portrait resolved as the dashboard does), the section nav and their record on the left; the open world as a hero card (the class building render by profession from `art.ts`, where every lobby image choice lives) with the calendar of announced and ended worlds in the centre; the guides box, the latest dispatches and Citizens on the right. Citizens is the top five of the prestige board, rank only, no presence of any kind; the viewer's own row is highlighted. `routes.ts` maps `/lobby`, `/lobby/account` and `/lobby/hall-of-fame` to the front's three views; `/news` and `/guides` are public pages (no login, no API call for the guides) inside the same `LobbyFrame` (brand, nav, session buttons, footer, the front art background). In-app links push through `apps/web/src/navigate.ts`. The front reads `GET /api/lobby` (`apps/server/src/routes/lobby.ts`, read-only, no lock) — which ranks the roster once through the same standings loader and ranker as `/api/standings` and serializes rank positions plus the portrait fields (`portrait`, `faceId`, `professionSlug`), never a raw metric — plus the news file. News is content, not a table: `content/news/news.json`, parsed by `@massalia/shared` (`news.ts`), validated at boot by `services/news.ts`, and fetched by the client straight from `/content/news/news.json`. `worlds.status` is `announced | active | ended` (migration 0052) and every game read filters `active`, so an announced world exists only to the Lobby. Because the session cookie is `httpOnly`, the client keeps a boolean **session hint** in `localStorage` (`massalia.session`, set by any login-shaped call, dropped on logout, deletion, a 401 or a null `/auth/me`): the bare `/` with a hint makes one `/auth/me` and lands in `/lobby`; without it the landing renders with no API call. Deliberately absent: world results and a Hall of Fame table (an empty state until a world ends), achievements (still the placeholder in the character sheet), an Admin link (`/admin` stays reachable by URL).

## Rate limiting

`@fastify/rate-limit` is registered once, globally (`apps/server/src/rateLimit.ts`): Redis store when `REDIS_URL` is set (shared across instances, failing open on Redis errors), in-memory otherwise.

- 300 requests per minute per key on every route; the key is the session's user id when a valid cookie is present, else the client IP (`trustProxy` trusts exactly one hop, Railway's edge).
- 60 per minute on `POST`/`PUT`/`PATCH`/`DELETE` under `/api/`, applied as route config by an `onRoute` hook unless the route declares its own.
- The auth routes keep their stricter IP-keyed limits: 8/min for register, login, reset-password and verify-email, 5/min for delete-account, 3/hour for forgot-password and resend-verification.
- `/health` and `/content/` are exempt. A 429 is `{ error: "Too many requests. Try again shortly." }` (auth routes: "Too many attempts…").

## Realtime

`GET /api/map/stream` is a cookie-authenticated SSE stream (full state once, then one `change` event per province change). Each user may hold at most 3 open streams — a fourth is refused with 429 — and a `: keep-alive` comment every 25 s keeps proxies from cutting an idle stream. The legacy `/api/world` state and stream are gone; `broadcastState()` remains a no-op hook after every mutating service.

## Health and shutdown

- `GET /health` runs `SELECT 1` on the shared pool and `PING` on a throwaway Redis client when `REDIS_URL` is set, each capped at 2 s. It answers `200 { ok: true, db: "ok", redis: "ok" | "off" }`, or `503` with the failing part marked `"failed"` and named in `error`. Railway uses it as the server's health check.
- Both processes handle `SIGTERM`/`SIGINT` once. The server stops accepting connections and lets in-flight requests finish; the worker finishes its active jobs and closes its queue. Each waits up to 10 s, then ends the pg pools (`endDbPools()` in `@massalia/db`) and exits 0. Railway sends `SIGTERM` on every redeploy, so a deploy never cuts a transaction.

## Deployment

| Piece | Where | How |
| --- | --- | --- |
| Web | GitHub Pages, `playmassalia.com` | `.github/workflows/pages.yml` builds and publishes only after a green `CI` run on `main` (`workflow_run`), or by hand. |
| Server | Railway service `server`, `api.playmassalia.com` | Railpack builder from the repo root (`corepack enable && pnpm install --frozen-lockfile && pnpm build`), start `pnpm railway:start` → migrate then `pnpm --filter @massalia/server start`, health check `/health`. |
| Worker | Railway service `worker` | Built from `apps/worker/Dockerfile` (Node 22 + PostgreSQL 18 client from PGDG), start `pnpm --filter @massalia/worker start`. |
| Postgres 18, Redis | Railway services | `DATABASE_URL`, `REDIS_URL`. |

**CI is the deploy gate.** `.github/workflows/ci.yml` builds shared and db, typechecks server, web and worker, lints, runs the shared suite, then the server, db, web and worker suites serially against a `postgres:16` service database (`massalia_test`), then `pnpm audit`. Pages deploys only on a green run, and Railway deploys a commit only once its CI check has passed — deployments for a red commit show as skipped.

Environment (`.env.example` lists them all): `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET` (≥ 32 chars), `WEB_ORIGIN`, `PORT`; `VITE_API_URL` for the web build; `RESEND_API_KEY` / `EMAIL_FROM`; `MAP_MUTATIONS_ENABLED` (keep `false`); `VITE_SOCIAL_LOGIN` (unset in production); `BACKUP_S3_*` for the worker.

## Backups

The worker runs a nightly backup at **03:30 UTC** (`apps/worker/src/jobs/backup.ts`, a cron job scheduler alongside the sweeps): `pg_dump --format=custom` of `DATABASE_URL`, gzipped, uploaded to an S3-compatible bucket as `massalia-YYYY-MM-DD.dump.gz`, then every `massalia-*.dump.gz` older than 30 days (by the day in its name) is deleted. The worker image ships a PostgreSQL 18 client (`apps/worker/Dockerfile`), matching the Railway Postgres major. Configure the worker service with:

- `BACKUP_S3_ENDPOINT` — the S3-compatible endpoint URL (R2, B2, MinIO, AWS)
- `BACKUP_S3_BUCKET` — the bucket name
- `BACKUP_S3_KEY_ID` — access key id
- `BACKUP_S3_SECRET` — secret access key
- `BACKUP_S3_REGION` — optional, default `auto` (path-style addressing is used)

If any of the four is unset the job logs `Nightly backup skipped: …` and does nothing. `PG_DUMP=/path/to/pg_dump` overrides the binary the job spawns.

**Restore drill.** Download a dump (e.g. `aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp "s3://$BACKUP_S3_BUCKET/massalia-2026-09-05.dump.gz" .`) and run `scripts/restore.sh massalia-2026-09-05.dump.gz "$SCRATCH_DATABASE_URL"`. It streams the archive through `pg_restore --clean --if-exists --no-owner --no-acl` into the given database (which must exist), asks you to type the database name first unless `--yes` is passed, and prints the largest tables' row counts afterwards. Drill against a scratch database; `pg_restore` must be at least the `pg_dump` major version.
