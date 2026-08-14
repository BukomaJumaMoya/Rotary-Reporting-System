import {
  forgotPasswordRequestSchema,
  inviteAcceptRequestSchema,
  loginRequestSchema,
  mfaDisableRequestSchema,
  mfaRegenerateRecoveryRequestSchema,
  mfaVerifyRequestSchema,
  resetPasswordRequestSchema,
} from '@dis/contracts';
import { Router } from 'express';
import type { Request } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { AuditAction, identifyActor } from '../../platform/audit.js';
import { config } from '../../platform/config.js';
import { recordAction } from '../../platform/db.js';
import { AppError, ErrorCode, unauthenticated } from '../../platform/errors.js';
import { asyncHandler, rawStringField, withBody } from '../../platform/validate.js';
import * as service from './service.js';

export const authRouter: Router = Router();

/** express-session's callbacks are Node-style; promisified here so routes stay linear. */
function promisify(operation: (callback: (error?: unknown) => void) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    operation((error) => {
      if (error) {
        // Never stringify the raw value: a non-Error rejection would serialise as
        // "[object Object]" and lose whatever the store actually reported.
        reject(error instanceof Error ? error : new Error('Session store operation failed'));
        return;
      }
      resolve();
    });
  });
}

/**
 * Throttles guessing before it reaches Argon2, which is deliberately expensive: without
 * this, the login endpoint is also a way to burn the server's CPU.
 *
 * Keyed on IP + email so one attacker cannot lock out an entire office behind a shared
 * NAT address, while a distributed attack on a single account still trips the
 * per-account lockout in the service.
 *
 * Memory store: this is one HTTP process, and ADR-001 rules out Redis. If the API is
 * ever scaled horizontally this must move to a shared store, or each instance will
 * allow the full quota independently.
 */
const loginRateLimit = rateLimit({
  windowMs: config.LOGIN_RATE_WINDOW_MINUTES * 60 * 1000,
  limit: config.LOGIN_RATE_MAX_ATTEMPTS,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    // Runs before validation, so the body is untrusted and untyped here.
    const email = rawStringField(req.body, 'email')?.toLowerCase() ?? 'unknown';
    // ipKeyGenerator normalises IPv6 to a /64 prefix — otherwise a single client can
    // hop addresses within its own subnet to reset the counter.
    return `${ipKeyGenerator(req.ip ?? 'unknown')}:${email}`;
  },
  handler: (_req, _res, next) => {
    next(
      new AppError(429, ErrorCode.RATE_LIMITED, 'Too many attempts. Try again later.', {
        retryAfterSeconds: config.LOGIN_RATE_WINDOW_MINUTES * 60,
      }),
    );
  },
});

/** Reads the caller's user id from the session, or refuses. */
function requireSession(req: Request): string {
  const userId = req.session.userId;
  if (!userId) throw unauthenticated();
  return userId;
}

/**
 * MFA endpoints are authenticated, so the session identifies the account and the limiter
 * keys on it rather than on a body field. Same budget as login: a six-digit code has a
 * million possibilities, which only matters if guesses are counted.
 */
const mfaRateLimit = rateLimit({
  windowMs: config.LOGIN_RATE_WINDOW_MINUTES * 60 * 1000,
  limit: config.LOGIN_RATE_MAX_ATTEMPTS,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req: Request) =>
    `mfa:${ipKeyGenerator(req.ip ?? 'unknown')}:${req.session.userId ?? 'anonymous'}`,
  handler: (_req, _res, next) => {
    next(
      new AppError(429, ErrorCode.RATE_LIMITED, 'Too many attempts. Try again later.', {
        retryAfterSeconds: config.LOGIN_RATE_WINDOW_MINUTES * 60,
      }),
    );
  },
});

authRouter.post(
  '/login',
  loginRateLimit,
  ...withBody(loginRequestSchema, async ({ body, req, res }) => {
    const user = await service.login(body.email, body.password, body.totpCode, body.recoveryCode);

    // Session fixation: a session id issued before authentication must not survive it.
    await promisify((cb) => req.session.regenerate(cb));
    req.session.userId = user.id;
    await promisify((cb) => req.session.save(cb));

    // Resolved BEFORE the audit row, and before the response.
    //
    // Before the response, because the context middleware ran while this session did not
    // yet exist — without this the login body reports no district and no permissions, the
    // same shape as a member who holds no appointment at all.
    //
    // Before the audit row, because the actor store was opened anonymous and a LOGIN
    // written without a district is a LOGIN no district administrator can ever see. "Who
    // was in the system, and when" is the first question asked after an incident.
    const detail = await service.contextFor(user);
    identifyActor({ userId: user.id, districtId: detail.districtId });

    await recordAction(AuditAction.LOGIN, { entityType: 'users', entityId: user.id });

    res.status(200).json(await service.toMeResponse(user, detail));
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    if (!req.session.userId) {
      // Idempotent: logging out when not logged in is not an error.
      res.status(204).end();
      return;
    }

    // Recorded before the session is destroyed, while the actor is still identifiable.
    await recordAction(AuditAction.LOGOUT, {
      entityType: 'users',
      entityId: req.session.userId,
    });
    await promisify((cb) => req.session.destroy(cb));
    res.clearCookie(config.SESSION_COOKIE_NAME, { path: '/' });
    res.status(204).end();
  }),
);

authRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const userId = req.session.userId;
    if (!userId) throw unauthenticated();

    const user = await service.currentUser(userId);
    if (!user) {
      // The account was deleted or soft-deleted while the session lived. Sessions are
      // revocable precisely so that ends access immediately (ADR-003).
      await promisify((cb) => req.session.destroy(cb));
      throw unauthenticated();
    }

    // Resolved by the context middleware, and absent for a member who holds no active
    // appointment — which is not an error. They sign in, they see their own account, and
    // every scoped endpoint refuses them.
    res.status(200).json(await service.toMeResponse(user, req.contextDetail));
  }),
);

authRouter.post(
  '/password/forgot',
  ...withBody(forgotPasswordRequestSchema, async ({ body, res }) => {
    await service.requestPasswordReset(body.email);
    // ALWAYS 204, whether or not the address has an account.
    res.status(204).end();
  }),
);

authRouter.post(
  '/password/reset',
  ...withBody(resetPasswordRequestSchema, async ({ body, res }) => {
    await service.resetPassword(body.token, body.password);
    res.status(204).end();
  }),
);

authRouter.post(
  '/invite/accept',
  ...withBody(inviteAcceptRequestSchema, async ({ body, req, res }) => {
    await service.acceptInvite(body.token, body.password, req.ip ?? null);
    res.status(204).end();
  }),
);

/**
 * MFA. All three require an existing session: enrolling, confirming and disabling are
 * things a signed-in member does to their own account.
 *
 * The same rate limiter guards them as guards login, keyed on IP + email — a six-digit
 * code is only out of reach while guesses are counted.
 */
authRouter.post(
  '/mfa/enrol',
  asyncHandler(async (req, res) => {
    const enrolment = await service.beginMfaEnrolment(requireSession(req));
    // Shown once. The secret is not retrievable afterwards: a member who loses it
    // restarts enrolment.
    res.status(200).json({ data: enrolment });
  }),
);

authRouter.post(
  '/mfa/verify',
  mfaRateLimit,
  ...withBody(mfaVerifyRequestSchema, async ({ body, req, res }) => {
    const recoveryCodes = await service.confirmMfaEnrolment(requireSession(req), body.code);
    // The only moment these can be shown: only their hashes are kept.
    res.status(200).json({ data: { recoveryCodes } });
  }),
);

authRouter.post(
  '/mfa/disable',
  mfaRateLimit,
  ...withBody(mfaDisableRequestSchema, async ({ body, req, res }) => {
    await service.disableMfa(requireSession(req), body.password, {
      totpCode: body.code,
      recoveryCode: body.recoveryCode,
    });
    res.status(204).end();
  }),
);

/** Issues a fresh set, invalidating every previous code. */
authRouter.post(
  '/mfa/recovery-codes',
  mfaRateLimit,
  ...withBody(mfaRegenerateRecoveryRequestSchema, async ({ body, req, res }) => {
    const recoveryCodes = await service.regenerateRecoveryCodes(
      requireSession(req),
      body.password,
      { totpCode: body.code, recoveryCode: body.recoveryCode },
    );
    res.status(200).json({ data: { recoveryCodes } });
  }),
);
