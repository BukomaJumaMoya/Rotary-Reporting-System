import type { RequestContext } from '@dis/contracts';
import { db, prisma } from '../../platform/db.js';

/**
 * Person reads.
 *
 * `persons` is a GLOBAL entity — people move between clubs and between districts, so axiom
 * 2's reasoning applies to them too — which means it carries no district and cannot be
 * scoped by the data access layer. The scope therefore comes from the ROSTER:
 * `club_rosters` is district-scoped, so "the people of this district" is a join through it.
 *
 * That is also why a person with no current club is reachable only by a district-wide
 * caller: there is no roster row to scope them by, and inventing one would be inventing a
 * membership.
 */

/** Everything the serialiser can use. Selected in one place so no endpoint selects more. */
export const PERSON_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  otherNames: true,
  gender: true,
  dateOfBirth: true,
  email: true,
  phone: true,
  altPhone: true,
  occupation: true,
  classification: true,
  employer: true,
  nationality: true,
  city: true,
  photoUrl: true,
  visibility: {
    select: {
      showEmail: true,
      showPhone: true,
      showPhoto: true,
      showOccupation: true,
      showCity: true,
      directoryOptout: true,
    },
  },
} as const;

/** The clubs, within the caller's district and year, a set of people are on the roster of. */
export async function rosterClubsFor(
  ctx: RequestContext,
  personIds: string[],
): Promise<Map<string, { id: string; name: string; since: Date }[]>> {
  if (personIds.length === 0) return new Map();

  const rows = await db(ctx).clubRoster.findMany({
    where: { personId: { in: personIds } },
    select: { personId: true, clubId: true, since: true, club: { select: { name: true } } },
  });

  const byPerson = new Map<string, { id: string; name: string; since: Date }[]>();
  for (const row of rows) {
    const list = byPerson.get(row.personId) ?? [];
    list.push({ id: row.clubId, name: row.club.name, since: row.since });
    byPerson.set(row.personId, list);
  }
  return byPerson;
}

function rosterScope(ctx: RequestContext, clubId?: string) {
  return {
    ...(clubId ? { clubId } : {}),
    // A club-scoped caller sees the people on their own clubs' rosters. A district-wide
    // one needs no narrowing — enumerating 68 clubs to answer a boolean is work done 68
    // times to no purpose.
    ...(ctx.scopes.isDistrictWide ? {} : { clubId: clubId ?? { in: [...ctx.scopes.clubIds] } }),
  };
}

export async function listPersons(
  ctx: RequestContext,
  query: { q?: string | undefined; clubId?: string | undefined; page: number; pageSize: number },
) {
  const where = {
    ...rosterScope(ctx, query.clubId),
    ...(query.q
      ? {
          person: {
            deletedAt: null,
            OR: [
              { firstName: { contains: query.q, mode: 'insensitive' as const } },
              { lastName: { contains: query.q, mode: 'insensitive' as const } },
              { otherNames: { contains: query.q, mode: 'insensitive' as const } },
            ],
          },
        }
      : // Nested, so the soft-delete extension does not reach it. Written by hand.
        { person: { deletedAt: null } }),
  };

  const [rows, total] = await Promise.all([
    db(ctx).clubRoster.findMany({
      where,
      select: {
        personId: true,
        clubId: true,
        since: true,
        club: { select: { name: true } },
        person: { select: PERSON_SELECT },
      },
      orderBy: [{ personId: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    db(ctx).clubRoster.count({ where }),
  ]);

  return { rows, total };
}

/**
 * One person, if the caller may reach them.
 *
 * Through the roster first, so a club officer reaches their own members. A district-wide
 * caller may also reach somebody with no current club — an incoming officer, a member
 * between clubs — because there is no roster row to find them by and they are still the
 * district's to administer.
 */
export async function findPersonInScope(ctx: RequestContext, personId: string) {
  const roster = await db(ctx).clubRoster.findFirst({
    where: { personId, ...rosterScope(ctx) },
    select: { personId: true },
  });

  if (!roster && !ctx.scopes.isDistrictWide) return null;

  return prisma.person.findFirst({ where: { id: personId }, select: PERSON_SELECT });
}

/** The person themselves, with no scope check. For the subject-access paths only. */
export async function findOwnPerson(personId: string) {
  return prisma.person.findFirst({ where: { id: personId }, select: PERSON_SELECT });
}

export async function createPerson(data: Record<string, unknown>) {
  // `person_visibility` is created by the persons_visibility_ins trigger, with every
  // contact field closed. Nothing here writes it: a second definition of the default is
  // the one that drifts, and the one that drifts open is the failure this project exists
  // to correct (build log §4).
  return prisma.person.create({ data: data as never, select: { id: true } });
}

export async function updatePerson(personId: string, data: Record<string, unknown>) {
  return prisma.person.updateMany({ where: { id: personId }, data });
}

export async function findVisibility(personId: string) {
  return prisma.personVisibility.findUnique({ where: { personId } });
}

export async function updateVisibility(personId: string, data: Record<string, boolean>) {
  return prisma.personVisibility.update({ where: { personId }, data });
}

export async function findByEmail(email: string) {
  return prisma.person.findFirst({ where: { email }, select: { id: true } });
}

/** Everything a subject access request returns. Unredacted: the caller IS the subject. */
export async function findExportData(ctx: RequestContext, personId: string) {
  const [person, consents, events, appointments] = await Promise.all([
    prisma.person.findFirst({
      where: { id: personId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        otherNames: true,
        email: true,
        phone: true,
        altPhone: true,
        gender: true,
        dateOfBirth: true,
        occupation: true,
        classification: true,
        employer: true,
        nationality: true,
        city: true,
        photoUrl: true,
        createdAt: true,
        visibility: true,
      },
    }),
    prisma.consent.findMany({
      where: { personId },
      select: { consentType: true, policyVersion: true, grantedAt: true, revokedAt: true },
      orderBy: { grantedAt: 'asc' },
    }),
    // Scoped, so the export covers this district's record of the member. A person who has
    // served in two districts asks each of them — which is the same answer the districts
    // themselves get, and the alternative is one district's officer reading another's log.
    db(ctx).membershipEvent.findMany({
      where: { personId },
      select: {
        id: true,
        eventType: true,
        memberCategory: true,
        effectiveOn: true,
        reasonCode: true,
        supersedesEventId: true,
        club: { select: { name: true } },
      },
      orderBy: { effectiveOn: 'asc' },
    }),
    db(ctx).appointment.findMany({
      where: { personId },
      select: {
        id: true,
        scopeType: true,
        startsOn: true,
        endsOn: true,
        isActive: true,
        position: { select: { name: true } },
        rotaryYear: { select: { label: true } },
      },
      orderBy: { startsOn: 'asc' },
    }),
  ]);

  return { person, consents, events, appointments };
}

// ─── Erasure ─────────────────────────────────────────────────────────────────

export const ERASURE_SELECT = {
  id: true,
  personId: true,
  status: true,
  reason: true,
  reviewNote: true,
  createdAt: true,
  reviewedAt: true,
  completedAt: true,
  person: { select: { firstName: true, lastName: true } },
} as const;

export async function findOpenErasureRequest(ctx: RequestContext, personId: string) {
  return db(ctx).personErasureRequest.findFirst({
    where: { personId, status: { in: ['PENDING', 'APPROVED'] } },
    select: ERASURE_SELECT,
  });
}

export async function createErasureRequest(
  ctx: RequestContext,
  input: { personId: string; reason: string | null },
) {
  return db(ctx).personErasureRequest.create({
    data: {
      personId: input.personId,
      requestedByUserId: ctx.userId === '' ? null : ctx.userId,
      reason: input.reason,
      status: 'PENDING',
    },
  });
}

export async function findErasureRequest(ctx: RequestContext, id: string) {
  return db(ctx).personErasureRequest.findFirst({ where: { id }, select: ERASURE_SELECT });
}

export async function listErasureRequests(
  ctx: RequestContext,
  query: { status?: string | undefined; page: number; pageSize: number },
) {
  const where = query.status ? { status: query.status as 'PENDING' } : {};

  const [rows, total] = await Promise.all([
    db(ctx).personErasureRequest.findMany({
      where,
      select: ERASURE_SELECT,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    db(ctx).personErasureRequest.count({ where }),
  ]);

  return { rows, total };
}

export async function markErasureReviewed(
  ctx: RequestContext,
  id: string,
  input: { status: 'APPROVED' | 'REJECTED'; note: string | null },
) {
  return db(ctx).personErasureRequest.updateMany({
    where: { id, status: 'PENDING' },
    data: {
      status: input.status,
      reviewNote: input.note,
      reviewedByUserId: ctx.userId === '' ? null : ctx.userId,
      reviewedAt: new Date(),
    },
  });
}

export async function markErasureCompleted(ctx: RequestContext, id: string) {
  return db(ctx).personErasureRequest.updateMany({
    where: { id, status: 'APPROVED' },
    data: { status: 'COMPLETED', completedAt: new Date() },
  });
}
