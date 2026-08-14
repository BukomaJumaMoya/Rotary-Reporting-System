import type {
  AddCommitteeMemberRequest,
  Committee,
  CommitteeListQuery,
  CommitteeMember,
  CommitteeNode,
  CreateCommitteeRequest,
  PaginationMeta,
  RequestContext,
  UpdateCommitteeRequest,
} from '@dis/contracts';
import { MAX_COMMITTEE_DEPTH } from '@dis/contracts';
import { db } from '../../platform/db.js';
import { AppError, ErrorCode, notFound } from '../../platform/errors.js';

/**
 * Committees.
 *
 * Self-referencing so that a chair can create sub-committees WITHOUT a developer and
 * without district-wide permission — the district asked for exactly this and the
 * incumbent system could not do it: *"allow chairs to create their own sub-committee,
 * enter position and select the person."*
 *
 * The delegation is a SCOPE check rather than a permission. `committee:manage:district`
 * lets the DES do anything; a chair may do the same things inside their own subtree,
 * because `ctx.scopes.committeeIds` contains every committee they hold an appointment
 * over plus everything beneath it.
 */

interface CommitteeRow {
  id: string;
  parentCommitteeId: string | null;
  name: string;
  mandate: string | null;
  rotaryYearId: string;
  _count: { members: number };
}

const COMMITTEE_SELECT = {
  id: true,
  parentCommitteeId: true,
  name: true,
  mandate: true,
  rotaryYearId: true,
  _count: { select: { members: true } },
} as const;

function toCommittee(row: CommitteeRow, depth: number): Committee {
  return {
    id: row.id,
    parentCommitteeId: row.parentCommitteeId,
    name: row.name,
    mandate: row.mandate,
    rotaryYearId: row.rotaryYearId,
    depth,
    memberCount: row._count.members,
  };
}

/** Every committee this year, which is a handful of rows and cheaper than repeated walks. */
async function loadAll(ctx: RequestContext): Promise<CommitteeRow[]> {
  return db(ctx).committee.findMany({ select: COMMITTEE_SELECT, orderBy: { name: 'asc' } });
}

function depthOf(row: CommitteeRow, byId: Map<string, CommitteeRow>): number {
  let depth = 1;
  let current = row.parentCommitteeId;

  // Bounded by the depth cap; the counter is a guard against a cycle that predates it.
  while (current && depth <= MAX_COMMITTEE_DEPTH + 1) {
    depth += 1;
    current = byId.get(current)?.parentCommitteeId ?? null;
  }
  return depth;
}

/**
 * Whether the caller may create or change things inside this committee.
 *
 * Two ways in, and the second is the point of the feature:
 *  * `committee:manage:district` — the DES, anywhere in the district;
 *  * an appointment over this committee or one above it, which puts it in
 *    `ctx.scopes.committeeIds` because that array expands downwards.
 *
 * Refusal is 404, not 403. A chair probing another chair's subtree learns nothing.
 */
function assertMayManage(ctx: RequestContext, committeeId: string | null): void {
  if (ctx.permissions.has('committee:manage:district')) return;

  // A committee with no parent is a district committee, and creating one is a
  // district-wide act by definition — there is no subtree to be inside of.
  if (committeeId === null) throw notFound();

  if (!ctx.scopes.committeeIds.includes(committeeId)) throw notFound();
}

export async function list(
  ctx: RequestContext,
  query: CommitteeListQuery,
): Promise<{ data: Committee[]; meta: PaginationMeta }> {
  const rows = await loadAll(ctx);
  const byId = new Map(rows.map((row) => [row.id, row]));

  const filtered =
    query.parentId === undefined
      ? rows
      : rows.filter((row) =>
          query.parentId === 'root'
            ? row.parentCommitteeId === null
            : row.parentCommitteeId === query.parentId,
        );

  const start = (query.page - 1) * query.pageSize;
  return {
    data: filtered
      .slice(start, start + query.pageSize)
      .map((row) => toCommittee(row, depthOf(row, byId))),
    meta: { page: query.page, pageSize: query.pageSize, total: filtered.length },
  };
}

/** The whole tree, nested. Not paginated: a district's committees are a page of rows. */
export async function tree(ctx: RequestContext): Promise<CommitteeNode[]> {
  const rows = await loadAll(ctx);
  const byId = new Map(rows.map((row) => [row.id, row]));

  const nodes = new Map<string, CommitteeNode>(
    rows.map((row) => [row.id, { ...toCommittee(row, depthOf(row, byId)), children: [] }]),
  );

  const roots: CommitteeNode[] = [];
  for (const row of rows) {
    const node = nodes.get(row.id);
    if (!node) continue;

    const parent = row.parentCommitteeId ? nodes.get(row.parentCommitteeId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export async function get(ctx: RequestContext, id: string): Promise<Committee> {
  const rows = await loadAll(ctx);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const row = byId.get(id);
  if (!row) throw notFound();

  return toCommittee(row, depthOf(row, byId));
}

export async function create(
  ctx: RequestContext,
  input: CreateCommitteeRequest,
): Promise<Committee> {
  assertMayManage(ctx, input.parentCommitteeId);

  if (input.parentCommitteeId) {
    const rows = await loadAll(ctx);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const parent = byId.get(input.parentCommitteeId);
    // Scoped read, so a parent in another district or another year is simply absent.
    if (!parent) throw notFound();

    if (depthOf(parent, byId) >= MAX_COMMITTEE_DEPTH) {
      throw new AppError(
        422,
        ErrorCode.COMMITTEE_TOO_DEEP,
        `Committees nest at most ${MAX_COMMITTEE_DEPTH} deep`,
        { maxDepth: MAX_COMMITTEE_DEPTH },
      );
    }
  }

  const created = await db(ctx).committee.create({
    data: {
      name: input.name,
      mandate: input.mandate,
      parentCommitteeId: input.parentCommitteeId,
    },
  });

  return get(ctx, created.id);
}

export async function update(
  ctx: RequestContext,
  id: string,
  input: UpdateCommitteeRequest,
): Promise<Committee> {
  const existing = await get(ctx, id);
  assertMayManage(ctx, existing.id);

  await db(ctx).committee.updateMany({
    where: { id },
    data: {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.mandate === undefined ? {} : { mandate: input.mandate }),
    },
  });

  return get(ctx, id);
}

export async function listMembers(
  ctx: RequestContext,
  committeeId: string,
  query: { page: number; pageSize: number },
): Promise<{ data: CommitteeMember[]; meta: PaginationMeta }> {
  // Confirms the committee is in scope before reading anybody's name off it.
  await get(ctx, committeeId);

  const where = { committeeId };
  const [rows, total] = await Promise.all([
    db(ctx).committeeMember.findMany({
      where,
      select: {
        appointmentId: true,
        roleLabel: true,
        appointment: {
          select: {
            personId: true,
            person: { select: { firstName: true, lastName: true } },
            position: { select: { name: true } },
          },
        },
      },
      orderBy: { appointmentId: 'asc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    db(ctx).committeeMember.count({ where }),
  ]);

  return {
    data: rows.map((row) => ({
      appointmentId: row.appointmentId,
      personId: row.appointment.personId,
      // Names only. Serving on a committee never needs a phone number.
      personName: `${row.appointment.person.firstName} ${row.appointment.person.lastName}`,
      positionName: row.appointment.position.name,
      roleLabel: row.roleLabel,
    })),
    meta: { page: query.page, pageSize: query.pageSize, total },
  };
}

export async function addMember(
  ctx: RequestContext,
  committeeId: string,
  input: AddCommitteeMemberRequest,
): Promise<CommitteeMember[]> {
  await get(ctx, committeeId);
  assertMayManage(ctx, committeeId);

  // The appointment must be one this district made this year. Read through db(ctx), so
  // another district's appointment is not there to be added.
  const appointment = await db(ctx).appointment.findFirst({
    where: { id: input.appointmentId },
    select: { id: true },
  });
  if (!appointment) {
    throw new AppError(422, ErrorCode.VALIDATION_ERROR, 'No such appointment in this Rotary Year', {
      appointmentId: input.appointmentId,
    });
  }

  const already = await db(ctx).committeeMember.count({
    where: { committeeId, appointmentId: input.appointmentId },
  });
  if (already > 0) {
    throw new AppError(409, ErrorCode.DUPLICATE_CODE, 'That appointment is already a member', {
      appointmentId: input.appointmentId,
    });
  }

  await db(ctx).committeeMember.create({
    data: { committeeId, appointmentId: input.appointmentId, roleLabel: input.roleLabel },
  });

  const { data } = await listMembers(ctx, committeeId, { page: 1, pageSize: 100 });
  return data;
}

export async function removeMember(
  ctx: RequestContext,
  committeeId: string,
  appointmentId: string,
): Promise<void> {
  await get(ctx, committeeId);
  assertMayManage(ctx, committeeId);

  const result = await db(ctx).committeeMember.deleteMany({
    where: { committeeId, appointmentId },
  });
  if (result.count === 0) throw notFound();
}
