import type {
  CreatePositionRequest,
  PaginationMeta,
  Permission,
  Position,
  PositionListQuery,
  RequestContext,
  UpdatePositionRequest,
} from '@dis/contracts';
import { AppError, ErrorCode, notFound } from '../../platform/errors.js';
import * as repository from './positions.repository.js';
import type { PositionRow } from './positions.repository.js';

/**
 * Positions: the catalogue of roles a district can appoint people to.
 *
 * Nothing here caches. Permissions are read from the database by `resolveContext` on every
 * request, and the only cache in the data layer is a WeakMap of Prisma clients keyed on
 * the per-request context object. So replacing a position's permissions takes effect on
 * the holder's NEXT request, with no invalidation to write — which is the behaviour ADR-003
 * chose sessions for in the first place.
 */

function toPosition(row: PositionRow): Position {
  return {
    id: row.id,
    districtId: row.districtId,
    isTemplate: row.districtId === null,
    code: row.code,
    name: row.name,
    scope: row.scope,
    sequence: row.sequence,
    isUniquePerScope: row.isUniquePerScope,
    isActive: row.isActive,
    permissions: row.permissions.map((entry) => entry.permissionCode).sort(),
    activeAppointments: row._count.appointments,
  };
}

/**
 * A template — `district_id NULL` — is part of every district's catalogue and belongs to
 * none of them. Readable by all, editable by no one through the API; changing the shared
 * catalogue is a migration, made once, deliberately, for everybody.
 *
 * 403 rather than 404: the caller can see the row, so pretending it is absent would be
 * a lie they can immediately disprove with a GET.
 */
function assertEditable(row: PositionRow): void {
  if (row.districtId === null) {
    throw new AppError(
      403,
      ErrorCode.TEMPLATE_IMMUTABLE,
      'System-wide template positions cannot be edited. Create one for your district instead.',
      { positionCode: row.code },
    );
  }
}

/** Rejects any code that is not in the seeded catalogue. */
async function assertKnownPermissions(codes: string[]): Promise<void> {
  const known = await repository.findKnownPermissionCodes(codes);
  const unknown = codes.filter((code) => !known.has(code));

  if (unknown.length > 0) {
    // Codes are matched EXACTLY at authorisation time, with no wildcard, so a typo here
    // would not fail loudly — it would grant nothing, quietly, until somebody noticed an
    // officer could not do their job.
    throw new AppError(
      422,
      ErrorCode.UNKNOWN_PERMISSION,
      'One or more permission codes are not in the catalogue',
      { unknown },
    );
  }
}

export async function list(
  ctx: RequestContext,
  query: PositionListQuery,
): Promise<{ data: Position[]; meta: PaginationMeta }> {
  const { rows, total } = await repository.listPositions(ctx, {
    scope: query.scope,
    isActive: query.isActive,
    includeTemplates: query.includeTemplates ?? true,
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  });

  return {
    data: rows.map(toPosition),
    meta: { page: query.page, pageSize: query.pageSize, total },
  };
}

export async function get(ctx: RequestContext, id: string): Promise<Position> {
  const row = await repository.findPosition(ctx, id);
  if (!row) throw notFound();
  return toPosition(row);
}

export async function create(ctx: RequestContext, input: CreatePositionRequest): Promise<Position> {
  await assertKnownPermissions(input.permissions);

  const existing = await repository.findPositionByCode(ctx, input.code);
  if (existing) {
    // `positions_district_code` is unique, so the database would refuse this anyway —
    // but as a constraint violation, not as something a form can point at a field with.
    throw new AppError(409, ErrorCode.DUPLICATE_CODE, 'A position with that code already exists', {
      code: input.code,
    });
  }

  const created = await repository.createPosition(ctx, {
    code: input.code,
    name: input.name,
    scope: input.scope,
    sequence: input.sequence,
    isUniquePerScope: input.isUniquePerScope,
    permissions: input.permissions,
  });

  return get(ctx, created.id);
}

export async function update(
  ctx: RequestContext,
  id: string,
  input: UpdatePositionRequest,
): Promise<Position> {
  const row = await repository.findPosition(ctx, id);
  if (!row) throw notFound();
  assertEditable(row);

  // Deactivation is the one change that can strip authority from people who currently
  // hold the role, so it is the one that has to look before it leaps.
  if (input.isActive === false && row._count.appointments > 0) {
    throw new AppError(
      409,
      ErrorCode.POSITION_IN_USE,
      'This position cannot be deactivated while it is held',
      { activeAppointments: row._count.appointments },
    );
  }

  await repository.updatePosition(ctx, id, input);
  return get(ctx, id);
}

/** Soft: sets `isActive` false. A position is referenced by history and is never deleted. */
export async function deactivate(ctx: RequestContext, id: string): Promise<Position> {
  return update(ctx, id, { isActive: false });
}

export async function replacePermissions(
  ctx: RequestContext,
  id: string,
  permissions: string[],
): Promise<Position> {
  const row = await repository.findPosition(ctx, id);
  if (!row) throw notFound();
  assertEditable(row);

  // Validated BEFORE the transaction opens. Inside it, a rejected code would roll the
  // whole thing back and leave the prior set intact — correct, but a wasted round trip
  // and a less useful error.
  const unique = [...new Set(permissions)];
  await assertKnownPermissions(unique);

  await repository.replacePermissions(ctx, id, unique);
  return get(ctx, id);
}

export async function listPermissions(query: {
  page: number;
  pageSize: number;
}): Promise<{ data: Permission[]; meta: PaginationMeta }> {
  const { rows, total } = await repository.listPermissions(
    (query.page - 1) * query.pageSize,
    query.pageSize,
  );

  return { data: rows, meta: { page: query.page, pageSize: query.pageSize, total } };
}
