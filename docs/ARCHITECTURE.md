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

`nixpacks.toml` installs with pnpm, builds all packages, and starts `@massalia/server`.
