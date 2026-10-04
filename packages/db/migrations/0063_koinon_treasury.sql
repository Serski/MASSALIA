-- The koinon's treasury and its hall (koinon prompt 2). `treasury` is an integer
-- purse members give into and only the koinon's buildings draw from. The Lesche
-- is four columns on the koinon: when it was ordered, when it stands, the end
-- of its last paid day of upkeep, and whether it is shut for want of upkeep.
-- `koinon_deposits` keeps one row per gift.
-- Idempotent, one transaction.
ALTER TABLE koina ADD COLUMN IF NOT EXISTS treasury integer NOT NULL DEFAULT 0 CHECK (treasury >= 0);
ALTER TABLE koina ADD COLUMN IF NOT EXISTS lesche_started_at timestamptz;
ALTER TABLE koina ADD COLUMN IF NOT EXISTS lesche_completes_at timestamptz;
ALTER TABLE koina ADD COLUMN IF NOT EXISTS lesche_paid_until timestamptz;
ALTER TABLE koina ADD COLUMN IF NOT EXISTS lesche_shut boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS koinon_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  koinon_id uuid NOT NULL REFERENCES koina(id),
  player_id uuid NOT NULL REFERENCES players(id),
  amount integer NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS koinon_deposits_koinon_idx ON koinon_deposits (koinon_id, created_at DESC);
