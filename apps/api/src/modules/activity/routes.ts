import {
  activityTypeListQuerySchema,
  createActivityTypeSchema,
  updateActivityTypeSchema,
} from '@dis/contracts';
import { Router } from 'express';
import { requireContext, requirePermission } from '../../platform/context.js';
import { asyncHandler, parseQuery, pathParam, withBody } from '../../platform/validate.js';
import * as types from './types.service.js';

/**
 * Activities.
 *
 * Session 8 builds the CONFIGURATION half: the types, and the media pipeline behind them.
 * The activities themselves arrive in session 9 and are rendered from what is declared here
 * — `GET /activity-types` is the contract between configuration and UI, and adding a type
 * never requires a client release.
 */
export const activityRouter: Router = Router();

/**
 * Readable by anyone who can read activities, which is everybody who reports one: the
 * reporting screen renders itself from this response, so a secretary who could not read it
 * could not file anything.
 *
 * Grouped by category on the server, because a client grouping a flat list would need to
 * know the category order too, and the second copy is the one that drifts.
 */
activityRouter.get(
  '/activity-types',
  requirePermission('activity:read:club'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    const query = parseQuery(activityTypeListQuerySchema, req);
    res.status(200).json({ data: await types.listGrouped(ctx, query) });
  }),
);

/** The flat list, for the administration screen that edits them. */
activityRouter.get(
  '/activity-types/flat',
  requirePermission('activity:read:club'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    const query = parseQuery(activityTypeListQuerySchema, req);
    const data = await types.list(ctx, query);
    res.status(200).json({ data, meta: { page: 1, pageSize: data.length, total: data.length } });
  }),
);

activityRouter.get(
  '/activity-types/:id',
  requirePermission('activity:read:club'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    res.status(200).json({ data: await types.get(ctx, pathParam(req, 'id')) });
  }),
);

activityRouter.post(
  '/activity-types',
  requirePermission('activitytype:manage:district'),
  ...withBody(createActivityTypeSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    res.status(201).json({ data: await types.create(ctx, body) });
  }),
);

activityRouter.patch(
  '/activity-types/:id',
  requirePermission('activitytype:manage:district'),
  ...withBody(updateActivityTypeSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    res.status(200).json({ data: await types.update(ctx, pathParam(req, 'id'), body) });
  }),
);
