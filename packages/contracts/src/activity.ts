import { z } from 'zod';
import { booleanQuerySchema, listResponseSchema, singleResponseSchema } from './common.js';
import { orgScopes } from './context.js';

/**
 * Activity types — configuration, not code (axiom 4).
 *
 * Fellowships, service projects, PLD, assemblies, cluster and district activities are all
 * rows in `activities`, distinguished by their type. A new type is an INSERT made by an
 * administrator: never a new table, never a deployment.
 */

export const activityCategories = [
  'FELLOWSHIP',
  'SERVICE',
  'INTERNATIONAL',
  'YOUTH',
  'PLD',
  'GOVERNANCE',
  'CLUSTER',
  'DISTRICT',
  'COMMITTEE',
] as const;
export type ActivityCategoryValue = (typeof activityCategories)[number];

/**
 * THE CONTRACT BETWEEN CONFIGURATION AND UI.
 *
 * `field_config` declares extra, type-specific fields; the client renders whatever it finds
 * and validates against the same declaration the server does. Design it carefully: changing
 * its shape later touches every activity type ever created, and there is no migration for a
 * JSONB column whose readers are a form builder and a scoring resolver.
 *
 * Deliberately small. Every addition here is a thing the renderer, the validator and the
 * builder UI must all agree about, and "just one more field kind" is how a configuration
 * format becomes a programming language.
 */
export const fieldKinds = ['text', 'number', 'date', 'select', 'boolean'] as const;
export type FieldKind = (typeof fieldKinds)[number];

export const activityFieldSchema = z
  .object({
    /** Stored as this key inside `activities.extra`. Stable: renaming it orphans the data. */
    key: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[a-z][a-zA-Z0-9_]*$/, 'A field key is lower camel case, e.g. beneficiaryGroup'),
    label: z.string().trim().min(1).max(120),
    type: z.enum(fieldKinds),
    required: z.boolean().default(false),
    /** `select` only. Absent for every other kind. */
    options: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
    helpText: z.string().trim().max(240).optional(),
  })
  .refine((field) => field.type !== 'select' || (field.options?.length ?? 0) > 0, {
    // A select with no options is a control nobody can complete, and it would reach a
    // secretary as a blank dropdown next to a required marker.
    message: 'A select field needs at least one option',
    path: ['options'],
  });
export type ActivityField = z.infer<typeof activityFieldSchema>;

/**
 * The whole `field_config` column.
 *
 * An OBJECT with a `fields` array rather than a bare array, so the format can gain a
 * sibling key later without every stored row needing a migration. The column's default is
 * `{}`, which parses to no fields.
 */
export const fieldConfigSchema = z
  .object({ fields: z.array(activityFieldSchema).max(20).default([]) })
  .default({ fields: [] });
export type FieldConfig = z.infer<typeof fieldConfigSchema>;

export const activityTypeSchema = z.object({
  id: z.uuid(),
  /** Null means a system-wide template: readable by every district, editable by none. */
  districtId: z.uuid().nullable(),
  isTemplate: z.boolean(),
  code: z.string(),
  name: z.string(),
  category: z.enum(activityCategories),
  allowedHostScopes: z.array(z.enum(orgScopes)),
  requiresPhoto: z.boolean(),
  requiresReport: z.boolean(),
  requiresAttendance: z.boolean(),
  requiresPartner: z.boolean(),
  requiresAreaOfFocus: z.boolean(),
  isScoringEligible: z.boolean(),
  fieldConfig: fieldConfigSchema,
  sequence: z.number().int(),
  isActive: z.boolean(),
  /** How many activities use it. A type in use cannot be deactivated without a warning. */
  activityCount: z.number().int().nonnegative(),
});
export type ActivityType = z.infer<typeof activityTypeSchema>;

export const activityTypeListResponseSchema = listResponseSchema(activityTypeSchema);
export const activityTypeResponseSchema = singleResponseSchema(activityTypeSchema);

/** Grouped by category, which is how the reporting flow presents them. */
export const activityTypeGroupedResponseSchema = z.object({
  data: z.array(
    z.object({
      category: z.enum(activityCategories),
      types: z.array(activityTypeSchema),
    }),
  ),
});

export const activityTypeListQuerySchema = z.object({
  category: z.enum(activityCategories).optional(),
  isActive: booleanQuerySchema.optional(),
  includeTemplates: booleanQuerySchema.optional(),
});
export type ActivityTypeListQuery = z.infer<typeof activityTypeListQuerySchema>;

export const createActivityTypeSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[A-Z][A-Z0-9_]*$/, 'An activity type code is upper snake case, e.g. SERVICE_PROJECT'),
  name: z.string().trim().min(2).max(120),
  category: z.enum(activityCategories),
  allowedHostScopes: z.array(z.enum(orgScopes)).min(1).default(['CLUB']),
  requiresPhoto: z.boolean().default(false),
  requiresReport: z.boolean().default(false),
  requiresAttendance: z.boolean().default(false),
  requiresPartner: z.boolean().default(false),
  requiresAreaOfFocus: z.boolean().default(false),
  isScoringEligible: z.boolean().default(true),
  fieldConfig: fieldConfigSchema.optional(),
  sequence: z.number().int().min(0).max(10_000).default(0),
});
export type CreateActivityType = z.infer<typeof createActivityTypeSchema>;

/** `code` is immutable: the seed and any scoring rule refer to a type by it. */
export const updateActivityTypeSchema = createActivityTypeSchema
  .omit({ code: true })
  .partial()
  .extend({
    isActive: z.boolean().optional(),
  });
export type UpdateActivityType = z.infer<typeof updateActivityTypeSchema>;

// ─── Media ───────────────────────────────────────────────────────────────────

export const mediaSchema = z.object({
  id: z.uuid(),
  activityId: z.uuid(),
  mediaType: z.string(),
  caption: z.string().nullable(),
  sequence: z.number().int(),
  /**
   * Short-lived signed URLs, minted per response. The database stores KEYS, never URLs, so
   * the provider or the CDN can change without a data migration — and a URL that expires is
   * a URL that cannot be pasted into a group chat and still work next week.
   */
  url: z.string().nullable(),
  thumbUrl: z.string().nullable(),
  /** False until the worker has produced the variants and stripped the metadata. */
  isProcessed: z.boolean(),
});
export type Media = z.infer<typeof mediaSchema>;

export const mediaListResponseSchema = listResponseSchema(mediaSchema);
export const mediaResponseSchema = singleResponseSchema(mediaSchema);
