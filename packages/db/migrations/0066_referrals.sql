-- The invite promo (invite prompt 1). Identifiers say referral so nothing
-- reads like the koinon's invitations (koinon_invites).
--   users.referral_code  each account's code for its link,
--                        playmassalia.com/?invite=CODE: ten upper-case hex
--                        characters from the column default, which also fills
--                        every existing row (a volatile default is evaluated
--                        per row)
--   referrals            one row per account that signed up through a link:
--                        who invited it and the world active at sign-up. An
--                        account signs up once, so the invitee is the key.
--                        paid_at / paid_character_id are stamped when the
--                        invited player first takes a seat in that world and
--                        the inviter's character there is paid.
-- Idempotent, one transaction.
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code text NOT NULL
  DEFAULT upper(substr(md5(random()::text || clock_timestamp()::text), 1, 10));
CREATE UNIQUE INDEX IF NOT EXISTS users_referral_code_idx ON users (referral_code);

CREATE TABLE IF NOT EXISTS referrals (
  invitee_user_id uuid PRIMARY KEY REFERENCES users(id),
  inviter_user_id uuid NOT NULL REFERENCES users(id),
  world_id uuid NOT NULL REFERENCES worlds(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  paid_character_id uuid REFERENCES player_characters(id),
  CHECK (invitee_user_id <> inviter_user_id)
);
CREATE INDEX IF NOT EXISTS referrals_inviter_world_idx ON referrals (inviter_user_id, world_id);
