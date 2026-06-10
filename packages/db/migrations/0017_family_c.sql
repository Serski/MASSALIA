-- Family pack, Prompt C: death, succession & regency. Death flips from
-- display-only (age pack) to real: reaching death_age opens succession, which
-- hands the house to an heir / adoptee / regent / fresh start so the player
-- always controls a living character.

-- Life status + the dynasty spine + regency state on the sheet.
ALTER TABLE player_characters
  ADD COLUMN IF NOT EXISTS status               text NOT NULL DEFAULT 'alive',
  ADD COLUMN IF NOT EXISTS dynasty_id           uuid,
  ADD COLUMN IF NOT EXISTS is_regent            boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS regent_for_child_id  uuid,
  -- The adopted heir's candidate (set by an adoption), used by the succession ladder.
  ADD COLUMN IF NOT EXISTS adopted_candidate_id uuid;
ALTER TABLE player_characters ADD CONSTRAINT player_characters_status_chk
  CHECK (status IN ('alive', 'deceased', 'retired_regent'));

-- Dynasties: the spine future legacy scoring reads. Extend the existing table.
ALTER TABLE dynasties
  ADD COLUMN IF NOT EXISTS founding_player_id uuid,
  ADD COLUMN IF NOT EXISTS house_slug         text,
  ADD COLUMN IF NOT EXISTS generation         integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_at         timestamptz NOT NULL DEFAULT now();

-- Backfill: one dynasty per existing character, linked.
WITH made AS (
  INSERT INTO dynasties (world_id, name, prestige, house_slug, founding_player_id, generation)
  SELECT pc.world_id, 'House ' || pc.house_slug, 0, pc.house_slug, pc.player_id, 1
  FROM player_characters pc
  WHERE pc.dynasty_id IS NULL
  RETURNING id, founding_player_id
)
UPDATE player_characters pc SET dynasty_id = made.id
FROM made WHERE pc.player_id = made.founding_player_id;

-- The succession ledger. from_name/from_age snapshot the deceased for a readable
-- history (the slot row is reused for the heir, per the one-character-per-player model).
CREATE TABLE IF NOT EXISTS successions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dynasty_id uuid NOT NULL REFERENCES dynasties(id),
  from_character_id uuid,
  to_character_id uuid,
  kind text NOT NULL CHECK (kind IN ('blood', 'adopted', 'regent_handoff', 'fresh')),
  from_name text,
  from_age integer,
  to_name text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS successions_dynasty_idx ON successions (dynasty_id);
