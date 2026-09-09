-- Barracks (server-side only — unit and band definitions never ship under
-- apps/web/public; the client reads rosters through /api/barracks).
-- player_units: one row per trained unit batch or hired band a player holds.
--   source 'trained' rows come from the levy (unit_id = units.json key, count
--   men, ready_at_season when training completes); source 'band' rows are
--   mercenary contracts (unit_id = bands.json key, contract_end_season).
-- player_levy: the player's own manpower pool, grown closed-form on settle.
-- band_offers: the per-player, per-season market roll (deterministic; a row
--   per offered band, `hired` flipped by a conditional update on hire).
-- The pre-existing `armies` table is unused and stays unused.
-- Idempotent: every statement is IF NOT EXISTS.
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
