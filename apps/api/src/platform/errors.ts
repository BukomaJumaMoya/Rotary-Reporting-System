import type { ErrorRequestHandler, Request, Response } from 'express';
import { isProduction } from './config.js';

/**
 * Stable, machine-readable error codes. The client maps codes to messages; the message
 * strings here are for developers and logs, not for end users.
 *
 * Domain codes from docs/05-API-Spec.md §1 join this union as their modules are built.
 */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_NOT_ACTIVE: 'ACCOUNT_NOT_ACTIVE',
  RATE_LIMITED: 'RATE_LIMITED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  // The password was correct; the client must now supply a second factor.
  MFA_REQUIRED: 'MFA_REQUIRED',
  MFA_INVALID: 'MFA_INVALID',
  MFA_ALREADY_ENABLED: 'MFA_ALREADY_ENABLED',
  MFA_NOT_ENROLLED: 'MFA_NOT_ENROLLED',
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  // Database guards (ADR-012). Mapped from SQLSTATE below.
  MEMBERSHIP_IMMUTABLE: 'MEMBERSHIP_IMMUTABLE',
  AUDIT_IMMUTABLE: 'AUDIT_IMMUTABLE',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCodeValue;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    status: number,
    code: ErrorCodeValue,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const unauthenticated = (): AppError =>
  new AppError(401, ErrorCode.UNAUTHENTICATED, 'Authentication required');

export const invalidCredentials = (): AppError =>
  // Deliberately identical for an unknown account and a wrong password. Distinguishing
  // them turns the login form into an account-existence oracle.
  new AppError(401, ErrorCode.INVALID_CREDENTIALS, 'Invalid email or password');

export const invalidToken = (): AppError =>
  // Also deliberately undifferentiated: unknown, already used and expired tokens are
  // one response, so a probe cannot learn which tokens were ever real.
  new AppError(400, ErrorCode.TOKEN_INVALID, 'This link is invalid or has expired');

/**
 * SQLSTATEs raised by the guard triggers (ADR-012, docs/02-Architecture.md). Mapping
 * them here is what turns a driver exception into a domain error the client can act on.
 */
const SQLSTATE_TO_ERROR: Record<string, { status: number; code: ErrorCodeValue; message: string }> =
  {
    DIS01: {
      status: 409,
      code: ErrorCode.MEMBERSHIP_IMMUTABLE,
      message: 'Membership events cannot be changed. Record a correcting event instead.',
    },
    DIS02: {
      status: 409,
      code: ErrorCode.AUDIT_IMMUTABLE,
      message: 'The audit log is append-only.',
    },
  };

function sqlStateOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  // Prisma surfaces the driver's SQLSTATE in different places depending on the error
  // class, so check both rather than assuming one shape.
  const candidate = error as { code?: unknown; meta?: { code?: unknown } };
  if (typeof candidate.code === 'string' && candidate.code in SQLSTATE_TO_ERROR) {
    return candidate.code;
  }
  const metaCode = candidate.meta?.code;
  if (typeof metaCode === 'string' && metaCode in SQLSTATE_TO_ERROR) return metaCode;
  return undefined;
}

function send(res: Response, status: number, body: AppError | { code: string; message: string }) {
  const payload =
    body instanceof AppError
      ? {
          code: body.code,
          message: body.message,
          ...(body.details ? { details: body.details } : {}),
        }
      : body;
  res.status(status).json({ error: payload });
}

/**
 * The single place an error becomes a response. Never serialises a stack trace, a SQL
 * fragment or an internal identifier — an unrecognised error is logged in full and
 * reported as an opaque 500.
 */
export const errorHandler: ErrorRequestHandler = (error, req: Request, res: Response, _next) => {
  if (res.headersSent) return;

  if (error instanceof AppError) {
    send(res, error.status, error);
    return;
  }

  const sqlState = sqlStateOf(error);
  if (sqlState) {
    const mapped = SQLSTATE_TO_ERROR[sqlState];
    if (mapped) {
      send(res, mapped.status, { code: mapped.code, message: mapped.message });
      return;
    }
  }

  console.error('[error]', req.method, req.path, error);

  send(res, 500, {
    code: ErrorCode.INTERNAL_ERROR,
    message: isProduction ? 'Something went wrong' : 'Something went wrong — see server logs',
  });
};

/** Terminal 404 for unmatched routes, in the same envelope as everything else. */
export function notFoundHandler(_req: Request, res: Response): void {
  send(res, 404, { code: ErrorCode.NOT_FOUND, message: 'Not found' });
}
