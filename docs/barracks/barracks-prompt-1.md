# MASSALIA — Barracks, prompt 1 of 3: server side (content, schema, services, API)

Read `AGENTS.md` first. Every invariant in it applies to every line you write. Work in the local repo at `/Users/macbook/Documents/Codex/2026-06-01/github-plugin-github-openai-curated/work/MASSALIA`. Commit locally only. Do not push.

## What this prompt builds

The server side of the Barracks system, spec sections 1 to 7: unit and band content, the levy pool, recruiting, hiring, upkeep settle with insolvency, contracts, and the API the tab will read. No web work. No map work. Deployment and reach (spec section 9) and the Barracks tab are prompts 2 and 3.

The design spec is `barracks-spec-v1.md` (provided alongside this prompt). Where the spec and this prompt differ, this prompt wins.

## Rulings this prompt assumes

1. The gate stat is `player_characters.militia` (`packages/db/src/schema.ts:241`), threshold 20. The spec's "military" means this column.
2. Naming. `apps/server/src/services/merc.ts`, `apps/server/src/routes/merc.ts`, `content/military/contracts.json`, `merc-cards.json` and `ranks.json` are the Hoplite's personal contract system. They are unrelated and untouched. The new system uses `units` (trained) and `bands` (hired) everywhere. No new identifier, table, route, file or content key may contain the string `merc`.
3. Food shortfall on unit upkeep is auto-bought at the seasonal vendor price, the same way `settleStaffing` handles pop food. Units disband only when drachmae cannot cover the day's total.
4. New tables. The existing `armies` table (`schema.ts:848`) is unused and stays unused.
5. Season index is whole days since world start: `Math.floor((nowMs - worldStartedMs) / MS_PER_DAY)`, the same arithmetic `seasonAt` uses at `packages/shared/src/buildings.ts:216`. One season = one real day.
6. Unit and band definitions reach the client only through the API response. Nothing under `content/military/` is ever copied into `apps/web/public`.

## Phase 1: content and validation

### 1a. `content/military/units.json`

Create exactly this:

```json
{
  "version": 1,
  "source": "server-side military content; never copy into apps/web/public",
  "gate": { "militia": 20 },
  "levy": { "startMen": 100, "growthPerYear": 10, "seasonsPerYear": 4 },
  "minServiceSeasons": 2,
  "units": {
    "peltast": {
      "label": "Peltast",
      "icon": "PELTAST.webp",
      "role": "skirmish",
      "trainSeasons": 1,
      "gear": { "timber": 2, "leather": 1 },
      "upkeepPerDay": { "grain": 1, "oliveoil": 1 },
      "stats": { "atk": 3, "def": 2, "msl": 5, "mor": 4, "spd": 8, "space": 1 }
    },
    "ekdromos": {
      "label": "Ekdromos",
      "icon": "EKDROMOS.webp",
      "role": "line",
      "trainSeasons": 1,
      "gear": { "timber": 1, "leather": 1, "iron": 1 },
      "upkeepPerDay": { "grain": 1, "oliveoil": 1 },
      "stats": { "atk": 5, "def": 4, "msl": 2, "mor": 5, "spd": 6, "space": 1 }
    },
    "hoplite": {
      "label": "Hoplite",
      "icon": "HOPLITE.webp",
      "role": "line",
      "trainSeasons": 2,
      "gear": { "timber": 1, "iron": 1, "tin": 2 },
      "upkeepPerDay": { "grain": 2, "oliveoil": 1 },
      "stats": { "atk": 7, "def": 8, "msl": 0, "mor": 7, "spd": 3, "space": 1 }
    },
    "hippeis": {
      "label": "Hippeis",
      "icon": "HIPPEIS.webp",
      "role": "mounted",
      "trainSeasons": 2,
      "gear": { "leather": 2, "iron": 1, "wool": 2, "horse": 1 },
      "upkeepPerDay": { "grain": 3, "oliveoil": 1 },
      "stats": { "atk": 6, "def": 4, "msl": 2, "mor": 6, "spd": 10, "space": 3 }
    }
  }
}
```

`icon` is a filename under `apps/web/public/assets/`, same convention as `CITIZEN CLEAR.webp`. The files do not exist yet; the value is a placeholder the tab will resolve later. Do not create image files.

### 1b. `content/military/bands.json`

Create exactly this. `upkeepPerDay` is per band, not per man. `stats` are per man. `renew` is the probability the band offers a renewal at contract end; omit it where the default applies.

```json
{
  "version": 1,
  "source": "server-side military content; never copy into apps/web/public",
  "market": { "offersPerSeason": 3, "maxActiveBands": 2 },
  "contract": { "termSeasons": 2, "renewDefault": 0.8 },
  "bands": {
    "volcae-irregulars":      { "label": "Volcae irregulars",      "icon": "BAND_VOLCAE.webp",     "role": "line",     "men": 40, "renew": 0.6, "upkeepPerDay": { "drachmae": 40,  "wine": 4, "chicken": 4, "herbal": 2 },              "stats": { "atk": 4, "def": 2, "msl": 1, "mor": 3,  "spd": 6,  "space": 1 } },
    "ligurian-light-foot":    { "label": "Ligurian light foot",    "icon": "BAND_LIGURIAN.webp",   "role": "skirmish", "men": 30,               "upkeepPerDay": { "drachmae": 45,  "wine": 3, "chicken": 3, "herbal": 2 },              "stats": { "atk": 4, "def": 4, "msl": 3, "mor": 4,  "spd": 7,  "space": 1 } },
    "salluvii-warband":       { "label": "Salluvii warband",       "icon": "BAND_SALLUVII.webp",   "role": "line",     "men": 30, "renew": 0.6, "upkeepPerDay": { "drachmae": 75,  "wine": 4, "chicken": 4, "herbal": 2 },              "stats": { "atk": 8, "def": 4, "msl": 0, "mor": 5,  "spd": 5,  "space": 1 } },
    "samnite-infantry":       { "label": "Samnite infantry",       "icon": "BAND_SAMNITE.webp",    "role": "line",     "men": 30,               "upkeepPerDay": { "drachmae": 90,  "wine": 4, "chicken": 4, "herbal": 2 },              "stats": { "atk": 6, "def": 6, "msl": 2, "mor": 6,  "spd": 5,  "space": 1 } },
    "lucanian-javelinmen":    { "label": "Lucanian javelinmen",    "icon": "BAND_LUCANIAN.webp",   "role": "skirmish", "men": 30,               "upkeepPerDay": { "drachmae": 60,  "wine": 3, "chicken": 3, "herbal": 2 },              "stats": { "atk": 4, "def": 3, "msl": 5, "mor": 4,  "spd": 7,  "space": 1 } },
    "etruscan-hoplites":      { "label": "Etruscan hoplites",      "icon": "BAND_ETRUSCAN.webp",   "role": "line",     "men": 20,               "upkeepPerDay": { "drachmae": 90,  "wine": 3, "chicken": 3, "herbal": 2 },              "stats": { "atk": 6, "def": 7, "msl": 0, "mor": 6,  "spd": 3,  "space": 1 } },
    "syracusan-hoplites":     { "label": "Syracusan hoplites",     "icon": "BAND_SYRACUSAN.webp",  "role": "line",     "men": 20,               "upkeepPerDay": { "drachmae": 110, "wine": 3, "chicken": 3, "herbal": 2 },              "stats": { "atk": 7, "def": 8, "msl": 0, "mor": 7,  "spd": 3,  "space": 1 } },
    "spartan-hoplites":       { "label": "Spartan hoplites",       "icon": "BAND_SPARTAN.webp",    "role": "line",     "men": 20, "renew": 0.9, "upkeepPerDay": { "drachmae": 200, "wine": 4, "chicken": 4, "herbal": 3 },              "stats": { "atk": 9, "def": 9, "msl": 0, "mor": 10, "spd": 4,  "space": 1 } },
    "iberian-scutarii":       { "label": "Iberian scutarii",       "icon": "BAND_SCUTARII.webp",   "role": "line",     "men": 30,               "upkeepPerDay": { "drachmae": 90,  "wine": 4, "chicken": 4, "herbal": 2 },              "stats": { "atk": 7, "def": 6, "msl": 2, "mor": 6,  "spd": 5,  "space": 1 } },
    "iberian-caetrati":       { "label": "Iberian caetrati",       "icon": "BAND_CAETRATI.webp",   "role": "skirmish", "men": 40,               "upkeepPerDay": { "drachmae": 50,  "wine": 4, "chicken": 4, "herbal": 2 },              "stats": { "atk": 4, "def": 3, "msl": 4, "mor": 4,  "spd": 8,  "space": 1 } },
    "balearic-slingers":      { "label": "Balearic slingers",      "icon": "BAND_BALEARIC.webp",   "role": "missile",  "men": 20,               "upkeepPerDay": { "drachmae": 70,  "wine": 2, "chicken": 2, "herbal": 1 },              "stats": { "atk": 2, "def": 2, "msl": 8, "mor": 4,  "spd": 7,  "space": 1 } },
    "rhodian-slingers":       { "label": "Rhodian slingers",       "icon": "BAND_RHODIAN.webp",    "role": "missile",  "men": 20, "renew": 0.9, "upkeepPerDay": { "drachmae": 80,  "wine": 2, "chicken": 2, "herbal": 1 },              "stats": { "atk": 2, "def": 2, "msl": 7, "mor": 5,  "spd": 7,  "space": 1 } },
    "cretan-archers":         { "label": "Cretan archers",         "icon": "BAND_CRETAN.webp",     "role": "missile",  "men": 30, "renew": 0.9, "upkeepPerDay": { "drachmae": 120, "wine": 3, "chicken": 3, "herbal": 2 },              "stats": { "atk": 3, "def": 2, "msl": 9, "mor": 5,  "spd": 6,  "space": 1 } },
    "thracian-peltasts":      { "label": "Thracian peltasts",      "icon": "BAND_THRACIAN.webp",   "role": "skirmish", "men": 30,               "upkeepPerDay": { "drachmae": 75,  "wine": 3, "chicken": 3, "herbal": 2 },              "stats": { "atk": 4, "def": 3, "msl": 6, "mor": 5,  "spd": 8,  "space": 1 } },
    "illyrian-raiders":       { "label": "Illyrian raiders",       "icon": "BAND_ILLYRIAN.webp",   "role": "skirmish", "men": 40, "renew": 0.6, "upkeepPerDay": { "drachmae": 45,  "wine": 4, "chicken": 4, "herbal": 2 },              "stats": { "atk": 5, "def": 2, "msl": 3, "mor": 3,  "spd": 8,  "space": 1 } },
    "libyan-spearmen":        { "label": "Libyan spearmen",        "icon": "BAND_LIBYAN.webp",     "role": "line",     "men": 30,               "upkeepPerDay": { "drachmae": 80,  "wine": 3, "chicken": 3, "herbal": 2 },              "stats": { "atk": 6, "def": 6, "msl": 0, "mor": 6,  "spd": 4,  "space": 1 } },
    "numidian-light-cavalry": { "label": "Numidian light cavalry", "icon": "BAND_NUMIDIAN.webp",   "role": "mounted",  "men": 20,               "upkeepPerDay": { "drachmae": 100, "wine": 2, "chicken": 2, "herbal": 1, "grain": 30 }, "stats": { "atk": 4, "def": 2, "msl": 5, "mor": 4,  "spd": 10, "space": 3 } },
    "tarentine-cavalry":      { "label": "Tarentine cavalry",      "icon": "BAND_TARENTINE.webp",  "role": "mounted",  "men": 20,               "upkeepPerDay": { "drachmae": 120, "wine": 3, "chicken": 3, "herbal": 2, "grain": 40 }, "stats": { "atk": 5, "def": 3, "msl": 5, "mor": 5,  "spd": 9,  "space": 3 } },
    "gallic-noble-cavalry":   { "label": "Gallic noble cavalry",   "icon": "BAND_GALLIC_HORSE.webp", "role": "mounted", "men": 20, "renew": 0.6, "upkeepPerDay": { "drachmae": 150, "wine": 4, "chicken": 4, "herbal": 2, "grain": 40 }, "stats": { "atk": 8, "def": 5, "msl": 0, "mor": 6,  "spd": 8,  "space": 3 } },
    "thessalian-cavalry":     { "label": "Thessalian cavalry",     "icon": "BAND_THESSALIAN.webp", "role": "mounted",  "men": 20,               "upkeepPerDay": { "drachmae": 180, "wine": 4, "chicken": 4, "herbal": 2, "grain": 40 }, "stats": { "atk": 8, "def": 6, "msl": 0, "mor": 7,  "spd": 9,  "space": 3 } }
  }
}
```

### 1c. Parsers

New file `packages/shared/src/barracks.ts` exporting `parseUnitsContent`, `parseBandsContent` and their types, written the way `parseContractsContent` is in `packages/shared/src/military.ts`. Zod, strict objects, no unknown keys. Validate:
- every `gear` and `upkeepPerDay` key is a known good id (the vendor list in `content/buildings/buildings.json` is the source of truth; `drachmae` is additionally allowed in band upkeep only)
- `role` is one of `line | skirmish | missile | mounted`
- `stats` has exactly the six keys, integers 0..10, `space` in {1, 3}
- band `men` is an integer 10..40, `renew` if present is 0..1
- unit ids and band ids are kebab-case and unique

Add `packages/shared/src/barracks.test.ts` in the shape of `military.test.ts`: both real files parse, and a malformed copy (unknown good, missing stat) is rejected.

### 1d. Loader

`apps/server/src/services/barracks.ts` with `loadBarracksContent()` (reads both files, memoizes) and `getUnitsContent()` / `getBandsContent()`, following the `loadContractsContent` / `getContractsContent` pattern at `apps/server/src/services/merc.ts:40-58`. Call `loadBarracksContent()` at boot next to `loadContractsContent()` in `apps/server/src/index.ts:105`. A malformed file fails the boot.

Commit: `barracks: unit and band content with parsers`.

## Phase 2: schema and migration

### 2a. Migration `packages/db/migrations/0053_barracks.sql`

Append-only, idempotent (`IF NOT EXISTS` on every statement), one transaction, header comment in the style of `0049_military_pools.sql`.

```sql
CREATE TABLE IF NOT EXISTS player_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id),
  owner_player_id uuid NOT NULL REFERENCES players(id),
  source text NOT NULL CHECK (source IN ('trained', 'band')),
  unit_id text NOT NULL,                 -- units.json key for trained rows, bands.json key for band rows
  count integer NOT NULL CHECK (count >= 0),
  start_count integer NOT NULL,
  recruited_season integer NOT NULL,
  ready_at_season integer,               -- trained only; NULL for bands
  contract_end_season integer,           -- band only; NULL for trained
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS player_units_owner_idx ON player_units (world_id, owner_player_id);

CREATE TABLE IF NOT EXISTS player_levy (
  world_id uuid NOT NULL REFERENCES worlds(id),
  owner_player_id uuid NOT NULL REFERENCES players(id),
  men integer NOT NULL CHECK (men >= 0),
  last_growth_season integer NOT NULL,
  PRIMARY KEY (world_id, owner_player_id)
);

CREATE TABLE IF NOT EXISTS band_offers (
  world_id uuid NOT NULL REFERENCES worlds(id),
  owner_player_id uuid NOT NULL REFERENCES players(id),
  season_index integer NOT NULL,
  band_id text NOT NULL,
  hired boolean NOT NULL DEFAULT false,
  PRIMARY KEY (world_id, owner_player_id, season_index, band_id)
);
```

### 2b. Drizzle

Add `playerUnits`, `playerLevy`, `bandOffers` to `packages/db/src/schema.ts` mirroring the SQL exactly, next to `playerPops`. Export them.

Run `pnpm db:migrate` against `massalia_test` and confirm the three tables exist.

Commit: `barracks: player_units, player_levy, band_offers`.

**STOP 1.** Report the two content files, the parser test output, the migration, and the Drizzle definitions. Wait for approval before Phase 3.

## Phase 3: services and settle

All in `apps/server/src/services/barracks.ts`. Every mutation runs inside a transaction that calls `lockPlayer(tx, playerId)` first. Every stock and wallet write is relative and guarded with the affected row count checked, exactly as `settleStaffing` does at `apps/server/src/services/buildings.ts:605-665`.

### 3a. Helpers

- `seasonIndexAt(nowMs, worldStartedMs)`: the integer from ruling 5. Put it in `packages/shared/src/buildings.ts` next to `seasonAt` and have `seasonAt` use it so there is one definition.
- `seededRoll(seedParts: string[]): number` in `packages/shared/src/barracks.ts`: sha256 of the joined parts, first 4 bytes as a uint32, divided by 2^32. Deterministic. `Math.random` is not used anywhere in this system.
- `isActive(row, season)`: trained rows are active when `season >= ready_at_season`; band rows are always active.

### 3b. Levy

`ensureLevy(tx, ctx, season)`: create the row if missing with `men = startMen + growthPerYear * floor(season / seasonsPerYear)` and `last_growth_season = floor(season / seasonsPerYear) * seasonsPerYear` (growth accrues from world start whether or not the tab was ever opened). If it exists, apply owed growth closed-form: `years = floor((season - last_growth_season) / seasonsPerYear)`; if `years > 0`, `men += years * growthPerYear`, `last_growth_season += years * seasonsPerYear`.

### 3c. Recruit

`recruitUnits(ctx, unitId, count, now)`:
1. Lock. Settle (call the same `settleAll` path `hirePops` uses at `buildings.ts:1069-1081`, so upkeep to now is charged at the pre-recruit roster).
2. Gate: `player_characters.militia >= gate.militia`, else 403 with a one-line message.
3. `count` is a positive integer; `unitId` exists.
4. Levy: `ensureLevy`, then `men >= count`, else 409.
5. Materials: for each gear good, need = qty × count. Read all rows first; if any is short, 409 listing the shortfall, nothing debited. Then debit each with `UPDATE resources SET amount = amount - X WHERE id = ? AND amount >= X`, checking the row count; any failure rolls the transaction back.
6. Insert a `player_units` row: `source = 'trained'`, `count = start_count = count`, `recruited_season = season`, `ready_at_season = season + trainSeasons`.
7. `player_levy.men -= count` (guarded).
8. `effect_log` row on the acting character: `kind: "barracks_recruit"`, `detail: { unitId, count, readyAtSeason, source: "barracks" }`.

### 3d. Hire

`hireBand(ctx, bandId, now)`:
1. Lock. Settle. `rollOffers` (3f) so this season's offers exist.
2. Gate as above.
3. An unhired `band_offers` row exists for `(world, player, season, bandId)`, else 404.
4. Active band rows for the player `< market.maxActiveBands`, else 409.
5. Insert `player_units`: `source = 'band'`, `unit_id = bandId`, `count = start_count = men`, `recruited_season = season`, `contract_end_season = season + contract.termSeasons`.
6. Mark the offer `hired = true` with a conditional update (`WHERE hired = false`), checking the row count; a lost claim applies nothing.
7. `effect_log`: `kind: "barracks_hire"`, `detail: { bandId, men, contractEndSeason, source: "barracks" }`.

### 3e. Disband

`disbandRow(ctx, rowId, now)`:
1. Lock. Settle.
2. Row belongs to the player, else 404.
3. Trained: `season >= recruited_season + minServiceSeasons`, else 409. Band: `season >= contract_end_season - contract.termSeasons + contract.termSeasons` (i.e. the first term has been served), else 409.
4. Trained: `player_levy.men += count`. Band: nothing returns.
5. Delete the row. `effect_log`: `kind: "barracks_disband"`, `detail: { unitId, count, source: "player" }`.

### 3f. Offers

`rollOffers(tx, ctx, season)`: if no `band_offers` rows exist for `(world, player, season)`, choose `market.offersPerSeason` band ids from the catalogue excluding bands the player currently holds a row for. Selection: sort all eligible ids, then pick by repeatedly drawing `seededRoll([worldId, playerId, String(season), String(i)])` for `i = 0, 1, 2` over the remaining list. Insert with `ON CONFLICT DO NOTHING`. Re-login never rerolls; the same inputs always give the same three.

### 3g. Settle

`settleBarracks(exec, ctx, now)`, called from `settleAll` at `buildings.ts:693` immediately after `settleStaffing`, its result added to `FullSettle` as `barracks`.

Marker: a `resources` row `scope = 'player'`, `type = 'barracks_upkeep'` carrying `lastUpdatedAt`, same mechanics as `STAFF_TYPE` at `buildings.ts:199`. First-settle anchor: the earliest `created_at` among the player's `player_units` rows; if there are none, do nothing and write no marker.

Per settle, in this order:
1. `ensureLevy`.
2. `days = wholeDaysBetween(marker, now)`. If `days === 0` skip to step 6.
3. Compute per-day demand across active rows: `drachmaeDirect` (bands only), and a map `good → qty` summing trained `upkeepPerDay × count` and band `upkeepPerDay` (per band, not × count). Multiply by `days`.
4. Food: for each good, draw from stock (guarded), buy the shortfall at `vendorUnitPrice(band, "buy", …)` with the current season the way `settleStaffing` prices `foodGood`. `cost = drachmaeDirect + purchases`.
5. Insolvency: if `cost > wallet`, remove rows and recompute until `cost <= wallet` or no rows remain, in this order: band rows by `upkeepPerDay.drachmae` descending, then trained rows by unit in the order `hippeis, hoplite, ekdromos, peltast`. A removed trained row returns `count` to the levy. Each removal writes `effect_log` `kind: "barracks_disband"`, `detail: { unitId, count, source: "insolvency" }`. Then debit the wallet relative and clamped as `settleStaffing` does at `buildings.ts:655-660`. Note in a code comment that a removed row is charged for the full gap (the men served the days before they walked); this is the accepted v1 approximation.
6. Contract ends: for band rows with `contract_end_season <= season`, roll `seededRoll([rowId, String(contract_end_season)])`. If `< renew` (band's own or `renewDefault`): `contract_end_season += termSeasons`, `effect_log` `kind: "barracks_renew"`. Else delete the row, `effect_log` `kind: "barracks_disband"`, `detail.source: "contract_end"`.
7. Advance the marker by `days × MS_PER_DAY` (or create it at the anchor advanced by `days`).

Insolvency here never touches `player_pops`; household eviction is a separate design and out of scope.

Commit: `barracks: levy, recruit, hire, disband, offers, settle`.

**STOP 2.** Report the service file with line references for each of 3b to 3g, and paste the `settleBarracks` function in full. Wait for approval before Phase 4.

## Phase 4: routes

`apps/server/src/routes/barracks.ts`, `export async function barracksRoutes(app)`, registered in `apps/server/src/index.ts` next to line 142 with prefix `/api/barracks`. Auth and session handling identical to `routes/merc.ts`. Every handler resolves the acting context the same way `routes/buildings.ts` does.

- `GET /api/barracks` → runs settle, then returns:
  ```
  {
    gate: { stat: "militia", required: 20, current: number, met: boolean },
    season: number,
    levy: { men: number },
    config: { minServiceSeasons, maxActiveBands, termSeasons },
    units: [ { id, label, icon, role, trainSeasons, gear, upkeepPerDay, stats } ],
    roster: [ { id, source, unitId, label, icon, count, startCount, recruitedSeason, readyAtSeason, contractEndSeason, active, canDisband } ],
    offers: [ { id, label, icon, role, men, upkeepPerDay, stats, hired } ],
    activeBands: number
  }
  ```
  Below the gate, `units`, `roster` and `offers` are still returned (the tab shows the catalogue behind the lock) but the POST routes refuse.
- `POST /api/barracks/recruit` `{ unitId, count }`
- `POST /api/barracks/hire` `{ bandId }`
- `POST /api/barracks/disband` `{ rowId }`

Each POST returns the same shape as GET on success so the client re-renders from one payload. Errors follow the repo's `{ ok, code, error }` convention. No internal messages on 5xx.

Commit: `barracks: /api/barracks routes`.

## Phase 5: tests

DB-gated, in the repo's existing style (`apps/server/src/services/merc.test.ts`, route tests with `app.inject()` and a minted session).

`apps/server/src/services/barracks.test.ts`:
- levy: fresh player at season 9 starts with 120 men and `last_growth_season = 8`; a player settled at season 3 then at season 12 gains exactly 20.
- gate: militia 19 recruit and hire refuse with 403; militia 20 succeeds.
- recruit: debits every gear good, refuses with nothing debited when one is short, decrements levy, sets `ready_at_season` correctly.
- offers: same `(world, player, season)` rolled twice yields identical rows; a band under contract never appears; exactly 3 per season.
- hire: refuses an id not in this season's offers; refuses a third active band; marks the offer hired.
- settle: charges grain and oliveoil for a trained row from stock, buys the shortfall at the seasonal price, debits band drachmae; inactive trained rows (not yet ready) cost nothing.
- insolvency: with wallet 0 and two bands plus hoplites, the higher-drachmae band is removed first, then the second, then hoplites, men returning to the levy; `effect_log` rows carry `source: "insolvency"`.
- contract end: at `contract_end_season` a band with `renew: 1` extends by `termSeasons`; with `renew: 0` it is deleted with `source: "contract_end"`.
- disband: trained refused before `minServiceSeasons`, allowed after, levy restored; band nothing returns.

`apps/server/src/routes/barracks.test.ts`: GET below and above the gate; the three POSTs happy path and one refusal each.

`apps/web/test/public-leak-guard.test.ts` must still pass unchanged.

Commit: `barracks: tests`.

## Gates before STOP 3

Run and paste the tail of each:
```
pnpm -r lint
pnpm --filter @massalia/server exec tsc -p tsconfig.json --noEmit
DATABASE_URL=postgres://…/massalia_test pnpm --filter @massalia/server test
DATABASE_URL=postgres://…/massalia_test pnpm --filter @massalia/db test
pnpm --filter @massalia/web test
```

**STOP 3.** Report and wait. Do not push. The push prompt is a separate step.

## Scope fence

Do not modify:
- `apps/web/**` (prompt 3)
- `apps/server/src/services/mapWar.ts`, `apps/server/src/routes/map.ts`, `apps/server/src/services/mapMilitary.ts`, `MAP_MUTATIONS_ENABLED`
- `apps/server/src/services/merc.ts`, `apps/server/src/routes/merc.ts`, `content/military/contracts.json`, `content/military/merc-cards.json`, `content/military/ranks.json`
- `content/people/pops.json`, `content/buildings/buildings.json`
- `content/map/**`, `town_military`, `region_military`, `armies`
- any migration file that already exists

`settleAll` in `buildings.ts` receives exactly one added call and one added result field. `index.ts` receives one loader call and one route registration. `packages/shared/src/buildings.ts` receives `seasonIndexAt` and nothing else.

## Final report template

```
COMMITS
<sha> <message>   (one per phase)

FILES
created: …
modified: … (file:lines)

GATES
lint: …
tsc: …
server tests: … passed / … failed
db tests: …
web tests (leak guard): …

MIGRATION
0053 applied to massalia_test: yes/no; tables present: player_units, player_levy, band_offers

DEVIATIONS FROM THIS PROMPT
… (or none)

OPEN QUESTIONS
…
```
