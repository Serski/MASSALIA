-- The League's building dues (government prompt 2b): 'buildings:s<N>' joins
-- the once-only reasons of 0070, once per world per season. The party dues
-- keep their own 'dues:' reasons, outside the index. The index is rebuilt with
-- the wider predicate; no row has a 'buildings:' reason yet. Until this runs,
-- the lock and re-read in collectLeagueRevenue keep the claim once-only (the
-- worker can be on the new code first). Idempotent, one transaction.
DROP INDEX IF EXISTS treasury_ledger_claim_idx;
CREATE UNIQUE INDEX IF NOT EXISTS treasury_ledger_claim_idx ON treasury_ledger (world_id, owner, reason)
  WHERE reason = 'opening' OR reason LIKE 'tax:s%' OR reason LIKE 'fees:s%' OR reason LIKE 'buildings:s%';
