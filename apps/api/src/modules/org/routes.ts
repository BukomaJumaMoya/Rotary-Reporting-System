import {
  clubListQuerySchema,
  clusterListQuerySchema,
  createAffiliationRequestSchema,
  createClubRequestSchema,
  createClusterRequestSchema,
  paginationQuerySchema,
  rolloverRequestSchema,
  setClusterClubsRequestSchema,
  updateClubRequestSchema,
  updateClusterRequestSchema,
} from '@dis/contracts';
import { Router } from 'express';
import { requireAnyPermission, requireContext, requirePermission } from '../../platform/context.js';
import { asyncHandler, parseQuery, pathParam, withBody } from '../../platform/validate.js';
import * as clubs from './clubs.service.js';
import * as clusters from './clusters.service.js';
import * as rollover from './rollover.service.js';

/**
 * Organisation: clubs, their district affiliations, clusters and regions.
 *
 * The whole surface rests on axiom 2 — a club has no district column, and belonging to
 * D9218 for a year is a row in `club_district_affiliations`. Every read below reaches clubs
 * through that join, written once in `clubs.repository.ts`.
 */
export const orgRouter: Router = Router();

// ─── Clubs ───────────────────────────────────────────────────────────────────

/**
 * `club:read:district` is held by every position on the slate, club officers included: the
 * club directory is the one screen everybody uses, and a district that cannot see its own
 * clubs cannot be administered. It carries no contact details — a club's meeting venue and
 * time are on the record, and the incumbent system published exactly those to the open
 * internet, which is why this endpoint requires a session.
 */
orgRouter.get(
  '/clubs',
  requirePermission('club:read:district'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    res.status(200).json(await clubs.list(ctx, parseQuery(clubListQuerySchema, req)));
  }),
);

/**
 * Everything a club page needs in ONE call, so the mobile client makes one round trip
 * rather than six. Declared before `/clubs/:id` would be ambiguous — Express matches in
 * registration order and `:id` would otherwise swallow nothing here, but the ordering is
 * kept explicit so a later `/clubs/search` cannot be added below `:id` by accident.
 */
orgRouter.get(
  '/clubs/:id/summary',
  requirePermission('club:read:district'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    res.status(200).json({ data: await clubs.summary(ctx, pathParam(req, 'id')) });
  }),
);

orgRouter.get(
  '/clubs/:id',
  requirePermission('club:read:district'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    res.status(200).json({ data: await clubs.get(ctx, pathParam(req, 'id')) });
  }),
);

orgRouter.post(
  '/clubs',
  requirePermission('club:create:district'),
  ...withBody(createClubRequestSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    res.status(201).json({ data: await clubs.create(ctx, body) });
  }),
);

/**
 * Two doors: a club officer editing their OWN club, and a district officer editing any of
 * them. `requireAnyPermission` answers "may you do this at all"; `clubs.service` answers
 * "may you do it to THIS club", and answers 404 rather than 403 when the answer is no.
 */
orgRouter.patch(
  '/clubs/:id',
  requireAnyPermission('club:update:own', 'club:update:district'),
  ...withBody(updateClubRequestSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    res.status(200).json({ data: await clubs.update(ctx, pathParam(req, 'id'), body) });
  }),
);

/**
 * THE endpoint axiom 2 exists for. A club moving from D9214 to D9218 gets a new row for the
 * new year; last year still says D9214, and the redistricting stays reconstructable.
 */
orgRouter.post(
  '/clubs/:id/affiliations',
  requirePermission('club:affiliate:district'),
  ...withBody(createAffiliationRequestSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    res.status(201).json({ data: await clubs.affiliate(ctx, pathParam(req, 'id'), body) });
  }),
);

// ─── Clusters and regions ────────────────────────────────────────────────────

/**
 * Read behind `club:read:district` rather than a `cluster:read:*` of its own: the club
 * directory filters by cluster, so everyone who can read clubs needs the cluster list, and
 * a permission held by exactly the same people as another is a permission that only adds a
 * row to the matrix. Writes need `cluster:manage:district`.
 */
orgRouter.get(
  '/clusters',
  requirePermission('club:read:district'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    res.status(200).json(await clusters.list(ctx, parseQuery(clusterListQuerySchema, req)));
  }),
);

orgRouter.get(
  '/clusters/:id',
  requirePermission('club:read:district'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    res.status(200).json({ data: await clusters.get(ctx, pathParam(req, 'id')) });
  }),
);

orgRouter.post(
  '/clusters',
  requirePermission('cluster:manage:district'),
  ...withBody(createClusterRequestSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    res.status(201).json({ data: await clusters.create(ctx, body) });
  }),
);

orgRouter.patch(
  '/clusters/:id',
  requirePermission('cluster:manage:district'),
  ...withBody(updateClusterRequestSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    res.status(200).json({ data: await clusters.update(ctx, pathParam(req, 'id'), body) });
  }),
);

/** The whole membership, not a diff — see the contract for why. */
orgRouter.post(
  '/clusters/:id/clubs',
  requirePermission('cluster:manage:district'),
  ...withBody(setClusterClubsRequestSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    res
      .status(200)
      .json({ data: await clusters.setClubs(ctx, pathParam(req, 'id'), body.clubIds) });
  }),
);

orgRouter.get(
  '/regions',
  requirePermission('club:read:district'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    res.status(200).json(await clusters.listRegions(ctx, parseQuery(paginationQuerySchema, req)));
  }),
);

// ─── Administration ──────────────────────────────────────────────────────────

/**
 * Year rollover. `dryRun` is REQUIRED — see the contract for why a default of either value
 * would be the wrong one.
 */
orgRouter.post(
  '/admin/rollover',
  requirePermission('year:rollover:district'),
  ...withBody(rolloverRequestSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    res.status(200).json({ data: await rollover.rollover(ctx, body) });
  }),
);
