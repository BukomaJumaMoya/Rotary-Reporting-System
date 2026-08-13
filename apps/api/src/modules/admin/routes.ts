import { Router } from 'express';
import type { HealthResponse } from '@dis/contracts';

export const adminRouter: Router = Router();

/**
 * GET /api/v1/admin/health — public liveness (docs/05-API-Spec.md §10).
 *
 * The only unauthenticated route in the system. It must return no data of any kind:
 * it is the single allowlisted entry in the unauthenticated-PII harness, and anything
 * added to the payload widens that allowance.
 */
adminRouter.get('/health', (_req, res) => {
  const body: HealthResponse = { status: 'ok' };
  res.status(200).json(body);
});
