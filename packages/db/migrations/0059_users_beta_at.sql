-- World 2 launch (prompt 1): the Beta stamp. Set once by the world:launch
-- script on every user who created a character in World 1; createCharacterRow
-- grants the permanent Beta trait to a stamped user's characters in every world
-- from then on. Idempotent.
ALTER TABLE users ADD COLUMN IF NOT EXISTS beta_at timestamptz;
