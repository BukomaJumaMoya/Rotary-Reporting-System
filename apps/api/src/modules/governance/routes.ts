import {
  addCommitteeMemberRequestSchema,
  auditListQuerySchema,
  createInvitationsRequestSchema,
  invitationListQuerySchema,
  appointmentListQuerySchema,
  committeeListQuerySchema,
  createAppointmentRequestSchema,
  createCommitteeRequestSchema,
  updateCommitteeRequestSchema,
  createPositionRequestSchema,
  paginationQuerySchema,
  positionListQuerySchema,
  replacePermissionsRequestSchema,
  updateAppointmentRequestSchema,
  updatePositionRequestSchema,
} from '@dis/contracts';
import { Router } from 'express';
import { requireContext, requirePermission } from '../../platform/context.js';
import { insufficientScope } from '../../platform/errors.js';
import { asyncHandler, parseQuery, pathParam, withBody } from '../../platform/validate.js';
import * as administration from './administration.service.js';
import * as appointments from './appointments.service.js';
import * as committees from './committees.service.js';
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

// ---------------------------------------------------------------------------
// Appointments
// ---------------------------------------------------------------------------

governanceRouter.get(
  '/appointments',
  requirePermission('appointment:read:district'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    const query = parseQuery(appointmentListQuerySchema, req);
    res.status(200).json(await appointments.list(ctx, query));
  }),
);

governanceRouter.get(
  '/appointments/:id',
  requirePermission('appointment:read:district'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    res.status(200).json({ data: await appointments.get(ctx, pathParam(req, 'id')) });
  }),
);

governanceRouter.post(
  '/appointments',
  requirePermission('appointment:manage:district'),
  ...withBody(createAppointmentRequestSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    res.status(201).json({ data: await appointments.create(ctx, body) });
  }),
);

/** End a term, or revoke. Never re-point at a different person — that is a new appointment. */
governanceRouter.patch(
  '/appointments/:id',
  requirePermission('appointment:manage:district'),
  ...withBody(updateAppointmentRequestSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    res.status(200).json({ data: await appointments.update(ctx, pathParam(req, 'id'), body) });
  }),
);

governanceRouter.delete(
  '/appointments/:id',
  requirePermission('appointment:manage:district'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    res.status(200).json({ data: await appointments.revoke(ctx, pathParam(req, 'id')) });
  }),
);

/**
 * A person's own appointment history.
 *
 * Readable by the person themselves without any permission — "what do I hold" is not a
 * question anybody needs authority to ask about their own record — and by anyone who may
 * read appointments across the district.
 */
governanceRouter.get(
  '/persons/:id/appointments',
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    const personId = pathParam(req, 'id');

    if (personId !== ctx.personId && !ctx.permissions.has('appointment:read:district')) {
      throw insufficientScope('You may only read your own appointments', {
        required: 'appointment:read:district',
      });
    }

    const query = parseQuery(paginationQuerySchema, req);
    res.status(200).json(await appointments.listForPerson(ctx, personId, query));
  }),
);

// ---------------------------------------------------------------------------
// Committees
//
// Readable by any signed-in member of the district: who sits on what is not a secret,
// and a member cannot volunteer for a committee they cannot see. WRITES are gated by
// `committee:manage:district` OR by chairing the committee in question — the scope check
// inside the service, which is the whole point of the feature.
// ---------------------------------------------------------------------------

governanceRouter.get(
  '/committees',
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    const query = parseQuery(committeeListQuerySchema, req);

    if (query.tree) {
      res.status(200).json({ data: await committees.tree(ctx) });
      return;
    }
    res.status(200).json(await committees.list(ctx, query));
  }),
);

governanceRouter.get(
  '/committees/:id',
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    res.status(200).json({ data: await committees.get(ctx, pathParam(req, 'id')) });
  }),
);

governanceRouter.post(
  '/committees',
  ...withBody(createCommitteeRequestSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    res.status(201).json({ data: await committees.create(ctx, body) });
  }),
);

governanceRouter.patch(
  '/committees/:id',
  ...withBody(updateCommitteeRequestSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    res.status(200).json({ data: await committees.update(ctx, pathParam(req, 'id'), body) });
  }),
);

governanceRouter.get(
  '/committees/:id/members',
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    const query = parseQuery(paginationQuerySchema, req);
    res.status(200).json(await committees.listMembers(ctx, pathParam(req, 'id'), query));
  }),
);

/** Adds an APPOINTMENT, not a person: membership carries the position it is served in. */
governanceRouter.post(
  '/committees/:id/members',
  ...withBody(addCommitteeMemberRequestSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    const members = await committees.addMember(ctx, pathParam(req, 'id'), body);
    res.status(201).json({ data: members });
  }),
);

governanceRouter.delete(
  '/committees/:id/members/:appointmentId',
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    await committees.removeMember(ctx, pathParam(req, 'id'), pathParam(req, 'appointmentId'));
    res.status(204).end();
  }),
);

// ---------------------------------------------------------------------------
// Onboarding and administration
//
// Three items M0 deferred, each because it is a permission question.
// ---------------------------------------------------------------------------

governanceRouter.get(
  '/invitations',
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    if (
      !ctx.permissions.has('person:invite:district') &&
      !ctx.permissions.has('person:invite:club')
    ) {
      throw insufficientScope('You may not issue invitations', {
        required: 'person:invite:club',
      });
    }

    const query = parseQuery(invitationListQuerySchema, req);
    res.status(200).json(await administration.listInvitations(ctx, query));
  }),
);

/**
 * One person or many, capped at fifty and processed one at a time.
 *
 * 200 rather than 201 even when every one succeeds: the useful answer to "invite these
 * forty" is a per-person report, and a batch that failed as a whole because one member
 * already had an account is a batch nobody can act on.
 */
governanceRouter.post(
  '/invitations',
  ...withBody(createInvitationsRequestSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    res.status(200).json({ data: await administration.createInvitations(ctx, body.personIds) });
  }),
);

governanceRouter.post(
  '/invitations/:id/resend',
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    res
      .status(200)
      .json({ data: await administration.resendInvitation(ctx, pathParam(req, 'id')) });
  }),
);

/**
 * Clears a member's second factor on their behalf — for somebody who has lost both their
 * authenticator and their recovery codes. Audited, and the account holder is told.
 */
governanceRouter.post(
  '/users/:id/mfa/reset',
  requirePermission('user:manage:district'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    res.status(200).json({ data: await administration.resetMfa(ctx, pathParam(req, 'id')) });
  }),
);

governanceRouter.get(
  '/audit',
  requirePermission('audit:read:district'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    const query = parseQuery(auditListQuerySchema, req);
    res.status(200).json(await administration.listAudit(ctx, query));
  }),
);

/*
 * `GET /persons` used to live here, returning names only.
 *
 * It moved to `modules/people` in M2 session 5, which is the module that owns persons and
 * the one place `serialisePerson` is applied. Two routers cannot both answer `/persons`:
 * Express matches in mount order, so the second would simply never run — and the one that
 * never ran would be the one with the visibility rules in it.
 */
