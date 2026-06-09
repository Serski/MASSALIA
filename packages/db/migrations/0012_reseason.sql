-- Re-season: 1 real day = 1 in-game season, run extended to 182 days, and the
-- dead per-day action counter removed (the daily decision set is the budget now).
--
-- Pre-launch with test players only — no progress to preserve. Resetting the
-- world clock restarts the in-game date at Winter, 300 BC. It does NOT delete
-- test characters; it only resets the date label.
UPDATE worlds
SET started_at = now(),
    ends_at = now() + interval '182 days'
WHERE status = 'active';

-- Drop the retired action economy columns.
ALTER TABLE player_characters DROP COLUMN IF EXISTS actions_spent_today;
ALTER TABLE player_characters DROP COLUMN IF EXISTS last_action_reset;
