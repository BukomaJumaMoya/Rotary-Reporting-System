import type { ErrorResponse } from '@dis/contracts';

/**
 * The one place the browser talks to the API.
 *
 * Every request carries the session cookie and every failure arrives as an `ApiError`
 * with the server's stable code on it — so a screen branches on `YEAR_LOCKED` or
 * `POSITION_ALREADY_HELD` rather than matching an English string that a copy edit will
 * quietly break.
 */

const BASE = '/api/v1';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown> | undefined,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Field-level messages from a 400, keyed by path, for a form to render inline. */
  get fieldErrors(): Record<string, string> {
    const fields = this.details?.['fields'];
    if (!Array.isArray(fields)) return {};

    const result: Record<string, string> = {};
    for (const entry of fields) {
      const field = entry as { path?: unknown; message?: unknown };
      if (typeof field.path === 'string' && typeof field.message === 'string') {
        result[field.path] = field.message;
      }
    }
    return result;
  }
}

/**
 * What to do when the server says the session is gone.
 *
 * Registered by the app rather than imported, so this module stays free of the router —
 * a fetch wrapper that reaches into navigation is a fetch wrapper that cannot be tested
 * or reused.
 */
let onUnauthenticated: (() => void) | null = null;

export function setUnauthenticatedHandler(handler: () => void): void {
  onUnauthenticated = handler;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /**
   * A multipart upload. Sent INSTEAD of `body`, and deliberately with no `Content-Type`
   * header — the browser has to set it itself so it can add the multipart boundary, and a
   * hand-written `multipart/form-data` produces a request the server cannot parse.
   */
  formData?: FormData;
  query?: Record<string, string | number | boolean | undefined>;
  /**
   * Suppresses the global redirect on 401. Set by the sign-in call: a wrong password
   * there is an answer, not an expired session, and bouncing to /login from /login is a
   * loop the member cannot escape.
   */
  allowUnauthenticated?: boolean;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = `${BASE}${path}`;
  if (!query) return url;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `${url}?${search}` : url;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(buildUrl(path, options.query), {
    method: options.method ?? 'GET',
    // The session lives in an HttpOnly cookie (ADR-003). Without this it is not sent and
    // every authenticated request 401s for reasons that look like a server bug.
    credentials: 'include',
    headers: options.body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(options.formData
      ? { body: options.formData }
      : options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
  });

  if (response.status === 204) return undefined as T;

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const envelope = payload as ErrorResponse | null;
    const error = envelope?.error;

    if (response.status === 401 && !options.allowUnauthenticated) {
      onUnauthenticated?.();
    }

    throw new ApiError(
      response.status,
      error?.code ?? 'NETWORK_ERROR',
      error?.message ?? 'Something went wrong. Please try again.',
      error?.details,
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query']) => apiRequest<T>(path, { query }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
};
