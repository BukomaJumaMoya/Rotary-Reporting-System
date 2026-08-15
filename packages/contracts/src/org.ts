import { z } from 'zod';
import {
  booleanQuerySchema,
  listResponseSchema,
  paginationQuerySchema,
  singleResponseSchema,
} from './common.js';

/**
 * Clubs, their district affiliations, and clusters.
 *
 * **A club carries no district** (axiom 2). It is a global entity keyed on its RI Club ID;
 * belonging to D9218 for 2027-28 is a row in `club_district_affiliations`, and that is what
 * makes the D9214 split survivable. Every field here that looks district-ish — `tier`,
 * `isConfirmed`, `clusterId` — is on the AFFILIATION, not on the club.
 */

export const clubBaseTypes = ['CBC', 'IBC', 'ECLUB'] as const;
export const clubStatuses = ['PROVISIONAL', 'ACTIVE', 'SUSPENDED', 'TERMINATED', 'MERGED'] as const;
export const clubTiers = ['T1', 'T2', 'IBC'] as const;

export type ClubBaseTypeValue = (typeof clubBaseTypes)[number];
export type ClubStatusValue = (typeof clubStatuses)[number];
export type ClubTierValue = (typeof clubTiers)[number];

/**
 * The RI Club ID, as a string.
 *
 * A BigInt in the database and a string on the wire: `JSON.parse` turns a number beyond
 * 2^53 into a different number without complaining, and RI has issued ids close enough to
 * that ceiling that guessing is not a plan.
 */
export const riClubIdSchema = z
  .string()
  .trim()
  .regex(/^[0-9]{1,18}$/, 'An RI Club ID is a number with no separators');

export const clubSchema = z.object({
  id: z.uuid(),
  riClubId: z.string().nullable(),
  name: z.string(),
  slug: z.string(),
  baseType: z.enum(clubBaseTypes),
  status: z.enum(clubStatuses),
  charteredOn: z.string().nullable(),
  charteredMemberCount: z.number().int().nullable(),
  sponsorRotaryClub: z.string().nullable(),
  hostInstitution: z.string().nullable(),
  /**
   * Day of the week, **0 = Sunday**, matching Postgres's own `EXTRACT(DOW)`.
   *
   * The column has been `CHECK (meeting_day BETWEEN 0 AND 6)` since M0 with no convention
   * recorded anywhere, and this contract originally said 1–7 — so a club meeting on Sunday
   * was accepted by the contract and refused by the database as a 500. Found by scaling the
   * seed to 68 clubs in M2 session 10.
   *
   * 0 = Sunday rather than ISO's 1 = Monday because a scoring resolver asking "did this club
   * meet on its meeting day" compares against `EXTRACT(DOW FROM starts_at)`, and two
   * conventions one join apart is a resolver that is wrong on Sundays.
   */
  meetingDay: z.number().int().min(0).max(6).nullable(),
  /** `HH:MM`, in the district's timezone. */
  meetingTime: z.string().nullable(),
  meetingVenue: z.string().nullable(),
  isVirtual: z.boolean(),
  postalAddress: z.string().nullable(),
  ursbNumber: z.string().nullable(),
  bankName: z.string().nullable(),
  logoUrl: z.string().nullable(),

  /**
   * The affiliation for the CONTEXT's year. Null for a club with no row for that year,
   * which a district-wide caller can only reach by naming its id.
   */
  affiliation: z
    .object({
      tier: z.enum(clubTiers),
      isConfirmed: z.boolean(),
      clusterId: z.uuid().nullable(),
      clusterName: z.string().nullable(),
      regionId: z.uuid().nullable(),
      regionName: z.string().nullable(),
    })
    .nullable(),
});
export type Club = z.infer<typeof clubSchema>;

export const clubListResponseSchema = listResponseSchema(clubSchema);
export const clubResponseSchema = singleResponseSchema(clubSchema);

export const clubListQuerySchema = paginationQuerySchema.extend({
  tier: z.enum(clubTiers).optional(),
  baseType: z.enum(clubBaseTypes).optional(),
  status: z.enum(clubStatuses).optional(),
  clusterId: z.uuid().optional(),
  /** Trigram search over the club name. */
  q: z.string().trim().min(1).max(120).optional(),
  /** Include clubs whose affiliation is not yet confirmed. Default true. */
  includeUnconfirmed: booleanQuerySchema.optional(),
});
export type ClubListQuery = z.infer<typeof clubListQuerySchema>;

/**
 * `slug` is derived from the name and never supplied: it is part of URLs an officer may
 * have shared, and a client-chosen one is a client-chosen collision.
 */
const clubProfileFields = {
  name: z.string().trim().min(3).max(160),
  riClubId: riClubIdSchema.nullable().optional(),
  baseType: z.enum(clubBaseTypes),
  status: z.enum(clubStatuses).optional(),
  charteredOn: z.iso.date().nullable().optional(),
  charteredMemberCount: z.number().int().min(0).max(10_000).nullable().optional(),
  sponsorRotaryClub: z.string().trim().max(160).nullable().optional(),
  hostInstitution: z.string().trim().max(160).nullable().optional(),
  meetingDay: z.number().int().min(0).max(6).nullable().optional(),
  meetingTime: z
    .string()
    .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'A meeting time looks like 18:30')
    .nullable()
    .optional(),
  meetingVenue: z.string().trim().max(240).nullable().optional(),
  isVirtual: z.boolean().optional(),
  postalAddress: z.string().trim().max(240).nullable().optional(),
  ursbNumber: z.string().trim().max(60).nullable().optional(),
  bankName: z.string().trim().max(120).nullable().optional(),
  bankAccountRef: z.string().trim().max(120).nullable().optional(),
};

export const createClubRequestSchema = z.object({
  /** Client-generated, so an offline retry is idempotent (ADR-004). */
  id: z.uuid().optional(),
  ...clubProfileFields,
  /**
   * The tier for the current year. Recalculated at rollover from the closing roster and
   * frozen within the year, so this is only ever the STARTING position for a new club.
   */
  tier: z.enum(clubTiers).optional(),
});
export type CreateClubRequest = z.infer<typeof createClubRequestSchema>;

/** Every profile field optional; `baseType` too, which a chartered club does not change. */
export const updateClubRequestSchema = z.object({
  ...clubProfileFields,
  name: clubProfileFields.name.optional(),
  baseType: z.enum(clubBaseTypes).optional(),
});
export type UpdateClubRequest = z.infer<typeof updateClubRequestSchema>;

/**
 * Everything a club profile screen needs, in ONE response.
 *
 * This endpoint exists to stop the mobile client making six round trips to render one
 * page. Design for the network, not for REST purity (docs/05-API-Spec.md §3).
 */
export const clubSummarySchema = z.object({
  club: clubSchema,
  rosterCount: z.number().int().nonnegative(),
  /** Activities held in the current Rotary Year, by verification state. */
  activities: z.object({
    total: z.number().int().nonnegative(),
    verified: z.number().int().nonnegative(),
    unverified: z.number().int().nonnegative(),
  }),
  /** Null until the finance module lands (M4). The SHAPE is fixed now so the client is not rewritten. */
  dues: z
    .object({
      status: z.enum(['UNPAID', 'PARTIAL', 'PAID', 'WAIVED']),
      amountDue: z.string(),
      amountPaid: z.string(),
      amountOutstanding: z.string(),
    })
    .nullable(),
  /** Null until the assessment module lands (M5). */
  score: z
    .object({
      periodLabel: z.string(),
      totalScore: z.string(),
      maxPossible: z.string(),
      percentage: z.string().nullable(),
      rankInTier: z.number().int().positive(),
    })
    .nullable(),
});
export type ClubSummary = z.infer<typeof clubSummarySchema>;

export const clubSummaryResponseSchema = singleResponseSchema(clubSummarySchema);

/** Affiliating a club to the caller's district for the caller's year. */
export const createAffiliationRequestSchema = z.object({
  tier: z.enum(clubTiers).optional(),
  isConfirmed: z.boolean().optional(),
});
export type CreateAffiliationRequest = z.infer<typeof createAffiliationRequestSchema>;

export const affiliationSchema = z.object({
  id: z.uuid(),
  clubId: z.uuid(),
  districtId: z.uuid(),
  rotaryYearId: z.uuid(),
  tier: z.enum(clubTiers),
  isConfirmed: z.boolean(),
});
export type Affiliation = z.infer<typeof affiliationSchema>;
export const affiliationResponseSchema = singleResponseSchema(affiliationSchema);

// ─── Clusters ────────────────────────────────────────────────────────────────

export const clusterSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  regionId: z.uuid().nullable(),
  regionName: z.string().nullable(),
  clubCount: z.number().int().nonnegative(),
});
export type Cluster = z.infer<typeof clusterSchema>;

export const clusterListResponseSchema = listResponseSchema(clusterSchema);
export const clusterResponseSchema = singleResponseSchema(clusterSchema);

export const clusterListQuerySchema = paginationQuerySchema.extend({
  regionId: z.uuid().optional(),
  q: z.string().trim().min(1).max(120).optional(),
});
export type ClusterListQuery = z.infer<typeof clusterListQuerySchema>;

export const createClusterRequestSchema = z.object({
  name: z.string().trim().min(2).max(120),
  regionId: z.uuid().nullable().optional(),
});
export type CreateClusterRequest = z.infer<typeof createClusterRequestSchema>;

export const updateClusterRequestSchema = createClusterRequestSchema.partial();
export type UpdateClusterRequest = z.infer<typeof updateClusterRequestSchema>;

/**
 * Assigning clubs to a cluster. The WHOLE membership, not a diff.
 *
 * Same reasoning as replacing a position's permission set: two officers redrawing clusters
 * from separate browsers with client-computed diffs merge each other's work silently, and
 * sending the full list makes the last write obviously the last write.
 */
export const setClusterClubsRequestSchema = z.object({
  clubIds: z.array(z.uuid()).max(200),
});
export type SetClusterClubsRequest = z.infer<typeof setClusterClubsRequestSchema>;

// ─── Regions ─────────────────────────────────────────────────────────────────

export const regionSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  clusterCount: z.number().int().nonnegative(),
});
export type Region = z.infer<typeof regionSchema>;
export const regionListResponseSchema = listResponseSchema(regionSchema);
