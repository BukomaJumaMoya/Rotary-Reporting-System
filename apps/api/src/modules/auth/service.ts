import type { MeResponse } from '@dis/contracts';
import { config } from '../../platform/config.js';
import {
  AppError,
  ErrorCode,
  invalidCredentials,
  invalidToken,
  unauthenticated,
} from '../../platform/errors.js';
import { serialiseScopes } from '../../platform/context.js';
import { resolveContext, type ResolvedContext } from '../governance/service.js';
import { notify } from '../notifications/service.js';
import { NotificationTemplate } from '../notifications/templates.js';
import { decryptSecret, encryptSecret, mfaContext } from '../../platform/crypto.js';
import { createEnrolment, verifyCode, type Enrolment } from './mfa.js';
import { generateRecoveryCodes, hashRecoveryCode } from './recovery.js';
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

/**
 * Records a failed attempt and throws — either the ordinary rejection, or the lockout if
 * this failure crossed the threshold.
 *
 * Used for a wrong password AND a wrong TOTP code. A six-digit code is a million
 * possibilities, which is only out of reach if guesses are counted.
 */
async function rejectAttempt(userId: string, error: AppError): Promise<never> {
  const attempts = await repository.recordFailedAttempt(userId, null);
  const duration = lockoutDuration(attempts);

  if (duration !== null) {
    const lockedUntil = new Date(Date.now() + duration);
    await repository.recordFailedAttempt(userId, lockedUntil);
    throw lockedError(lockedUntil);
  }
  throw error;
}

export interface SecondFactor {
  totpCode?: string | undefined;
  recoveryCode?: string | undefined;
}

/**
 * Checks the second factor: an authenticator code, or a recovery code when the
 * authenticator is gone. Throws on failure; returns quietly on success.
 *
 * Both paths are single use — a TOTP code through the step guard, a recovery code
 * through its own redemption — so neither can be replayed by someone who saw it once.
 */
async function verifySecondFactor(user: AuthUser, factor: SecondFactor): Promise<void> {
  if (!user.mfaSecret) return;

  if (factor.recoveryCode) {
    const redeemed = await repository.redeemRecoveryCode(
      user.id,
      hashRecoveryCode(factor.recoveryCode),
    );
    if (!redeemed) {
      await rejectAttempt(
        user.id,
        new AppError(401, ErrorCode.MFA_INVALID, 'That recovery code is not valid'),
      );
    }
    return;
  }

  if (!factor.totpCode) {
    // Not a failed attempt: the password was right, and the client simply has not been
    // asked for a code yet. Counting this would lock out every correct login.
    throw new AppError(401, ErrorCode.MFA_REQUIRED, 'A second factor is required');
  }

  const label = user.person.email ?? user.id;
  const result = verifyCode(
    decryptSecret(user.mfaSecret, mfaContext(user.id)),
    label,
    factor.totpCode,
  );

  if (!result.valid) {
    await rejectAttempt(
      user.id,
      new AppError(401, ErrorCode.MFA_INVALID, 'That code is not valid'),
    );
  }

  // Replay guard: a code already used cannot be used again inside its window.
  const consumed = await repository.consumeMfaStep(user.id, BigInt(result.step));
  if (!consumed) {
    await rejectAttempt(
      user.id,
      new AppError(401, ErrorCode.MFA_INVALID, 'That code has already been used'),
    );
  }
}

export async function login(
  email: string,
  password: string,
  totpCode?: string,
  recoveryCode?: string,
): Promise<AuthUser> {
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
    await rejectAttempt(user.id, invalidCredentials());
  }

  if (user.mfaEnabled && user.mfaSecret) {
    await verifySecondFactor(user, { totpCode, recoveryCode });
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
 * Builds a link into the web client. The base comes from configuration, never from a
 * request header: Host and X-Forwarded-Host are attacker-controlled, and a reset link
 * built from them can be pointed at somebody else's server — a classic account takeover
 * that looks like a legitimate email to the member who receives it.
 */
function clientLink(path: string, token: string): string {
  const url = new URL(path, config.APP_BASE_URL);
  url.searchParams.set('token', token);
  return url.toString();
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

  // Delivery failure is recorded on the notification row, never raised: the token is
  // already stored and the member can simply ask again.
  await notify({
    personId: user.personId,
    templateCode: NotificationTemplate.AUTH_PASSWORD_RESET,
    payload: {
      firstName: user.person.firstName,
      resetUrl: clientLink('/auth/reset', token.plaintext),
      ttlMinutes: String(config.TOKEN_TTL_MINUTES),
    },
  });
}

/**
 * Issues an invitation and emails it.
 *
 * Exported for the governance module (M1), which creates accounts for officers, and for
 * the seed. There is deliberately no HTTP endpoint yet: who may invite whom is a
 * permission question, and permissions do not exist until session 4.
 */
export async function issueInvite(userId: string): Promise<void> {
  const user = await repository.findUserById(userId);
  if (!user) return;

  const token = issueToken(config.INVITE_TTL_MINUTES);
  await repository.createToken({
    userId: user.id,
    purpose: TokenPurpose.INVITE,
    tokenHash: token.hash,
    expiresAt: token.expiresAt,
  });

  await notify({
    personId: user.personId,
    templateCode: NotificationTemplate.AUTH_INVITE,
    payload: {
      firstName: user.person.firstName,
      inviteUrl: clientLink('/auth/accept-invite', token.plaintext),
      ttlMinutes: String(config.INVITE_TTL_MINUTES),
    },
  });
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
 * The account and its context, as `/auth/me` returns it.
 *
 * `detail` is resolved by the context middleware for an authenticated request. Login
 * passes none — the session is created in that same response, so no middleware has run
 * against it yet — and the client gets the context on its first call to `/auth/me`.
 * Resolving it twice inside one login would be two extra round trips to say what the
 * next request says anyway.
 */
export async function toMeResponse(user: AuthUser, detail?: ResolvedContext): Promise<MeResponse> {
  return {
    data: {
      userId: user.id,
      personId: user.personId,
      firstName: user.person.firstName,
      lastName: user.person.lastName,
      status: user.status,
      mfaEnabled: user.mfaEnabled,
      mfaRecoveryCodesRemaining: user.mfaEnabled
        ? await repository.countUnusedRecoveryCodes(user.id)
        : 0,
      context: {
        districtId: detail?.districtId ?? null,
        districtName: detail?.districtName ?? null,
        rotaryYearId: detail?.rotaryYearId ?? null,
        rotaryYearLabel: detail?.rotaryYearLabel ?? null,
        isYearLocked: detail?.isYearLocked ?? false,
        isYearWritable: detail?.isYearWritable ?? false,
        permissions: detail?.permissions ?? [],
        scopes: detail?.context
          ? serialiseScopes(detail.context.scopes)
          : { clubIds: [], clusterIds: [], isDistrictWide: false },
      },
      appointments: detail ? await detail.listAppointments() : [],
    },
  };
}

/**
 * Resolves the caller's context for a response that needs one but has no middleware
 * behind it — which is login, where the session is created in the very response being
 * built.
 *
 * Without this, login answers with a context of nulls that is indistinguishable from
 * "you hold no appointment", and a client rendering straight from the login response
 * shows a member with real authority a page saying they have none.
 */
export async function contextFor(user: AuthUser): Promise<ResolvedContext> {
  return resolveContext({ userId: user.id, personId: user.personId });
}

export async function currentUser(userId: string): Promise<AuthUser | null> {
  return repository.findUserById(userId);
}

/**
 * Starts MFA enrolment: generates a secret and stores it WITHOUT enabling anything.
 *
 * Enabling here would lock a member out of their own account the moment they lost the QR
 * code — they must prove the authenticator works first, via /auth/mfa/verify.
 *
 * Re-enrolling is allowed while MFA is off (a scan that did not take), and refused once
 * it is on, where replacing the secret would be an account takeover from a hijacked
 * session.
 */
export async function beginMfaEnrolment(userId: string): Promise<Enrolment> {
  const user = await repository.findUserById(userId);
  if (!user) throw unauthenticated();

  if (user.mfaEnabled) {
    throw new AppError(409, ErrorCode.MFA_ALREADY_ENABLED, 'Two-factor sign-in is already on');
  }

  const enrolment = createEnrolment(user.person.email ?? user.id);
  // Encrypted before it touches the database, bound to this user id.
  await repository.stageMfaSecret(user.id, encryptSecret(enrolment.secret, mfaContext(user.id)));
  return enrolment;
}

/**
 * Confirms enrolment. Only a working code turns MFA on, and doing so issues the recovery
 * codes — returned once, here, and never retrievable again.
 */
export async function confirmMfaEnrolment(userId: string, code: string): Promise<string[]> {
  const user = await repository.findUserById(userId);
  if (!user) throw unauthenticated();

  if (user.mfaEnabled) {
    throw new AppError(409, ErrorCode.MFA_ALREADY_ENABLED, 'Two-factor sign-in is already on');
  }
  if (!user.mfaSecret) {
    throw new AppError(409, ErrorCode.MFA_NOT_ENROLLED, 'Start enrolment before verifying a code');
  }

  const label = user.person.email ?? user.id;
  const result = verifyCode(decryptSecret(user.mfaSecret, mfaContext(user.id)), label, code);
  if (!result.valid) {
    await rejectAttempt(
      user.id,
      new AppError(401, ErrorCode.MFA_INVALID, 'That code is not valid'),
    );
  }

  const consumed = await repository.consumeMfaStep(user.id, BigInt(result.step), { enable: true });
  if (!consumed) {
    throw new AppError(401, ErrorCode.MFA_INVALID, 'That code has already been used');
  }

  return issueRecoveryCodes(user.id);
}

/** Generates a fresh set, stores only their hashes, and returns the plaintext once. */
async function issueRecoveryCodes(userId: string): Promise<string[]> {
  const codes = generateRecoveryCodes();
  await repository.replaceRecoveryCodes(userId, codes.map(hashRecoveryCode));
  return codes;
}

/**
 * Issues a new set, invalidating the old one. Requires the password and a second factor
 * — either an authenticator code or one of the remaining recovery codes, so a member
 * down to their last code can refill without an administrator.
 */
export async function regenerateRecoveryCodes(
  userId: string,
  password: string,
  factor: SecondFactor,
): Promise<string[]> {
  const user = await repository.findUserById(userId);
  if (!user?.passwordHash) throw unauthenticated();

  if (!user.mfaEnabled || !user.mfaSecret) {
    throw new AppError(409, ErrorCode.MFA_NOT_ENROLLED, 'Two-factor sign-in is not on');
  }

  const passwordOk = await verifyPassword(user.passwordHash, password);
  if (!passwordOk) {
    await rejectAttempt(user.id, invalidCredentials());
  }

  await verifySecondFactor(user, factor);
  return issueRecoveryCodes(user.id);
}

export async function recoveryCodesRemaining(userId: string): Promise<number> {
  return repository.countUnusedRecoveryCodes(userId);
}

/**
 * Turns MFA off. Requires the password AND a second factor.
 *
 * A hijacked session alone must not be able to strip the second factor — that would make
 * MFA worth nothing precisely when it matters. A recovery code is accepted in place of an
 * authenticator code, because this is the path for the member whose phone is gone, and
 * requiring the authenticator in order to remove the authenticator is a trap.
 */
export async function disableMfa(
  userId: string,
  password: string,
  factor: SecondFactor,
): Promise<void> {
  const user = await repository.findUserById(userId);
  if (!user?.passwordHash) throw unauthenticated();

  if (!user.mfaEnabled || !user.mfaSecret) {
    throw new AppError(409, ErrorCode.MFA_NOT_ENROLLED, 'Two-factor sign-in is not on');
  }

  const passwordOk = await verifyPassword(user.passwordHash, password);
  if (!passwordOk) {
    await rejectAttempt(user.id, invalidCredentials());
  }

  await verifySecondFactor(user, factor);
  await repository.disableMfa(user.id);
}
