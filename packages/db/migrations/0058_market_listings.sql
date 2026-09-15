-- The player market (market prompt 1): sell-only stalls. Listing escrows the
-- seller's stock at once; `remaining` is the claim a buy decrements under a
-- guard, and `closed_at` marks a stall sold out or cancelled. No expiry.
-- Idempotent, one transaction.
CREATE TABLE IF NOT EXISTS market_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id),
  seller_player_id uuid NOT NULL REFERENCES players(id),
  good text NOT NULL,
  remaining integer NOT NULL CHECK (remaining >= 0),
  price integer NOT NULL CHECK (price >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE INDEX IF NOT EXISTS market_listings_open_idx ON market_listings (world_id, good) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS market_listings_seller_open_idx ON market_listings (seller_player_id) WHERE closed_at IS NULL;
