-- Diplomacy D1 — migrate faction relations to a −200..+200 opinion bar.
-- The opinion integer becomes the source of truth; the five middle stances
-- (hostile..cordial) are now DISPLAY BANDS computed from it (see opinionBand in
-- @massalia/shared), and War/Allied become latched status flags (at_war/allied)
-- like the existing `vassal` flag rather than stance rungs.
--
-- Additive + idempotent: ADD COLUMN IF NOT EXISTS, and the backfill only touches
-- rows still at the freshly-added default (opinion = 0), so re-running it will not
-- clobber an opinion an event has since moved. The legacy `stance` column is kept
-- (now derived/harmless) to minimise risk — it is not dropped here.
ALTER TABLE faction_relations ADD COLUMN IF NOT EXISTS opinion integer NOT NULL DEFAULT 0;
ALTER TABLE faction_relations ADD COLUMN IF NOT EXISTS at_war boolean NOT NULL DEFAULT false;
ALTER TABLE faction_relations ADD COLUMN IF NOT EXISTS allied boolean NOT NULL DEFAULT false;

-- Backfill opinion from the existing stance string at each band's MIDPOINT so the
-- bar shows the same relation it did before (no visible jump). war/allied also set
-- their latched flag and pin opinion to the extreme. Gated on opinion = 0 so it is
-- idempotent: neutral rows already sit at 0 (no-op), and any row an event later
-- moves off 0 is skipped on a re-run.
UPDATE faction_relations SET
  opinion = CASE stance
    WHEN 'war'        THEN -200
    WHEN 'hostile'    THEN -137
    WHEN 'unfriendly' THEN  -45
    WHEN 'neutral'    THEN    0
    WHEN 'friendly'   THEN   45
    WHEN 'cordial'    THEN  137
    WHEN 'allied'     THEN  200
    ELSE 0
  END,
  at_war = (stance = 'war'),
  allied = (stance = 'allied')
WHERE opinion = 0;
