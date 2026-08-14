import {
  createPositionRequestSchema,
  paginationQuerySchema,
  positionListQuerySchema,
  replacePermissionsRequestSchema,
  updatePositionRequestSchema,
} from '@dis/contracts';
import { Router } from 'express';
import { requireContext, requirePermission } from '../../platform/context.js';
import { asyncHandler, parseQuery, pathParam, withBody } from '../../platform/validate.js';
import * as positions from './positions.service.js';

/**
 * Governance: the module that answers "who may do what, and to which records".
 *
 * Everything here is CONFIGURATION rather than code. D9218's RY2027-28 slate has over
 * thirty distinct roles, several of them new; adding one must be an insert made by the
 * DES, not a release made by the developer (docs/03-Data-Model.md §3).
 */
export const governanceRouter: Router = Router();

/**
 * The permission catalogue. Read-only, deliberately: there is no endpoint that creates a
 * permission, because a code without a matching check in the code is a lie. Codes are
 * matched exactly with no wildcard, so a created row containing a typo would grant
 * nothing and say nothing.
 *
 * Readable by anyone who may manage positions — you cannot build a permission grid
 * without the list of permissions.
 */
governanceRouter.get(
  '/permissions',
  requirePermission('position:manage:district'),
  asyncHandler(async (req, res) => {
    requireContext(req);
    const query = parseQuery(paginationQuerySchema, req);
    res.status(200).json(await positions.listPermissions(query));
  }),
);

/**
 * Readable by anyone who can read appointments — the list of roles is not sensitive, and
 * an appointments screen is unusable without it.
 */
governanceRouter.get(
  '/positions',
  requirePermission('appointment:read:district'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    const query = parseQuery(positionListQuerySchema, req);
    res.status(200).json(await positions.list(ctx, query));
  }),
);

governanceRouter.get(
  '/positions/:id',
  requirePermission('appointment:read:district'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    res.status(200).json({ data: await positions.get(ctx, pathParam(req, 'id')) });
  }),
);

governanceRouter.post(
  '/positions',
  requirePermission('position:manage:district'),
  ...withBody(createPositionRequestSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    res.status(201).json({ data: await positions.create(ctx, body) });
  }),
);

governanceRouter.patch(
  '/positions/:id',
  requirePermission('position:manage:district'),
  ...withBody(updatePositionRequestSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    res.status(200).json({ data: await positions.update(ctx, pathParam(req, 'id'), body) });
  }),
);

/**
 * Soft. A position is referenced by every appointment ever made against it, so it is
 * deactivated and never deleted — and refused outright while anyone still holds it.
 */
governanceRouter.delete(
  '/positions/:id',
  requirePermission('position:manage:district'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    res.status(200).json({ data: await positions.deactivate(ctx, pathParam(req, 'id')) });
  }),
);

/** PUT, not PATCH: the body is the whole set, and applying it is one transaction. */
governanceRouter.put(
  '/positions/:id/permissions',
  requirePermission('position:manage:district'),
  ...withBody(replacePermissionsRequestSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    const updated = await positions.replacePermissions(ctx, pathParam(req, 'id'), body.permissions);
    res.status(200).json({ data: updated });
  }),
);
