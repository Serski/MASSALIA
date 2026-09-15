# MASSALIA — World 2 launch, prompt 1: the Beta trait and the launch script

Read `AGENTS.md` first. Pull `main` (baseline `8da41e5`). Commit locally only. Do not push. Web changes ship only with a render test.

## What this prompt builds

The switch from World 1 (the beta, "Massalia Season One") to World 2, done as a status flip and an insert, never a truncation: World 1 becomes `ended`, a new world row becomes `active`, and every user goes through character creation again because characters are per world. Two things are new: a permanent **Beta** trait for everyone who created a character in World 1, and a guarded `world:launch` script that performs the flip in one transaction. The Hall of Fame board for ended worlds is a later prompt; nothing here touches World 1's data.

Save this prompt as `docs/worlds/world2-launch-prompt-1.md` in the first commit.

## Facts from the repo (Phase 0 confirms; stop only on contradiction)

- `worlds` (`packages/db/src/schema.ts:7`): id, name, seed, started_at, ends_at, status `announced | active | ended`, tagline. `getActiveWorldId()` (`services/character.ts:44`) takes the first active row with `limit(1)`, so exactly one world may be active at any instant.
- `hasCharacter` (`routes/auth.ts:81`) is scoped to the active world, so after the flip every logged-in user gets `hasCharacter: false`, lands in the Lobby and creates a character for the new world through `/create`. Player names are unique per world (0050), so World 1 names are free again.
- A `player_characters` row is born only in `createCharacterRow` (`services/character.ts`), called from `ensureCharacterRow`, `routes/character.ts:44` and `routes/characters.ts:209`. The row is reused across generations and heirs inherit traits, so a trait granted at birth of the row carries down the dynasty.
- Traits: `content/traits/traits.json` (84 entries, shape `{ id, name, category, description, statMod }`, e.g. `megas-choregos`, category `reputation`); `character_traits` is unique on (character_id, trait_id); grants use `exec.insert(characterTraits).values(...).onConflictDoNothing()` as in `services/composure.ts:133`.
- Per-world state is created lazily on first read (treasuries, party leaders, region warbands, Olympiad) except the chamber seats (`ensureChamberSeats`, called only by `packages/db/src/seed.ts` `seedChamber`) and the military pools (`ensureMilitaryPools` in `services/mapMilitary.ts`, run once at server boot; `ensureTownMilitary` / `ensureRegionMilitary` live in `packages/db/src/military.ts`).
- `users` (`schema.ts:17`): email, password_hash, newsletter_opt_in, created_at, email_verified_at, deleted_at, is_admin, banned_at, ban_reason. `GET /api/lobby` (`routes/lobby.ts`) already returns `worldsPlayed` and the office history across worlds; the client shows `record.worldsPlayed` at `lobby/LobbyPage.tsx:254`.
- Production writes run as guarded scripts through `railway run --service Postgres --environment production` with `DATABASE_PUBLIC_URL`: BEFORE selects, one transaction with row-count checks, AFTER selects. `scripts/make-admin.ts` is the shape.
- The calendar stays at `START_YEAR_BC = 300` (`packages/shared/src/calendar.ts:14`). Do not touch it.

## Rulings

1. **Beta trait.** Content id `beta`, name `Beta`, category `reputation`, `statMod: { "prestige": 1 }`, description `Stood in the agora before the walls were finished.` One entry in `traits.json`, validated by the existing schema.
2. **Who has it.** Every user who created a character in World 1: any `players` row in that world, active or not. The launch script stamps `users.beta_at` (migration 0059, nullable timestamptz) for them, once.
3. **Where it is granted.** In `createCharacterRow`, on the same executor, right after the row is inserted: if the player's user has `beta_at`, insert the trait. Every world from now on, every caller, no client involvement. Nothing about class, house, name or face is prefilled or carried over.
4. **The Lobby record** shows one line for a user with `beta_at`: `Beta citizen · World 1`. Server: `beta: boolean` on the lobby user payload. Client: the line under the record's existing rows.
5. **`world:launch`** is a script, not an admin route: `pnpm --filter @massalia/db world:launch --name "<name>" --tagline "<tagline>" [--start <ISO instant>] [--days 182] [--dry-run]`. It refuses to run unless exactly one world is active. BEFORE: the active world's id, name, started_at, its player count, the count of users without `beta_at` who have a player there. In one transaction: the active world to `ended` with `ends_at = now`; insert the new world (`status: active`, `seed` from the name, `started_at` = `--start` or now, `ends_at` = started_at + days); `ensureChamberSeats` for the new world with `politics.chamber` the way `seedChamber` does; `ensureTownMilitary` and `ensureRegionMilitary` for the new world; stamp `beta_at = now()` on every user with a `players` row in the old world where `beta_at IS NULL`. Check every row count and roll back on any surprise. AFTER: both world rows, the seat count, the pool counts, the number of users stamped. `--dry-run` prints BEFORE and the plan and writes nothing. No demo users, no catalog writes: houses and professions already exist.
6. **The start instant** is the season boundary for the whole round (`gameDate` floors whole days from `started_at`), so `--start` is the lever for where the daily rollover lands; the script does not decide this, the operator does.

## Phase 0: recon

Confirm the facts above. Then read every worker sweep in `apps/worker/src/index.ts` and the services they call and report whether each resolves the active world per run or holds a world id from boot; the same for the server's boot-time loads. Report which processes need a restart after the flip (the answer is at least the server, for `ensureMilitaryPools`; say whether the script's own pool seeding makes that unnecessary). Report any code path that assumes the active world's id never changes (a cached world id, a `MAP_WORLD_ID`-style constant used for game reads). **STOP 0 only on a contradiction or a path that would break at the flip.**

## Phase 1: trait and stamp

- Migration `packages/db/migrations/0059_users_beta_at.sql`: `ALTER TABLE users ADD COLUMN IF NOT EXISTS beta_at timestamptz;` plus the schema line.
- The `beta` entry in `traits.json`.
- The grant in `createCharacterRow`, one query joining `players` to `users` on the executor it was given.
- Lobby: `beta` on the user payload; the record line.
- Tests: shared, the trait parses and the stat mod applies through whatever path reads `statMod`; server DB-gated, a user with `beta_at` gets the trait on `createCharacterRow` through all three callers and a user without does not, the trait survives a second `ensureCharacterRow`, and the lobby payload carries `beta`; web render test for the record line present and absent.

Gates: `pnpm -r lint`, server and web tsc, web build, shared, db, server and web suites against a migrated `massalia_test`.

Commits: `db: users.beta_at`, `traits: the Beta trait`, `character: grant Beta at creation`, `lobby: beta line on the record`.

## Phase 2: the launch script

`packages/db/scripts/world-launch.ts`, `world:launch` in `packages/db/package.json`, exactly as ruled in 5 and 6. DB-gated test: seed a world with three users (two with players, one without), run the script's core function against it, assert the old world ended, the new world active with seats and pools, two users stamped, the third not, a second run refused (two worlds are never active) and `--dry-run` writing nothing. The script must be runnable from the repo root through `railway run` with only `DATABASE_URL` in the environment.

Gates: as Phase 1.

Commit: `db: world:launch script`.

**STOP 1.** Final report. Wait. Do not push.

## Scope fence

`packages/db/migrations/0059_users_beta_at.sql`, `packages/db/src/schema.ts`, `packages/db/scripts/world-launch.ts`, `packages/db/package.json`, `content/traits/traits.json`, `apps/server/src/services/character.ts`, `apps/server/src/routes/lobby.ts`, `apps/web/src/api.ts`, `apps/web/src/lobby/LobbyPage.tsx`, their tests, `docs/worlds/world2-launch-prompt-1.md`. No changes to the calendar, `seed.ts`, the worker, the market, the map, or any World 1 row. No admin route, no Hall of Fame, no announce state.

## Final report template

```
RECON
sweeps: <name> resolves active world per run | holds id from boot, for each
restart needed after the flip: server yes/no (why), worker yes/no (why)
paths that assume a fixed world id: none | <file:line>
LAUNCH
dry-run output from massalia_test
Committed: <SHA> per commit, in order
```
