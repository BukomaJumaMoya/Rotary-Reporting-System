import { z } from 'zod';
import {
  booleanQuerySchema,
  listResponseSchema,
  paginationQuerySchema,
  singleResponseSchema,
} from './common.js';
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

// ─── Activities ──────────────────────────────────────────────────────────────

export const activityStatuses = ['PLANNED', 'HELD', 'CANCELLED'] as const;
export const verificationStates = ['UNVERIFIED', 'VERIFIED', 'QUERIED', 'REJECTED'] as const;
export const partnerTypes = [
  'ROTARACT_CLUB',
  'ROTARY_CLUB',
  'INTERACT_CLUB',
  'CORPORATE',
  'NGO',
  'GOVERNMENT',
  'ACADEMIC',
  'OTHER',
] as const;
export const attendeeRoles = ['MEMBER', 'VISITOR', 'GUEST', 'SPEAKER'] as const;

export const activitySchema = z.object({
  id: z.uuid(),
  activityTypeId: z.uuid(),
  activityTypeName: z.string(),
  activityTypeCode: z.string(),
  category: z.enum(activityCategories),
  hostScopeType: z.enum(orgScopes),
  hostScopeId: z.uuid(),
  hostName: z.string().nullable(),
  title: z.string(),
  /** NO length limit, by design — the predecessor's limit was a logged complaint. */
  description: z.string().nullable(),
  startsAt: z.string(),
  endsAt: z.string().nullable(),
  venue: z.string().nullable(),
  isVirtual: z.boolean(),
  meetingUrl: z.string().nullable(),
  status: z.enum(activityStatuses),
  themeAlignment: z.string().nullable(),
  narrativeReport: z.string().nullable(),
  attendanceMembers: z.number().int().nullable(),
  attendanceVisitors: z.number().int().nullable(),
  attendanceGuests: z.number().int().nullable(),
  beneficiariesCount: z.number().int().nullable(),
  treesPlanted: z.number().int().nullable(),
  fundsRaised: z.string().nullable(),
  volunteerHours: z.string().nullable(),
  /** The type-specific fields the type's `field_config` declared. */
  extra: z.record(z.string(), z.unknown()),
  verification: z.enum(verificationStates),
  verifiedAt: z.string().nullable(),
  areaOfFocusCodes: z.array(z.string()),
  mediaCount: z.number().int().nonnegative(),
  partnerCount: z.number().int().nonnegative(),
  attendeeCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type Activity = z.infer<typeof activitySchema>;

export const activityListResponseSchema = listResponseSchema(activitySchema);
export const activityResponseSchema = singleResponseSchema(activitySchema);

export const activityListQuerySchema = paginationQuerySchema.extend({
  activityTypeId: z.uuid().optional(),
  category: z.enum(activityCategories).optional(),
  hostScopeType: z.enum(orgScopes).optional(),
  hostScopeId: z.uuid().optional(),
  status: z.enum(activityStatuses).optional(),
  verification: z.enum(verificationStates).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  q: z.string().trim().min(1).max(120).optional(),
});
export type ActivityListQuery = z.infer<typeof activityListQuerySchema>;

const activityFields = {
  activityTypeId: z.uuid(),
  hostScopeType: z.enum(orgScopes),
  hostScopeId: z.uuid(),
  title: z.string().trim().min(3).max(240),
  /**
   * NO maximum. The predecessor's description limit was a logged complaint — a club that
   * has run a six-month project has more than 500 characters to say about it, and a system
   * that truncates the account is a system whose reports get written somewhere else.
   */
  description: z.string().nullable().optional(),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }).nullable().optional(),
  venue: z.string().trim().max(240).nullable().optional(),
  isVirtual: z.boolean().optional(),
  meetingUrl: z.string().trim().max(500).nullable().optional(),
  status: z.enum(activityStatuses).optional(),
  themeAlignment: z.string().trim().max(120).nullable().optional(),
  narrativeReport: z.string().nullable().optional(),
  attendanceMembers: z.number().int().min(0).max(100_000).nullable().optional(),
  attendanceVisitors: z.number().int().min(0).max(100_000).nullable().optional(),
  attendanceGuests: z.number().int().min(0).max(100_000).nullable().optional(),
  beneficiariesCount: z.number().int().min(0).max(10_000_000).nullable().optional(),
  treesPlanted: z.number().int().min(0).max(10_000_000).nullable().optional(),
  fundsRaised: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .nullable()
    .optional(),
  volunteerHours: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .nullable()
    .optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
  areaOfFocusCodes: z.array(z.string().trim().min(1).max(40)).max(7).optional(),
};

export const createActivitySchema = z.object({
  /** Client-generated, so an offline retry is idempotent (ADR-004, ADR-006). */
  id: z.uuid().optional(),
  ...activityFields,
});
export type CreateActivity = z.infer<typeof createActivitySchema>;

/**
 * The TYPE cannot change. The activity was validated against its requirements, and
 * re-pointing it would leave a row satisfying a different type's rules than the ones it was
 * checked against — which the scoring engine would then read as compliant.
 */
export const updateActivitySchema = z
  .object(activityFields)
  .omit({ activityTypeId: true })
  .partial();
export type UpdateActivity = z.infer<typeof updateActivitySchema>;

export const verifyActivitySchema = z.object({
  decision: z.enum(['VERIFY', 'QUERY', 'REJECT']),
  /** Required for QUERY and REJECT: a refusal with no reason is one nobody can act on. */
  comment: z.string().trim().max(2000).optional(),
});
export type VerifyActivity = z.infer<typeof verifyActivitySchema>;

export const addPartnerSchema = z.object({
  partnerType: z.enum(partnerTypes),
  partnerClubId: z.uuid().nullable().optional(),
  partnerOrgName: z.string().trim().max(200).nullable().optional(),
  /**
   * International service is DERIVED from this, never declared — the resolver's predicate is
   * `country_code <> 'UG'`. A club cannot tick a box to claim it.
   */
  countryCode: z.string().trim().length(2).toUpperCase().default('UG'),
  contributionNote: z.string().trim().max(500).nullable().optional(),
});
export type AddPartner = z.infer<typeof addPartnerSchema>;

export const partnerSchema = z.object({
  id: z.uuid(),
  partnerType: z.enum(partnerTypes),
  partnerClubId: z.uuid().nullable(),
  partnerOrgName: z.string().nullable(),
  countryCode: z.string(),
  contributionNote: z.string().nullable(),
  /** True when the country is not Uganda — the whole reason the column is NOT NULL. */
  isInternational: z.boolean(),
});
export type Partner = z.infer<typeof partnerSchema>;
export const partnerListResponseSchema = listResponseSchema(partnerSchema);

export const addAttendeesSchema = z.object({
  attendees: z
    .array(z.object({ personId: z.uuid(), role: z.enum(attendeeRoles).default('MEMBER') }))
    .min(1)
    .max(500),
});
export type AddAttendees = z.infer<typeof addAttendeesSchema>;

export const calendarQuerySchema = z.object({
  /** `YYYY-MM`. One month, which is what a planning view shows. */
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'A month looks like 2027-09'),
  hostScopeId: z.uuid().optional(),
});
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;

export const calendarResponseSchema = z.object({
  data: z.array(
    z.object({
      date: z.string(),
      activities: z.array(
        z.object({
          id: z.uuid(),
          title: z.string(),
          activityTypeName: z.string(),
          status: z.enum(activityStatuses),
          verification: z.enum(verificationStates),
          hostName: z.string().nullable(),
        }),
      ),
    }),
  ),
});
