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
