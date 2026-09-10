-- Holdings and unit basing (server-side only — never shipped under
-- apps/web/public; the client reads reach through /api/map/reach).
-- player_holdings: one row per World 2 region a player holds, as a colony or a
--   conquest; previous_owner is the content polity id it was taken from (NULL
--   for an unclaimed region). Nothing creates rows yet (3b / 3c do).
-- player_units gains basing: based_at is the region a row stands in (R060, the
--   Massalia region, by default; otherwise a holding the same player owns —
--   enforced in code, not by FK), and moving_to / arrives_at carry a relocation
--   in flight, resolved by the barracks settle when arrives_at passes.
-- Idempotent: every statement is IF NOT EXISTS.
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
