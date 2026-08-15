import {
  activityListQuerySchema,
  activityTypeListQuerySchema,
  addAttendeesSchema,
  addPartnerSchema,
  calendarQuerySchema,
  createActivitySchema,
  createActivityTypeSchema,
  updateActivitySchema,
  updateActivityTypeSchema,
  verifyActivitySchema,
} from '@dis/contracts';
import { Router } from 'express';
import { requireContext, requirePermission } from '../../platform/context.js';
import { parseUpload } from '../../platform/upload.js';
import { asyncHandler, parseQuery, pathParam, withBody } from '../../platform/validate.js';
import * as media from './media.service.js';
import * as activities from './service.js';
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

// ─── Activities ──────────────────────────────────────────────────────────────

/**
 * The single most important screen in the system reads and writes through here. If it is
 * slow or confusing, nothing else matters — clubs go back to WhatsApp.
 */
activityRouter.get(
  '/activities',
  requirePermission('activity:read:club'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    res.status(200).json(await activities.list(ctx, parseQuery(activityListQuerySchema, req)));
  }),
);

/** Declared before `/activities/:id`, which would otherwise capture `calendar`. */
activityRouter.get(
  '/activities/calendar',
  requirePermission('activity:read:club'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    res
      .status(200)
      .json({ data: await activities.calendar(ctx, parseQuery(calendarQuerySchema, req)) });
  }),
);

activityRouter.get(
  '/activities/:id',
  requirePermission('activity:read:club'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    res.status(200).json({ data: await activities.get(ctx, pathParam(req, 'id')) });
  }),
);

/** Idempotent on a client-generated UUID. A replay answers 200 with the row that exists. */
activityRouter.post(
  '/activities',
  requirePermission('activity:create:club'),
  ...withBody(createActivitySchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    const { activity, replayed } = await activities.create(ctx, body);
    res.status(replayed ? 200 : 201).json({ data: activity });
  }),
);

activityRouter.patch(
  '/activities/:id',
  requirePermission('activity:create:club'),
  ...withBody(updateActivitySchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    res.status(200).json({ data: await activities.update(ctx, pathParam(req, 'id'), body) });
  }),
);

/** Soft. A deleted activity is one the scoring engine must stop counting. */
activityRouter.delete(
  '/activities/:id',
  requirePermission('activity:create:club'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    await activities.remove(ctx, pathParam(req, 'id'));
    res.status(204).end();
  }),
);

/**
 * Verify, query or reject. QUERY is what makes this two-way rather than write-only: a club
 * that files something incomplete gets a comment and a chance to fix it.
 */
activityRouter.post(
  '/activities/:id/verify',
  requirePermission('activity:verify:district'),
  ...withBody(verifyActivitySchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    res.status(200).json({ data: await activities.verify(ctx, pathParam(req, 'id'), body) });
  }),
);

// ─── Media, partners, attendees ──────────────────────────────────────────────

activityRouter.get(
  '/activities/:id/media',
  requirePermission('activity:read:club'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    res.status(200).json({ data: await media.list(ctx, pathParam(req, 'id')) });
  }),
);

/**
 * Multipart. Content type is decided by MAGIC BYTES and the 10MB cap is enforced while
 * reading, so neither the filename nor the Content-Length header is trusted.
 */
activityRouter.post(
  '/activities/:id/media',
  requirePermission('activity:create:club'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    const parsed = await parseUpload(req);
    res.status(201).json({ data: await media.upload(ctx, pathParam(req, 'id'), parsed) });
  }),
);

activityRouter.delete(
  '/activities/:id/media/:mediaId',
  requirePermission('activity:create:club'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    await media.remove(ctx, pathParam(req, 'id'), pathParam(req, 'mediaId'));
    res.status(204).end();
  }),
);

activityRouter.get(
  '/activities/:id/partners',
  requirePermission('activity:read:club'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    res.status(200).json({ data: await activities.listPartners(ctx, pathParam(req, 'id')) });
  }),
);

activityRouter.post(
  '/activities/:id/partners',
  requirePermission('activity:create:club'),
  ...withBody(addPartnerSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    res.status(201).json({ data: await activities.addPartner(ctx, pathParam(req, 'id'), body) });
  }),
);

/** Bulk, and idempotent: re-posting the same list adds nobody twice. */
activityRouter.post(
  '/activities/:id/attendees',
  requirePermission('activity:create:club'),
  ...withBody(addAttendeesSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    res.status(200).json({ data: await activities.addAttendees(ctx, pathParam(req, 'id'), body) });
  }),
);
