# Worker image with a PostgreSQL 18 client for the nightly backup (jobs/backup.ts).
# Railway's Postgres runs 18 and pg_dump refuses to dump a server newer than itself,
# so the client must come from the PGDG apt repository rather than the distro's.
# Build from the repo root:  docker build -f apps/worker/Dockerfile .
# On Railway: set the worker service's builder to Dockerfile with this path.
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-18 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile && pnpm build

CMD ["pnpm", "--filter", "@massalia/worker", "start"]
