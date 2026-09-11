# MASSALIA — Barracks, prompt 3c: towns, tribute, and moving men

Read `AGENTS.md` first. Pull `main`. Commit locally only. Do not push. Web changes ship only with a render test.

## What this prompt builds

Phase 0 fixes what the first conquest showed. Phase 1 and 2 make towns targets: attack, raid and scout them, take them, hold them for tribute, with walls and fleets defending. Phase 3 lets men move between the player's bases. Colonies and NPC counter-attacks are 3d.

Spec: `docs/barracks/barracks-spec-v1.md` sections 7, 9, 10. Where this prompt differs, this prompt wins.

## Facts from the map

Every neighbour of Salyes (R046) and of Massalia (R060) holds a town, so a player who has taken Salyes has nothing left to attack until towns are targets. Town garrisons in `content/map/town-military.json` run 30 to 30,000, median 180; region warbands 100 to 4,000, median 600. Towns are meant to be hard and the far end is meant never to fall. `apps/web/public/map2/townstats.json` carries public `population` and `walls` per town.

## Rulings

1. **Actions on a town target the town**, chosen on the map the way `mapActionButtons({ kind: "town" })` already does. The defender is the town's garrison with the `garrison` stat block from `battle.json`, plus a walls bonus. The region's warband does not join.
2. **Walls** add to every defending row's `def` inside the town: `+walls` capped by `town.wallsDefCap` (3). Report the walls level and the effective def in the battle report.
3. **A sea assault must beat the fleet first.** When the route is sea and the town's `pentekonters + triremes > 0`: attacker naval power `Σ ships × ships.json.naval`; defender `pentekonters × 1 + triremes × 5`. If the attacker's is lower, the landing is repulsed: no land battle, the force returns with recovery, `winner: "repulsed"`, no ship losses in v1. If higher or equal, the land battle follows; the town's fleet is unchanged.
4. **Taking a town** (defender broken): a holding on the town, garrison set to 0, survivors based at the town, the town's `owner` in play becomes the player. The region and its warband are untouched. Reversion after a day ungarrisoned, like conquests.
5. **Tribute.** A held town pays `tribute.perPopulation × population` drachmae a day (0.04: four a day per hundred people, no cap), credited closed-form on settle for the days the town was held and garrisoned at or above `tribute.minGarrisonPerPopulation × population` men (0.01: one man per hundred people, so Vienna needs 30 standing, Nemausus 40, Tolosa 80). Below that the town is still held but pays nothing for those days. A held region (townless) pays goods instead: `max(minGrain, grainPerWarband × baseWarband)` grain and `max(minTimber, timberPerWarband × baseWarband)` timber a day from `regionTribute`, using the region's content warband as its size (the ten unclaimed regions are all warband 100 and would otherwise pay 5 and 2), and raises the player's levy growth by `regionTribute.levyPerYear` men per year for each region held and garrisoned at the year boundary. Constants in `battle.json`; report the population distribution at STOP 1 so the town constants can be set.
6. **Raiding a town** pays `raid.townPlunderMultiplier` (2) times the region rate on kills.
7. **Garrisons regenerate** like warbands: `regen.garrisonPerDay` (5) toward the content value.
8. **Bases can be towns.** `player_units.based_at` may hold a town id. Reach resolves a town base to its region through `townRegion`. Garrison counts for a town holding count rows based at that town id.
9. **Home towns are never targets** (Massalia's own), as today.
10. **Move** is an action to any place the player may station men: Massalia's region, any home region or home town of Massalia's polity (Arelate, Antipolis, Nikaia, Olbia, Monoikos, Athinopolis and the rest of `homeRegions`), a held region, or a held town. Adjacent by land to the force's base, or by sea within range with hulls. No battle, mission `move`, travel takes 30 minutes a step by land or sea and 10 minutes within one region; arrival rebases the rows.
11. **Home ground as bases.** A home region or home town counts as a base for reach once the player has at least one active, non-moving row based there; Massalia's region always counts; holdings always count. Home ground is still never a target. Massalia's own places are shared friendly ground: any player may station men in them, and men there are never a garrison in the holdings sense (no reversion, no tribute, nothing to defend).

## Phase 0: fixes

- **Scout gated on the client** like Raid: disabled with the reason when `reach[region].raid` is not ok, on regions and on towns once Phase 2 lands.
- **Per-base reach in the payload.** `GET /api/map/reach` entries gain `byBase: { [baseId]: { landSteps, seaSteps } }`. The picker groups rows by base, evaluates the verdict per base with the shared rule, greys the rows of any base that cannot reach the target with the reason under the group heading, and selects only within one base (ticking a row in a second base clears the first, with a one-line note `A force marches from one base.`).
- **Upkeep with icons.** The summary strip's daily upkeep line shows each good's icon before its number, the way the inventory does; drachmae last with the coin.
- **Army in the Economy tab.** The inventory's Economy view lists the army under Expenses: one line per good drawn per day (`Army · grain −194/day` etc.) and `Army pay −130 dr`, sourced from the same server summary the panel reads (extend the economy payload server-side; no second fetch from the client).
- Render tests for the picker grouping and the economy lines.

Commit: `map: scout gating, per-base picker, army in the economy`.

**STOP 1.** Report, with the population and walls distributions from `townstats.json`. Wait.

## Phase 1: towns, server

### Migration `0057_town_holdings.sql`

```sql
ALTER TABLE player_holdings ADD COLUMN IF NOT EXISTS town_id text NOT NULL DEFAULT '';
ALTER TABLE player_holdings DROP CONSTRAINT IF EXISTS player_holdings_pkey;
ALTER TABLE player_holdings ADD PRIMARY KEY (world_id, region_id, town_id);
```
Idempotent, one transaction, header. `town_id = ''` is a region holding; otherwise the town slug. Drizzle mirrors it. Existing rows keep `''`.

### Content

`battle.json` gains:
```json
"town": { "wallsDefCap": 3 },
"tribute": { "perPopulation": 0.04, "minGarrisonPerPopulation": 0.01 },
"regionTribute": { "grainPerWarband": 0.05, "timberPerWarband": 0.025, "minGrain": 15, "minTimber": 8, "levyPerYear": 5 },
"raid": { "...": "existing", "townPlunderMultiplier": 2 },
"regen": { "warbandPerDay": 5, "garrisonPerDay": 5 },
"move": { "minutesPerStep": 30, "minutesWithinRegion": 10 }
```
The `tribute` constants are decided; report the distribution at STOP 1 for the record only. `townstats.json` is read server-side for `population` and `walls` through a small loader next to the names loader; it is public data already.

### Services

- `mapPools.ts`: `readTownGarrison` / `writeTownGarrison` with regeneration, mirroring the warband functions; `readTownFleet`.
- `holdings.ts`: town holdings (`town_id` set), `garrisonCount` by town id, reversion, `insertTownConquest(townId, previousOwner)`, and `settleTribute(exec, ctx, now)` called from `settleBarracks` after reversion: for each held, garrisoned holding, credit `wholeDays` since its `last_tribute_at` (add the column in the same migration: `last_tribute_at timestamptz NOT NULL DEFAULT now()`) of drachmae for a town or grain and timber for a region (relative, guarded stock writes), advance the marker, log `holding_tribute`, one Chronicle line per settle when anything was paid. Levy growth: `ensureLevy` applies `growthPerYear + regionTribute.levyPerYear × heldGarrisonedRegions` at each year boundary; a region only counts if it is garrisoned when the boundary is settled.
- `mapActions.ts`: `act` accepts `townId` as an alternative to `regionId`. Target checks: the town exists, not home-owned, not the player's own holding. Reach is the town's region. Route by sea triggers the fleet check (ruling 3). Defender rows: `[{ id: "garrison", label: "Town garrison", count, stats: garrison stats with def + min(walls, wallsDefCap) }]`. Scout writes `town_intel` with garrison, pentekonters, triremes. Raid plunder ×2. Attack win per ruling 4. Recovery, mission (`regionId` stays the region, add `townId`), effect_log and Chronicle as for regions, with the town's display name.
- `mapReach.ts`: bases may be town ids; `basesRegions` resolves them. Bases for reach are `massaliaRegion`, every holding, and every home region or home town where the player has an active, non-moving row (ruling 11). `homeRegions` stays the target exclusion set. The reach payload's `bases` list gains `kind: "home"` entries so the client can label them.
- Move action (rulings 10 and 11): `type: "move"`, target `baseId` (Massalia's region, a home region or home town, or a region or town the player holds); rows from one other base; adjacent by land, else sea with the hull and range checks; no battle; mission `move`; travel time is `move.minutesWithinRegion` when the origin and destination resolve to the same region (a town and its region, or two towns in one region), otherwise `steps × move.minutesPerStep` by land or by sea; `arrives_at = now + travel`; arrival rebases (already does) and merges. Campaign recovery (3 hours per step) does not apply to a move. `moveTargets` in the reach payload lists every place the player may move to with its per-base steps, so the client can light `SEND MEN HERE` without guessing.

### Tests

Towns: a scout writes town intel; a raid pays double; a sea assault with too weak a fleet is repulsed with no casualties and no garrison change; a land attack that breaks the garrison creates a town holding with survivors based at the town and the region warband untouched; walls raise the effective def in the report; town tribute accrues for whole days only while the garrison meets the population minimum and stops after reversion; a held region pays grain and timber and adds to the levy at the year boundary only while garrisoned; garrison regenerates toward base. Move: by land to an adjacent holding; by land from Massalia to Arelate (home) and then reach from Arelate lights Nemausus's region while the men stand there and goes dark once they leave; refused to a foreign region; by sea with insufficient hulls refused with the hull reason; arrival rebases and merges.

Gates: `pnpm -r lint`, server tsc, server, db, shared tests.

Commits: `holdings: town holdings and tribute`, `map: towns as targets`, `map: move between bases`, `map: town and move tests`.

**STOP 2.** Paste the town branch of `act` and the tribute settle. Wait.

## Phase 2: towns and move, client

- Town panels on the Atlas: Attack, Raid and Scout open the picker for the town; the intel block shows garrison and fleet from `town_intel`; walls and population from `townstats.json` are shown as `Walls 2 · Population 4,000`.
- Battle report for towns: the outcome line, the walls line (`Walls 2, garrison defends at 9`), the fleet line when the route was sea (`Your 3 pentekonters against 2 pentekonters and 1 trireme: the landing held` or `was driven off`), the rows table, plunder or conquest.
- Held towns render as the player's the way held regions do, with `Held by your house · tribute 120 dr a day` in the panel, or `Held by your house · garrison too small for tribute (30 men needed)` when under the minimum; held regions show `Held by your house · 15 grain, 8 timber a day · +5 levy a year`. The Barracks summary strip's COME OF AGE cell shows the total (`+15 each year` with two regions held).
- Move: selecting any place in `moveTargets` (Massalia's region, a home region or town, or one of the player's holdings) shows a `SEND MEN HERE` button in place of the attack row; it opens the picker with rows from the other bases, the per-base verdict for a move, and `Go`. The report is one line: `20 hoplites march from Massalia to Nikaia, arriving in 00:30:00.` Home places with the player's men show `Your men here: 20 hoplites` in the panel.
- Barracks Away rows for a move read `Marching to Salyes` with the MOVE tag (already supported).
- Barracks At Home rows gain a `MOVE` button beside `DISBAND`. It opens the same move picker as the map, with that row pre-ticked at its full count and a destination selector listing `moveTargets` (display names, the travel time next to each, unreachable ones greyed with the reason). Confirming runs the same `move` action and the same one-line report; the panel refetches. One picker component, mounted from two places; do not fork it.
- Render tests: the town panel with and without intel; the report sheet for a repulsed sea assault and a taken town; the move picker opened from the map and from a Barracks row.

Gates: `pnpm -r lint`, web tsc, web build, web tests, plus the server suite.

Commit: `map: towns and move on the Atlas`.

**STOP 3.** Report and wait. Do not push.

## Scope fence

`packages/db` (migration 0057 and schema), `content/military/battle.json`, `apps/server/src/services/{mapPools,holdings,mapActions,mapReach,barracks,mapNames}.ts` (+ a townstats loader), `routes/map.ts`, `routes/barracks.ts` only if the summary needs a field, the economy summary service the inventory reads, and their tests; `apps/web/src/api.ts`, `map/World2Map.tsx`, `map/World2Map.css`, `dashboard/panels/BarracksPanel.tsx`, the inventory Economy view, `dashboard.css`, and the web tests. No changes to `units.json`, `bands.json`, `ships.json`, the graph files, or `apps/web/public/**`.

## Final report template

As 3b, plus:
```
TOWNS
population: min / median / max; walls: distribution
tribute constants shipped: …
CHRONICLE
sample town lines: …
```
