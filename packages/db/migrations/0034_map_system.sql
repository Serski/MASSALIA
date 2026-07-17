-- Province/map system (new geographic map — NOT the economy `provinces` table).
-- Six map_-prefixed tables holding the Western-Mediterranean province mesh, its
-- adjacency graph, the polities that own it, per-world ownership state, an
-- append-only ownership history (for season replays), and the map's towns.
--
-- Geometry + reference data (map_provinces, map_province_adjacency, map_polities,
-- map_towns) is GLOBAL — one 300 BC mesh shared by every world. Only the mutable
-- ownership tables (map_province_state, map_province_history) carry world_id so a
-- second season never needs scoping retrofitted into hot tables. There is no
-- worlds table for this system yet, so world_id is a plain text scope key with a
-- 'season-1' default (a constant today, a parameter later); the seed and API
-- scope every query by it from day one.
--
-- Hand-written to match the repo's SQL-migration convention (see 0030–0033); the
-- typed drizzle defs in schema.ts describe these tables but are NOT drizzle-kit
-- managed — this file is the source of truth. Idempotent: safe to re-run.

-- Polities: the 18 tribes/states that can own provinces. Stable slug ids.
CREATE TABLE IF NOT EXISTS map_polities (
  id text PRIMARY KEY,
  name text NOT NULL,
  color text NOT NULL
);

-- Provinces: the 1023-cell mesh. type is 'land' | 'sea' | 'wasteland'; terrain and
-- coastal are static attributes. Geometry itself lives in the browser/seed assets,
-- not here — this table is the id registry ownership + adjacency reference.
CREATE TABLE IF NOT EXISTS map_provinces (
  id text PRIMARY KEY,
  type text NOT NULL,
  terrain text NOT NULL,
  coastal boolean NOT NULL DEFAULT false
);

-- Undirected province adjacency graph (border pairs). Stored one direction only,
-- so neighbour lookups must match either column — province_a is covered by the PK,
-- province_b gets its own index for the reverse direction. The CHECK makes the
-- canonical (province_a < province_b) form structural, so a pair can never be
-- stored twice in opposite orders.
CREATE TABLE IF NOT EXISTS map_province_adjacency (
  province_a text NOT NULL REFERENCES map_provinces(id),
  province_b text NOT NULL REFERENCES map_provinces(id),
  PRIMARY KEY (province_a, province_b),
  CHECK (province_a < province_b)
);
CREATE INDEX IF NOT EXISTS map_province_adjacency_b_idx ON map_province_adjacency (province_b);

-- Per-world ownership state. owner vs controller are separate ON PURPOSE: the
-- controller occupies a province during war; the owner is who annexes it at peace.
-- One row per (world, province). Land provinces get a row (owner may be NULL =
-- unclaimed); sea and wasteland get no row. since_tick is the integer game tick the
-- current owner took it (0 at seed).
CREATE TABLE IF NOT EXISTS map_province_state (
  world_id text NOT NULL DEFAULT 'season-1',
  province_id text NOT NULL REFERENCES map_provinces(id),
  owner_polity_id text REFERENCES map_polities(id),
  controller_polity_id text REFERENCES map_polities(id),
  since_tick integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (world_id, province_id)
);

-- Append-only ownership history for season replays. One row per change (including
-- the seed baseline). change_type is a free-form marker ('seed' | 'owner' |
-- 'controller'); polity_id is who it changed to (NULL = became unclaimed).
CREATE TABLE IF NOT EXISTS map_province_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id text NOT NULL DEFAULT 'season-1',
  province_id text NOT NULL REFERENCES map_provinces(id),
  polity_id text REFERENCES map_polities(id),
  change_type text NOT NULL,
  tick integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS map_province_history_world_province_idx
  ON map_province_history (world_id, province_id);
-- The replay feature reads a whole world in tick order, so scope-then-tick too.
CREATE INDEX IF NOT EXISTS map_province_history_world_tick_idx
  ON map_province_history (world_id, tick);

-- Towns: 26 named settlements. province_id is resolved at seed time (point-in-
-- polygon, nearest-land fallback); polity_id is the town's owning polity. lon/lat
-- are WGS84, px_x/px_y are the shared 2400x1991 pixel space. Global reference data.
CREATE TABLE IF NOT EXISTS map_towns (
  id text PRIMARY KEY,
  name text NOT NULL,
  province_id text REFERENCES map_provinces(id),
  polity_id text REFERENCES map_polities(id),
  lon numeric NOT NULL,
  lat numeric NOT NULL,
  px_x numeric NOT NULL,
  px_y numeric NOT NULL
);
