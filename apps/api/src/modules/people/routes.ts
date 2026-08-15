import {
  createErasureRequestSchema,
  createPersonRequestSchema,
  erasureListQuerySchema,
  personListQuerySchema,
  reviewErasureRequestSchema,
  updatePersonRequestSchema,
  updateVisibilityRequestSchema,
} from '@dis/contracts';
import { Router } from 'express';
import { currentQueue, enqueue } from '../../jobs/boss.js';
import { erasureJob } from '../../jobs/erasure.job.js';
import { requireContext, requirePermission } from '../../platform/context.js';
import { asyncHandler, parseQuery, pathParam, withBody } from '../../platform/validate.js';
import * as people from './service.js';

/**
 * People.
 *
 * **There is no unauthenticated endpoint here, and there must never be one.** Not a reduced
 * one, not a name-only one. The predecessor system published ~4,000 members' names, photos,
 * phone numbers, emails, genders and residential areas on an open page; several rules in
 * this project exist because of that, and a public directory is a separate, explicitly
 * designed, opt-in surface with its own review — never a permission relaxed on this router.
 *
 * Every response goes through `serialisePerson`, including the nested ones other modules
 * return. Contact data leaks through relations, not through the endpoint you were thinking
 * about.
 */
export const peopleRouter: Router = Router();

peopleRouter.get(
  '/persons',
  requirePermission('person:read:club'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    res.status(200).json(await people.list(ctx, parseQuery(personListQuerySchema, req)));
  }),
);

/**
 * OWN RECORD ONLY, and no permission overrides it. Declared before `/persons/:id` so the
 * intent is readable, though React Router is not the one matching here — Express matches in
 * registration order, and `/persons/:id` would otherwise capture `/persons/me`.
 */
peopleRouter.get(
  '/persons/me/visibility',
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    res.status(200).json({ data: await people.getVisibility(ctx, ctx.personId) });
  }),
);

peopleRouter.get(
  '/persons/:id',
  requirePermission('person:read:club'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    res.status(200).json({ data: await people.get(ctx, pathParam(req, 'id')) });
  }),
);

peopleRouter.post(
  '/persons',
  requirePermission('person:create:club'),
  ...withBody(createPersonRequestSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    res.status(201).json({ data: await people.create(ctx, body) });
  }),
);

/**
 * Your own record, or somebody in your scope with `person:update:club`. No `requirePermission`
 * on the route, because the first case needs no permission at all — the service decides, and
 * refuses with 403 for a missing permission and 404 for a person out of scope.
 */
peopleRouter.patch(
  '/persons/:id',
  ...withBody(updatePersonRequestSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    res.status(200).json({ data: await people.update(ctx, pathParam(req, 'id'), body) });
  }),
);

/**
 * The member's own switches. Not the DES's, not an administrator's: a system where somebody
 * else can turn a member's contact details back on is a system where the flags mean nothing.
 */
peopleRouter.get(
  '/persons/:id/visibility',
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    res.status(200).json({ data: await people.getVisibility(ctx, pathParam(req, 'id')) });
  }),
);

peopleRouter.patch(
  '/persons/:id/visibility',
  ...withBody(updateVisibilityRequestSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    res.status(200).json({ data: await people.updateVisibility(ctx, pathParam(req, 'id'), body) });
  }),
);

/** A subject access request. Own record only; there is deliberately no administrative version. */
peopleRouter.get(
  '/persons/:id/export',
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    res.status(200).json({ data: await people.exportPerson(ctx, pathParam(req, 'id')) });
  }),
);

/** Queues an erasure for REVIEW. Nothing is anonymised until a district officer approves. */
peopleRouter.post(
  '/persons/:id/erasure',
  ...withBody(createErasureRequestSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    res.status(201).json({ data: await people.requestErasure(ctx, pathParam(req, 'id'), body) });
  }),
);

peopleRouter.get(
  '/erasure-requests',
  requirePermission('person:erase:district'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    res
      .status(200)
      .json(await people.listErasureRequests(ctx, parseQuery(erasureListQuerySchema, req)));
  }),
);

/**
 * The review. Approving QUEUES the anonymisation rather than performing it: the work
 * touches the roster history of every club the member ever belonged to, and it must run
 * under a system context so the audit log says the approved request caused it rather than
 * attributing a whole record being blanked to whoever pressed the button.
 */
peopleRouter.post(
  '/erasure-requests/:id/review',
  requirePermission('person:erase:district'),
  ...withBody(reviewErasureRequestSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    const request = await people.reviewErasure(ctx, pathParam(req, 'id'), body);

    if (request.status === 'APPROVED') {
      if (currentQueue()) {
        await enqueue(erasureJob, {
          districtId: ctx.districtId,
          rotaryYearId: ctx.rotaryYearId,
          requestId: request.id,
        });
      } else {
        // No worker in this process — development without `npm run worker`, or a test.
        // The request stays APPROVED and visible on the review screen, which is the state
        // somebody should look at rather than a silent nothing.
        console.warn(`[people] erasure ${request.id} approved but no queue is running`);
      }
    }

    res.status(200).json({ data: request });
  }),
);
