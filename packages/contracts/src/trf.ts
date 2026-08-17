import { z } from 'zod';
// The SAME four states an activity uses, imported rather than re-declared. Verification is
// one idea — a district officer confirming a club's claim — and two copies of the list is
// one that eventually gains a fifth state on only one side.
import { verificationStates } from './activity.js';
import { listResponseSchema, paginationQuerySchema, singleResponseSchema } from './common.js';
import { moneyOutSchema, moneySchema } from './finance.js';

/**
 * The Rotary Foundation (docs/05-API-Spec.md §7, FR-5).
 *
 * **Amounts are USD, and are stored as reported — never converted.** Club finances are in
 * UGX and the rubric's bands are in dollars, because that is what TRF reports and what the
 * district is measured on. Converting at a rate this system picked would make a club's
 * scoring band depend on the day somebody ran an import, which is not a number anyone could
 * defend when a club misses a threshold by twenty dollars.
 *
 * **Only VERIFIED contributions count.** M5's `trf.contribution_usd` resolver depends on it,
 * and a club typing in a figure it has not evidenced is exactly what verification exists to
 * catch: TRF giving is a scored parameter with award consequences.
 */

export const trfFundTypes = [
  'ANNUAL_FUND',
  'POLIO_PLUS',
  'ENDOWMENT',
  'DISASTER_RESPONSE',
  'OTHER',
] as const;
export type TrfFundType = (typeof trfFundTypes)[number];

export const trfContributionSchema = z.object({
  id: z.uuid(),
  clubId: z.uuid(),
  clubName: z.string().nullable(),
  /** Null for a club-level gift rather than a named member's. */
  personId: z.uuid().nullable(),
  personName: z.string().nullable(),
  fundType: z.enum(trfFundTypes),
  amountUsd: moneyOutSchema,
  contributedOn: z.string(),
  /** The reference on the Rotary receipt. What a dispute is settled with. */
  riReceiptRef: z.string().nullable(),
  evidenceUrl: z.string().nullable(),
  verification: z.enum(verificationStates),
  createdAt: z.string(),
});
export type TrfContribution = z.infer<typeof trfContributionSchema>;

export const createTrfContributionSchema = z.object({
  id: z.uuid().optional(),
  clubId: z.uuid(),
  /** Omit for a club-level gift. */
  personId: z.uuid().nullable().optional(),
  fundType: z.enum(trfFundTypes).default('ANNUAL_FUND'),
  amountUsd: moneySchema,
  contributedOn: z.iso.date(),
  riReceiptRef: z.string().trim().max(120).nullable().optional(),
  evidenceUrl: z.url().max(500).nullable().optional(),
});
export type CreateTrfContribution = z.infer<typeof createTrfContributionSchema>;

/**
 * Verification, with the same four states an activity has.
 *
 * QUERIED rather than REJECTED is the useful middle: a club that mistyped a receipt
 * reference should be asked, not refused. A comment is required for anything but VERIFIED,
 * because "your contribution was rejected" with no reason is a message that generates an
 * email rather than a correction.
 */
export const verifyTrfContributionSchema = z
  .object({
    decision: z.enum(['VERIFIED', 'QUERIED', 'REJECTED']),
    comment: z.string().trim().max(500).nullable().optional(),
  })
  .refine((value) => value.decision === 'VERIFIED' || (value.comment?.length ?? 0) >= 5, {
    message: 'Say why, so the club can correct it',
    path: ['comment'],
  });
export type VerifyTrfContribution = z.infer<typeof verifyTrfContributionSchema>;

export const trfListQuerySchema = paginationQuerySchema.extend({
  clubId: z.uuid().optional(),
  personId: z.uuid().optional(),
  fundType: z.enum(trfFundTypes).optional(),
  verification: z.enum(verificationStates).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

// ─── Summary ─────────────────────────────────────────────────────────────────

export const trfClubTotalSchema = z.object({
  clubId: z.uuid(),
  clubName: z.string(),
  /** VERIFIED only — the figure a scorecard would use. */
  verifiedUsd: moneyOutSchema,
  /** Everything not yet verified, so a treasurer can see what needs attention. */
  pendingUsd: moneyOutSchema,
  /**
   * Members with at least one VERIFIED contribution, over the club's roster.
   *
   * `trf.contributing_member_rate` in the rubric. Club-level gifts have no person and are
   * therefore excluded from the numerator — a single club cheque is not every member
   * giving, and counting it as such is the exact misreading this rate exists to prevent.
   */
  contributingMembers: z.number().int().nonnegative(),
  rosterSize: z.number().int().nonnegative(),
  contributingMemberRate: z.number(),
});
export type TrfClubTotal = z.infer<typeof trfClubTotalSchema>;

export const trfFundTotalSchema = z.object({
  fundType: z.enum(trfFundTypes),
  verifiedUsd: moneyOutSchema,
  pendingUsd: moneyOutSchema,
});

export const trfSummarySchema = z.object({
  rotaryYearId: z.uuid(),
  /** Cumulative year-to-date across the district, VERIFIED only. */
  verifiedUsd: moneyOutSchema,
  pendingUsd: moneyOutSchema,
  byFund: z.array(trfFundTotalSchema),
  byClub: z.array(trfClubTotalSchema),
});
export type TrfSummary = z.infer<typeof trfSummarySchema>;

// ─── Envelopes ───────────────────────────────────────────────────────────────

export const trfContributionResponseSchema = singleResponseSchema(trfContributionSchema);
export const trfContributionListResponseSchema = listResponseSchema(trfContributionSchema);
export const trfSummaryResponseSchema = singleResponseSchema(trfSummarySchema);
