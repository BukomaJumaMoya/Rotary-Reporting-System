import type { OrgScopeValue, RequestContext } from '@dis/contracts';
import { db, prisma } from '../../platform/db.js';

/**
 * Appointments, through the scoped client.
 *
 * `Appointment` is registered `{ district: 'required', year: true }`, so the caller's
 * district and Rotary Year are injected into every read and stamped onto every create.
 * Neither ever appears in a request body.
 */

export interface AppointmentRow {
  id: string;
  personId: string;
  positionId: string;
  scopeType: OrgScopeValue;
  scopeId: string | null;
  rotaryYearId: string;
  startsOn: Date;
  endsOn: Date | null;
  isActive: boolean;
  person: { firstName: string; lastName: string };
  position: { code: string; name: string; scope: OrgScopeValue; isUniquePerScope: boolean };
  rotaryYear: { label: string };
}

const APPOINTMENT_SELECT = {
  id: true,
  personId: true,
  positionId: true,
  scopeType: true,
  scopeId: true,
  rotaryYearId: true,
  startsOn: true,
  endsOn: true,
  isActive: true,
  // Names only. A person's contact fields are never needed to render an appointment, and
  // the cheapest way to keep them out of a response is not to select them (axiom 6).
  person: { select: { firstName: true, lastName: true } },
  position: { select: { code: true, name: true, scope: true, isUniquePerScope: true } },
  rotaryYear: { select: { label: true } },
} as const;

export interface AppointmentFilter {
  personId?: string | undefined;
  positionId?: string | undefined;
  scopeType?: OrgScopeValue | undefined;
  scopeId?: string | undefined;
  isActive?: boolean | undefined;
  skip: number;
  take: number;
}

function whereFor(filter: AppointmentFilter) {
  return {
    ...(filter.personId ? { personId: filter.personId } : {}),
    ...(filter.positionId ? { positionId: filter.positionId } : {}),
    ...(filter.scopeType ? { scopeType: filter.scopeType } : {}),
    ...(filter.scopeId ? { scopeId: filter.scopeId } : {}),
    ...(filter.isActive === undefined ? {} : { isActive: filter.isActive }),
  };
}

export async function listAppointments(
  ctx: RequestContext,
  filter: AppointmentFilter,
): Promise<{ rows: AppointmentRow[]; total: number }> {
  const where = whereFor(filter);

  const [rows, total] = await Promise.all([
    db(ctx).appointment.findMany({
      where,
      select: APPOINTMENT_SELECT,
      orderBy: [{ startsOn: 'desc' }, { id: 'asc' }],
      skip: filter.skip,
      take: filter.take,
    }),
    db(ctx).appointment.count({ where }),
  ]);

  return { rows, total };
}

export async function findAppointment(
  ctx: RequestContext,
  id: string,
): Promise<AppointmentRow | null> {
  return db(ctx).appointment.findFirst({ where: { id }, select: APPOINTMENT_SELECT });
}

/**
 * Whether anybody already holds this position at this scope, this year.
 *
 * Only ACTIVE rows count. A revoked appointment is history, and it must not block the
 * replacement it exists to make room for.
 */
export async function countActiveHolders(
  ctx: RequestContext,
  input: { positionId: string; scopeId: string | null; excludeAppointmentId?: string },
): Promise<number> {
  return db(ctx).appointment.count({
    where: {
      positionId: input.positionId,
      scopeId: input.scopeId,
      isActive: true,
      ...(input.excludeAppointmentId ? { id: { not: input.excludeAppointmentId } } : {}),
    },
  });
}

export async function createAppointment(
  ctx: RequestContext,
  input: {
    personId: string;
    positionId: string;
    scopeType: OrgScopeValue;
    scopeId: string | null;
    startsOn: Date;
    endsOn: Date | null;
  },
): Promise<{ id: string }> {
  // districtId and rotaryYearId are absent from the scoped create signature: the layer
  // supplies them from the context.
  return db(ctx).appointment.create({ data: input });
}

export async function updateAppointment(
  ctx: RequestContext,
  id: string,
  data: { endsOn?: Date | null; isActive?: boolean },
): Promise<number> {
  const result = await db(ctx).appointment.updateMany({ where: { id }, data });
  return result.count;
}

/** The position being appointed to, scoped — a position in another district is invisible. */
export async function findPositionForAppointment(
  ctx: RequestContext,
  id: string,
): Promise<{
  id: string;
  scope: OrgScopeValue;
  isUniquePerScope: boolean;
  isActive: boolean;
} | null> {
  return db(ctx).position.findFirst({
    where: { id },
    select: { id: true, scope: true, isUniquePerScope: true, isActive: true },
  });
}

/** The person being appointed. Global entity, soft-delete filtered by the plain client. */
export async function personExists(personId: string): Promise<boolean> {
  const row = await prisma.person.findFirst({ where: { id: personId }, select: { id: true } });
  return row !== null;
}

/**
 * Whether `scopeId` names a real record of the kind `scopeType` implies.
 *
 * `appointments.scope_id` is a bare UUID rather than a foreign key — it may reference a
 * club, cluster, region or committee, and that is the one place the schema trades
 * referential integrity for polymorphism (docs/03-Data-Model.md §3). The trade is only
 * safe if the service layer does the check the database is not doing.
 *
 * Every lookup goes through `db(ctx)`, so a record in another district or another year
 * is simply not there.
 */
export async function scopeReferenceExists(
  ctx: RequestContext,
  scopeType: OrgScopeValue,
  scopeId: string,
): Promise<boolean> {
  switch (scopeType) {
    case 'CLUB': {
      // Clubs are GLOBAL — a club is not owned by a district, it is affiliated to one for
      // a year (axiom 2). So the question is not "does this club exist" but "is it ours
      // this year", which is exactly what the affiliation says.
      const row = await db(ctx).clubDistrictAffiliation.findFirst({
        where: { clubId: scopeId },
        select: { id: true },
      });
      return row !== null;
    }
    case 'CLUSTER': {
      const row = await db(ctx).cluster.findFirst({ where: { id: scopeId }, select: { id: true } });
      return row !== null;
    }
    case 'REGION': {
      const row = await db(ctx).region.findFirst({ where: { id: scopeId }, select: { id: true } });
      return row !== null;
    }
    case 'COMMITTEE': {
      const row = await db(ctx).committee.findFirst({
        where: { id: scopeId },
        select: { id: true },
      });
      return row !== null;
    }
    case 'DISTRICT':
      // Handled by the caller: a DISTRICT appointment names no scope id at all.
      return false;
  }
}

/** Display names for the polymorphic scope, for a list the UI can actually read. */
export async function findScopeNames(
  ctx: RequestContext,
  targets: { scopeType: OrgScopeValue; scopeId: string }[],
): Promise<Map<string, string>> {
  const idsOf = (type: OrgScopeValue): string[] => [
    ...new Set(targets.filter((t) => t.scopeType === type).map((t) => t.scopeId)),
  ];

  const clubIds = idsOf('CLUB');
  const clusterIds = idsOf('CLUSTER');
  const regionIds = idsOf('REGION');
  const committeeIds = idsOf('COMMITTEE');

  const [clubs, clusters, regions, committees] = await Promise.all([
    // Read from the global club table rather than the affiliation, so a club that has
    // left the district still renders a name on its historical appointments.
    clubIds.length
      ? prisma.club.findMany({ where: { id: { in: clubIds } }, select: { id: true, name: true } })
      : [],
    clusterIds.length
      ? db(ctx).cluster.findMany({
          where: { id: { in: clusterIds } },
          select: { id: true, name: true },
        })
      : [],
    regionIds.length
      ? db(ctx).region.findMany({
          where: { id: { in: regionIds } },
          select: { id: true, name: true },
        })
      : [],
    committeeIds.length
      ? db(ctx).committee.findMany({
          where: { id: { in: committeeIds } },
          select: { id: true, name: true },
        })
      : [],
  ]);

  const names = new Map<string, string>();
  for (const row of [...clubs, ...clusters, ...regions, ...committees]) {
    names.set(row.id, row.name);
  }
  return names;
}

/** The district's timezone, for comparing a term against today. */
export async function districtTimezone(ctx: RequestContext): Promise<string> {
  const district = await prisma.district.findFirst({
    where: { id: ctx.districtId },
    select: { timezone: true },
  });
  return district?.timezone ?? 'UTC';
}
