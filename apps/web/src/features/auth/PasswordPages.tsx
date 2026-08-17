import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AuthShell } from '../../components/layout/AppShell';
import { Button, Input } from '../../components/ui';
import { api, ApiError } from '../../lib/api';

/**
 * Forgotten password.
 *
 * ALWAYS reports success, whether or not the address has an account. A page that answers
 * "no such account" is an account-existence oracle open to the internet, and this system
 * exists partly because its predecessor treated member data as public.
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isSent, setIsSent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    // The server returns 204 either way; a failure here is a network problem, and even
    // then the member should not learn anything about the address.
    await api.post('/auth/password/forgot', { email }).catch(() => undefined);
    setIsSubmitting(false);
    setIsSent(true);
  };

  if (isSent) {
    return (
      <AuthShell title="Check your email">
        <p className="text-text-secondary text-table">
          If an account exists for {email}, a reset link is on its way. The link is valid for one
          hour and can be used once.
        </p>
        <Link to="/login" className="text-info mt-4 block text-center text-table underline">
          Back to sign in
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Reset your password" subtitle="We will email you a link.">
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <Input
          label="Email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Button type="submit" isLoading={isSubmitting} fullWidth>
          Send the link
        </Button>
        <Link to="/login" className="text-info text-center text-table underline">
          Back to sign in
        </Link>
      </form>
    </AuthShell>
  );
}

/** Shared by reset and invite: the same password rules, the same two fields. */
function usePasswordForm() {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const mismatch = confirmation.length > 0 && password !== confirmation;

  return { password, setPassword, confirmation, setConfirmation, mismatch };
}

export function ResetPasswordPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const form = usePasswordForm();
  const [error, setError] = useState<ApiError | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (form.mismatch) return;

    setError(null);
    setIsSubmitting(true);
    try {
      await api.post('/auth/password/reset', { token, password: form.password });
      navigate('/login', { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : null);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthShell title="Choose a new password">
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <Input
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          value={form.password}
          onChange={(event) => form.setPassword(event.target.value)}
          hint="At least 12 characters. Length matters more than symbols — a passphrase is fine."
          error={error?.fieldErrors['password']}
        />
        <Input
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          required
          value={form.confirmation}
          onChange={(event) => form.setConfirmation(event.target.value)}
          error={form.mismatch ? 'The two passwords do not match' : undefined}
        />

        {error && (
          <p role="alert" className="text-danger-text text-table">
            {error.message}
          </p>
        )}

        <Button type="submit" isLoading={isSubmitting} fullWidth>
          Set my password
        </Button>
      </form>
    </AuthShell>
  );
}

/**
 * Accepting an invitation.
 *
 * The consent checkbox is what writes the `consents` row, with the policy version and the
 * source IP. It must be given EXPLICITLY rather than inferred from the act of setting a
 * password — a consent record that can be assumed is not a demonstrable lawful basis
 * under the DPPA 2019.
 */
export function AcceptInvitePage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const form = usePasswordForm();
  const [acceptsDataProcessing, setAcceptsDataProcessing] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (form.mismatch || !acceptsDataProcessing) return;

    setError(null);
    setIsSubmitting(true);
    try {
      await api.post('/auth/invite/accept', {
        token,
        password: form.password,
        acceptsDataProcessing: true,
      });
      navigate('/login', { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : null);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthShell title="Set up your account" subtitle="Rotaract District 9218">
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <Input
          label="Choose a password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          value={form.password}
          onChange={(event) => form.setPassword(event.target.value)}
          hint="At least 12 characters."
          error={error?.fieldErrors['password']}
        />
        <Input
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          required
          value={form.confirmation}
          onChange={(event) => form.setConfirmation(event.target.value)}
          error={form.mismatch ? 'The two passwords do not match' : undefined}
        />

        <label className="flex min-h-11 items-start gap-3 text-table">
          <input
            type="checkbox"
            required
            checked={acceptsDataProcessing}
            onChange={(event) => setAcceptsDataProcessing(event.target.checked)}
            className="mt-1 h-5 w-5 shrink-0"
          />
          <span className="text-text-secondary">
            I agree to the district processing my personal data to administer club membership,
            activity and assessment. My contact details stay private unless I choose otherwise.
          </span>
        </label>

        {error && (
          <p role="alert" className="text-danger-text text-table">
            {error.message}
          </p>
        )}

        <Button type="submit" isLoading={isSubmitting} fullWidth disabled={!acceptsDataProcessing}>
          Create my account
        </Button>
      </form>
    </AuthShell>
  );
}
