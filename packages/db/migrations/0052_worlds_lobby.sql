ALTER TABLE worlds ADD COLUMN tagline text;
ALTER TABLE worlds ADD CONSTRAINT worlds_status_check CHECK (status IN ('announced', 'active', 'ended'));
