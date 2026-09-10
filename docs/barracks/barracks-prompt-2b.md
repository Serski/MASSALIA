# MASSALIA — Barracks, prompt 2b: training and contract timers

Read `AGENTS.md` first. Pull `main`. Commit locally only. Do not push.

## What this changes

Training and contracts currently resolve at season boundaries, so a unit recruited an hour before the boundary is ready in an hour and one recruited just after waits a day. Both become durations from the moment of the action, stored as timestamps, and the tab shows a live countdown for each. Levy growth and the market stay on the season calendar; they are calendar events, not durations.

Rulings:
1. `trainSeasons` and `termSeasons` keep their names and values in content. One season of duration is `MS_PER_DAY`.
2. `ready_at = recruitedAt + trainSeasons × MS_PER_DAY`. `contract_end_at = hiredAt + termSeasons × MS_PER_DAY`.
3. A trained row is charged upkeep only for days after `ready_at`. A band is charged from hire.
4. `ready_at_season` and `contract_end_season` stop being written and read. They stay in the table (migrations are append-only).

## Phase 1: server

### Migration `packages/db/migrations/0054_barracks_timers.sql`

```sql
ALTER TABLE player_units ADD COLUMN IF NOT EXISTS ready_at timestamptz;
ALTER TABLE player_units ADD COLUMN IF NOT EXISTS contract_end_at timestamptz;
UPDATE player_units
   SET ready_at = created_at + (ready_at_season - recruited_season) * interval '1 day'
 WHERE source = 'trained' AND ready_at IS NULL AND ready_at_season IS NOT NULL;
UPDATE player_units
   SET contract_end_at = created_at + (contract_end_season - recruited_season) * interval '1 day'
 WHERE source = 'band' AND contract_end_at IS NULL AND contract_end_season IS NOT NULL;
```

Idempotent, one transaction, 0049-style header. Mirror both columns in Drizzle.

### `apps/server/src/services/barracks.ts`

- `isActive(row, now)`: trained → `row.readyAt !== null && now.getTime() >= row.readyAt.getTime()`. Band → true. Replace every `isActive(row, season)` call.
- `recruitUnits`: write `ready_at = new Date(now.getTime() + trainSeasons * MS_PER_DAY)`. Do not write `ready_at_season`.
- `hireBand`: write `contract_end_at = new Date(now.getTime() + termSeasons * MS_PER_DAY)`. Do not write `contract_end_season`.
- `disbandRow`: trained gate `now >= created_at + minServiceSeasons × MS_PER_DAY`; band gate `now >= created_at + termSeasons × MS_PER_DAY`.
- `settleBarracks`:
  - Per-row chargeable days. For a trained row, `rowDays = min(days, wholeDaysBetween(max(lastMs, readyAt), now))`, 0 if `readyAt > now`. For a band, `rowDays = days`. The `plan()` function multiplies each row's demand by its own `rowDays` instead of the global `days`. Band `drachmaeDirect` likewise per row.
  - Insolvency victim selection considers rows with `rowDays > 0` only.
  - Contract ends: rows where `contract_end_at <= now`. Loop: roll `seededRoll([rowId, String(contractEndAt.getTime())])`; under the renew chance, `contractEndAt += termSeasons × MS_PER_DAY` and roll again if still past; otherwise the band leaves. Write `contract_end_at` on renewal.
- The `BarracksSettle` result and `effect_log` details that carried season numbers carry ISO timestamps instead (`readyAt`, `contractEndAt`).

### `apps/server/src/routes/barracks.ts`

Payload changes:
- roster rows: replace `readyAtSeason` and `contractEndSeason` with `readyAt` and `contractEndAt` as ISO strings or null.
- top level: add `now` (server time, ISO) so countdowns are anchored to the server clock.
- everything else unchanged.

### Tests

Update `barracks.test.ts` (services and routes) to the timestamp model: readiness at `recruitedAt + trainSeasons days`, upkeep starting only after `ready_at`, a row that became ready mid-gap charged for the post-ready days only, contract end and renewal on `contract_end_at`, disband gates by elapsed time. All previous assertions keep their meaning.

Gates: `pnpm -r lint`, server tsc, server tests, db tests, web leak guard.

Commits: `barracks: ready_at and contract_end_at`, `barracks: timers in settle and routes`, `barracks: timer tests`.

**STOP 1.** Paste the new `isActive`, the per-row days block of `plan()`, and the contract-end loop. Report gates. Wait.

## Phase 2: client

`apps/web/src/api.ts`: update the types (`readyAt`, `contractEndAt`, `now`).

`apps/web/src/dashboard/panels/BarracksPanel.tsx`:
- Compute the clock offset once per payload: `offset = Date.parse(view.now) - Date.now()`, and derive every countdown from `Date.now() + offset` so a wrong device clock does not skew timers.
- Roster status, using `useCountdownSeconds` and `formatDuration` from `shared.tsx`:
  - trained, not ready: `Training · 22:14:07` (hours:minutes:seconds, days prefixed when over 24h)
  - trained, ready: `Ready`
  - band: `Contract · 1d 03:12:44`
- When any countdown reaches zero, refetch once (the settle on GET flips the row active or resolves the contract). Guard against refetch loops: one refetch per row per crossing.
- Training Ground rows: replace `Trains in N season(s)` with `Trains in 24h` / `48h` from `trainSeasons × 24`.
- Market rows: `Contract 48h`.
- Disband caption stays but reads from elapsed time; the server's `canDisband` remains authoritative.

Gates: `pnpm -r lint`, web tsc, web build, web tests.

Commit: `barracks: live training and contract countdowns`.

**STOP 2.** Report and wait. Do not push.

## Scope fence

Only the files named above. No content changes, no map, no other panels.

## Final report template

Same as prompt 2, plus a `MIGRATION` line confirming 0054 applied to the test DB and the existing production row's backfill expression checked by hand.
