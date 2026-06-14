-- The hoplite's mercenary RISK (Hoplite Step 4) — death/injury/scare at contract
-- completion, wired into the EXISTING succession flow. Additive only.
--
-- successions.note: a free-text chronicle line for the dynasty handoff. A glorious
-- mercenary death records "<name> fell <setting>, season <n>" here; old-age and
-- other handoffs leave it NULL. Surfaced in the dynasty history (dynastyInfo).
ALTER TABLE successions
  ADD COLUMN IF NOT EXISTS note text;

-- player_characters.pending_death_note: carries the composed death chronicle line
-- from the death instant (settleMercContract, marks the character 'deceased') to
-- heir resolution (becomeHeir reads it into successions.note, then clears it).
ALTER TABLE player_characters
  ADD COLUMN IF NOT EXISTS pending_death_note text;
