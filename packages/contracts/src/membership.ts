import { z } from 'zod';
import { listResponseSchema, paginationQuerySchema, singleResponseSchema } from './common.js';
import { personSchema } from './people.js';

/**
 * Membership is an EVENT LOG (axiom 3).
 *
 * There is no `PUT` and no `DELETE` here, and the absence is the design. A mistake is
 * corrected by appending, never by editing: the original row stays, a new event points at
 * it through `supersedesEventId`, and the roster — a materialised view — resolves to the tip
 * of the chain.
 *
 * Corrections come in two shapes. To fix a FACT, append the corrected event with its real
 * type: a mistyped join date is a second `JOIN` carrying the right date. To retract a fact
 * entirely, append an event of type `CORRECTION`, which supersedes the original and, not
 * being a joining type, drops the person from the roster.
 */

export const membershipEventTypes = [
  'JOIN',
  'INDUCT',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'TERMINATE',
  'TRANSITION_TO_ROTARY',
  'REINSTATE',
  'CATEGORY_CHANGE',
  'CORRECTION',
] as const;
export type MembershipEventTypeValue = (typeof membershipEventTypes)[number];

/** The types that leave somebody ON the roster. Mirrors the club_rosters predicate. */
export const joiningEventTypes = [
  'JOIN',
  'INDUCT',
  'TRANSFER_IN',
  'REINSTATE',
  'CATEGORY_CHANGE',
] as const;

/** The types that take somebody OFF it. */
export const leavingEventTypes = ['TRANSFER_OUT', 'TERMINATE', 'TRANSITION_TO_ROTARY'] as const;

export const memberCategories = ['ACTIVE', 'HONORARY', 'CORPORATE'] as const;
export type MemberCategoryValue = (typeof memberCategories)[number];

export const membershipEventSchema = z.object({
  id: z.uuid(),
  personId: z.uuid(),
  person: personSchema,
  clubId: z.uuid(),
  clubName: z.string(),
  eventType: z.enum(membershipEventTypes),
  memberCategory: z.enum(memberCategories),
  effectiveOn: z.string(),
  reasonCode: z.string().nullable(),
  reasonNote: z.string().nullable(),
  counterpartyClubId: z.uuid().nullable(),
  counterpartyClubName: z.string().nullable(),
  rotaryClubName: z.string().nullable(),
  rotaryClubRiId: z.string().nullable(),
  corroboratedAt: z.string().nullable(),
  /** The event this one replaces, if any. */
  supersedesEventId: z.uuid().nullable(),
  /** True when a LATER event supersedes this one — i.e. this row is history. */
  isSuperseded: z.boolean(),
  recordedAt: z.string(),
});
export type MembershipEvent = z.infer<typeof membershipEventSchema>;

export const membershipEventListResponseSchema = listResponseSchema(membershipEventSchema);
export const membershipEventResponseSchema = singleResponseSchema(membershipEventSchema);

export const membershipEventListQuerySchema = paginationQuerySchema.extend({
  clubId: z.uuid().optional(),
  personId: z.uuid().optional(),
  eventType: z.enum(membershipEventTypes).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
export type MembershipEventListQuery = z.infer<typeof membershipEventListQuerySchema>;

/**
 * `id` is client-generated so an offline retry is idempotent (ADR-004): the same UUID
 * posted twice yields one row, which is what makes a secretary tapping Save on a bad
 * connection safe.
 */
export const createMembershipEventSchema = z
  .object({
    id: z.uuid().optional(),
    personId: z.uuid(),
    clubId: z.uuid(),
    eventType: z.enum(membershipEventTypes),
    memberCategory: z.enum(memberCategories).default('ACTIVE'),
    effectiveOn: z.iso.date(),
    reasonCode: z.string().trim().max(60).nullable().optional(),
    reasonNote: z.string().trim().max(1000).nullable().optional(),
    /** Transfers: the club on the other side of the move. */
    counterpartyClubId: z.uuid().nullable().optional(),
    /** TRANSITION_TO_ROTARY: the receiving Rotary club. */
    rotaryClubName: z.string().trim().max(160).nullable().optional(),
    rotaryClubRiId: z
      .string()
      .trim()
      .regex(/^[0-9]{1,18}$/)
      .nullable()
      .optional(),
    evidenceUrl: z.string().trim().max(500).nullable().optional(),
  })
  .refine(
    (input) =>
      input.eventType !== 'TRANSITION_TO_ROTARY' ||
      (input.rotaryClubName !== null && input.rotaryClubName !== undefined),
    {
      // A transition with no receiving club is a number in a report nobody can check, and
      // transitions to Rotary are the single most contested figure in a district's return.
      message: 'A transition to Rotary must name the receiving Rotary club',
      path: ['rotaryClubName'],
    },
  );
export type CreateMembershipEvent = z.infer<typeof createMembershipEventSchema>;

/**
 * A correction. `eventType` says which of the two shapes this is: `CORRECTION` retracts the
 * original, anything else replaces it with a corrected fact.
 */
export const correctMembershipEventSchema = z.object({
  id: z.uuid().optional(),
  eventType: z.enum(membershipEventTypes).default('CORRECTION'),
  memberCategory: z.enum(memberCategories).optional(),
  effectiveOn: z.iso.date().optional(),
  reasonCode: z.string().trim().max(60).nullable().optional(),
  reasonNote: z.string().trim().max(1000),
});
export type CorrectMembershipEvent = z.infer<typeof correctMembershipEventSchema>;

// ─── Roster ──────────────────────────────────────────────────────────────────

export const rosterEntrySchema = z.object({
  personId: z.uuid(),
  person: personSchema,
  clubId: z.uuid(),
  clubName: z.string(),
  memberCategory: z.enum(memberCategories),
  since: z.string(),
});
export type RosterEntry = z.infer<typeof rosterEntrySchema>;

export const rosterListResponseSchema = listResponseSchema(rosterEntrySchema);

export const rosterQuerySchema = paginationQuerySchema.extend({
  clubId: z.uuid().optional(),
  /**
   * A date to reconstruct the roster AS AT. Reconstructed from the event log rather than
   * read from the view — the view is today, and "who were we in March" is the question a
   * disputed scorecard turns on.
   */
  asOf: z.iso.date().optional(),
  q: z.string().trim().min(1).max(120).optional(),
});
export type RosterQuery = z.infer<typeof rosterQuerySchema>;

// ─── Statistics ──────────────────────────────────────────────────────────────

export const membershipStatsSchema = z.object({
  from: z.string(),
  to: z.string(),
  clubId: z.uuid().nullable(),
  /** The roster as it stood the day before `from`. */
  opening: z.number().int().nonnegative(),
  closing: z.number().int().nonnegative(),
  joiners: z.number().int().nonnegative(),
  leavers: z.number().int().nonnegative(),
  netChange: z.number().int(),
  /**
   * `(opening − leavers) / opening`, as a percentage to two places. Null when the opening
   * roster was empty: a retention rate out of nothing is a division by zero dressed up as
   * 0%, and a club chartered in October would otherwise be reported as having lost everyone.
   */
  retentionRate: z.string().nullable(),
  transitionsToRotary: z.number().int().nonnegative(),
  byReason: z.array(z.object({ reasonCode: z.string(), count: z.number().int().nonnegative() })),
  byType: z.array(
    z.object({ eventType: z.enum(membershipEventTypes), count: z.number().int().nonnegative() }),
  ),
});
export type MembershipStats = z.infer<typeof membershipStatsSchema>;
export const membershipStatsResponseSchema = singleResponseSchema(membershipStatsSchema);

export const membershipStatsQuerySchema = z.object({
  clubId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
export type MembershipStatsQuery = z.infer<typeof membershipStatsQuerySchema>;

// ─── Transitions to Rotary ───────────────────────────────────────────────────

export const transitionSchema = z.object({
  id: z.uuid(),
  personId: z.uuid(),
  personName: z.string(),
  clubId: z.uuid(),
  clubName: z.string(),
  effectiveOn: z.string(),
  rotaryClubName: z.string().nullable(),
  rotaryClubRiId: z.string().nullable(),
  corroboratedAt: z.string().nullable(),
});
export type Transition = z.infer<typeof transitionSchema>;

export const transitionListResponseSchema = listResponseSchema(transitionSchema);
export const transitionResponseSchema = singleResponseSchema(transitionSchema);

export const transitionListQuerySchema = paginationQuerySchema.extend({
  clubId: z.uuid().optional(),
  corroborated: z.enum(['true', 'false']).optional(),
});
export type TransitionListQuery = z.infer<typeof transitionListQuerySchema>;
