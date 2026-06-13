-- The Ledger / player economy (Economy Build 1) — the universal building engine.
-- A NEW player-scoped buildings table (distinct from the province-scoped
-- `buildings` table that belongs to the map/atlas system). Goods + drachmae
-- income accrue lazily into the existing `resources` rows (scope 'player'); no
-- cron — all accrual is closed-form rate × elapsed × seasonal, computed on read.

-- One row per (world, owner, building content key). Tier upgrades happen in
-- place (the same row's tier increments), so the UNIQUE key forbids duplicates.
CREATE TABLE IF NOT EXISTS player_buildings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id),
  owner_player_id uuid NOT NULL REFERENCES players(id),
  building_id text NOT NULL,
  tier integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'constructing' CHECK (status IN ('constructing', 'active')),
  completes_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (world_id, owner_player_id, building_id)
);
CREATE INDEX IF NOT EXISTS player_buildings_owner_idx ON player_buildings (world_id, owner_player_id);

-- Stub treasury sink: fees from routine cards accrue here (one row per world).
-- NO treasury spending in this build — this is a counter the future treasury
-- system will read. world_id is the primary key (one balance per world).
CREATE TABLE IF NOT EXISTS world_treasury (
  world_id uuid PRIMARY KEY REFERENCES worlds(id),
  balance integer NOT NULL DEFAULT 0
);

-- Seed one treasury counter per active world (idempotent).
INSERT INTO world_treasury (world_id)
SELECT id FROM worlds
ON CONFLICT (world_id) DO NOTHING;
