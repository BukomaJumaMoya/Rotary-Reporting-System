import { Router, type Express } from 'express';
import { z } from 'zod';
import {
  clubScopeWhere,
  requireContext,
  requirePermission,
  requireScope,
} from '../platform/context.js';
import { db } from '../platform/db.js';
import { notFound } from '../platform/errors.js';
import { asyncHandler, withBody } from '../platform/validate.js';

/**
 * Probe routes for the scoping tests.
 *
 * Session 4 builds infrastructure and no features, so there is no real endpoint yet to
 * prove the scoped client against end to end. These stand in for one — and they are
 * mounted into the REAL app through `createApp(mountExtra)`, not into an app the test
 * assembled, so what they exercise is the middleware stack that ships: session, then
 * context resolution, then permission, then the scoped client, then the error handler.
 *
 * They are ordinary handlers written the way a module's handler should be written. If
 * scoping needed anything extra here, that would be the finding.
 *
 * `tsconfig.build.json` excludes `src/test`, so none of this reaches `dist`.
 */
export const probeRouter: Router = Router();

/**
 * Everything the context resolved, so a test can assert on it directly.
 *
 * Synchronous, and therefore not wrapped in `asyncHandler`: Express 5 forwards a thrown
 * error from a sync handler to the error middleware by itself.
 */
probeRouter.get('/context', (req, res) => {
  const ctx = requireContext(req);
  res.status(200).json({
    data: {
      userId: ctx.userId,
      personId: ctx.personId,
      districtId: ctx.districtId,
      rotaryYearId: ctx.rotaryYearId,
      isYearWritable: ctx.isYearWritable,
      permissions: [...ctx.permissions].sort(),
      scopes: {
        clubIds: [...ctx.scopes.clubIds].sort(),
        clusterIds: [...ctx.scopes.clusterIds].sort(),
        isDistrictWide: ctx.scopes.isDistrictWide,
      },
    },
  });
});

/**
 * A list. No `where` at all — whatever comes back came back because the data access
 * layer put the district, the year and the soft-delete filter there.
 */
probeRouter.get(
  '/activities',
  requirePermission('activity:read:club'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    const activities = await db(ctx).activity.findMany({
      select: { id: true, title: true, hostScopeId: true },
      orderBy: { title: 'asc' },
    });
    res.status(200).json({ data: activities });
  }),
);

/**
 * The same list, narrowed to the caller's own clubs.
 *
 * A list must not 404 because one row in it is out of scope — it filters. `requireScope`
 * is for the single-record read below, where the caller named the record.
 */
probeRouter.get(
  '/activities/mine',
  requirePermission('activity:read:club'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    const activities = await db(ctx).activity.findMany({
      where: { ...clubScopeWhere(ctx, 'hostScopeId') },
      select: { id: true, title: true, hostScopeId: true },
      orderBy: { title: 'asc' },
    });
    res.status(200).json({ data: activities });
  }),
);

/**
 * A single record, the shape every module's read-one handler will take:
 *
 *  1. the scoped client answers "is it in my district and year"
 *  2. `requireScope` answers "is it in MY club"
 *
 * Both failures are 404. A club secretary who guesses another club's activity id learns
 * nothing from the response that they did not already supply.
 */
probeRouter.get(
  '/activities/:id',
  requirePermission('activity:read:club'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    // Express 5 types a path parameter as string | string[]; only the first form can be
    // a uuid, and a malformed one simply matches nothing.
    const raw = req.params['id'];
    const id = typeof raw === 'string' ? raw : '';

    const activity = await db(ctx).activity.findFirst({ where: { id } });
    if (!activity) throw notFound();

    requireScope(ctx, { scopeType: activity.hostScopeType, scopeId: activity.hostScopeId });
    res.status(200).json({ data: { id: activity.id, title: activity.title } });
  }),
);

const createActivityProbeSchema = z.object({
  activityTypeId: z.uuid(),
  hostScopeId: z.uuid(),
  title: z.string().min(1),
});

/** A create. Note the absence of districtId and rotaryYearId — the layer stamps them. */
probeRouter.post(
  '/activities',
  requirePermission('activity:create:club'),
  ...withBody(createActivityProbeSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    requireScope(ctx, { scopeType: 'CLUB', scopeId: body.hostScopeId });

    // No districtId, no rotaryYearId. They are not omitted here for brevity — the
    // scoped delegate does not accept them, because the layer supplies them.
    const created = await db(ctx).activity.create({
      data: {
        activityTypeId: body.activityTypeId,
        hostScopeType: 'CLUB',
        hostScopeId: body.hostScopeId,
        title: body.title,
        startsAt: new Date(),
      },
    });

    res.status(201).json({
      data: {
        id: created.id,
        districtId: created.districtId,
        rotaryYearId: created.rotaryYearId,
      },
    });
  }),
);

/**
 * A create that TRIES to choose its own district and year — exactly the bug CLAUDE.md
 * names: scope taken from request input.
 *
 * Written as an object built first and passed second, which is how it slips past the
 * type: TypeScript's excess-property check fires on an object LITERAL at the call site
 * and not on a variable, so a handler assembling `data` in a helper can still carry
 * fields the scoped delegate does not declare.
 *
 * That is precisely why the runtime override exists rather than the types alone. This
 * route is here to prove it: whatever arrives, the row lands in the caller's district
 * and the caller's year.
 */
const forgedActivityProbeSchema = createActivityProbeSchema.extend({
  districtId: z.uuid(),
  rotaryYearId: z.uuid(),
});

probeRouter.post(
  '/activities/forged',
  requirePermission('activity:create:club'),
  ...withBody(forgedActivityProbeSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);

    const forged = {
      districtId: body.districtId,
      rotaryYearId: body.rotaryYearId,
      activityTypeId: body.activityTypeId,
      hostScopeType: 'CLUB' as const,
      hostScopeId: body.hostScopeId,
      title: body.title,
      startsAt: new Date(),
    };

    const created = await db(ctx).activity.create({ data: forged });

    res.status(201).json({
      data: {
        id: created.id,
        districtId: created.districtId,
        rotaryYearId: created.rotaryYearId,
      },
    });
  }),
);

/** Mounted by `createApp(mountProbeRoutes)`. */
export function mountProbeRoutes(app: Express): void {
  app.use('/api/v1/__probe', probeRouter);
}
