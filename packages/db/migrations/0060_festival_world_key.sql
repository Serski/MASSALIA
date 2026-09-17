-- Festival instances are per world (festival world key, prompt 1). game_year
-- restarts with every world, so the close guard must carry the world: without it
-- World 1's closed (festival, year) rows shadowed World 2's festivals. Each
-- existing row goes to the world that was running when it was closed: the world
-- with the earliest ends_at later than closed_at. world:launch stamps ends_at at
-- the flip, while a new world's started_at may be backdated, so started_at cannot
-- decide it. A row no world can claim fails SET NOT NULL and aborts the migration.
-- Idempotent, one transaction.
ALTER TABLE festival_choregos ADD COLUMN IF NOT EXISTS world_id uuid REFERENCES worlds(id);

UPDATE festival_choregos fc
SET world_id = (SELECT w.id FROM worlds w WHERE w.ends_at > fc.closed_at ORDER BY w.ends_at ASC LIMIT 1)
WHERE fc.world_id IS NULL;

ALTER TABLE festival_choregos ALTER COLUMN world_id SET NOT NULL;

-- 0018 declared UNIQUE (festival_id, game_year) inline, so Postgres named the
-- constraint itself. Drop it by definition, never by a guessed name.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'festival_choregos'::regclass AND contype = 'u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (festival_id, game_year)'
  LOOP
    EXECUTE format('ALTER TABLE festival_choregos DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
DROP INDEX IF EXISTS festival_choregos_instance_idx;

CREATE UNIQUE INDEX IF NOT EXISTS festival_choregos_world_instance_idx
  ON festival_choregos (world_id, festival_id, game_year);
