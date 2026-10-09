-- The League treasury's once-only credits (government prompt 1). The ledger
-- row is the claim: 'opening' once per world, 'tax:s<N>' and 'fees:s<N>' once
-- per world per season. Every other reason repeats and stays unconstrained.
-- Idempotent: IF NOT EXISTS.
CREATE UNIQUE INDEX IF NOT EXISTS treasury_ledger_claim_idx ON treasury_ledger (world_id, owner, reason)
  WHERE reason = 'opening' OR reason LIKE 'tax:s%' OR reason LIKE 'fees:s%';
