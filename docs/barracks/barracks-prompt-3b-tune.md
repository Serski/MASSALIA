# MASSALIA — Barracks, prompt 3b-tune: plunder, recovery, winter, picker, plurals, icons, partial forces

Read `AGENTS.md` first. Pull `main`. Commit locally only. Do not push. One phase, one stop.

## Changes

### 1. Plunder

`content/military/battle.json`: `raid.plunderPerKill` 3 → 20, `raid.grainPerKill` 1 → 5. Update the test that asserts plunder amounts.

### 2. Recovery is hours, not days

`battle.json` gains `"recovery": { "hoursPerStep": 3 }`. In `mapActions.ts` the recovery after any action (scout, raid, attack) becomes `arrives_at = now + max(1, steps) × hoursPerStep × 3_600_000`. The report's `recoveryDays` field becomes `recoveryHours`; the client's "The party returns in …" line reads from it. Conquest keeps dating `last_garrisoned_at` at `arrives_at`. Update tests.

### 3. Winter closes campaigns

- `packages/shared`: `campaignSeason(nowMs, worldStartedMs)` returning `{ season, open: boolean, opensAtMs: number | null }`, using the existing `seasonAt`; `open` is false when the season is winter, and `opensAtMs` is the instant the next season starts. Put it next to `seasonAt` and test the boundary on both sides.
- Server: `act` refuses scout, raid and attack in winter with 409 `The passes are closed until spring.` before any other check. `GET /api/map/reach` and the act response gain `campaign: { season, open, opensAt }` (ISO or null).
- Client: when `campaign.open` is false, the Attack, Raid and Scout buttons are disabled with the title `The passes are closed until spring. Opens in {countdown}` and the same line as the touch caption, using the existing countdown hook against `opensAt` with the clock offset the barracks panel uses. Colonise keeps 3a's behaviour. The picker does not open in winter.
- Training, contracts, recovery, levy growth, regeneration and reversion are unaffected by winter.

### 4. Picker hides rows still training

In the force picker, rows with `readyAt` in the future are not listed at all. Rows recovering (`movingTo` set) stay listed, greyed, with their countdown as now.

### 5. Unit plurals

`content/military/units.json` gains a `plural` per unit: `"Peltasts"`, `"Ekdromoi"`, `"Hoplites"`, `"Hippeis"`. The parser requires it. `renderCampaignLine` and `describeForce` use `plural` for trained units when the count is not 1 and `label` when it is, lowercased in running text as now; bands keep their label, which is already plural. The stored chronicle payloads re-render through the same function, so past lines correct themselves. Update the wording tests and the sample lines.

### 6. Icons in the picker and the report

The barracks roster payload already carries `icon`. The picker row shows it the way the Barracks roster does (`AssetIcon`, same size, emoji fallback), and the battle report's rows table shows it in the first column. The defender row keeps no icon.

### 7. Partial forces for trained rows

The picker lets the player choose how many men from each trained row march: a count input next to the checkbox, default the full row, min 1, max the row's count. Band rows have no input; a band marches whole under its contract (caption: `A band marches as one.`).

Server, `POST /api/map/act` body becomes `{ type, regionId, rows: [{ rowId, count }] }`:
- Validate each `count` is an integer in `1..row.count`; a band row must be sent at its full count, else 409 `A band marches as one.`
- For a trained row sent at less than its full count, split under the lock before anything else: insert a new `player_units` row copying `unit_id`, `source`, `based_at`, `recruited_season`, `ready_at`, `created_at` with `count = start_count = sent`, and reduce the original by `sent`. The new row is the one that fights and recovers; the original stays home, unchanged.
- Reach, ships and the battle use the sent rows and counts.
- Merge on return: in the arrival step of `settleBarracks` (rows whose `arrives_at` has passed), a trained row arriving at a base merges into an existing trained row at that base with the same `unit_id` that is ready and not moving, if one exists: add counts, keep the larger `start_count` sum, keep the later `created_at` (so the disband gate stays conservative), delete the arriving row. Bands never merge. A row arriving at a base where no such row exists just lands.
- The report's rows show the sent count as `start`.

Client: the picker's verdict box and space count use the chosen counts. `api.mapAct` sends the new body.

Tests: split creates a fighting row and leaves the original untouched; a band at partial count is refused; two same-unit trained rows merge on arrival with the conservative `created_at`; a returning row lands alone when nothing matches.

## Gates

`pnpm -r lint`, server tsc, web tsc, web build, shared, server, db and web tests.

Commits: `battle: plunder and recovery tuning`, `map: winter closes campaigns`, `map: picker hides training rows; unit plurals`, `map: icons and partial forces`.

**STOP.** Report with the new sample chronicle lines and the winter boundary test output. Do not push.

## Scope fence

`content/military/battle.json`, `content/military/units.json`, `packages/shared/src/barracks.ts`, `buildings.ts` (or wherever `seasonAt` lives), `chronicle.ts` and their tests; `apps/server/src/services/mapActions.ts`, `mapReach.ts`, `routes/map.ts` and their tests; `apps/web/src/api.ts`, `map/World2Map.tsx`, `map/World2Map.css`; and for section 7 only, `apps/server/src/services/barracks.ts` (the arrival merge) and its tests. Nothing else, no migration.
