import { rolloverRequestSchema } from '@dis/contracts';
import { Router } from 'express';
import { requireContext, requirePermission } from '../../platform/context.js';
import { withBody } from '../../platform/validate.js';
import * as rollover from './rollover.service.js';

/**
 * Organisation administration.
 *
 * One endpoint for now, and it is the one that runs once a year and must not go wrong.
 */
export const orgRouter: Router = Router();

/**
 * Year rollover. `dryRun` is REQUIRED — see the contract for why a default of either
 * value would be the wrong one.
 */
orgRouter.post(
  '/admin/rollover',
  requirePermission('year:rollover:district'),
  ...withBody(rolloverRequestSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    res.status(200).json({ data: await rollover.rollover(ctx, body) });
  }),
);
