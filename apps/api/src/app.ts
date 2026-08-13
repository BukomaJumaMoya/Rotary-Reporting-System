import express, { type Express } from 'express';
import { adminRouter } from './modules/admin/routes.js';

/**
 * Builds the Express application without binding a port, so tests can exercise routes
 * through supertest and so server.ts stays a bootstrap file with nothing to test.
 *
 * Body parsing, CORS, sessions and the error envelope arrive with the sessions that
 * need them (M0 sessions 3–5). Wiring unused middleware now would read as though those
 * concerns were already handled.
 */
export function createApp(): Express {
  const app = express();

  // Nothing about the runtime is advertised to an unauthenticated caller.
  app.disable('x-powered-by');

  app.use('/api/v1/admin', adminRouter);

  return app;
}
