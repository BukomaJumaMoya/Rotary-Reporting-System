import type { OrgScopeValue, RequestContext } from '@dis/contracts';
import { db, prisma } from '../../platform/db.js';

/**
 * Positions, through the scoped client.
 *
 * `Position` is registered `district: 'sharedWhenNull'`, so reads see this district's rows
 * AND the system-wide templates, and a create is stamped with the caller's district —
 * meaning nothing written through here can accidentally become a template.
 */

export interface PositionRow {
  id: string;
  districtId: string | null;
  code: string;
  name: string;
  scope: OrgScopeValue;
  sequence: number;
  isUniquePerScope: boolean;
  isActive: boolean;
  permissions: { permissionCode: string }[];
  _count: { appointments: number };
}

/**
 * `appointments` counted with `isActive` only.
 *
 * A position held by nobody today but held by somebody last year can be deactivated
 * freely — that is what rollover leaves behind, and refusing it would make the catalogue
 * impossible to tidy.
 */
const POSITION_SELECT = {
  id: true,
  districtId: true,
  code: true,
  name: true,
  scope: true,
  sequence: true,
  isUniquePerScope: true,
  isActive: true,
  permissions: { select: { permissionCode: true } },
  _count: { select: { appointments: { where: { isActive: true } } } },
} as const;

export interface PositionFilter {
  scope?: OrgScopeValue | undefined;
  isActive?: boolean | undefined;
  includeTemplates: boolean;
  skip: number;
  take: number;
}

function whereFor(filter: PositionFilter) {
  return {
    ...(filter.scope ? { scope: filter.scope } : {}),
    ...(filter.isActive === undefined ? {} : { isActive: filter.isActive }),
    // The scoped client already ANDs in `districtId = ctx OR districtId IS NULL`; this
    // narrows that to the district's own rows when templates are not wanted.
    ...(filter.includeTemplates ? {} : { districtId: { not: null } }),
  };
}

export async function listPositions(
  ctx: RequestContext,
  filter: PositionFilter,
): Promise<{ rows: PositionRow[]; total: number }> {
  const where = whereFor(filter);

  const [rows, total] = await Promise.all([
    db(ctx).position.findMany({
      where,
      select: POSITION_SELECT,
      orderBy: [{ sequence: 'asc' }, { name: 'asc' }],
      skip: filter.skip,
      take: filter.take,
    }),
    db(ctx).position.count({ where }),
  ]);

  return { rows, total };
}

/** Null is the caller's 404 — a position in another district is indistinguishable from one that does not exist. */
export async function findPosition(ctx: RequestContext, id: string): Promise<PositionRow | null> {
  return db(ctx).position.findFirst({ where: { id }, select: POSITION_SELECT });
}

export async function findPositionByCode(
  ctx: RequestContext,
  code: string,
): Promise<{ id: string } | null> {
  // Restricted to the district's own rows: a template sharing a code does not stop a
  // district defining its own version of that role.
  return db(ctx).position.findFirst({
    where: { code, districtId: { not: null } },
    select: { id: true },
  });
}

export async function createPosition(
  ctx: RequestContext,
  input: {
    code: string;
    name: string;
    scope: OrgScopeValue;
    sequence: number;
    isUniquePerScope: boolean;
    permissions: string[];
  },
): Promise<{ id: string }> {
  // districtId is not passed and cannot be: the scoped delegate removed it, and the layer
  // stamps the caller's district. A scoped create returns the whole row and takes no
  // `select`, so the caller re-reads through findPosition to get the counts.
  return db(ctx).position.create({
    data: {
      code: input.code,
      name: input.name,
      scope: input.scope,
      sequence: input.sequence,
      isUniquePerScope: input.isUniquePerScope,
      permissions: { create: input.permissions.map((permissionCode) => ({ permissionCode })) },
    },
  });
}

export async function updatePosition(
  ctx: RequestContext,
  id: string,
  data: {
    name?: string;
    scope?: OrgScopeValue;
    sequence?: number;
    isUniquePerScope?: boolean;
    isActive?: boolean;
  },
): Promise<number> {
  // updateMany, not update: a unique `where` cannot carry the district filter. The count
  // is the 404.
  const result = await db(ctx).position.updateMany({ where: { id }, data });
  return result.count;
}

/**
 * Replaces a position's permission set in ONE transaction.
 *
 * Delete-then-insert rather than a diff: the client sends the whole set, and computing
 * adds and removes from it would let two editors silently merge. Either the new set is
 * there or the old one is — a half-applied permission set is a half-authorised officer.
 */
export async function replacePermissions(
  ctx: RequestContext,
  positionId: string,
  permissions: string[],
): Promise<void> {
  await db(ctx).$transaction(async (tx) => {
    await tx.positionPermission.deleteMany({ where: { positionId } });
    if (permissions.length > 0) {
      await tx.positionPermission.createMany({
        data: permissions.map((permissionCode) => ({ positionId, permissionCode })),
      });
    }
  });
}

/** The permission catalogue. Reference data — global, and read-only through the API. */
export async function listPermissions(
  skip: number,
  take: number,
): Promise<{ rows: { code: string; description: string }[]; total: number }> {
  // `permissions` is UNSCOPED_BY_DESIGN reference data — global, identical for every
  // district — so it is reachable on the plain client and needs no context.
  const [rows, total] = await Promise.all([
    prisma.permission.findMany({
      select: { code: true, description: true },
      orderBy: { code: 'asc' },
      skip,
      take,
    }),
    prisma.permission.count(),
  ]);

  return { rows, total };
}

/** Which of the given codes exist. Used to reject a typo before it becomes a silent non-grant. */
export async function findKnownPermissionCodes(codes: string[]): Promise<Set<string>> {
  if (codes.length === 0) return new Set();

  const rows = await prisma.permission.findMany({
    where: { code: { in: codes } },
    select: { code: true },
  });
  return new Set(rows.map((row) => row.code));
}
