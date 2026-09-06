# MASSALIA

MASSALIA is a browser strategy RPG set in Massalia, 300 BC: persistent seasonal worlds, timestamp-based progression, server-authoritative state, a data-driven event engine, and the hand-drawn world 2 map.

## Quick Start

```bash
pnpm install
cp .env.example .env
docker compose up -d
pnpm db:migrate
pnpm db:seed
pnpm dev:api
pnpm dev:web
```

The web app runs from `apps/web`, the API from `apps/server`, and scheduled work from `apps/worker`.

## Local Dev With Persistence

1. Start local services:

```bash
docker compose up -d
```

2. Copy environment variables and adjust if needed:

```bash
cp .env.example .env
```

3. Run migrations and seed the active Massalia world, Houses, professions, and profession ladders:

```bash
pnpm db:migrate
pnpm db:seed
```

4. Run the API and web app in separate terminals:

```bash
pnpm dev:api
pnpm dev:web
```

The default local API is `http://localhost:3001`; the web client uses `VITE_API_URL` and sends credentialed requests. Sessions are cookie-only: the API sets a signed `httpOnly` `SameSite=Lax` cookie (`Secure` when `WEB_ORIGIN` is https, 30 days). In production `playmassalia.com` and `api.playmassalia.com` are same-site, so the cookie flows everywhere; for local HTTP development it is simply not `Secure`.

## Architecture Guardrails

- TypeScript end-to-end with shared packages under `@massalia/*`.
- No real-time simulation loop. Actions store completion timestamps; resources accrue lazily on read.
- The server is authoritative for ownership, faction colors, map state, events, and outcomes.
- React is only the HUD and host for the map. Map behavior lives in framework-agnostic `.ts` modules.

See [AGENTS.md](AGENTS.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/MAP.md](docs/MAP.md).
