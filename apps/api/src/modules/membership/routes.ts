import {
  correctMembershipEventSchema,
  createMembershipEventSchema,
  membershipEventListQuerySchema,
  membershipStatsQuerySchema,
  rosterQuerySchema,
  transitionListQuerySchema,
} from '@dis/contracts';
import { Router } from 'express';
import { requireContext, requirePermission } from '../../platform/context.js';
import { asyncHandler, parseQuery, pathParam, withBody } from '../../platform/validate.js';
import * as membership from './service.js';

/**
 * Membership.
 *
 * **There is no `PUT` and no `DELETE` here, and the absence is the design** (axiom 3). A
 * mistake is corrected by appending an event that supersedes the original; the original row
 * stays. `membership_events_no_mutate` makes that true at the database, so a route added in
 * M6 that tried to update one would be refused with `MEMBERSHIP_IMMUTABLE` rather than
 * silently rewriting the club's history.
 */
export const membershipRouter: Router = Router();

membershipRouter.get(
  '/membership/events',
  requirePermission('membership:read:club'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    res
      .status(200)
      .json(await membership.listEvents(ctx, parseQuery(membershipEventListQuerySchema, req)));
  }),
);

/**
 * Idempotent on a client-supplied `id`. A replay answers 200 with the row that already
 * exists rather than 409 — the client generated the id precisely so a retry would be safe,
 * and making it distinguish "created" from "already created" would put the burden back on
 * exactly the connection that caused the retry.
 */
membershipRouter.post(
  '/membership/events',
  requirePermission('membership:write:club'),
  ...withBody(createMembershipEventSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    const { event, replayed } = await membership.createEvent(ctx, body);
    res.status(replayed ? 200 : 201).json({ data: event });
  }),
);

/** Appends a correcting event. The original stays; the log is never edited. */
membershipRouter.post(
  '/membership/events/:id/correct',
  requirePermission('membership:write:club'),
  ...withBody(correctMembershipEventSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    res.status(201).json({ data: await membership.correctEvent(ctx, pathParam(req, 'id'), body) });
  }),
);

/**
 * The roster. `?asOf=` reconstructs it from the log rather than reading the view — the view
 * is today, and "who were we in March" is what a disputed scorecard turns on.
 */
membershipRouter.get(
  '/membership/roster',
  requirePermission('membership:read:club'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    res.status(200).json(await membership.roster(ctx, parseQuery(rosterQuerySchema, req)));
  }),
);

/** Opening, joiners, leavers, net, retention, transitions. This arithmetic feeds M5. */
membershipRouter.get(
  '/membership/stats',
  requirePermission('membership:read:club'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    res
      .status(200)
      .json({ data: await membership.stats(ctx, parseQuery(membershipStatsQuerySchema, req)) });
  }),
);

membershipRouter.get(
  '/membership/transitions',
  requirePermission('membership:read:club'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    res
      .status(200)
      .json(await membership.listTransitions(ctx, parseQuery(transitionListQuerySchema, req)));
  }),
);

/**
 * Receiving-side confirmation. `corroborated_at` is the ONE column the immutability guard
 * lets through, because corroborating necessarily happens after the event was recorded.
 */
membershipRouter.post(
  '/membership/transitions/:id/corroborate',
  requirePermission('membership:write:club'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    res.status(200).json({ data: await membership.corroborate(ctx, pathParam(req, 'id')) });
  }),
);
