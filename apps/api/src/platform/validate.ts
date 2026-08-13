import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';
import { AppError, ErrorCode } from './errors.js';

/**
 * Validates the request body against a schema from @dis/contracts and replaces it with
 * the parsed result, so handlers receive coerced, trimmed, typed data.
 *
 * The same schema validates the form in the browser. That is the whole reason the
 * contracts package exists: one definition, no drift.
 */
export function validateBody<T>(schema: ZodType<T>): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      // Field paths and messages only. Never the submitted values — a validation error
      // on a login form would otherwise echo the password into logs and responses.
      const fields = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      next(new AppError(400, ErrorCode.VALIDATION_ERROR, 'Request validation failed', { fields }));
      return;
    }

    req.body = result.data;
    next();
  };
}

/** Wraps an async handler so a rejected promise reaches the error handler. */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

/**
 * Validation and handler as one unit, with a TYPED body.
 *
 * Express types `req.body` as `any`, so a handler reading `req.body.email` is unchecked
 * — the compiler cannot tell you when a field is renamed in the contract. Pairing the
 * schema with the handler here means the body arrives as the schema's inferred type and
 * a contract change becomes a compile error at every call site.
 *
 * The single cast below is the one place the `any` is laundered, and it is sound:
 * validateBody has already replaced req.body with the parsed result of this schema.
 */
export function withBody<T>(
  schema: ZodType<T>,
  handler: (input: { body: T; req: Request; res: Response }) => Promise<void>,
): RequestHandler[] {
  return [
    validateBody(schema),
    (req, res, next) => {
      handler({ body: req.body as T, req, res }).catch(next);
    },
  ];
}

/** Reads a string field from an unvalidated body — for middleware that runs before validation. */
export function rawStringField(body: unknown, field: string): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const value = (body as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : undefined;
}
