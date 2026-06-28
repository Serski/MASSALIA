-- Atlas Phase 2a — world-state data layers (STORAGE ONLY, static values).
-- Two per-world tables holding the CURRENT values for the nine League colonies
-- and the nineteen neighbouring factions. Stable ids, display names, grouping,
-- and the seeded starting numbers live in content (content/cities/cities.json,
-- content/diplomacy/factions.json) and are read via @massalia/shared. Rows are
-- seeded lazily on read from those defaults (see routes/league.ts), so this
-- migration only creates the tables — no hard-coded seed, works for every world.
--
-- No growth/drift/accrual columns and no accrual timestamps — values are static
-- this phase (growth is 2b). Idempotent: safe to re-run.

-- One row per (world, city). stance has no place here; cities carry five stats.
CREATE TABLE IF NOT EXISTS league_cities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id),
  city_id text NOT NULL,
  population integer NOT NULL,
  tax integer NOT NULL,
  stability integer NOT NULL,
  fortifications integer NOT NULL,
  garrison integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (world_id, city_id)
);
CREATE INDEX IF NOT EXISTS league_cities_world_idx ON league_cities (world_id);

-- One row per (world, faction). stance stored as the scale string id (war ..
-- allied); the numeric ordering lives in @massalia/shared, not here.
CREATE TABLE IF NOT EXISTS faction_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id),
  faction_id text NOT NULL,
  stance text NOT NULL,
  vassal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (world_id, faction_id)
);
CREATE INDEX IF NOT EXISTS faction_relations_world_idx ON faction_relations (world_id);
