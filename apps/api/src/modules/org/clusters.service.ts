import type {
  Cluster,
  ClusterListQuery,
  CreateClusterRequest,
  PaginationMeta,
  Region,
  RequestContext,
  UpdateClusterRequest,
} from '@dis/contracts';
import { db } from '../../platform/db.js';
import { AppError, ErrorCode, notFound } from '../../platform/errors.js';

/**
 * Clusters, and the regions above them.
 *
 * Clusters are YEAR-SCOPED because they are redrawn annually: an ADRR's territory in
 * 2027-28 is not their territory in 2028-29, and a scorecard read for a past year has to see
 * the clusters as they were. The data access layer applies both the district and the year,
 * so nothing here names either.
 *
 * `club_cluster_assignments` carries the year and no district, which is why every read of it
 * here goes through a cluster whose district the layer has already checked.
 */

interface ClusterRow {
  id: string;
  name: string;
  regionId: string | null;
  region: { name: string } | null;
  _count: { clubAssignments: number };
}

function serialise(row: ClusterRow): Cluster {
  return {
    id: row.id,
    name: row.name,
    regionId: row.regionId,
    regionName: row.region?.name ?? null,
    clubCount: row._count.clubAssignments,
  };
}

const CLUSTER_SELECT = {
  id: true,
  name: true,
  regionId: true,
  region: { select: { name: true } },
  _count: { select: { clubAssignments: true } },
} as const;

export async function list(
  ctx: RequestContext,
  query: ClusterListQuery,
): Promise<{ data: Cluster[]; meta: PaginationMeta }> {
  const where = {
    ...(query.regionId ? { regionId: query.regionId } : {}),
    ...(query.q ? { name: { contains: query.q, mode: 'insensitive' as const } } : {}),
  };

  const [rows, total] = await Promise.all([
    db(ctx).cluster.findMany({
      where,
      select: CLUSTER_SELECT,
      orderBy: { name: 'asc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    db(ctx).cluster.count({ where }),
  ]);

  return {
    data: rows.map(serialise),
    meta: { page: query.page, pageSize: query.pageSize, total },
  };
}

export async function get(ctx: RequestContext, id: string): Promise<Cluster> {
  const row = await db(ctx).cluster.findFirst({ where: { id }, select: CLUSTER_SELECT });
  if (!row) throw notFound();
  return serialise(row);
}

/** A region must belong to the caller's district; `regions` is district-scoped, so ask. */
async function assertRegion(
  ctx: RequestContext,
  regionId: string | null | undefined,
): Promise<void> {
  if (!regionId) return;
  const found = await db(ctx).region.count({ where: { id: regionId } });
  if (found === 0) {
    throw new AppError(422, ErrorCode.INVALID_SCOPE_REFERENCE, 'That region does not exist', {
      regionId,
    });
  }
}

export async function create(ctx: RequestContext, input: CreateClusterRequest): Promise<Cluster> {
  await assertRegion(ctx, input.regionId);

  const duplicate = await db(ctx).cluster.count({ where: { name: input.name } });
  if (duplicate > 0) {
    // `clusters_district_year_name` is unique. Caught here so a form can point at the
    // field rather than showing a constraint violation.
    throw new AppError(409, ErrorCode.DUPLICATE_CODE, 'A cluster with that name already exists', {
      name: input.name,
    });
  }

  const created = await db(ctx).cluster.create({
    data: { name: input.name, regionId: input.regionId ?? null },
  });

  return get(ctx, created.id);
}

export async function update(
  ctx: RequestContext,
  id: string,
  input: UpdateClusterRequest,
): Promise<Cluster> {
  await assertRegion(ctx, input.regionId);

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data['name'] = input.name;
  if (input.regionId !== undefined) data['regionId'] = input.regionId;

  const { count } = await db(ctx).cluster.updateMany({ where: { id }, data });
  // Zero rows is the 404: a cluster in another district or another year is not this
  // caller's to find, and `updateMany` cannot have touched it.
  if (count === 0) throw notFound();

  return get(ctx, id);
}

/**
 * Sets the WHOLE membership of a cluster, not a diff.
 *
 * Two officers redrawing clusters from two browsers with client-computed diffs merge each
 * other's work silently. Sending the full list makes the last write obviously the last
 * write — the same reasoning as replacing a position's permission set.
 */
export async function setClubs(
  ctx: RequestContext,
  clusterId: string,
  clubIds: string[],
): Promise<Cluster> {
  // Proves the cluster is this district's and this year's before anything is written.
  await get(ctx, clusterId);

  const unique = [...new Set(clubIds)];

  if (unique.length > 0) {
    // Every club must be affiliated to this district for this year. A club that is not is
    // not this district's to organise, and the affiliation is the only thing that says so
    // (axiom 2) — there is no district column on `clubs` to check instead.
    const affiliated = await db(ctx).clubDistrictAffiliation.findMany({
      where: { clubId: { in: unique } },
      select: { clubId: true },
    });
    const known = new Set(affiliated.map((row) => row.clubId));
    const strangers = unique.filter((id) => !known.has(id));

    if (strangers.length > 0) {
      throw new AppError(
        422,
        ErrorCode.INVALID_SCOPE_REFERENCE,
        'One or more clubs are not affiliated to this district for this Rotary Year',
        { clubIds: strangers },
      );
    }
  }

  await db(ctx).$transaction(async (tx) => {
    // A club sits in at most one cluster per year — `club_cluster_assignments` is keyed
    // on (club_id, rotary_year_id) — so adding a club to this cluster removes it from
    // whichever one it was in. Clearing by CLUSTER first and then by CLUB is what makes
    // the operation a set rather than an append.
    await tx.clubClusterAssignment.deleteMany({ where: { clusterId } });
    if (unique.length > 0) {
      await tx.clubClusterAssignment.deleteMany({ where: { clubId: { in: unique } } });
      await tx.clubClusterAssignment.createMany({
        data: unique.map((clubId) => ({ clubId, clusterId })),
      });
    }
  });

  return get(ctx, clusterId);
}

/**
 * The regions of this district. Not year-scoped: an LDRR's territory is a standing part of
 * the district's structure, unlike a cluster.
 */
export async function listRegions(
  ctx: RequestContext,
  query: { page: number; pageSize: number },
): Promise<{ data: Region[]; meta: PaginationMeta }> {
  const [rows, total] = await Promise.all([
    db(ctx).region.findMany({
      select: { id: true, name: true, _count: { select: { clusters: true } } },
      orderBy: { name: 'asc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    db(ctx).region.count({}),
  ]);

  return {
    data: rows.map((row) => ({ id: row.id, name: row.name, clusterCount: row._count.clusters })),
    meta: { page: query.page, pageSize: query.pageSize, total },
  };
}
