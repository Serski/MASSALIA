# MASSALIA

MASSALIA is a browser-based grand-strategy game scaffold: persistent seasonal worlds, timestamp-based progression, server-authoritative state, a data-driven event engine, and a layered Crusader Kings-style map.

The complete verified scaffold has been generated locally in this Codex workspace at:

`/Users/macbook/Documents/Codex/2026-06-01/github-plugin-github-openai-curated/work/MASSALIA`

## Included In The Local Scaffold

- pnpm TypeScript monorepo with packages under `@massalia/*`.
- Fastify API with SSE world-state stream and event routes.
- Vite React client with a framework-agnostic layered map system.
- `IMapRenderer` abstraction and Leaflet `CRS.Simple` implementation.
- `Layer` interface and layer manager for z-order, visibility, and modes.
- Drizzle PostgreSQL schema, migration, and seed for one world with 12 provinces.
- BullMQ worker pattern for scheduled building completion.
- Shared tick/lazy-accrual resource math with Vitest tests.
- Data-driven map content, labels, modes, traits, buildings, and example events.
- `docs/ARCHITECTURE.md` and `docs/MAP.md`.

## Quick Start

```bash
pnpm install
cp .env.example .env
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Required environment variables are documented in `.env.example`, including `DATABASE_URL` and `REDIS_URL`.

## Verification Run Locally

The local scaffold currently passes:

```bash
corepack pnpm -r test
corepack pnpm -r build
corepack pnpm -r lint
```

## Publish Note

The remote repository was initialized through the GitHub connector. A full source push from this environment is blocked because `/usr/bin/git` depends on missing Xcode Command Line Tools, `gh` is not installed, and Homebrew cannot install or build Git without those tools.
