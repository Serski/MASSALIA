-- Family pack, Prompt A: marriage & the per-player candidate pool. Children and
-- succession arrive in later packs — this only adds sex, the spouse link, the
-- generated-candidate pool, and the marriages ledger.

-- Sex on the character sheet. Backfill: hetaira -> female, everyone else male
-- (the existing avatar art reads male; a proper choice arrives with new avatars).
ALTER TABLE player_characters
  ADD COLUMN IF NOT EXISTS sex                 text NOT NULL DEFAULT 'male',
  ADD COLUMN IF NOT EXISTS spouse_candidate_id uuid;
UPDATE player_characters SET sex = 'female' WHERE class_id = 'hetaira';
ALTER TABLE player_characters ADD CONSTRAINT player_characters_sex_chk CHECK (sex IN ('male', 'female'));

-- Generated people for wives AND adoptions. PER PLAYER (for_character_id) so the
-- offer can never run dry. consumed_at is set when chosen; consumed rows are kept
-- for history. Unconsumed rows are replaced when a fresher draw lands.
CREATE TABLE IF NOT EXISTS family_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id),
  for_character_id uuid NOT NULL REFERENCES player_characters(id),
  purpose text NOT NULL CHECK (purpose IN ('marriage', 'adoption')),
  name text NOT NULL,
  sex text NOT NULL CHECK (sex IN ('male', 'female')),
  house_slug text NOT NULL,
  age integer NOT NULL,
  prestige integer NOT NULL DEFAULT 0,
  devotion integer NOT NULL DEFAULT 0,
  militia integer NOT NULL DEFAULT 0,
  intelligence integer NOT NULL DEFAULT 0,
  trait_id text,
  avatar_id text,
  ideology integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz
);
CREATE INDEX IF NOT EXISTS family_candidates_for_char_idx
  ON family_candidates (for_character_id, purpose, consumed_at);

-- The marriages ledger. ended_at / end_reason fill in when a marriage ends
-- (childbirth death etc. — later packs).
CREATE TABLE IF NOT EXISTS marriages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id uuid NOT NULL REFERENCES player_characters(id),
  candidate_id uuid NOT NULL REFERENCES family_candidates(id),
  married_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  end_reason text
);
