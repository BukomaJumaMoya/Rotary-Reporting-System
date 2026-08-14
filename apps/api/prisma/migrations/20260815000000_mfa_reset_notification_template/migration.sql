-- The notification an administrative MFA reset sends.
--
-- A DATA migration rather than a seed row, for the same reason AUTH_PASSWORD_RESET and
-- AUTH_INVITE are: authentication depends on it existing before any district does, and
-- `resetDatabase()` preserves notification_templates precisely so tests do not delete
-- rows nothing recreates.
--
-- The notification is NOT optional. An admin-triggered MFA reset that the account holder
-- never hears about is an account takeover path with a paper trail nobody reads.
INSERT INTO notification_templates (code, channel, subject, body, is_active) VALUES
(
  'AUTH_MFA_RESET',
  'EMAIL',
  'Your two-factor sign-in was reset',
  E'Hello {{firstName}},\n\n'
  'Two-factor sign-in on your Rotaract District Information System account was reset by '
  '{{resetBy}} on {{resetAt}}.\n\n'
  'Your authenticator app and any recovery codes you saved will no longer work. The next '
  'time you sign in you can set up two-factor again from your account settings.\n\n'
  'IF YOU DID NOT EXPECT THIS, tell your district secretary immediately — somebody with '
  'administrative access removed a protection from your account.\n\n'
  'Rotaract District 9218',
  true
)
ON CONFLICT (code) DO NOTHING;
