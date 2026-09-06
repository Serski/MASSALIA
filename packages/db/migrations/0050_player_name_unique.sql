-- Character names are unique per world, case-insensitively, among ACTIVE players
-- (a detached/deleted player's name frees up). The route pre-checks and maps the
-- constraint to a friendly 409; this index is the guarantee under concurrency.
--
-- Existing duplicates (if any) would make the index creation fail and wedge the
-- deploy, so the newer duplicates are first suffixed with the first four hex
-- characters of their id (the oldest row keeps the bare name).
UPDATE players AS p
SET name = p.name || ' ' || left(replace(p.id::text, '-', ''), 4)
FROM (
  SELECT id, row_number() OVER (PARTITION BY world_id, lower(name) ORDER BY created_at, id) AS rn
  FROM players
  WHERE is_active
) AS d
WHERE p.id = d.id AND d.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS players_name_world_lower_idx
  ON players (world_id, lower(name))
  WHERE is_active;
