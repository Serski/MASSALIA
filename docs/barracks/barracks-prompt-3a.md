# MASSALIA — Barracks, prompt 3a: topology, ships, holdings, reach

Read `AGENTS.md` first. Pull `main`. Commit locally only. Do not push.

## What this prompt builds

The ground under the map actions: the land-and-sea graph the server can walk, ship stats, the holdings table and unit basing, a pure reach library, a `GET /api/map/reach` endpoint, and the map's Attack, Raid and Colonise buttons gating on real reach with a reason. No combat, no action resolves. That is 3b (battle resolver, Raid and Attack on townless regions) and 3c (colonies, towns, relocation, garrison defence).

Spec: `docs/barracks/barracks-spec-v1.md`, sections 8, 9 and 11. Where this prompt differs from the spec, this prompt wins.

## What I found in the repo, and the rulings that follow

1. **No server-side map actions exist.** `packages/shared/src/mapActions.ts` is the legality matrix, `apps/web/src/map/mapActions.ts` renders buttons from it, and nothing on the server receives an action. The `map_*` tables, `MAP_WORLD_ID = "season-1"`, `routes/map.ts` `/state/:provinceId` and `services/mapWar.ts` are the older polity-level conquest seam. Leave all of that alone. The player military system lives on the World 2 ids: regions `R001..R175`, town slugs, `town_military`, `region_military`, `worlds.id` uuids.
2. **The World 2 graph has no land-to-sea links.** In `apps/web/public/map2/world2.json` land provinces neighbour only land and sea only sea; `coastal` is a flag. Sea reach needs those links, and they are derivable from shared polygon vertices (see Phase 1). Four flagged-coastal provinces do not resolve by vertices: `R057`, `R109`, `R114` (Lixus), `R137`. `R174` and `R175` are `fog` and are never reachable.
3. **Players own no pentekonters or triremes.** Their ships are the `trade-ship` and `galley` goods (Shipbuilder craft, `content/buildings/buildings.json`). Ruling: `trade-ship` is the pentekonter role and `galley` the trireme role. No new goods. A fleet is drawn from the player's stock when a force embarks and is back in Massalia when the action resolves; ships are never based anywhere else. Spec section 9's ship `basedAt` is dropped.
4. **Massalia is never a target.** `R060` (the town `massalia`) and anything owned by `HOME_POLITY_ID` stay illegal, as `allowedMapActions` already says. No player holding inside Massalia's own regions.
5. **Bases.** A player's bases are `R060` plus every row in `player_holdings` they own. Nothing in this prompt creates holdings; the table and the reach logic are built so 3b and 3c can.
6. Reach rules, from the spec: land Attack 1 step from a base; land Raid 2 steps if every row in the force has `spd >= 6`, else 1; sea targets are coastal land regions linked to a sea province within fleet range of a base's sea; fleet range is the lowest range of any ship type present; the force's space (`Σ count × space`) must fit `Σ troopSpace` of the ships taken. For this prompt the force is the whole active roster and the fleet is the whole stock; force selection arrives in 3b.

## Phase 1: topology

### 1a. Derivation script

`packages/db/scripts/derive-map-graph.ts` (runnable with `tsx`, wired as `pnpm --filter @massalia/db map:graph`). It reads `apps/web/public/map2/world2.json` and writes two files under `content/map/`:

`content/map/graph.json`
```json
{
  "version": 1,
  "source": "derived from apps/web/public/map2/world2.json by packages/db/scripts/derive-map-graph.ts; do not hand-edit provinces",
  "massaliaRegion": "R060",
  "provinces": {
    "R060": { "type": "land", "coastal": true, "neighbors": ["R046", "R047", "R052", "R059"], "towns": ["massalia"] }
  }
}
```
One entry per province in `world2.json`, all 175, with `type`, `coastal`, `neighbors` and `towns` copied verbatim. No paths, no pixels.

`content/map/coast-links.json`
```json
{
  "version": 1,
  "source": "derived by packages/db/scripts/derive-map-graph.ts; the manual block is hand-maintained",
  "derived": { "R060": ["R150"] },
  "manual": {}
}
```
`derived` maps each land province to the sea provinces it borders. Method: parse every `M`/`L` vertex of every province path, round to one decimal, and call a land and a sea province linked when they share at least 2 vertices. Then a tolerance pass for coastal-flagged land provinces that got nothing: link to a sea province if any land vertex is within 1.5 px of any of its vertices. Print, at the end, every coastal-flagged province still without a link and every non-coastal province that got one (the second list must be empty; if not, stop and report).

Do not modify `world2.json`.

### 1b. Loader and validation

`packages/shared/src/mapGraph.ts`: `parseMapGraph`, `parseCoastLinks`, types, and a `buildTopology(graph, links)` that returns `{ land: Map<id, Set<id>>, sea: Map<id, Set<id>>, coast: Map<landId, Set<seaId>>, seaToCoast: Map<seaId, Set<landId>>, coastal: Set<id>, massaliaRegion }`. Validation: every neighbour id exists; land neighbours land, sea neighbours sea; every coast link is land→sea; `massaliaRegion` is a land province that holds the town `massalia`; adjacency is symmetric. `fog` provinces are loaded but excluded from every set.

`apps/server/src/services/mapGraph.ts`: `loadMapGraph()` at boot next to `loadBarracksContent()`, `getTopology()`. A malformed file fails the boot.

Test `packages/shared/src/mapGraph.test.ts`: both real files parse; `R060` is coastal and touches `R150`; every sea province is reachable from `R150` through sea; a fabricated land→land coast link is rejected.

Commit: `map: derived graph and coast links`.

**STOP 1.** Report the script's two printed lists (coastal provinces without a link, non-coastal with one), the `derived` entries for `R057`, `R109`, `R114`, `R137` if the tolerance pass found any, and wait for the manual block to be confirmed before Phase 2.

## Phase 2: ships, holdings, basing

### 2a. `content/military/ships.json`

```json
{
  "version": 1,
  "source": "server-side military content; never copy into apps/web/public",
  "ships": {
    "trade-ship": { "label": "Pentekonter", "role": "transport", "range": 7, "troopSpace": 20, "naval": 1 },
    "galley":     { "label": "Trireme",     "role": "warship",   "range": 4, "troopSpace": 4,  "naval": 5 }
  }
}
```
Parser `parseShipsContent` in `packages/shared/src/barracks.ts` (strict, ids must be goods in the vendor list, `role` in `transport | warship`, integers). Loaded with the other barracks content. `naval` is unused until 3b.

### 2b. Migration `packages/db/migrations/0055_holdings_and_basing.sql`

```sql
CREATE TABLE IF NOT EXISTS player_holdings (
  world_id uuid NOT NULL REFERENCES worlds(id),
  region_id text NOT NULL,
  owner_player_id uuid NOT NULL REFERENCES players(id),
  kind text NOT NULL CHECK (kind IN ('colony', 'conquest')),
  previous_owner text,                       -- polity id from content, or NULL
  since timestamptz NOT NULL DEFAULT now(),
  last_garrisoned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (world_id, region_id)
);
CREATE INDEX IF NOT EXISTS player_holdings_owner_idx ON player_holdings (world_id, owner_player_id);

ALTER TABLE player_units ADD COLUMN IF NOT EXISTS based_at text NOT NULL DEFAULT 'R060';
ALTER TABLE player_units ADD COLUMN IF NOT EXISTS moving_to text;
ALTER TABLE player_units ADD COLUMN IF NOT EXISTS arrives_at timestamptz;
```
Idempotent, one transaction, 0049-style header. Mirror in Drizzle. `based_at` is a region id; a row's base must be `R060` or a holding the same player owns, enforced in code, not by FK.

### 2c. Barracks service

- `MASSALIA_REGION_ID` comes from the topology, not a literal; recruit and hire write `based_at = topology.massaliaRegion`.
- `settleBarracks` step 2b from the spec: rows with `moving_to` and `arrives_at <= now` get `based_at = moving_to`, `moving_to = null`, `arrives_at = null`. No relocation can be started yet; the resolution exists so 3c only adds the start.
- Roster payload rows gain `basedAt`, `movingTo`, `arrivesAt`.

Commit: `barracks: ships content, holdings table, unit basing`.

## Phase 3: reach

### 3a. Pure library, `packages/shared/src/reach.ts`

```ts
export type ReachInput = {
  topology: Topology;
  bases: string[];                       // region ids: massaliaRegion + held regions
  force: { spd: number; space: number; count: number }[];   // active rows only
  fleet: { shipId: string; count: number; range: number; troopSpace: number }[];
};
export type ReachEntry = {
  landSteps: number | null;              // shortest land distance from any base, null if > 2
  seaSteps: number | null;               // fewest sea provinces from any base's coast to a sea touching this region, null if none
  attack: { ok: boolean; reason?: string };
  raid:   { ok: boolean; reason?: string };
  colonise: { ok: boolean; reason?: string };
};
export function computeReach(input: ReachInput): Record<string, ReachEntry>;
```
Rules:
- Land distance: BFS over land from every base, depth ≤ 2.
- Sea distance: from every coastal base, its linked sea provinces are distance 1; BFS through sea; a target region's sea distance is the minimum over the sea provinces it links to. A base that is not coastal contributes no sea reach.
- `fleetRange = min(range)` over ship types with `count > 0`; 0 if no ships. `fleetSpace = Σ count × troopSpace`. `forceSpace = Σ count × space`. `forceFast = every force row has spd >= 6` (an empty force is not fast).
- Attack ok if `landSteps === 1`, or `seaSteps !== null && seaSteps <= fleetRange && forceSpace <= fleetSpace`.
- Raid ok if `landSteps === 1`, or `landSteps === 2 && forceFast`, or the same sea condition as Attack.
- Colonise ok under the same reach as Attack (a colony party has to get there); legality by target kind and owner stays with `allowedMapActions`.
- An empty force makes Attack and Raid not ok with reason `No men under arms.`
- Reasons, one line each, in this order of precedence: `No men under arms.`, `No base within reach.`, `Too far by land; a raiding party needs every man at Spd 6 or more.`, `Beyond the fleet's range ({seaSteps} seas, fleet reaches {fleetRange}).`, `Not enough hulls: {forceSpace} space needed, {fleetSpace} aboard.`
- Entries are produced only for land provinces that are not `fog`, not `massaliaRegion`, and not owned by `HOME_POLITY_ID` per `content/map/region-military.json` / `town-military.json` owners (the server passes a `homeRegions: Set<string>` in the input; add it to `ReachInput`). Everything else is absent from the record.

Test `packages/shared/src/reach.test.ts` against the real topology: from `R060` with one hoplite and no ships, `R046` `R047` `R052` `R059` have `landSteps 1` and Attack ok; a two-step region is Raid-not-ok with the Spd reason and becomes ok when the force is all peltasts; with 1 trade-ship and 40 peltasts (space 40 > 20) the hull reason fires; with 2 trade-ships it clears and a coastal region 5 seas out is Attack ok; adding a galley drops `fleetRange` to 4 and that target flips to the range reason; a base list containing a second coastal region extends sea reach from there; `R060` and home-owned regions never appear.

### 3b. Endpoint

`GET /api/map/reach` in `apps/server/src/routes/map.ts`, next to `/military`, read-only and not behind `MAP_MUTATIONS_ENABLED`. Auth and player resolution identical to `/military`. It runs `settleAll` under the player lock (rows may have finished training) and returns:

```
{
  bases: [{ regionId, kind: "massalia" | "colony" | "conquest" }],
  force: { men, space, fast },
  fleet: { ships: { "trade-ship": n, "galley": n }, range, space },
  reach: Record<regionId, ReachEntry>
}
```
`force` is the active roster based at any base (rows still training or mid-move excluded). `fleet` is the player's `trade-ship` and `galley` stock.

Commit: `map: reach library and /api/map/reach`.

**STOP 2.** Paste `computeReach` in full, report tests and gates, wait.

## Phase 4: client

- `apps/web/src/api.ts`: `api.mapReach()` and types.
- `apps/web/src/map/World2Map.tsx`: fetch reach when the map opens and after the barracks changes (an `onRefresh` from the dashboard is enough; no polling). For the selected town or region, combine `mapActionButtons(...)` with `reach[regionId]`: a button that the legality matrix enables is still disabled when the matching `ReachEntry` says not ok, with the reason as its title, and shown as a one-line caption under the button row on touch. Scout is unchanged by reach in this prompt. A region absent from `reach` keeps the matrix's own verdict.
- Town targets resolve to their region through `graph.json`'s `towns` (the server includes `regionId` for towns in the reach payload if the client lacks it; do whichever is simpler and say which).
- No new files under `apps/web/public`; the topology the client already has in `world2.json` is enough for display, and the leak guard must stay green.

Gates: `pnpm -r lint`, web tsc, web build, web tests, plus the server and shared suites from earlier phases.

Commit: `map: reach-aware action buttons`.

**STOP 3.** Report and wait. Do not push.

## Scope fence

Do not modify: `apps/web/public/**`, `services/mapWar.ts`, the `/state/:provinceId` route, `map_*` tables, `MAP_MUTATIONS_ENABLED`, `merc.*`, `content/people/**`, `content/buildings/**`, existing migrations, `units.json`, `bands.json`. `routes/map.ts` gains one route. `barracks.ts` gains the basing writes and the arrival step. `index.ts` gains one loader call.

## Final report template

As prompt 1, plus:
```
TOPOLOGY
coastal without link: …
non-coastal with link: … (must be empty)
manual block entries: …
```
