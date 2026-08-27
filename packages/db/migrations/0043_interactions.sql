-- Player→player interactions (Interaction Pipeline, Prompt 1). The append-only
-- ledger every player-to-player action rides: an actor acts on a target, with a
-- free-form typed payload. Prompt 1 actions (give drachmae) resolve instantly, so
-- there is no status column yet — contested resolution (poison, assassination)
-- will store its outcome inside `payload` when it lands.
CREATE TABLE interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id),
  actor_character_id uuid NOT NULL REFERENCES player_characters(id),
  target_character_id uuid NOT NULL REFERENCES player_characters(id),
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX interactions_target_idx ON interactions (target_character_id, created_at);
CREATE INDEX interactions_actor_idx ON interactions (actor_character_id, created_at);
