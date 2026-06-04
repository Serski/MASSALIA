# MASSALIA

MASSALIA is a browser-based grand-strategy game scaffold: persistent seasonal worlds, timestamp-based progression, server-authoritative state, a data-driven event engine, and a layered Crusader Kings-style map.

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

The default local API is `http://localhost:3001`; the web client uses `VITE_API_URL` and sends credentialed requests. For HTTPS production origins such as GitHub Pages to Railway, the API uses a `SameSite=None; Secure; httpOnly` signed cookie. For local HTTP development, cookies cannot use `Secure`, so the server relaxes the cookie to `SameSite=Lax` and `secure=false`.

## Architecture Guardrails

- TypeScript end-to-end with shared packages under `@massalia/*`.
- No real-time simulation loop. Actions store completion timestamps; resources accrue lazily on read.
- The server is authoritative for ownership, faction colors, map state, events, and outcomes.
- React is only the HUD and host for the map. Map behavior lives in framework-agnostic `.ts` modules.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/MAP.md](docs/MAP.md).
