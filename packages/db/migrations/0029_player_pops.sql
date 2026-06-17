-- Phase 1 economy rebalance — pops persistence (STORAGE ONLY).
-- How many of each pop (slave / freeman / citizen) a player owns. One row per
-- (world, owner, pop type); the count is adjusted in place, so the UNIQUE index
-- forbids duplicates. `pop_type` is free-form text — content-driven, mirroring the
-- string-keyed `resources.type`; the pop catalog (hireCost / upkeep / food) lives in
-- content/people/pops.json and is read via @massalia/shared parsePopsContent, NOT
-- stored here. No upkeep/food/hiring/staffing logic yet — that arrives in a later
-- phase. Idempotent: safe to re-run.
CREATE TABLE IF NOT EXISTS player_pops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id),
  owner_player_id uuid NOT NULL REFERENCES players(id),
  pop_type text NOT NULL,
  count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS player_pops_owner_type_idx ON player_pops (world_id, owner_player_id, pop_type);
CREATE INDEX IF NOT EXISTS player_pops_owner_idx ON player_pops (world_id, owner_player_id);
