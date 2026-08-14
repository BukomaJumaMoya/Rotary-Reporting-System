import { z } from 'zod';
import {
  booleanQuerySchema,
  listResponseSchema,
  paginationQuerySchema,
  singleResponseSchema,
} from './common.js';
import { orgScopes } from './context.js';

/**
 * Positions and the permissions they grant.
 *
 * A position is CONFIGURATION: D9218's RY2027-28 slate has over thirty distinct roles,
 * several of which did not previously exist, and adding one must be an insert rather than
 * a release (docs/03-Data-Model.md §3).
 */

/** `resource:action:scope`, e.g. `activity:create:club`. */
export const permissionCodeSchema = z
  .string()
  .trim()
  .regex(
    /^[a-z][a-z0-9]*:[a-z][a-z0-9]*:[a-z][a-z0-9]*$/,
    'A permission code looks like resource:action:scope',
  );

export const permissionSchema = z.object({
  code: z.string(),
  description: z.string(),
});
export type Permission = z.infer<typeof permissionSchema>;

export const permissionListResponseSchema = listResponseSchema(permissionSchema);

export const positionSchema = z.object({
  id: z.uuid(),
  /** Null means a system-wide template: readable by every district, editable by none. */
  districtId: z.uuid().nullable(),
  isTemplate: z.boolean(),
  code: z.string(),
  name: z.string(),
  scope: z.enum(orgScopes),
  sequence: z.number().int(),
  isUniquePerScope: z.boolean(),
  isActive: z.boolean(),
  /** The permission codes this position grants, sorted. */
  permissions: z.array(z.string()),
  /** How many people currently hold it. Present on reads, so the UI can warn before deactivating. */
  activeAppointments: z.number().int().nonnegative(),
});
export type Position = z.infer<typeof positionSchema>;

export const positionListResponseSchema = listResponseSchema(positionSchema);
export const positionResponseSchema = singleResponseSchema(positionSchema);

export const positionListQuerySchema = paginationQuerySchema.extend({
  scope: z.enum(orgScopes).optional(),
  isActive: booleanQuerySchema.optional(),
  /** Whether to include the system-wide templates. Default true — they are part of the catalogue. */
  includeTemplates: booleanQuerySchema.optional(),
});
export type PositionListQuery = z.infer<typeof positionListQuerySchema>;

/**
 * `code` is immutable after creation and therefore absent from the patch schema.
 *
 * The seed, the authorisation matrix and anything an officer has written down all refer to
 * a position by its code. Renaming one silently re-points every reference.
 */
export const createPositionRequestSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[A-Z][A-Z0-9_]*$/, 'A position code is upper snake case, e.g. CLUB_SECRETARY'),
  name: z.string().trim().min(2).max(120),
  scope: z.enum(orgScopes),
  sequence: z.number().int().min(0).max(10_000).default(0),
  isUniquePerScope: z.boolean().default(false),
  permissions: z.array(permissionCodeSchema).default([]),
});
export type CreatePositionRequest = z.infer<typeof createPositionRequestSchema>;

export const updatePositionRequestSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    scope: z.enum(orgScopes).optional(),
    sequence: z.number().int().min(0).max(10_000).optional(),
    isUniquePerScope: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to change',
  });
export type UpdatePositionRequest = z.infer<typeof updatePositionRequestSchema>;

/**
 * Replaces the WHOLE permission set. Not a patch.
 *
 * A grid of checkboxes is what the PIME Chair and the DES actually edit, and "here is the
 * new set" is what that produces. Diffing it into adds and removes on the client would
 * make two racing editors silently merge each other's work.
 */
export const replacePermissionsRequestSchema = z.object({
  permissions: z.array(permissionCodeSchema).max(200),
});
export type ReplacePermissionsRequest = z.infer<typeof replacePermissionsRequestSchema>;

// ---------------------------------------------------------------------------
// Appointments
//
// The unit of authorisation. Nobody has a role; people hold appointments, and an
// appointment is (person, position, org unit, year). Annual turnover is a consequence
// rather than a job: on 1 July last year's appointments are out of scope and last year's
// access ends without an administrator revoking anything.
// ---------------------------------------------------------------------------

/** `YYYY-MM-DD`. A term is a DATE, not a timestamp — see platform/time.ts. */
export const isoDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'A date looks like 2027-07-01');

export const appointmentSchema = z.object({
  id: z.uuid(),
  personId: z.uuid(),
  personName: z.string(),
  positionId: z.uuid(),
  positionCode: z.string(),
  positionName: z.string(),
  scopeType: z.enum(orgScopes),
  scopeId: z.uuid().nullable(),
  scopeName: z.string().nullable(),
  rotaryYearId: z.uuid(),
  rotaryYearLabel: z.string(),
  startsOn: isoDateSchema,
  endsOn: isoDateSchema.nullable(),
  isActive: z.boolean(),
  /**
   * Whether the term covers TODAY in the district's timezone.
   *
   * Distinct from `isActive`, which only says the appointment has not been revoked. An
   * appointment created in June for a term starting 1 July is active and not yet in
   * force, and a screen that showed one number for both would be lying for a month.
   */
  isCurrent: z.boolean(),
});
export type Appointment = z.infer<typeof appointmentSchema>;

export const appointmentListResponseSchema = listResponseSchema(appointmentSchema);
export const appointmentResponseSchema = singleResponseSchema(appointmentSchema);

export const appointmentListQuerySchema = paginationQuerySchema.extend({
  personId: z.uuid().optional(),
  positionId: z.uuid().optional(),
  scopeType: z.enum(orgScopes).optional(),
  scopeId: z.uuid().optional(),
  isActive: booleanQuerySchema.optional(),
  /** Only those whose term covers today, in district-local time. */
  currentOnly: booleanQuerySchema.optional(),
});
export type AppointmentListQuery = z.infer<typeof appointmentListQuerySchema>;

/**
 * `rotaryYearId` is deliberately absent. It comes from the request context, never from
 * the body — a handler reading a year from input is the bug axiom 1 exists to prevent.
 */
export const createAppointmentRequestSchema = z.object({
  personId: z.uuid(),
  positionId: z.uuid(),
  scopeType: z.enum(orgScopes),
  /** Null for a DISTRICT appointment; a club, cluster, region or committee id otherwise. */
  scopeId: z.uuid().nullable().default(null),
  startsOn: isoDateSchema,
  endsOn: isoDateSchema.nullable().default(null),
});
export type CreateAppointmentRequest = z.infer<typeof createAppointmentRequestSchema>;

/**
 * Only the term and the revocation flag can change.
 *
 * Re-pointing an appointment at a different person or position is not an edit, it is a
 * different appointment — and it would silently rewrite who held office when.
 */
export const updateAppointmentRequestSchema = z
  .object({
    endsOn: isoDateSchema.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to change',
  });
export type UpdateAppointmentRequest = z.infer<typeof updateAppointmentRequestSchema>;

// ---------------------------------------------------------------------------
// Committees
//
// Self-referencing, so a chair can create sub-committees without a developer. The
// district asked for exactly this and the incumbent system could not do it:
// "allow chairs to create their own sub-committee, enter position and select the person".
// ---------------------------------------------------------------------------

/** District committee → sub-committee → working group. Deep enough; deeper is a maze. */
export const MAX_COMMITTEE_DEPTH = 3;

export const committeeSchema = z.object({
  id: z.uuid(),
  parentCommitteeId: z.uuid().nullable(),
  name: z.string(),
  mandate: z.string().nullable(),
  rotaryYearId: z.uuid(),
  /** 1 for a district committee, 2 for a sub-committee, 3 for a working group. */
  depth: z.number().int().positive(),
  memberCount: z.number().int().nonnegative(),
});
export type Committee = z.infer<typeof committeeSchema>;

/** The same committee with its children nested, for the tree view. */
export type CommitteeNode = Committee & { children: CommitteeNode[] };

export const committeeNodeSchema: z.ZodType<CommitteeNode> = committeeSchema.extend({
  children: z.lazy(() => z.array(committeeNodeSchema)),
});

export const committeeListResponseSchema = listResponseSchema(committeeSchema);
export const committeeTreeResponseSchema = z.object({ data: z.array(committeeNodeSchema) });
export const committeeResponseSchema = singleResponseSchema(committeeSchema);

export const committeeListQuerySchema = paginationQuerySchema.extend({
  /** Only the direct children of this committee. `root` for the top level. */
  parentId: z.union([z.uuid(), z.literal('root')]).optional(),
  /** Nested rather than flat. Ignores pagination — a committee tree is a handful of rows. */
  tree: booleanQuerySchema.optional(),
});
export type CommitteeListQuery = z.infer<typeof committeeListQuerySchema>;

export const createCommitteeRequestSchema = z.object({
  name: z.string().trim().min(2).max(120),
  mandate: z.string().trim().max(2000).nullable().default(null),
  parentCommitteeId: z.uuid().nullable().default(null),
});
export type CreateCommitteeRequest = z.infer<typeof createCommitteeRequestSchema>;

/**
 * `parentCommitteeId` is absent: re-parenting a committee mid-year would move every
 * member's scope with it, silently, and is not something a form should offer.
 */
export const updateCommitteeRequestSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    mandate: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to change',
  });
export type UpdateCommitteeRequest = z.infer<typeof updateCommitteeRequestSchema>;

/**
 * Membership is by APPOINTMENT, not by person.
 *
 * Serving on a committee is something you do in a capacity, for a year, and it expires
 * with the appointment that justified it — so the row names the appointment and carries
 * the person's position context with it.
 */
export const committeeMemberSchema = z.object({
  appointmentId: z.uuid(),
  personId: z.uuid(),
  personName: z.string(),
  positionName: z.string(),
  roleLabel: z.string().nullable(),
});
export type CommitteeMember = z.infer<typeof committeeMemberSchema>;

export const committeeMemberListResponseSchema = listResponseSchema(committeeMemberSchema);

export const addCommitteeMemberRequestSchema = z.object({
  appointmentId: z.uuid(),
  roleLabel: z.string().trim().max(80).nullable().default(null),
});
export type AddCommitteeMemberRequest = z.infer<typeof addCommitteeMemberRequestSchema>;

// ---------------------------------------------------------------------------
// Person lookup
//
// NAMES ONLY. Enough to choose somebody in an appointment or committee picker, and
// nothing more — no email, no phone, no photo. The cheapest way to keep contact fields
// out of a response is not to select them, and a picker has never needed them.
// ---------------------------------------------------------------------------

export const personSummarySchema = z.object({
  id: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
  /** Their current club, so two people with the same name can be told apart. */
  clubName: z.string().nullable(),
});
export type PersonSummary = z.infer<typeof personSummarySchema>;

export const personSummaryListResponseSchema = listResponseSchema(personSummarySchema);

export const personSearchQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(80).optional(),
});
export type PersonSearchQuery = z.infer<typeof personSearchQuerySchema>;
