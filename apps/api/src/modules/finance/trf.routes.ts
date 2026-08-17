import {
  createTrfContributionSchema,
  trfListQuerySchema,
  verifyTrfContributionSchema,
} from '@dis/contracts';
import { Router } from 'express';
import { requireContext, requirePermission } from '../../platform/context.js';
import { asyncHandler, parseQuery, pathParam, withBody } from '../../platform/validate.js';
import * as trf from './trf.service.js';

/**
 * The Rotary Foundation (docs/05-API-Spec.md §7).
 *
 * **The authoritative figures are read BY HAND from My Rotary and the Rotary Foundation
 * reports.** There is no feed. The District Foundation Chair opens the club recognition
 * summary, reads what a club has given and to which fund, and reconciles that against what
 * the club has recorded here. That is the workflow this endpoint set has to fit, and it is
 * why the Chair holds `finance:write:club` at district scope as well: they are the
 * transcriber as often as they are the verifier.
 *
 * A club RECORDS its own giving — `finance:write:club`, because the club holds the receipt.
 * Verification is `trf:verify:district`, which the Foundation Chair and the DRR hold and
 * nobody else. It is deliberately NOT `activity:verify:district`: reconciling against My
 * Rotary and verifying an activity report are different jobs done by different officers,
 * and an assessor who verifies fellowship reports has no business confirming a dollar
 * figure they have no way to check.
 */
export const trfRouter: Router = Router();

trfRouter.get(
  '/trf/contributions',
  requirePermission('finance:read:club'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    const query = parseQuery(trfListQuerySchema, req);
    const { data, total } = await trf.list(ctx, query);
    res.status(200).json({ data, meta: { page: query.page, pageSize: query.pageSize, total } });
  }),
);

/** Before `/trf/contributions/:id`, which would otherwise match `summary` as an id. */
trfRouter.get(
  '/trf/summary',
  requirePermission('finance:read:club'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    res.status(200).json({ data: await trf.summary(ctx) });
  }),
);

trfRouter.get(
  '/trf/contributions/:id',
  requirePermission('finance:read:club'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    res.status(200).json({ data: await trf.get(ctx, pathParam(req, 'id')) });
  }),
);

trfRouter.post(
  '/trf/contributions',
  requirePermission('finance:write:club'),
  ...withBody(createTrfContributionSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    res.status(201).json({ data: await trf.create(ctx, body) });
  }),
);

/**
 * Verification is where a contribution starts counting toward a score, so it is deliberately
 * a different permission from recording one. A club verifying its own giving would be a club
 * scoring itself.
 */
trfRouter.post(
  '/trf/contributions/:id/verify',
  requirePermission('trf:verify:district'),
  ...withBody(verifyTrfContributionSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    res.status(200).json({ data: await trf.verify(ctx, pathParam(req, 'id'), body) });
  }),
);
