-- Spymaster posture (Interaction Pipeline, Prompt 4). The spymaster is a singleton
-- household pop whose posture buffs the hidden hostile channels: 'guard' adds flat
-- defense to BOTH channels when someone targets the owner; 'hunt' adds a flat bonus
-- to the owner's own hostile attempts. One switch per season (24h cooldown), tracked
-- by the changed-at anchor. Posture persists across hire/dismiss (harmless when no
-- spymaster is retained) and rides succession with the reused character row.
ALTER TABLE player_characters
  ADD COLUMN spymaster_posture text NOT NULL DEFAULT 'guard',
  ADD COLUMN spymaster_posture_changed_at timestamptz;
