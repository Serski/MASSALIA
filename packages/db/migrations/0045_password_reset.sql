-- Password reset tokens. Mirrors the session-token discipline: a random token is
-- generated, only its SHA-256 hash is stored here (never the raw value), and the
-- raw token travels solely in the emailed reset link. 60-minute TTL; newest-only
-- (older unused tokens for a user are marked used when a new one is issued);
-- single-use (used_at guards consumption). See services/auth.ts.
CREATE TABLE password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens (user_id, created_at);
