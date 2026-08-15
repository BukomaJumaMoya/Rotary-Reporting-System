import type {
  CreateErasureRequest,
  CreatePersonRequest,
  ErasureListQuery,
  ErasureRequest,
  PaginationMeta,
  Person,
  PersonExport,
  PersonListQuery,
  PersonVisibility,
  RequestContext,
  UpdatePersonRequest,
  UpdateVisibilityRequest,
} from '@dis/contracts';
import { requireClubScope } from '../../platform/context.js';
import { AppError, ErrorCode, insufficientScope, notFound } from '../../platform/errors.js';
import { isoDate } from '../../platform/time.js';
import * as repository from './repository.js';
import { serialisePerson, serialiseVisibility } from './serialiser.js';

/**
 * People.
 *
 * Every response here goes through `serialisePerson`, and so does every response anywhere
 * else that contains a person. That is the whole design: one gate, and modules reach it by
 * calling `serialiseFor` below rather than by selecting contact columns of their own.
 */

/** Re-exported so other modules serialise nested people the same way, not a similar way. */
export { serialisePerson, mayReadContact } from './serialiser.js';
export type { PersonRecord } from './serialiser.js';

export async function list(
  ctx: RequestContext,
  query: PersonListQuery,
): Promise<{ data: Person[]; meta: PaginationMeta }> {
  // Scoped through the roster: a club officer sees their own members, a district officer
  // sees the district. `persons` has no district column to filter on.
  if (query.clubId) requireClubScope(ctx, query.clubId);

  const { rows, total } = await repository.listPersons(ctx, {
    q: query.q,
    clubId: query.clubId,
    page: query.page,
    pageSize: query.pageSize,
  });

  return {
    data: rows.map((row) =>
      serialisePerson(ctx, row.person, {
        // The roster row that made them visible is the club that decides whether a
        // `person:read:contact` holder has them in scope.
        rosterClubIds: [row.clubId],
        clubs: [{ id: row.clubId, name: row.club.name, since: isoDate(row.since) }],
      }),
    ),
    meta: { page: query.page, pageSize: query.pageSize, total },
  };
}

export async function get(ctx: RequestContext, personId: string): Promise<Person> {
  const record = await repository.findPersonInScope(ctx, personId);
  // Out of scope and non-existent give the same answer.
  if (!record) throw notFound();

  const clubs = (await repository.rosterClubsFor(ctx, [personId])).get(personId) ?? [];

  return serialisePerson(ctx, record, {
    rosterClubIds: clubs.map((club) => club.id),
    clubs: clubs.map((club) => ({ id: club.id, name: club.name, since: isoDate(club.since) })),
  });
}

export async function create(ctx: RequestContext, input: CreatePersonRequest): Promise<Person> {
  if (input.email) {
    const existing = await repository.findByEmail(input.email);
    if (existing) {
      // `persons.email` is CITEXT and unique. Caught here so a form can point at the field
      // — and so the message says "already registered" rather than exposing whose record
      // it is, which for a member of another district would be a cross-district read.
      throw new AppError(
        409,
        ErrorCode.DUPLICATE_CODE,
        'That email address is already registered',
        {
          field: 'email',
        },
      );
    }
  }

  const created = await repository.createPerson({
    ...(input.id ? { id: input.id } : {}),
    firstName: input.firstName,
    lastName: input.lastName,
    otherNames: input.otherNames ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    altPhone: input.altPhone ?? null,
    gender: input.gender ?? null,
    dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
    occupation: input.occupation ?? null,
    classification: input.classification ?? null,
    employer: input.employer ?? null,
    nationality: input.nationality ?? null,
    city: input.city ?? null,
  });

  // A person created but not yet on any roster is reachable only district-wide, so a club
  // secretary would get a 404 reading back what they just made. Serialised from the record
  // rather than re-read for that reason — and they are the author, so nothing is withheld
  // that they did not just type.
  const record = await repository.findOwnPerson(created.id);
  if (!record) throw notFound();
  return serialisePerson(ctx, record, { rosterClubIds: [] });
}

/**
 * Who may edit whom.
 *
 * Your own record always. Somebody else's needs `person:update:club` AND that person on a
 * club in your scope — which `findPersonInScope` has already proved by returning them.
 */
export async function update(
  ctx: RequestContext,
  personId: string,
  input: UpdatePersonRequest,
): Promise<Person> {
  const isSelf = personId === ctx.personId;

  if (!isSelf) {
    if (!ctx.permissions.has('person:update:club')) {
      throw insufficientScope('You may only edit your own record', {
        required: 'person:update:club',
      });
    }
    const inScope = await repository.findPersonInScope(ctx, personId);
    if (!inScope) throw notFound();
  }

  if (input.email !== undefined && input.email !== null) {
    const existing = await repository.findByEmail(input.email);
    if (existing && existing.id !== personId) {
      throw new AppError(
        409,
        ErrorCode.DUPLICATE_CODE,
        'That email address is already registered',
        {
          field: 'email',
        },
      );
    }
  }

  const data: Record<string, unknown> = {};
  const assign = (key: string, value: unknown): void => {
    if (value !== undefined) data[key] = value;
  };

  assign('firstName', input.firstName);
  assign('lastName', input.lastName);
  assign('otherNames', input.otherNames);
  assign('email', input.email);
  assign('phone', input.phone);
  assign('altPhone', input.altPhone);
  assign('gender', input.gender);
  assign(
    'dateOfBirth',
    input.dateOfBirth === undefined
      ? undefined
      : input.dateOfBirth === null
        ? null
        : new Date(input.dateOfBirth),
  );
  assign('occupation', input.occupation);
  assign('classification', input.classification);
  assign('employer', input.employer);
  assign('nationality', input.nationality);
  assign('city', input.city);

  if (Object.keys(data).length > 0) await repository.updatePerson(personId, data);

  return isSelf ? own(ctx, personId) : get(ctx, personId);
}

/** The caller's own record, unredacted. `mayReadContact` returns true for yourself. */
async function own(ctx: RequestContext, personId: string): Promise<Person> {
  const record = await repository.findOwnPerson(personId);
  if (!record) throw notFound();
  return serialisePerson(ctx, record);
}

// ─── Visibility ──────────────────────────────────────────────────────────────

/**
 * OWN RECORD ONLY, with no permission that overrides it.
 *
 * Not the DES, not an administrator, not a club secretary "helping". These flags are the
 * member's statement about their own data, and a system where somebody else can flip them
 * on is a system where the flags mean nothing.
 */
export async function getVisibility(
  ctx: RequestContext,
  personId: string,
): Promise<PersonVisibility> {
  if (personId !== ctx.personId) throw notFound();
  return serialiseVisibility(await repository.findVisibility(personId));
}

export async function updateVisibility(
  ctx: RequestContext,
  personId: string,
  input: UpdateVisibilityRequest,
): Promise<PersonVisibility> {
  // 404 rather than 403: a caller asking to change somebody else's visibility is asking
  // about a record that, for this purpose, is not theirs to know exists.
  if (personId !== ctx.personId) throw notFound();

  const data: Record<string, boolean> = {};
  for (const key of [
    'showEmail',
    'showPhone',
    'showPhoto',
    'showOccupation',
    'showCity',
    'directoryOptout',
  ] as const) {
    const value = input[key];
    if (value !== undefined) data[key] = value;
  }

  if (Object.keys(data).length === 0) return getVisibility(ctx, personId);

  // The row exists — `persons_visibility_ins` creates one for every person on insert — so
  // this is an update and never an upsert. A missing row would mean the trigger was
  // dropped, which is a schema problem and should surface as one.
  await repository.updateVisibility(personId, data);
  return getVisibility(ctx, personId);
}

// ─── Subject access ──────────────────────────────────────────────────────────

/**
 * Everything the district holds about one person, for that person.
 *
 * Own record only. There is no administrative version: an officer wanting a member's
 * history has the screens for it, and a one-call dump of somebody else's entire record is
 * the export that ends up in a WhatsApp group.
 */
export async function exportPerson(ctx: RequestContext, personId: string): Promise<PersonExport> {
  if (personId !== ctx.personId) throw notFound();

  const { person, consents, events, appointments } = await repository.findExportData(ctx, personId);
  if (!person) throw notFound();

  return {
    exportedAt: new Date().toISOString(),
    person: {
      id: person.id,
      firstName: person.firstName,
      lastName: person.lastName,
      otherNames: person.otherNames,
      email: person.email,
      phone: person.phone,
      altPhone: person.altPhone,
      gender: person.gender,
      dateOfBirth: person.dateOfBirth ? isoDate(person.dateOfBirth) : null,
      occupation: person.occupation,
      classification: person.classification,
      employer: person.employer,
      nationality: person.nationality,
      city: person.city,
      photoUrl: person.photoUrl,
      createdAt: person.createdAt.toISOString(),
    },
    visibility: person.visibility ? serialiseVisibility(person.visibility) : null,
    consents: consents.map((consent) => ({
      consentType: consent.consentType,
      policyVersion: consent.policyVersion,
      grantedAt: consent.grantedAt?.toISOString() ?? null,
      revokedAt: consent.revokedAt?.toISOString() ?? null,
    })),
    membershipEvents: events.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      memberCategory: event.memberCategory,
      effectiveOn: isoDate(event.effectiveOn),
      clubName: event.club.name,
      reasonCode: event.reasonCode,
      supersedesEventId: event.supersedesEventId,
    })),
    appointments: appointments.map((appointment) => ({
      id: appointment.id,
      positionName: appointment.position.name,
      scopeType: appointment.scopeType,
      startsOn: isoDate(appointment.startsOn),
      endsOn: appointment.endsOn ? isoDate(appointment.endsOn) : null,
      isActive: appointment.isActive,
      rotaryYearLabel: appointment.rotaryYear.label,
    })),
  };
}

// ─── Erasure ─────────────────────────────────────────────────────────────────

interface ErasureRow {
  id: string;
  personId: string;
  status: string;
  reason: string | null;
  reviewNote: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
  completedAt: Date | null;
  person: { firstName: string; lastName: string };
}

function serialiseErasure(row: ErasureRow): ErasureRequest {
  return {
    id: row.id,
    personId: row.personId,
    personName: `${row.person.firstName} ${row.person.lastName}`,
    status: row.status as ErasureRequest['status'],
    reason: row.reason,
    reviewNote: row.reviewNote,
    requestedAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

/**
 * A member asking to be erased.
 *
 * Own record only, and REVIEWED rather than immediate. Erasure is irreversible and the
 * request arrives from a session, which is the thing an attacker takes; a district officer
 * reading it first costs a day and prevents a member's whole record being anonymised by
 * somebody who borrowed their phone.
 */
export async function requestErasure(
  ctx: RequestContext,
  personId: string,
  input: CreateErasureRequest,
): Promise<ErasureRequest> {
  if (personId !== ctx.personId) throw notFound();

  const open = await repository.findOpenErasureRequest(ctx, personId);
  // Asking twice is asking once. Returning the existing request is a better answer than a
  // second row for the reviewer to work out the relationship between.
  if (open) return serialiseErasure(open);

  const created = await repository.createErasureRequest(ctx, {
    personId,
    reason: input.reason ?? null,
  });

  const row = await repository.findErasureRequest(ctx, created.id);
  if (!row) throw notFound();
  return serialiseErasure(row);
}

export async function listErasureRequests(
  ctx: RequestContext,
  query: ErasureListQuery,
): Promise<{ data: ErasureRequest[]; meta: PaginationMeta }> {
  const { rows, total } = await repository.listErasureRequests(ctx, {
    status: query.status,
    page: query.page,
    pageSize: query.pageSize,
  });

  return {
    data: rows.map(serialiseErasure),
    meta: { page: query.page, pageSize: query.pageSize, total },
  };
}

/** Marks the decision. Approving only QUEUES the work — see `people.erasure.job`. */
export async function reviewErasure(
  ctx: RequestContext,
  id: string,
  input: { decision: 'APPROVE' | 'REJECT'; note?: string | undefined },
): Promise<ErasureRequest> {
  const existing = await repository.findErasureRequest(ctx, id);
  if (!existing) throw notFound();

  if (existing.status !== 'PENDING') {
    throw new AppError(
      422,
      ErrorCode.VALIDATION_ERROR,
      'That erasure request has already been reviewed',
      { status: existing.status },
    );
  }

  await repository.markErasureReviewed(ctx, id, {
    status: input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
    note: input.note ?? null,
  });

  const row = await repository.findErasureRequest(ctx, id);
  if (!row) throw notFound();
  return serialiseErasure(row);
}

/**
 * ANONYMISES. Does not delete.
 *
 * `membership_events` is append-only and a club's roster history has to survive one member
 * leaving it — the club's 2027-28 retention rate is a fact about the club, and deleting the
 * person would change it retroactively. So the person row stays, keyed by the same id, with
 * the names replaced and every contact field nulled.
 *
 * Called by the job, under a system context, never from a request.
 */
export async function performErasure(ctx: RequestContext, requestId: string): Promise<boolean> {
  const request = await repository.findErasureRequest(ctx, requestId);
  if (!request || request.status !== 'APPROVED') return false;

  await repository.updatePerson(request.personId, {
    firstName: 'Former',
    lastName: 'member',
    otherNames: null,
    email: null,
    phone: null,
    altPhone: null,
    gender: null,
    dateOfBirth: null,
    occupation: null,
    classification: null,
    employer: null,
    nationality: null,
    city: null,
    photoUrl: null,
    riMemberId: null,
  });

  await repository.markErasureCompleted(ctx, requestId);
  return true;
}
