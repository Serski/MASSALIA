-- Anti-multi-account and admin tooling.
--   users:    is_admin flag; banned_at + ban_reason (a banned user's sessions no
--             longer authenticate; login is refused with the reason).
--   sessions: the client IP and user agent recorded at creation.
--   auth_events: one row per register / login / reset / verify with ip + user agent,
--             indexed by (ip, created_at) for the same-IP cluster view.
--   admin_audit: one row per admin API call (who, what, on whom, detail).
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason text;

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ip inet;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_agent text;

CREATE TABLE IF NOT EXISTS auth_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('register', 'login', 'reset', 'verify')),
  ip inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_events_ip_created_idx ON auth_events (ip, created_at);
CREATE INDEX IF NOT EXISTS auth_events_user_created_idx ON auth_events (user_id, created_at);

CREATE TABLE IF NOT EXISTS admin_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL,
  target_user_id uuid REFERENCES users(id),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_audit_created_idx ON admin_audit (created_at);
