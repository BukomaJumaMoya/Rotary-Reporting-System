import type {
  Appointment,
  AppointmentListQuery,
  CreateAppointmentRequest,
  OrgScopeValue,
  PaginationMeta,
  RequestContext,
  UpdateAppointmentRequest,
} from '@dis/contracts';
import { db } from '../../platform/db.js';
import { AppError, ErrorCode, notFound } from '../../platform/errors.js';
import { fromIsoDate, isoDate, isTermCurrent } from '../../platform/time.js';
import * as repository from './appointments.repository.js';
import type { AppointmentRow } from './appointments.repository.js';

/**
 * Appointments — the unit of authorisation.
 *
 * Nobody has a role; people hold appointments, and an appointment is
 * `(person, position, org unit, year)`. Three problems disappear as a consequence: annual
 * turnover becomes automatic, new positions become data, and a person holding two roles
 * is two rows rather than an impossible case (docs/03-Data-Model.md §3).
 *
 * The rules below live here rather than in the database because `scope_id` is
 * deliberately a bare UUID — it may name a club, cluster, region or committee — and that
 * is the one place the schema trades referential integrity for polymorphism. The trade is
 * only safe if this layer does the check the foreign key is not doing.
 */

function toAppointment(
  row: AppointmentRow,
  timezone: string,
  scopeNames: Map<string, string>,
): Appointment {
  return {
    id: row.id,
    personId: row.personId,
    personName: `${row.person.firstName} ${row.person.lastName}`,
    positionId: row.positionId,
    positionCode: row.position.code,
    positionName: row.position.name,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    scopeName: row.scopeId ? (scopeNames.get(row.scopeId) ?? null) : null,
    rotaryYearId: row.rotaryYearId,
    rotaryYearLabel: row.rotaryYear.label,
    startsOn: isoDate(row.startsOn),
    endsOn: row.endsOn ? isoDate(row.endsOn) : null,
    isActive: row.isActive,
    // Distinct from isActive: an appointment created in June for a term starting 1 July
    // is active and not yet in force, compared against midnight where the district is.
    isCurrent: row.isActive && isTermCurrent(row, timezone),
  };
}

async function present(ctx: RequestContext, rows: AppointmentRow[]): Promise<Appointment[]> {
  const [timezone, scopeNames] = await Promise.all([
    repository.districtTimezone(ctx),
    repository.findScopeNames(
      ctx,
      rows
        .filter((row): row is AppointmentRow & { scopeId: string } => row.scopeId !== null)
        .map((row) => ({ scopeType: row.scopeType, scopeId: row.scopeId })),
    ),
  ]);

  return rows.map((row) => toAppointment(row, timezone, scopeNames));
}

/**
 * The position's own scope must match the appointment's.
 *
 * A CLUB_SECRETARY appointed at DISTRICT scope would carry club permissions across the
 * whole district — which is not a configuration mistake anybody would spot in a list.
 */
function assertScopeTypeMatches(positionScope: OrgScopeValue, scopeType: OrgScopeValue): void {
  if (positionScope !== scopeType) {
    throw new AppError(
      422,
      ErrorCode.SCOPE_TYPE_MISMATCH,
      'This position is defined at a different scope',
      { positionScope, requested: scopeType },
    );
  }
}

/** Resolves `scope_id` against the table `scope_type` implies, or refuses. */
async function assertScopeReference(
  ctx: RequestContext,
  scopeType: OrgScopeValue,
  scopeId: string | null,
): Promise<void> {
  if (scopeType === 'DISTRICT') {
    if (scopeId !== null) {
      throw new AppError(
        422,
        ErrorCode.INVALID_SCOPE_REFERENCE,
        'A district appointment names no scope id',
        { scopeType },
      );
    }
    return;
  }

  if (scopeId === null) {
    throw new AppError(
      422,
      ErrorCode.INVALID_SCOPE_REFERENCE,
      `A ${scopeType.toLowerCase()} appointment needs a scope id`,
      { scopeType },
    );
  }

  const exists = await repository.scopeReferenceExists(ctx, scopeType, scopeId);
  if (!exists) {
    // Every lookup went through db(ctx), so "another district's club" and "no such club"
    // arrive here as the same answer — which is the answer the caller should get.
    throw new AppError(
      422,
      ErrorCode.INVALID_SCOPE_REFERENCE,
      `No ${scopeType.toLowerCase()} with that id belongs to this district for this year`,
      { scopeType, scopeId },
    );
  }
}

/**
 * One holder at a time, where the position says so.
 *
 * `is_unique_per_scope` is enforced HERE rather than by a unique index, because "one DRR
 * per district per year" is only true of ACTIVE rows — a revoked appointment is history,
 * and a partial unique index over a mutable flag would refuse the replacement the
 * revocation exists to make room for.
 */
async function assertPositionAvailable(
  ctx: RequestContext,
  input: { positionId: string; scopeId: string | null; excludeAppointmentId?: string },
): Promise<void> {
  const held = await repository.countActiveHolders(ctx, input);
  if (held > 0) {
    throw new AppError(
      409,
      ErrorCode.POSITION_ALREADY_HELD,
      'Somebody already holds this position here for this Rotary Year',
      { activeHolders: held },
    );
  }
}

export async function list(
  ctx: RequestContext,
  query: AppointmentListQuery,
): Promise<{ data: Appointment[]; meta: PaginationMeta }> {
  const { rows, total } = await repository.listAppointments(ctx, {
    personId: query.personId,
    positionId: query.positionId,
    scopeType: query.scopeType,
    scopeId: query.scopeId,
    isActive: query.isActive,
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  });

  const data = await present(ctx, rows);

  // `currentOnly` filters the PAGE rather than the query, because "is the term in force
  // today" needs the district's timezone and cannot be expressed in the where clause.
  // The total stays honest about what the filter matched before that.
  return {
    data: query.currentOnly ? data.filter((row) => row.isCurrent) : data,
    meta: { page: query.page, pageSize: query.pageSize, total },
  };
}

export async function get(ctx: RequestContext, id: string): Promise<Appointment> {
  const row = await repository.findAppointment(ctx, id);
  if (!row) throw notFound();
  const [appointment] = await present(ctx, [row]);
  if (!appointment) throw notFound();
  return appointment;
}

export async function create(
  ctx: RequestContext,
  input: CreateAppointmentRequest,
): Promise<Appointment> {
  const position = await repository.findPositionForAppointment(ctx, input.positionId);
  if (!position) throw notFound();

  if (!position.isActive) {
    throw new AppError(422, ErrorCode.VALIDATION_ERROR, 'That position is no longer active', {
      positionId: input.positionId,
    });
  }

  if (!(await repository.personExists(input.personId))) {
    throw new AppError(422, ErrorCode.VALIDATION_ERROR, 'No such person', {
      personId: input.personId,
    });
  }

  assertScopeTypeMatches(position.scope, input.scopeType);
  await assertScopeReference(ctx, input.scopeType, input.scopeId);

  if (position.isUniquePerScope) {
    await assertPositionAvailable(ctx, {
      positionId: input.positionId,
      scopeId: input.scopeId,
    });
  }

  const startsOn = fromIsoDate(input.startsOn);
  const endsOn = input.endsOn ? fromIsoDate(input.endsOn) : null;

  if (endsOn && endsOn.getTime() < startsOn.getTime()) {
    throw new AppError(422, ErrorCode.VALIDATION_ERROR, 'A term cannot end before it starts', {
      startsOn: input.startsOn,
      endsOn: input.endsOn,
    });
  }

  // A person may hold several appointments at once. That is normal in Rotaract, and it
  // is why permissions and scopes are unioned rather than chosen between.
  const created = await repository.createAppointment(ctx, {
    personId: input.personId,
    positionId: input.positionId,
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    startsOn,
    endsOn,
  });

  return get(ctx, created.id);
}

export async function update(
  ctx: RequestContext,
  id: string,
  input: UpdateAppointmentRequest,
): Promise<Appointment> {
  const row = await repository.findAppointment(ctx, id);
  if (!row) throw notFound();

  const endsOn =
    input.endsOn === undefined
      ? undefined
      : input.endsOn === null
        ? null
        : fromIsoDate(input.endsOn);

  if (endsOn && endsOn.getTime() < row.startsOn.getTime()) {
    throw new AppError(422, ErrorCode.VALIDATION_ERROR, 'A term cannot end before it starts', {
      startsOn: isoDate(row.startsOn),
      endsOn: input.endsOn,
    });
  }

  // Reinstating a revoked appointment can collide with whoever replaced them.
  if (input.isActive === true && !row.isActive && row.position.isUniquePerScope) {
    await assertPositionAvailable(ctx, {
      positionId: row.positionId,
      scopeId: row.scopeId,
      excludeAppointmentId: id,
    });
  }

  await repository.updateAppointment(ctx, id, {
    ...(endsOn === undefined ? {} : { endsOn }),
    ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
  });

  return get(ctx, id);
}

/**
 * Soft. An appointment is the record of who held office and when, so it is revoked and
 * never deleted — deleting one would rewrite history, and the audit log would show a
 * removal with nothing to compare it against.
 */
export async function revoke(ctx: RequestContext, id: string): Promise<Appointment> {
  return update(ctx, id, { isActive: false });
}

/** Every appointment a person holds, across years. Ordered newest first. */
export async function listForPerson(
  ctx: RequestContext,
  personId: string,
  query: { page: number; pageSize: number },
): Promise<{ data: Appointment[]; meta: PaginationMeta }> {
  const { rows, total } = await repository.listAppointments(ctx, {
    personId,
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  });

  return {
    data: await present(ctx, rows),
    meta: { page: query.page, pageSize: query.pageSize, total },
  };
}

/**
 * The people currently holding a CLUB-scoped appointment for one club.
 *
 * Exported for `modules/membership`, which has to tell the receiving club that a transfer
 * naming them has been recorded. Appointments are governance's table, so membership asks
 * rather than joining — the dependency rule, and the reason the day appointments gain a
 * "notifications off" flag there is one place to honour it.
 *
 * Names only: the caller wants somebody to notify, not a directory.
 */
export async function listClubOfficerPersonIds(
  ctx: RequestContext,
  clubId: string,
): Promise<string[]> {
  const rows = await db(ctx).appointment.findMany({
    where: { scopeType: 'CLUB', scopeId: clubId, isActive: true },
    select: { personId: true },
  });
  return [...new Set(rows.map((row) => row.personId))];
}
