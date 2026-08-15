import type { ClubListQuery, RequestContext } from '@dis/contracts';
import { db, prisma } from '../../platform/db.js';

/**
 * Club reads, and the ONE place the affiliation join is written.
 *
 * **A club has no `district_id`** (axiom 2). D9218 is being formed by splitting D9214, and
 * a column would destroy the history of that split the first time a club moved. So "the
 * clubs of this district, this year" is a join through `club_district_affiliations`, and it
 * is written here once rather than in each of the nine handlers that need it — a handler
 * that forgot it would return every club in the world, and would look exactly like a
 * handler that had not.
 *
 * Everything therefore reads FROM the affiliation side. `db(ctx).clubDistrictAffiliation`
 * is district- and year-scoped by the data access layer, so the scope is applied by the
 * layer rather than by anybody remembering it.
 *
 * The one thing the layer does NOT do is scope a relation reached by `include` or a nested
 * `where` (build log §4). `clubs` and `persons` carry a soft delete and the extension does
 * not rewrite nested filters, so `deletedAt: null` is written by hand wherever this file
 * reaches into `club` — exactly as `modules/auth/repository.ts` does for `persons`.
 */

/** Everything a club serialiser needs, so the shape is declared once. */
const CLUB_SELECT = {
  id: true,
  riClubId: true,
  name: true,
  slug: true,
  baseType: true,
  status: true,
  charteredOn: true,
  charteredMemberCount: true,
  sponsorRotaryClub: true,
  hostInstitution: true,
  meetingDay: true,
  meetingTime: true,
  meetingVenue: true,
  isVirtual: true,
  postalAddress: true,
  ursbNumber: true,
  bankName: true,
  logoUrl: true,
} as const;

const AFFILIATION_SELECT = {
  id: true,
  clubId: true,
  districtId: true,
  rotaryYearId: true,
  tier: true,
  isConfirmed: true,
  club: { select: CLUB_SELECT },
} as const;

export type AffiliatedClubRow = NonNullable<Awaited<ReturnType<typeof findAffiliatedClub>>>;

/** The cluster (and its region) a club sits in for the context's year. */
export interface ClusterPlacement {
  clubId: string;
  clusterId: string;
  clusterName: string;
  regionId: string | null;
  regionName: string | null;
}

/**
 * Cluster placements for a page of clubs.
 *
 * Read separately rather than joined into the list, because `club_cluster_assignments`
 * carries a year and NO district: a club that moved districts mid-year could be assigned to
 * a cluster elsewhere, and an unscoped `include` would put another district's cluster name
 * on the page. The cluster's own district is therefore named explicitly — from the context,
 * never from input.
 */
export async function findClusterPlacements(
  ctx: RequestContext,
  clubIds: string[],
): Promise<Map<string, ClusterPlacement>> {
  if (clubIds.length === 0) return new Map();

  const rows = await db(ctx).clubClusterAssignment.findMany({
    where: { clubId: { in: clubIds }, cluster: { districtId: ctx.districtId } },
    select: {
      clubId: true,
      cluster: {
        select: { id: true, name: true, region: { select: { id: true, name: true } } },
      },
    },
  });

  return new Map(
    rows.map((row) => [
      row.clubId,
      {
        clubId: row.clubId,
        clusterId: row.cluster.id,
        clusterName: row.cluster.name,
        regionId: row.cluster.region?.id ?? null,
        regionName: row.cluster.region?.name ?? null,
      },
    ]),
  );
}

function clubWhere(query: Pick<ClubListQuery, 'baseType' | 'status' | 'q'>) {
  return {
    // By hand, because the soft-delete extension does not rewrite a NESTED filter.
    deletedAt: null,
    ...(query.baseType ? { baseType: query.baseType } : {}),
    ...(query.status ? { status: query.status } : {}),
    // `contains` with `mode: 'insensitive'` compiles to ILIKE '%…%', which the
    // clubs_name_trgm GIN index serves — so the trigram search needs no raw SQL, which is
    // just as well, because raw SQL lives only in modules/assessment/resolvers. That index
    // had to move into schema.prisma (build log §4); do not re-add it as a SQL migration.
    ...(query.q ? { name: { contains: query.q, mode: 'insensitive' as const } } : {}),
  };
}

export async function listAffiliatedClubs(
  ctx: RequestContext,
  query: ClubListQuery,
): Promise<{ rows: AffiliatedClubRow[]; total: number }> {
  const where = {
    ...(query.tier ? { tier: query.tier } : {}),
    ...(query.includeUnconfirmed === false ? { isConfirmed: true } : {}),
    club: {
      ...clubWhere(query),
      ...(query.clusterId
        ? {
            clusterAssignments: {
              // The year again by hand: this is a nested filter, so the layer does not
              // reach it, and without the year a club would match last year's cluster.
              some: { clusterId: query.clusterId, rotaryYearId: ctx.rotaryYearId },
            },
          }
        : {}),
    },
  };

  const [rows, total] = await Promise.all([
    db(ctx).clubDistrictAffiliation.findMany({
      where,
      select: AFFILIATION_SELECT,
      orderBy: { club: { name: 'asc' } },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    db(ctx).clubDistrictAffiliation.count({ where }),
  ]);

  return { rows, total };
}

/**
 * One club, IF it is affiliated to the caller's district for the caller's year.
 *
 * Null for a club that exists but belongs elsewhere, which becomes a 404 — the same answer
 * as a club that does not exist, so probing identifiers teaches a caller nothing about the
 * shape of the dataset.
 */
export async function findAffiliatedClub(ctx: RequestContext, clubId: string) {
  return db(ctx).clubDistrictAffiliation.findFirst({
    where: { clubId, club: { deletedAt: null } },
    select: AFFILIATION_SELECT,
  });
}

/** A club anywhere in the world, by RI Club ID. Global, so no context. */
export async function findClubByRiId(riClubId: bigint) {
  return prisma.club.findFirst({ where: { riClubId }, select: { id: true, name: true } });
}

export async function findClubById(clubId: string) {
  return prisma.club.findFirst({ where: { id: clubId }, select: CLUB_SELECT });
}

export async function slugTaken(slug: string): Promise<boolean> {
  return (await prisma.club.count({ where: { slug } })) > 0;
}

export interface CreateClubInput {
  id: string | undefined;
  name: string;
  slug: string;
  riClubId: bigint | null;
  baseType: 'CBC' | 'IBC' | 'ECLUB';
  status: 'PROVISIONAL' | 'ACTIVE' | 'SUSPENDED' | 'TERMINATED' | 'MERGED';
  profile: Record<string, unknown>;
  tier: 'T1' | 'T2' | 'IBC';
}

/**
 * Creates the club AND its affiliation, atomically.
 *
 * Two writes that must not come apart: a club with no affiliation belongs to no district
 * and is invisible to every endpoint here, which is a row nobody can reach and nobody can
 * fix. `db(ctx).$transaction` gives both the scoped client — `clubs` is global and keeps
 * its full delegate, `club_district_affiliations` is stamped with the district and year by
 * the layer.
 */
export async function createClubWithAffiliation(ctx: RequestContext, input: CreateClubInput) {
  return db(ctx).$transaction(async (tx) => {
    const club = await tx.club.create({
      data: {
        ...(input.id ? { id: input.id } : {}),
        name: input.name,
        slug: input.slug,
        riClubId: input.riClubId,
        baseType: input.baseType,
        status: input.status,
        ...input.profile,
      },
      select: { id: true },
    });

    await tx.clubDistrictAffiliation.create({
      data: { clubId: club.id, tier: input.tier, isConfirmed: true },
    });

    return club;
  });
}

export async function updateClub(clubId: string, data: Record<string, unknown>): Promise<number> {
  const result = await prisma.club.updateMany({ where: { id: clubId }, data });
  return result.count;
}

export async function upsertAffiliation(
  ctx: RequestContext,
  clubId: string,
  input: { tier: 'T1' | 'T2' | 'IBC'; isConfirmed: boolean },
) {
  const existing = await db(ctx).clubDistrictAffiliation.findFirst({
    where: { clubId },
    select: { id: true },
  });

  if (existing) {
    // `upsert` is absent from a scoped delegate: its `where` takes unique fields only and
    // cannot carry the injected district and year. Read then branch, as the conventions say.
    await db(ctx).clubDistrictAffiliation.updateMany({
      where: { clubId },
      data: { tier: input.tier, isConfirmed: input.isConfirmed },
    });
  } else {
    await db(ctx).clubDistrictAffiliation.create({
      data: { clubId, tier: input.tier, isConfirmed: input.isConfirmed },
    });
  }

  return db(ctx).clubDistrictAffiliation.findFirst({
    where: { clubId },
    select: AFFILIATION_SELECT,
  });
}

/**
 * Whether a failure is the "one district per club per year" unique being violated.
 *
 * `club_district_affiliations` is unique on (club_id, rotary_year_id), which is axiom 2
 * expressed as a constraint. There is deliberately NO query here that looks for the other
 * district's row: reading across the district boundary to produce a better error message
 * is exactly the read this system does not permit itself, and the constraint already knows
 * the answer. The service turns this into a domain error a screen can explain.
 */
export function isAffiliationConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; meta?: { modelName?: unknown; target?: unknown } };
  if (candidate.code !== 'P2002') return false;

  // `meta.modelName`, NOT `meta.target`. Prisma 7 with `@prisma/adapter-pg` does not
  // populate `target` at all — the violated fields appear in the message and nowhere
  // structured — so code matching on it silently never fires and the caller gets a 500
  // where it expected a domain error. Measured against the real driver, not assumed.
  if (candidate.meta?.modelName === 'ClubDistrictAffiliation') return true;

  // Kept for the day `target` comes back: the model name alone would stop distinguishing
  // this unique from any other one added to the same table.
  const target = candidate.meta?.target;
  const fields = Array.isArray(target) ? target : [target];
  return fields.some(
    (field) => typeof field === 'string' && (field.includes('club_id') || field.includes('clubId')),
  );
}
