# MASSALIA

MASSALIA is a browser-based grand-strategy game scaffold: persistent seasonal worlds, timestamp-based progression, server-authoritative state, a data-driven event engine, and a layered Crusader Kings-style map.

## Quick Start

```bash
pnpm install
cp .env.example .env
pnpm db:migrate
pnpm db:seed
pnpm dev
```

The web app runs from `apps/web`, the API from `apps/server`, and scheduled work from `apps/worker`.

## Architecture Guardrails

- TypeScript end-to-end with shared packages under `@massalia/*`.
- No real-time simulation loop. Actions store completion timestamps; resources accrue lazily on read.
- The server is authoritative for ownership, faction colors, map state, events, and outcomes.
- React is only the HUD and host for the map. Map behavior lives in framework-agnostic `.ts` modules.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/MAP.md](docs/MAP.md).
