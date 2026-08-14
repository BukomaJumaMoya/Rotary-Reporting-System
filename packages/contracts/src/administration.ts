import { z } from 'zod';
import { listResponseSchema, paginationQuerySchema } from './common.js';

/**
 * Onboarding and administration.
 *
 * Three things M0 deliberately deferred, all for the same reason: each is a permission
 * question, and permissions did not exist until session 4.
 */

// ─── Invitations ─────────────────────────────────────────────────────────────

export const invitationSchema = z.object({
  id: z.uuid(),
  personId: z.uuid(),
  personName: z.string(),
  /** Where it was sent. Shown only to a caller who may already see the person. */
  email: z.string().nullable(),
  issuedAt: z.string(),
  expiresAt: z.string(),
  isExpired: z.boolean(),
});
export type Invitation = z.infer<typeof invitationSchema>;

export const invitationListResponseSchema = listResponseSchema(invitationSchema);

export const invitationListQuerySchema = paginationQuerySchema.extend({
  /** Include invitations that have expired but were never used. Default false. */
  includeExpired: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type InvitationListQuery = z.infer<typeof invitationListQuerySchema>;

/**
 * One person or many.
 *
 * Bulk is CAPPED and processed one at a time, reporting per person, because the useful
 * answer to "invite these forty members" is which of them worked — not a batch that
 * failed because one already had an account.
 */
export const createInvitationsRequestSchema = z.object({
  personIds: z.array(z.uuid()).min(1).max(50),
});
export type CreateInvitationsRequest = z.infer<typeof createInvitationsRequestSchema>;

export const invitationResultSchema = z.object({
  personId: z.uuid(),
  status: z.enum(['SENT', 'FAILED']),
  /** A stable code when it failed: ALREADY_ACTIVE, OUT_OF_SCOPE, NOT_FOUND. */
  reason: z.string().nullable(),
});
export type InvitationResult = z.infer<typeof invitationResultSchema>;

export const createInvitationsResponseSchema = z.object({
  data: z.object({
    sent: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    results: z.array(invitationResultSchema),
  }),
});

// ─── Audit ───────────────────────────────────────────────────────────────────

export const auditEntrySchema = z.object({
  id: z.string(),
  occurredAt: z.string(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.uuid().nullable(),
  actorUserId: z.uuid().nullable(),
  actorName: z.string().nullable(),
  ipAddress: z.string().nullable(),
  /**
   * Field-level changes, ready to render as rows rather than as raw JSON.
   *
   * Contact fields are REDACTED. The log exists to answer "who changed what and when";
   * a member's old phone number is not part of that answer, and an audit endpoint that
   * leaked what the rest of the system protects would be the obvious hole.
   */
  changes: z.array(
    z.object({
      field: z.string(),
      before: z.string().nullable(),
      after: z.string().nullable(),
      isRedacted: z.boolean(),
    }),
  ),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const auditListResponseSchema = listResponseSchema(auditEntrySchema);

export const auditListQuerySchema = paginationQuerySchema.extend({
  entityType: z.string().trim().max(60).optional(),
  entityId: z.uuid().optional(),
  actorUserId: z.uuid().optional(),
  action: z.string().trim().max(30).optional(),
  /** ISO dates, inclusive. */
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type AuditListQuery = z.infer<typeof auditListQuerySchema>;

// ─── MFA administrative reset ────────────────────────────────────────────────

export const mfaResetResponseSchema = z.object({
  data: z.object({
    userId: z.uuid(),
    mfaEnabled: z.literal(false),
    recoveryCodesInvalidated: z.number().int().nonnegative(),
    /** False when the person has no email on file — the reset still happened. */
    personNotified: z.boolean(),
  }),
});

// ─── Year rollover ───────────────────────────────────────────────────────────

/**
 * The riskiest operation in the system: once a year, every club and every appointment.
 *
 * `dryRun` has NO default and must be sent explicitly. A default of true would be
 * ignored by a client that forgot it; a default of false would be a catastrophe. Making
 * it required means the caller has said which one they meant.
 */
export const rolloverRequestSchema = z.object({
  targetYearLabel: z.string().regex(/^\d{4}-\d{2}$/, 'A Rotary Year looks like 2028-29'),
  dryRun: z.boolean(),
  /** Required to commit. Issued by the most recent dry run, expiring after 30 minutes. */
  confirmToken: z.uuid().optional(),
});
export type RolloverRequest = z.infer<typeof rolloverRequestSchema>;

export const rolloverReportSchema = z.object({
  dryRun: z.boolean(),
  fromYearLabel: z.string(),
  toYearLabel: z.string(),
  clubsCarriedForward: z.number().int().nonnegative(),
  clusterAssignmentsCarried: z.number().int().nonnegative(),
  appointmentsExpired: z.number().int().nonnegative(),
  expiringByPosition: z.array(
    z.object({ position: z.string(), count: z.number().int().nonnegative() }),
  ),
  /** Tier recalculated from the closing roster: what moved, and why. */
  tierChanges: z.array(
    z.object({
      clubId: z.uuid(),
      clubName: z.string(),
      from: z.string(),
      to: z.string(),
      rosterSize: z.number().int().nonnegative(),
    }),
  ),
  /** Clubs the district should look at before confirming — a zero roster, above all. */
  flaggedClubs: z.array(z.object({ clubId: z.uuid(), clubName: z.string(), reason: z.string() })),
  /** Present on a dry run only. Pass it back to commit the same diff. */
  confirmToken: z.string().nullable(),
});
export type RolloverReport = z.infer<typeof rolloverReportSchema>;

export const rolloverResponseSchema = z.object({ data: rolloverReportSchema });
