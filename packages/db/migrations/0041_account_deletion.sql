-- Account deletion (anonymize-and-detach): a tombstone timestamp on users. Set at
-- deletion time alongside scrubbed email/passwordHash; NULL for every live account.
-- Idempotent (mirrors 0002); no backfill — existing rows stay NULL (live).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
