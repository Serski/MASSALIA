-- Political alignment on a -100..+100 spectrum: negative = Reformist (Dynatoi),
-- positive = Conservative (Palaioi), 0 = centrist. Additive, defaults to centre.
-- Nothing moves it yet; the event engine will adjust it later.
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS alignment integer NOT NULL DEFAULT 0;
