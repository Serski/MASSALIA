-- Marks a daily card that expired unresolved and was then resolved lazily (at the
-- player's next login) to its event's defaultChoiceId. Additive, no backfill:
-- every existing row (player-resolved or plain-expired) reads false. See
-- services/dailyDecisions.ts (applyExpiredDefaults).
ALTER TABLE daily_decisions ADD COLUMN IF NOT EXISTS resolved_by_default boolean NOT NULL DEFAULT false;
