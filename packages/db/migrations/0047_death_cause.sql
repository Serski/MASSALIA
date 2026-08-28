-- Death cause on each succession handoff — feeds the murder death card and the
-- chronicle's death entries. Nullable, additive, no backfill: the single
-- pre-existing death keeps a NULL cause (which reads as a plain death everywhere).
-- Values written going forward: 'natural' | 'assassinated' | 'poison' | 'mercenary'
-- (only for death handoffs; a regent-maturation handoff leaves it NULL). See
-- services/succession.ts (resolveDeathCause) and packages/db/src/chronicle.ts.
ALTER TABLE successions ADD COLUMN IF NOT EXISTS cause text;
