# Architecture

MASSALIA is a TypeScript monorepo split into app packages and shared domain packages.

## Packages

- `apps/server`: Fastify API, session stub, SSE stream, authoritative game services.
- `apps/web`: Vite React client. React owns HUD and panels; the map system is framework-agnostic TypeScript.
- `apps/worker`: BullMQ scheduled-resolution worker.
- `packages/shared`: shared types, event definitions, and timestamp/tick math.
- `packages/db`: Drizzle schema, migrations, and seed data.
- `content`: data-driven map, events, traits, and buildings.

## Tick Model

There is no real-time game loop. Actions persist completion timestamps. Resource values are computed lazily when read:

```ts
amount = amount + ratePerSecond * secondsSinceLastUpdate
```

The worker only resolves scheduled moments that must happen at a specific time, such as queued building completion, battle arrival, or later siege ticks.

## Server Authority

The server owns province ownership, faction colors, control status, event outcomes, and scheduled resolutions. The client renders server state and sends player intent. It never decides who owns a province or which effect succeeds.

## Event Engine

Event definitions live in `content/events`. Choices contain declarative effects. Server services apply effects, record the result, and publish state changes over SSE.

The current vertical slice includes `set_province_owner` to prove that a server-side event can recolor the political map without client special-casing.

## Deployment

Railway should provide:

- `DATABASE_URL`
- `REDIS_URL`
- `SESSION_SECRET`
- `WEB_ORIGIN`

The Railway project has four services: `server` (start: `pnpm --filter @massalia/server start`, health check `/health`), `worker` (start: `pnpm --filter @massalia/worker start`), `Postgres` (image `postgres-ssl:18`) and `Redis`. Both app services build from the repo root with Railway's **Railpack** builder (build: `corepack enable && pnpm install --frozen-lockfile && pnpm build`). `nixpacks.toml` describes the same plan for the Nixpacks builder and local `nixpacks build`; Railpack does not read it.

### Health, shutdown

- `GET /health` runs `SELECT 1` on Postgres and `PING` on Redis (when `REDIS_URL` is set), each capped at 2 s, and answers `200 { ok: true, db: "ok", redis: "ok" | "off" }` or `503` with the failing part marked `"failed"` and named in `error`. It is exempt from the rate limiter.
- Both processes handle `SIGTERM`/`SIGINT` once: the server stops accepting connections and lets in-flight requests finish, the worker finishes its active jobs; each waits up to 10 s, then ends the pg pools (`endDbPools()` in `@massalia/db`) and exits 0. Railway sends `SIGTERM` on every redeploy, so a deploy never cuts a transaction.

### Backups

The worker runs a nightly backup at **03:30 UTC** (`apps/worker/src/jobs/backup.ts`, a cron job scheduler alongside the sweeps): `pg_dump --format=custom` of `DATABASE_URL`, gzipped, uploaded to an S3-compatible bucket as `massalia-YYYY-MM-DD.dump.gz`, then every `massalia-*.dump.gz` older than 30 days is deleted. Configure the worker service with:

- `BACKUP_S3_ENDPOINT` — the S3-compatible endpoint URL (R2, B2, MinIO, AWS)
- `BACKUP_S3_BUCKET` — the bucket name
- `BACKUP_S3_KEY_ID` — access key id
- `BACKUP_S3_SECRET` — secret access key
- `BACKUP_S3_REGION` — optional, default `auto` (path-style addressing is used)

If any of the four is unset the job logs `Nightly backup skipped: …` and does nothing.

**pg_dump in the worker image.** Postgres on Railway is version 18, and `pg_dump` refuses to dump a server newer than itself, so the worker needs a PostgreSQL 18 client. `nixpacks.toml` adds `postgresql_18` for Nixpacks builds; the Railpack runtime image only offers the distro's older `postgresql-client`, so with the current Railpack builder the job fails each night with `pg_dump: error: aborting because of server version mismatch` (logged, self-healing next night) until the worker image carries an 18 client. `apps/worker/Dockerfile` installs `postgresql-client-18` from the PGDG repository for that purpose (switch the worker service to the Dockerfile builder, or run it wherever the worker is built). `PG_DUMP=/path/to/pg_dump` overrides the binary the job spawns.

**Restore drill.** Download a dump (e.g. `aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp "s3://$BACKUP_S3_BUCKET/massalia-2026-09-05.dump.gz" .`) and run `scripts/restore.sh massalia-2026-09-05.dump.gz "$SCRATCH_DATABASE_URL"`. It streams the archive through `pg_restore --clean --if-exists --no-owner --no-acl` into the given database (which must exist), asks you to type the database name first unless `--yes` is passed, and prints the largest tables' row counts afterwards. Drill against a scratch database; `pg_restore` must be at least the `pg_dump` major version.
