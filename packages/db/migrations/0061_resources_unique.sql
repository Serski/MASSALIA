-- One resources row per (scope, scope_id, type). Every Landowner created since the
-- starting package shipped holds two grain rows: the class resource at 0 from the
-- create route and the package's 10. Readers disagreed on which one counts, so the
-- market, the vendor and the staff food draw hit the empty row. Each duplicate
-- group folds into its row with the latest last_updated_at (tie-break: the greatest
-- id), which takes the whole group's amount; the other rows go. Then the unique
-- index, which the inserts' ON CONFLICT (scope, scope_id, type) targets.
-- The lock keeps a write from landing between the merge and the index build.
-- Idempotent (no duplicates: no row changes), one transaction.
LOCK TABLE resources IN SHARE ROW EXCLUSIVE MODE;

WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY scope, scope_id, type ORDER BY last_updated_at DESC, id DESC) AS rn,
         count(*) OVER (PARTITION BY scope, scope_id, type) AS n,
         sum(amount) OVER (PARTITION BY scope, scope_id, type) AS total
  FROM resources
)
UPDATE resources r
SET amount = ranked.total
FROM ranked
WHERE r.id = ranked.id AND ranked.rn = 1 AND ranked.n > 1;

WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY scope, scope_id, type ORDER BY last_updated_at DESC, id DESC) AS rn
  FROM resources
)
DELETE FROM resources r
USING ranked
WHERE r.id = ranked.id AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS resources_scope_type_uq ON resources (scope, scope_id, type);
