-- When an invitation or reset link was issued.
--
-- The outstanding-invitations screen (M1 session 5) lists who is sitting on an unused
-- invitation and for how long, which cannot be answered from `expires_at` alone without
-- assuming the TTL never changed.
--
-- DEFAULT now() rather than a backfill with a guessed value: existing rows are
-- development and test tokens with a lifetime measured in minutes.
ALTER TABLE user_tokens
  ADD COLUMN created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now();
