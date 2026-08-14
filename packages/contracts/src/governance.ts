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
