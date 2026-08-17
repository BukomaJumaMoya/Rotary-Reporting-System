import compression from 'compression';
import express, { type Express, type Router } from 'express';
import { activityRouter } from './modules/activity/routes.js';
import { adminRouter } from './modules/admin/routes.js';
import { authRouter } from './modules/auth/routes.js';
import { financeRouter } from './modules/finance/routes.js';
import { governanceRouter } from './modules/governance/routes.js';
import { membershipRouter } from './modules/membership/routes.js';
import { orgRouter } from './modules/org/routes.js';
import { peopleRouter } from './modules/people/routes.js';
import { auditActorMiddleware } from './platform/audit.js';
import { resolveRequestContext } from './platform/context.js';
import { errorHandler, notFoundHandler } from './platform/errors.js';
import { securityHeaders } from './platform/security-headers.js';
import { createSessionMiddleware } from './platform/session.js';
import { serveWebClient } from './platform/web-client.js';
import { config } from './platform/config.js';

/** Registers a router and records where it was mounted. */
export type MountFn = (prefix: string, router: Router) => void;

export interface MountedRouter {
  prefix: string;
  router: Router;
}

/** Where `createApp` records its mounts, for the route walker to read back. */
export const MOUNTS_KEY = 'dis:mounts';

/**
 * Builds the Express application without binding a port, so tests can exercise routes
 * through supertest and so server.ts stays a bootstrap file with nothing to test.
 *
 * Every router goes through `mount`, which records the prefix alongside registering it.
 * That is not bookkeeping for its own sake: Express 5 does not retain a mount path as a
 * string — `layer.path` holds the path that MATCHED a request, and the pattern survives
 * only as a compiled matcher — so the unauthenticated-PII harness cannot reconstruct
 * `/api/v1/auth/login` from the router tree. It reads this instead, and asserts the
 * recorded mounts account for every router on the stack, so a router mounted around the
 * helper is caught rather than silently unwalked.
 *
 * `mountExtra` runs after the real routers and before the terminal handlers. Nothing in
 * production passes it: it exists so the scoping tests can put a probe route INSIDE the
 * middleware stack — testing scoping through a hand-built app would prove the stack the
 * test assembled, not the one that ships.
 */
export function createApp(mountExtra?: (mount: MountFn) => void): Express {
  const app = express();

  // Nothing about the runtime is advertised to an unauthenticated caller.
  app.disable('x-powered-by');

  if (config.TRUST_PROXY_HOPS > 0) {
    // Behind a proxy, req.ip must come from X-Forwarded-For or every request appears to
    // originate from the load balancer — which would make the login rate limiter
    // throttle all members as one client. Trust exactly as many hops as are deployed,
    // never `true`, which lets any caller forge the header.
    app.set('trust proxy', config.TRUST_PROXY_HOPS);
  }

  // Before anything that can produce a response, so a 404 and an error page carry the
  // policy as surely as the application does.
  app.use(securityHeaders);

  /**
   * GZIP (NFR-1.1, NFR-1.4). Members pay per megabyte.
   *
   * This was missing until M3 session 3, and it was the single largest payload cost in the
   * system: a page of 25 activities is 22.8 KB of JSON uncompressed and 3.2 KB gzipped —
   * SEVEN TIMES the traffic, on the screen a club officer opens most, for every request. No
   * amount of care on the client makes that back.
   *
   * `threshold` is the point below which compressing costs more than it saves: a 200-byte
   * body gains nothing and pays for a Content-Encoding negotiation.
   *
   * Note what this does NOT need to worry about. BREACH-style attacks need a secret in a
   * compressed response together with attacker-controlled reflected input; this API reflects
   * no request data into a response body, and the session lives in an HttpOnly cookie rather
   * than in one. Images and other already-compressed payloads are skipped by `compression`'s
   * own content-type filter.
   */
  app.use(compression({ threshold: 1024 }));

  // 100kb: every request body in this API is a form. A larger limit only widens what an
  // unauthenticated caller can make the process parse.
  app.use(express.json({ limit: '100kb' }));

  app.use(createSessionMiddleware());

  // Before the context, and before any route: a login writes an audit row while the
  // session it is creating does not exist yet, so the actor store has to be open first
  // and be named on the way through.
  app.use(auditActorMiddleware);

  // Global, not per router. Every module built between now and launch inherits the
  // context without anyone remembering to wire it up (docs/02-Architecture.md §4.1).
  app.use(resolveRequestContext);

  const mounts: MountedRouter[] = [];
  const mount: MountFn = (prefix, router) => {
    mounts.push({ prefix, router });
    app.use(prefix, router);
  };

  mount('/api/v1/admin', adminRouter);
  mount('/api/v1/auth', authRouter);
  mount('/api/v1', governanceRouter);
  mount('/api/v1', orgRouter);
  mount('/api/v1', peopleRouter);
  mount('/api/v1', membershipRouter);
  mount('/api/v1', activityRouter);
  mount('/api/v1', financeRouter);

  mountExtra?.(mount);

  app.set(MOUNTS_KEY, mounts);

  // AFTER every API router and BEFORE the terminal handlers. Nothing here can shadow an
  // endpoint, and an unmatched `/api/...` still falls through to a JSON 404 rather than
  // being answered with index.html — which is how a client ends up reporting "unexpected
  // token <" instead of the 404 the server actually gave it.
  serveWebClient(app);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
