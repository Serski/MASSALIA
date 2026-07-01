-- Backfill wife avatars onto pre-fix female candidate rows.
-- Marriage candidates are always female, but before commit f17bcee avatars were
-- assigned sex-blind, so older family_candidates rows hold a MALE placeholder
-- avatar_id (e.g. avatar-20-3) whose art is a .placeholder and renders as nothing.
-- Married spouses never self-heal (the marriage is locked to a consumed row), so
-- give every such row a random wife-NN (01-34, matching content/age/age-config.json).
-- Idempotent: only female rows not already on a wife-* avatar are touched, so a
-- re-run updates 0 rows. random() is evaluated per-row, so faces vary across rows.
UPDATE family_candidates
SET avatar_id = 'wife-' || LPAD((floor(random() * 34) + 1)::int::text, 2, '0')
WHERE sex = 'female'
  AND (avatar_id IS NULL OR avatar_id NOT LIKE 'wife-%');
