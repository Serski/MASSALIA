-- Rename the "military-leader" profession to "hoplite" across all references.
-- FKs (players, characters, profession_ladders) point at professions.slug, so
-- insert the new row, repoint references, then drop the old row.
INSERT INTO professions (slug, name, initial, rank, income, hard_mode, data)
  SELECT 'hoplite', 'Hoplite', initial, rank, income, hard_mode,
         jsonb_set(jsonb_set(data, '{slug}', '"hoplite"'), '{name}', '"Hoplite"')
  FROM professions WHERE slug = 'military-leader'
  ON CONFLICT (slug) DO NOTHING;

UPDATE profession_ladders SET profession_slug = 'hoplite' WHERE profession_slug = 'military-leader';
UPDATE players SET profession_slug = 'hoplite' WHERE profession_slug = 'military-leader';
UPDATE characters SET profession_slug = 'hoplite' WHERE profession_slug = 'military-leader';

DELETE FROM professions WHERE slug = 'military-leader';
