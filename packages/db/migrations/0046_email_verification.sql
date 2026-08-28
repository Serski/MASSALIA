-- Soft email verification. A verify link is emailed on register; verification is
-- non-blocking (a banner nags until done). Same token discipline as sessions and
-- password resets: a random token is generated, only its SHA-256 hash is stored,
-- 24-hour TTL, newest-only, single-use. `users.email_verified_at` is the flag
-- (NULL = unverified). Using a password-reset link also sets it (owning the inbox
-- is proven either way). See services/auth.ts.
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;

CREATE TABLE email_verification_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_verification_tokens_user_idx ON email_verification_tokens (user_id, created_at);
