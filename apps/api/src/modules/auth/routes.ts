import {
  forgotPasswordRequestSchema,
  inviteAcceptRequestSchema,
  loginRequestSchema,
  mfaDisableRequestSchema,
  mfaVerifyRequestSchema,
  resetPasswordRequestSchema,
} from '@dis/contracts';
import { Router } from 'express';
import type { Request } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { config } from '../../platform/config.js';
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
    const user = await service.login(body.email, body.password, body.totpCode);

    // Session fixation: a session id issued before authentication must not survive it.
    await promisify((cb) => req.session.regenerate(cb));
    req.session.userId = user.id;
    await promisify((cb) => req.session.save(cb));

    res.status(200).json(service.toMeResponse(user));
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

    res.status(200).json(service.toMeResponse(user));
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
    await service.confirmMfaEnrolment(requireSession(req), body.code);
    res.status(204).end();
  }),
);

authRouter.post(
  '/mfa/disable',
  mfaRateLimit,
  ...withBody(mfaDisableRequestSchema, async ({ body, req, res }) => {
    await service.disableMfa(requireSession(req), body.password, body.code);
    res.status(204).end();
  }),
);
