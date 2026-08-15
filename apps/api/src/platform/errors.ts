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
  /** The caller holds no permission, no appointment, or asked for a year they may not read. */
  INSUFFICIENT_SCOPE: 'INSUFFICIENT_SCOPE',
  /** The context year is read-only: the district_year is locked, or `?year=` was used. */
  YEAR_LOCKED: 'YEAR_LOCKED',
  /** A position cannot be deactivated while people still hold it. */
  POSITION_IN_USE: 'POSITION_IN_USE',
  /** A system-wide template row is readable by every district and writable by none. */
  TEMPLATE_IMMUTABLE: 'TEMPLATE_IMMUTABLE',
  /** A permission code that is not in the seeded catalogue. */
  UNKNOWN_PERMISSION: 'UNKNOWN_PERMISSION',
  /** A code or name that must be unique within the district is already taken. */
  DUPLICATE_CODE: 'DUPLICATE_CODE',
  /** The position is `is_unique_per_scope` and somebody already holds it here this year. */
  POSITION_ALREADY_HELD: 'POSITION_ALREADY_HELD',
  /** `scope_id` names no record of the kind `scope_type` implies. */
  INVALID_SCOPE_REFERENCE: 'INVALID_SCOPE_REFERENCE',
  /** The appointment's scope type does not match the position's own scope. */
  SCOPE_TYPE_MISMATCH: 'SCOPE_TYPE_MISMATCH',
  /** Committees nest at most three deep; deeper is a maze nobody can navigate. */
  COMMITTEE_TOO_DEEP: 'COMMITTEE_TOO_DEEP',
  /** A rollover commit without a valid, unexpired confirmation token from a dry run. */
  ROLLOVER_NOT_CONFIRMED: 'ROLLOVER_NOT_CONFIRMED',
  /** An assessment period is still OPEN for the year being closed. */
  PERIOD_OPEN: 'PERIOD_OPEN',
  /** Another club already holds that RI Club ID. The id is RI's, and it identifies one club. */
  RI_ID_ALREADY_CLAIMED: 'RI_ID_ALREADY_CLAIMED',
  /**
   * The club is already affiliated to a district for this Rotary Year, and one club has one
   * district per year (axiom 2). Which district is deliberately not said: that would be a
   * read across the boundary, made to write a better error message.
   */
  CLUB_AFFILIATED_ELSEWHERE: 'CLUB_AFFILIATED_ELSEWHERE',
  /**
   * The same person, club, event type and date twice. A double-tap, not two facts — and
   * without this, one slow save on a bad connection is a member counted twice in the
   * retention arithmetic. A correction is exempt: superseding an event necessarily repeats
   * its key in order to say something different about it.
   */
  DUPLICATE_MEMBERSHIP_EVENT: 'DUPLICATE_MEMBERSHIP_EVENT',
  /**
   * A create was re-posted with an id that already exists.
   *
   * Not an error so much as an answer: offline clients generate their own ids precisely so
   * a retry is safe, and the response carries the existing record (docs/05-API-Spec.md §1).
   */
  IDEMPOTENT_REPLAY: 'IDEMPOTENT_REPLAY',
  /**
   * A write aimed at something already counted — a verified activity, or a period that has
   * been closed. Editing it silently would change a number somebody has already read.
   */
  PERIOD_CLOSED: 'PERIOD_CLOSED',
  /** The uploaded bytes are not a format the system handles, whatever the filename said. */
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  /** Past the 10MB cap, detected while reading rather than after the buffer exists. */
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  /**
   * An activity is missing a field its TYPE declares as required — either a `requires_*`
   * flag or an entry in `field_config`. `details.key` names it.
   */
  MISSING_REQUIRED_FIELD_FOR_TYPE: 'MISSING_REQUIRED_FIELD_FOR_TYPE',
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
 * The answer for a record that does not exist AND for one the caller may not see.
 *
 * 403 would confirm the record exists, which hands the shape of the dataset to anyone
 * willing to walk a list of identifiers. One response for both cases means a probe
 * learns nothing (docs/05-API-Spec.md §1).
 */
export const notFound = (): AppError => new AppError(404, ErrorCode.NOT_FOUND, 'Not found');

/**
 * The caller is authenticated and in scope, but does not hold the permission the action
 * requires. Unlike an out-of-scope RECORD, this leaks nothing: it describes the caller's
 * own authority, which they already know.
 */
export const insufficientScope = (message: string, details?: Record<string, unknown>): AppError =>
  new AppError(403, ErrorCode.INSUFFICIENT_SCOPE, message, details);

/** A write aimed at a year that is closed to writing. */
export const yearLocked = (message: string): AppError =>
  new AppError(422, ErrorCode.YEAR_LOCKED, message);

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

/**
 * Digs the driver's SQLSTATE out of whichever nesting Prisma used.
 *
 * Three places, because the shape depends on the error class AND on the driver adapter.
 * Prisma 7 with `@prisma/adapter-pg` wraps the driver error twice, so the code arrives at
 * `meta.driverAdapterError.cause.code` — and a mapping that only checked the two obvious
 * places found nothing, which meant every guard violation reached the client as an opaque
 * 500 instead of `MEMBERSHIP_IMMUTABLE`. Found by the audit tests in session 5; the
 * conformance suite proved the guards fire, never that the mapping did.
 */
function sqlStateOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;

  const candidate = error as {
    code?: unknown;
    meta?: { code?: unknown; driverAdapterError?: { cause?: { code?: unknown } } };
  };

  const candidates = [
    candidate.code,
    candidate.meta?.code,
    candidate.meta?.driverAdapterError?.cause?.code,
  ];

  for (const value of candidates) {
    if (typeof value === 'string' && value in SQLSTATE_TO_ERROR) return value;
  }
  return undefined;
}

/**
 * The domain error a database guard violation maps to, or undefined for anything else.
 *
 * Exported so the mapping can be tested directly. It was wrong for two sessions without
 * anything noticing, because every test that tripped a guard asserted the write failed —
 * which it did — and none asserted what the client would have been told.
 */
export function domainErrorFor(
  error: unknown,
): { status: number; code: ErrorCodeValue; message: string } | undefined {
  const sqlState = sqlStateOf(error);
  return sqlState ? SQLSTATE_TO_ERROR[sqlState] : undefined;
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

  const mapped = domainErrorFor(error);
  if (mapped) {
    send(res, mapped.status, { code: mapped.code, message: mapped.message });
    return;
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
