-- The League as an owner (government prompt 5a). One players row per world
-- stands for the League itself: kind 'league', no user and no character, owning
-- ordinary player_units rows and ship stock, so the League's army is paid and
-- (in 5b) ordered through the code a player's is. Every other row is kind
-- 'player' and keeps its user: user_id becomes nullable, and a check holds the
-- two apart. A partial unique index allows one League row per world; its
-- insert is the claim that raises the army once.
-- The army's upkeep is charged once a season, claimed by its ledger row:
-- 'army:s<N>' joins the once-only reasons of 0070 and 0072. The index is
-- rebuilt with the wider predicate; no row has an 'army:' reason yet. Until
-- this runs, the lock and re-read in settleLeagueArmy keep the claim once-only.
-- Idempotent, one transaction.
ALTER TABLE players ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'player';
ALTER TABLE players ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE players DROP CONSTRAINT IF EXISTS players_kind_check;
ALTER TABLE players ADD CONSTRAINT players_kind_check CHECK (kind IN ('player', 'league'));
ALTER TABLE players DROP CONSTRAINT IF EXISTS players_kind_user_check;
ALTER TABLE players ADD CONSTRAINT players_kind_user_check CHECK ((kind = 'player' AND user_id IS NOT NULL) OR (kind = 'league' AND user_id IS NULL));
CREATE UNIQUE INDEX IF NOT EXISTS players_one_league_per_world_idx ON players (world_id) WHERE kind = 'league';
DROP INDEX IF EXISTS treasury_ledger_claim_idx;
CREATE UNIQUE INDEX IF NOT EXISTS treasury_ledger_claim_idx ON treasury_ledger (world_id, owner, reason)
  WHERE reason = 'opening' OR reason LIKE 'tax:s%' OR reason LIKE 'fees:s%' OR reason LIKE 'buildings:s%' OR reason LIKE 'army:s%';
