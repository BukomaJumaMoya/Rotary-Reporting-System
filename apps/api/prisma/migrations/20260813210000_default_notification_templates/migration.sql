-- Default notification templates.
--
-- These are DATA, not code: the PIME Chair or district secretary edits the wording in
-- the UI without a deployment. They are inserted by a migration rather than left to the
-- seed because authentication depends on them — a password reset with no template row
-- fails, and the seed only ever runs on a development machine.
--
-- ON CONFLICT DO NOTHING so an environment that has already edited its wording keeps it.

INSERT INTO notification_templates (code, channel, subject, body, is_active) VALUES
(
  'AUTH_PASSWORD_RESET',
  'EMAIL',
  'Reset your Rotaract DIS password',
  E'Hello {{firstName}},\n\n'
  'Someone asked to reset the password for your Rotaract District Information System '
  'account. If that was you, open the link below within {{ttlMinutes}} minutes:\n\n'
  '{{resetUrl}}\n\n'
  'If it was not you, you can ignore this message — your password has not changed, and '
  'the link above will expire on its own.\n\n'
  'Rotaract District 9218',
  TRUE
),
(
  'AUTH_INVITE',
  'EMAIL',
  'Your Rotaract DIS account',
  E'Hello {{firstName}},\n\n'
  'An account has been created for you on the Rotaract District Information System. '
  'Open the link below within {{ttlMinutes}} minutes to set your password and accept '
  'the data processing notice:\n\n'
  '{{inviteUrl}}\n\n'
  'Rotaract District 9218',
  TRUE
)
ON CONFLICT (code) DO NOTHING;
