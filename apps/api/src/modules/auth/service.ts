import type { MeResponse } from '@dis/contracts';
import { config, isProduction } from '../../platform/config.js';
import { AppError, ErrorCode, invalidCredentials, invalidToken } from '../../platform/errors.js';
import { consumeTimingBudget, hashPassword, verifyPassword } from './passwords.js';
import * as repository from './repository.js';
import type { AuthUser } from './repository.js';
import { hashToken, issueToken, TokenPurpose } from './tokens.js';

/**
 * Lockout delay: base × 2^(failures beyond the threshold), capped.
 *
 * With the defaults (5 attempts, 5 minutes, 24h cap) the 5th failure costs 5 minutes,
 * the 6th 10, the 7th 20 — an automated attack slows to nothing within a dozen guesses,
 * while a member who mistypes their password twice notices nothing at all.
 */
export function lockoutDuration(failedAttempts: number): number | null {
  const threshold = config.LOGIN_RATE_MAX_ATTEMPTS;
  if (failedAttempts < threshold) return null;

  const overage = failedAttempts - threshold;
  const minutes = Math.min(config.LOCKOUT_BASE_MINUTES * 2 ** overage, config.LOCKOUT_MAX_MINUTES);
  return minutes * 60 * 1000;
}

function lockedError(lockedUntil: Date): AppError {
  const retryAfterSeconds = Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 1000));
  return new AppError(423, ErrorCode.ACCOUNT_LOCKED, 'Account temporarily locked', {
    retryAfterSeconds,
  });
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const user = await repository.findUserByEmail(email);

  if (!user || !user.passwordHash) {
    // Spend the same time as a real verify so the endpoint cannot be used to discover
    // which addresses have accounts, then fail identically.
    await consumeTimingBudget(password);
    throw invalidCredentials();
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    throw lockedError(user.lockedUntil);
  }

  const ok = await verifyPassword(user.passwordHash, password);

  if (!ok) {
    // Increment first: the new count decides whether this failure starts a lockout.
    const attempts = await repository.recordFailedAttempt(user.id, null);
    const duration = lockoutDuration(attempts);
    if (duration !== null) {
      const lockedUntil = new Date(Date.now() + duration);
      await repository.recordFailedAttempt(user.id, lockedUntil);
      throw lockedError(lockedUntil);
    }
    throw invalidCredentials();
  }

  if (user.status === 'SUSPENDED' || user.status === 'DISABLED') {
    // Checked only after the password verifies, so the endpoint does not reveal account
    // states to someone who does not hold the credentials.
    throw new AppError(403, ErrorCode.ACCOUNT_NOT_ACTIVE, 'This account is not active');
  }

  if (user.status === 'INVITED') {
    throw new AppError(
      403,
      ErrorCode.ACCOUNT_NOT_ACTIVE,
      'This invitation has not been accepted yet',
    );
  }

  await repository.recordSuccessfulLogin(user.id);
  return user;
}

/**
 * Always succeeds from the caller's point of view. An unknown address does the same
 * work and returns the same 204, because an endpoint that answers "no such account"
 * is an account-existence oracle open to the internet.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await repository.findUserByEmail(email);
  if (!user) return;

  const token = issueToken(config.TOKEN_TTL_MINUTES);
  await repository.createToken({
    userId: user.id,
    purpose: TokenPurpose.RESET,
    tokenHash: token.hash,
    expiresAt: token.expiresAt,
  });

  // TODO(M0 s6 / notifications): enqueue the email. No mail transport exists yet, so in
  // development the link is logged and in production nothing is delivered — the endpoint
  // is complete but not yet useful to a real member.
  if (!isProduction) {
    console.log(`[auth] password reset token for ${email}: ${token.plaintext}`);
  }
}

async function consumeToken(
  plaintext: string,
  purpose: string,
): Promise<{ tokenId: string; user: AuthUser }> {
  const record = await repository.findTokenByHash(hashToken(plaintext));

  // Unknown, wrong-purpose, already used and expired all produce ONE response, so a
  // probe cannot learn which tokens were ever real.
  if (!record || record.purpose !== purpose) throw invalidToken();
  if (record.consumedAt !== null) throw invalidToken();
  if (record.expiresAt.getTime() <= Date.now()) throw invalidToken();

  const user = await repository.findUserById(record.userId);
  if (!user) throw invalidToken();

  return { tokenId: record.id, user };
}

export async function resetPassword(plaintext: string, newPassword: string): Promise<void> {
  const { tokenId, user } = await consumeToken(plaintext, TokenPurpose.RESET);

  const consumed = await repository.consumeTokenAndSetPassword({
    tokenId,
    userId: user.id,
    passwordHash: await hashPassword(newPassword),
    // A reset does not activate an invited account; that is what invite/accept is for.
    activateUser: false,
  });

  // Lost the race with a concurrent use of the same token.
  if (!consumed) throw invalidToken();
}

export async function acceptInvite(
  plaintext: string,
  newPassword: string,
  sourceIp: string | null,
): Promise<void> {
  const { tokenId, user } = await consumeToken(plaintext, TokenPurpose.INVITE);

  const consumed = await repository.consumeTokenAndSetPassword({
    tokenId,
    userId: user.id,
    passwordHash: await hashPassword(newPassword),
    activateUser: true,
    consent: {
      policyVersion: config.PRIVACY_POLICY_VERSION,
      sourceIp,
      personId: user.personId,
    },
  });

  if (!consumed) throw invalidToken();
}

/**
 * The stub context. Session 4 replaces the nulls and empty arrays with values derived
 * from the caller's active appointments — this shape is already the final one so the
 * client can be built against it now.
 */
export function toMeResponse(user: AuthUser): MeResponse {
  return {
    data: {
      userId: user.id,
      personId: user.personId,
      firstName: user.person.firstName,
      lastName: user.person.lastName,
      status: user.status,
      mfaEnabled: user.mfaEnabled,
      context: {
        districtId: null,
        rotaryYearId: null,
        permissions: [],
        scopes: { clubIds: [], clusterIds: [], isDistrictWide: false },
      },
    },
  };
}

export async function currentUser(userId: string): Promise<AuthUser | null> {
  return repository.findUserById(userId);
}
