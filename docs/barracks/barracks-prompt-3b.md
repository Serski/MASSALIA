# MASSALIA — Barracks, prompt 3b: the battle (Scout, Raid, Attack on townless regions)

Read `AGENTS.md` first. Pull `main`. Commit locally only. Do not push.

## What this prompt builds

The first map actions that resolve: Scout, Raid and Attack against townless regions not owned by Massalia. A pure, deterministic battle resolver in shared with a calibration harness; NPC defender stat blocks; lazy regeneration of region warbands; conquest holdings with the reversion rule; a recovery period after every action; the `POST /api/map/act` endpoint; a force picker and battle report on the Atlas. Towns, colonies, relocation and NPC counter-attacks are 3c.

Spec: `docs/barracks/barracks-spec-v1.md` sections 7, 9, 10. Where this prompt differs, this prompt wins.

## Rulings

1. **Targets in 3b are townless regions only** (`graph.json` `towns` empty), not home-owned, not fog. Towns return 409 `Towns are for a later season.` from the endpoint; the client leaves their buttons as 3a rendered them.
2. **Resolution is immediate.** The battle resolves in the request. The rhythm comes from recovery: every row that took part gets `moving_to` and `arrives_at = now + recoveryDays × MS_PER_DAY` (`recoveryDays = max(1, steps)`, land steps or sea steps as used to reach the target). While moving a row is excluded from `force`, from reach, and from garrison counts, and cannot be selected again. Upkeep is still charged. Destination: the origin base after a Raid, a Scout, or a lost Attack; the conquered region after a won Attack.
3. **Whole rows only.** A force is a set of roster rows; no splitting counts. A row must be active, not moving, and based at a base from which the target is reachable for this force under `computeReach` run with exactly the selected rows.
4. **Ships are taken automatically** for sea routes: enough `trade-ship` first, then `galley` if space is still short, and the resulting fleet's `min(range)` must cover `seaSteps`. Ships are not lost or moved in 3b.
5. **NPC pools change.** A region's `warband` is reduced by its casualties and regenerates lazily toward its content value (see 2b). The boot seam's ON CONFLICT DO NOTHING already preserves live pools.
6. **Conquest.** A won Attack inserts a `player_holdings` row (`kind = 'conquest'`, `previous_owner` = the content owner from `region-military.json`), sets the region's `warband` to 0, and rebases the surviving force there. A holding whose garrison is empty (no active, non-moving rows based there) for a full day reverts: the row is deleted and the warband restored to its content value. Reversion and `last_garrisoned_at` are maintained in `settleBarracks` and checked again in the reach and act handlers.
7. **Casualties.** Attacker losses are distributed across rows proportional to headcount, stochastic rounding on the battle seed. Trained deaths do not return to the levy. A row at 0 is deleted. Losses are logged per row.
8. **Scout** needs at least one selected row with `spd >= 6`, costs no casualties, resolves with no battle, writes the requester's dynasty `region_intel` snapshot (`warband` after regeneration, `scoutedGameDate` from the calendar helper the existing `/military` route reads), and triggers recovery like any action.
9. **No feature flag.** Same footing as the barracks: live on deploy.
10. Every action writes `effect_log` rows on the acting character and a Chronicle line.

## Phase 1: resolver and calibration

### 1a. `content/military/battle.json`

```json
{
  "version": 1,
  "source": "server-side military content; never copy into apps/web/public",
  "rounds": 3,
  "lethality": 0.15,
  "defenseFloor": 4,
  "moraleStep": 0.05,
  "pursuitLoss": 0.10,
  "raid": { "rounds": 1, "plunderPerKill": 3, "grainPerKill": 1 },
  "regen": { "warbandPerDay": 5 },
  "npc": {
    "warband":  { "label": "Tribal warband", "stats": { "atk": 5, "def": 3, "msl": 1, "mor": 4, "spd": 6, "space": 1 } },
    "garrison": { "label": "Town garrison",  "stats": { "atk": 6, "def": 7, "msl": 1, "mor": 6, "spd": 3, "space": 1 } }
  }
}
```
Parser `parseBattleContent` in `packages/shared/src/barracks.ts`, strict. Loaded with the other barracks content.

### 1b. `packages/shared/src/battle.ts`

```ts
export type BattleRow = { id: string; label: string; count: number; stats: UnitStats };
export type BattleInput = { attacker: BattleRow[]; defender: BattleRow[]; seed: string; config: BattleConfig; mode: "attack" | "raid" };
export type BattleSide = { rows: { id: string; label: string; start: number; end: number; broke: boolean }[]; losses: number; broke: boolean };
export type BattleResult = { winner: "attacker" | "defender" | "stand"; rounds: BattleRound[]; attacker: BattleSide; defender: BattleSide };
export function resolveBattle(input: BattleInput): BattleResult;
```

Rules, implemented exactly:

- Only rows with `count > 0` and not broken take part in a phase. Side power for a stat is `Σ count × stat` over participating rows. A side's `avgDef` is headcount-weighted over participating rows.
- **Missile phase**, round 1 only, both sides simultaneously: casualties inflicted on the other side = `Σ(count × msl) × lethality / (targetAvgDef + defenseFloor)`.
- **Melee phase**, every round, both sides simultaneously, same formula with `atk`.
- Casualties are fractional until applied; apply per side by distributing across participating rows proportional to headcount and rounding each row's share with `seededRoll([seed, round, phase, side, rowId]) < fraction` for the fractional part. Never below 0, never above the row's count.
- **Morale**, after each round: a row breaks when `(start − count) / start > mor × moraleStep`. Broken rows leave the fight. A broken row suffers pursuit if the enemy's headcount-weighted `spd` exceeds its own: extra losses `count × pursuitLoss`, rounded the same way.
- A side is broken when it has no participating rows left.
- **Attack** runs `rounds` rounds or until a side is broken. Winner: the side still standing. Both standing after the last round: `"stand"` (the attacker withdraws; the defender holds).
- **Raid** runs `raid.rounds` rounds. Attacker wins if it has not broken and inflicted more losses (as a share of starting headcount) than it took; otherwise the defender wins. `"stand"` does not occur in raid mode.
- Fully deterministic for a given input. No `Math.random`.

### 1c. Calibration harness

`packages/shared/scripts/battle-calibration.ts` (runnable with `tsx`), printing one table with the canonical matchups below, each run against the real content: attacker rows, defender, mode, winner, attacker losses / start, defender losses / start, rounds fought.

1. 20 hoplites vs 40 warband, attack
2. 30 hoplites vs 40 warband, attack
3. 20 peltasts vs 40 warband, raid
4. 20 peltasts vs 40 warband, attack
5. 20 hippeis vs 40 warband, attack
6. 40 Volcae irregulars (band) vs 40 warband, attack
7. 20 Spartan hoplites (band) vs 80 warband, attack
8. 10 hoplites + 20 peltasts + 20 Balearic slingers vs 60 warband, attack
9. 20 hoplites vs 100 warband, attack
10. 20 hoplites vs 100 garrison, attack

Also print the same ten with the seed changed, to show how much the stochastic rounding moves results.

Test `packages/shared/src/battle.test.ts`: determinism (same input twice is identical); a side with no rows loses; morale break at the boundary; pursuit applies only when the enemy is faster; raid never returns `"stand"`; matchup 2 is an attacker win and matchup 9 is a defender win with the shipped constants.

Commit: `battle: resolver, content, calibration harness`.

**STOP 1.** Paste `resolveBattle` in full and the calibration table (both seeds). Wait for the constants to be confirmed or changed before Phase 2.

## Phase 2: server

### 2a. Region pools

`apps/server/src/services/mapPools.ts`:
- `regionBaseWarband(regionId)` from `content/map/region-military.json`.
- `readRegionWarband(exec, worldId, regionId, now)`: read the row, apply lazy regeneration `min(base, warband + floor(days since updated_at) × regen.warbandPerDay)` when the stored value is below base, persist the regenerated value with `updated_at = now`, return it. Closed-form; no tick.
- `writeRegionWarband(exec, worldId, regionId, value, now)`.
Home-owned regions are never read through this path.

### 2b. Holdings

`apps/server/src/services/holdings.ts`:
- `listHoldings(exec, ctx)`.
- `garrisonCount(exec, ctx, regionId, now)`: active, non-moving rows based there.
- `settleHoldings(exec, ctx, now)`: for each holding, if `garrisonCount > 0` set `last_garrisoned_at = now`; else if `now − last_garrisoned_at >= MS_PER_DAY` delete it, restore the region's `warband` to base, log `holding_reverted`, Chronicle line. Called from `settleBarracks` after the arrival step so a returning garrison is counted first.
- `insertConquest(exec, ctx, regionId, previousOwner, now)`.

### 2c. Actions

`apps/server/src/services/mapActions.ts`, one exported `act(ctx, input, now)` with `input = { type: "scout" | "raid" | "attack"; regionId: string; rowIds: string[] }`. Under the player lock, after `settleAll`:

1. Target: land, not fog, `towns` empty, not home-owned, not the player's own holding (409 `You hold this land.`), else 409 with the ruling-1 message for towns.
2. Rows: all belong to the player, active, `moving_to` null, all based at the same base (409 `A force marches from one base.`), at least one row. Scout additionally needs a row with `spd >= 6`.
3. Reach: `computeReach` with exactly these rows as the force, the full stock as the fleet, bases = R060 + holdings. The target's verdict for the action type must be ok, else 409 with its reason. Determine the route: land if `landSteps` satisfies the action, else sea with `seaSteps`. Steps = the one used.
4. Ships (sea route): take `ceil(forceSpace / troopSpace)` trade-ships if stock allows; if space is still short, add galleys; if the assembled fleet's `min(range) < seaSteps` or space is still short, 409 with the reach reason. Stock is not debited.
5. Defender: `readRegionWarband` → one `BattleRow` `{ id: "warband", count, stats: npc.warband.stats }`.
6. Scout: write `region_intel` for the dynasty (upsert), no battle.
7. Raid / Attack: `resolveBattle` with `seed = sha256(worldId, playerId, regionId, now.toISOString())`. Apply attacker losses per row (delete rows at 0, `effect_log` `battle_loss` per row), write the region's remaining warband.
   - Raid, attacker wins: plunder `defenderLosses × plunderPerKill` drachmae and `defenderLosses × grainPerKill` grain into the player's stock (relative, guarded). Loses: nothing.
   - Attack, attacker wins (defender broken): `insertConquest`, warband to 0, surviving rows `based_at = regionId`, recovery destination = `regionId`. `"stand"` or defender wins: survivors return.
8. Recovery: participating rows get `moving_to = destination`, `arrives_at = now + max(1, steps) × MS_PER_DAY`.
9. `effect_log` `map_action` on the character with the full report in `detail` (type, region, route, steps, ships used, rounds, per-row start/end, plunder, conquest). One Chronicle line: e.g. `Raided R046 with 20 peltasts: 6 tribesmen slain, 2 of ours lost, 18 drachmae of plunder.` — use the region's display name from `apps/web/public/map2/names2.json` if the server can read it; otherwise the id, and say so.
10. Return `{ report, reach, force, fleet, roster }` where `reach` is the fresh `computeReach` payload and `roster` the barracks roster payload, so the client re-renders from one response.

Route: `POST /api/map/act` in `routes/map.ts`, body `{ type, regionId, rowIds }`, auth as `/reach`, errors `reply.code(n) + { error }` like the rest of the file.

### 2d. Tests

`apps/server/src/services/mapActions.test.ts` (DB-gated): scout writes intel and needs a fast row; raid win credits plunder and reduces the warband; attack win creates a holding, rebases survivors, zeroes the warband; attack against a stronger warband returns survivors home and creates no holding; a moving row cannot be selected; rows from two bases are refused; a sea target without enough hulls is refused with the hull reason; regeneration restores 5 per day up to base; an empty holding reverts after a day and the warband comes back; a town target is refused with the ruling-1 message.

`routes/map.test.ts`: inject one raid happy path and one 409.

Gates: `pnpm -r lint`, server tsc, shared, server, db tests, web leak guard.

Commits: `map: region pools and holdings`, `map: scout, raid, attack`, `map: action tests`.

**STOP 2.** Paste `act` in full and the Chronicle lines produced by the test suite. Wait.

## Phase 3: client

- `api.ts`: `api.mapAct(type, regionId, rowIds)` and the report types.
- Force picker: tapping Attack, Raid or Scout on a legal townless region opens a sheet listing the player's active, non-moving rows grouped by base (icon, label, count, stats line), with checkboxes. Under the list, live and client-side, using `computeReach` from `@massalia/shared` with the selected rows and the fleet from the last reach payload: the verdict for this action on this target, the route and steps it would use, the force space against hulls when the route is sea, and a `Go` button enabled only when the verdict is ok. Rows still recovering are listed greyed with their countdown. Whole rows only; no count inputs.
- Battle report: on success, a sheet with the outcome line, a per-row table of start and end for both sides, plunder or conquest, and the recovery time. Close returns to the map with reach and the region's display refreshed from the response. For Scout, the report is the intel line.
- After any action the Atlas refreshes reach from the response; the Barracks tab picks up the roster on its next open.
- Conquered regions render on the map with the player's own marker where the region owner is shown, if the map already has a per-region owner rendering path; if not, leave rendering to 3c and say so.

Gates: `pnpm -r lint`, web tsc, web build, web tests.

Commit: `map: force picker and battle report`.

**STOP 3.** Report and wait. Do not push.

## Scope fence

Do not modify: `apps/web/public/**`, `services/mapWar.ts`, the `/state/:provinceId` route, `map_*` tables, `MAP_MUTATIONS_ENABLED`, `merc.*`, `content/people/**`, `content/buildings/**`, existing migrations, `units.json`, `bands.json`, `ships.json`, `graph.json`, `coast-links.json`. `settleBarracks` gains the holdings step. `routes/map.ts` gains one route. No new migration is expected; if one is needed, stop and say why before writing it.

## Final report template

As prompt 3a, plus:
```
CALIBRATION
constants shipped: …
matchups changed from the STOP 1 table: … (or none)
CHRONICLE
sample lines: …
```
