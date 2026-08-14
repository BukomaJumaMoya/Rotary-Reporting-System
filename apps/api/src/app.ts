import express, { type Express } from 'express';
import { adminRouter } from './modules/admin/routes.js';
import { authRouter } from './modules/auth/routes.js';
import { resolveRequestContext } from './platform/context.js';
import { errorHandler, notFoundHandler } from './platform/errors.js';
import { createSessionMiddleware } from './platform/session.js';
import { config } from './platform/config.js';

/**
 * Builds the Express application without binding a port, so tests can exercise routes
 * through supertest and so server.ts stays a bootstrap file with nothing to test.
 *
 * `mountExtra` runs after the real routers and before the terminal handlers. Nothing in
 * production passes it: it exists so the scoping tests can put a probe route INSIDE the
 * middleware stack — testing scoping through a hand-built app would prove the stack the
 * test assembled, not the one that ships.
 */
export function createApp(mountExtra?: (app: Express) => void): Express {
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

  // 100kb: every request body in this API is a form. A larger limit only widens what an
  // unauthenticated caller can make the process parse.
  app.use(express.json({ limit: '100kb' }));

  app.use(createSessionMiddleware());

  // Global, not per router. Every module built between now and launch inherits the
  // context without anyone remembering to wire it up (docs/02-Architecture.md §4.1).
  app.use(resolveRequestContext);

  app.use('/api/v1/admin', adminRouter);
  app.use('/api/v1/auth', authRouter);

  mountExtra?.(app);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
