-- Story engine: authored branching stories + per-character play state.
-- stories.tree holds the node/choice graph (shape enforced in @massalia/shared, later phase).
-- story_progress is one row per (character, story): the UNIQUE index is the
-- once-ever guard; status flips to 'completed' together with terminal rewards
-- (service phase). CHECK is inline so the IF NOT EXISTS guard covers it.

CREATE TABLE IF NOT EXISTS stories (
  id text PRIMARY KEY,
  version integer NOT NULL DEFAULT 1,
  tree jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS story_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id uuid NOT NULL REFERENCES player_characters(id),
  story_id text NOT NULL REFERENCES stories(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  current_node text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS story_progress_character_story_idx
  ON story_progress (character_id, story_id);
