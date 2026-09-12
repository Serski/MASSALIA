-- Town holdings and tribute (barracks prompt 3c). A holding may now be a town:
-- town_id is the town slug, or '' for a region holding (existing rows keep ''),
-- and the key becomes (world_id, region_id, town_id) so a region with several
-- towns can hold more than one. last_tribute_at is the marker tribute settles
-- from, closed-form on whole days. Idempotent, one transaction.
ALTER TABLE player_holdings ADD COLUMN IF NOT EXISTS town_id text NOT NULL DEFAULT '';
ALTER TABLE player_holdings ADD COLUMN IF NOT EXISTS last_tribute_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE player_holdings DROP CONSTRAINT IF EXISTS player_holdings_pkey;
ALTER TABLE player_holdings ADD PRIMARY KEY (world_id, region_id, town_id);
