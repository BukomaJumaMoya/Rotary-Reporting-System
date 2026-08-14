import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { MeResponse } from '@dis/contracts';
import { AuthShell } from '../../components/layout/AppShell';
import { Button, Input } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { authQueryKey } from './useAuth';

/**
 * Sign in.
 *
 * ONE STEP, ATTEMPTED TWICE — not a half-authenticated session (docs/05-API-Spec.md §2).
 * If the account has a second factor the server answers 401 MFA_REQUIRED and issues no
 * cookie; the client then resends the same credentials with the code. A session that
 * exists but is not yet trusted is a state every later check must remember to consider,
 * and the one that forgets is an authentication bypass.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [secondFactor, setSecondFactor] = useState('');
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [needsSecondFactor, setNeedsSecondFactor] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const me = await api.post<MeResponse>(
        '/auth/login',
        {
          email,
          password,
          ...(needsSecondFactor && secondFactor
            ? useRecoveryCode
              ? { recoveryCode: secondFactor }
              : { totpCode: secondFactor }
            : {}),
        },
        // A wrong password here is an answer, not an expired session. Bouncing to /login
        // from /login is a loop the member cannot escape.
        { allowUnauthenticated: true },
      );

      // Seed the cache from the login response, which already carries the resolved
      // context — so the dashboard renders without a second round trip.
      queryClient.setQueryData(authQueryKey, me);
      navigate('/', { replace: true });
    } catch (caught) {
      const apiError = caught instanceof ApiError ? caught : null;

      if (apiError?.code === 'MFA_REQUIRED') {
        setNeedsSecondFactor(true);
        setError(null);
      } else {
        setError(apiError);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const fields = error?.fieldErrors ?? {};

  return (
    <AuthShell title="Sign in" subtitle="Rotaract District Information System">
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <Input
          label="Email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fields['email']}
          disabled={needsSecondFactor}
        />
        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={fields['password']}
          disabled={needsSecondFactor}
        />

        {needsSecondFactor && (
          <>
            <Input
              label={useRecoveryCode ? 'Recovery code' : 'Authenticator code'}
              inputMode={useRecoveryCode ? 'text' : 'numeric'}
              autoComplete="one-time-code"
              autoFocus
              required
              value={secondFactor}
              onChange={(event) => setSecondFactor(event.target.value)}
              hint={
                useRecoveryCode
                  ? 'One of the ten codes you saved when you turned on two-factor sign-in.'
                  : 'The 6-digit code from your authenticator app.'
              }
            />
            <button
              type="button"
              className="text-azure-600 self-start text-sm underline"
              onClick={() => {
                setUseRecoveryCode((current) => !current);
                setSecondFactor('');
              }}
            >
              {useRecoveryCode ? 'Use my authenticator app instead' : 'I have lost my phone'}
            </button>
          </>
        )}

        {error && (
          <p role="alert" className="text-danger-700 text-sm">
            {error.message}
          </p>
        )}

        <Button type="submit" isLoading={isSubmitting} fullWidth>
          {needsSecondFactor ? 'Verify and sign in' : 'Sign in'}
        </Button>

        <Link to="/forgot" className="text-azure-600 text-center text-sm underline">
          Forgotten your password?
        </Link>
      </form>
    </AuthShell>
  );
}
