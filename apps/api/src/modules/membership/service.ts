import type {
  CorrectMembershipEvent,
  CreateMembershipEvent,
  MembershipEvent,
  MembershipEventListQuery,
  MembershipStats,
  MembershipStatsQuery,
  PaginationMeta,
  RequestContext,
  RosterEntry,
  RosterQuery,
  Transition,
  TransitionListQuery,
} from '@dis/contracts';
import { joiningEventTypes, leavingEventTypes } from '@dis/contracts';
import { requireClubScope } from '../../platform/context.js';
import { db } from '../../platform/db.js';
import { AppError, ErrorCode, notFound } from '../../platform/errors.js';
import { isoDate } from '../../platform/time.js';
import { notifyThroughQueue } from '../../jobs/notification.job.js';
import { listClubOfficerPersonIds } from '../governance/appointments.service.js';
import { NotificationTemplate } from '../notifications/templates.js';
import { serialisePerson } from '../people/serialiser.js';
import * as analytics from './analytics.js';

/**
 * Membership — the event log, and the roster derived from it (axiom 3).
 *
 * `membership_events` is APPEND-ONLY. There is no update path and no delete path in this
 * file, and there is a database guard (`membership_events_no_mutate`, SQLSTATE DIS01 →
 * `MEMBERSHIP_IMMUTABLE`) that makes that true of paths nobody has written yet. The one
 * column that may be set after insert is `corroborated_at`, because corroborating a
 * transition to Rotary necessarily happens after the fact.
 *
 * Nothing here writes `club_rosters`. It is a materialised view over this log and is
 * refreshed after every write.
 */

const JOINING = new Set<string>(joiningEventTypes);
const LEAVING = new Set<string>(leavingEventTypes);

const EVENT_SELECT = {
  id: true,
  personId: true,
  clubId: true,
  eventType: true,
  memberCategory: true,
  effectiveOn: true,
  reasonCode: true,
  reasonNote: true,
  counterpartyClubId: true,
  rotaryClubName: true,
  rotaryClubRiId: true,
  corroboratedAt: true,
  supersedesEventId: true,
  createdAt: true,
  club: { select: { name: true } },
  counterpartyClub: { select: { name: true } },
  person: {
    select: {
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
      visibility: true,
    },
  },
  // One extra column rather than a second query per row: a client rendering the history
  // has to show which rows have been corrected, and "is this the tip of its chain" is not
  // answerable from the row alone.
  supersededBy: { select: { id: true } },
} as const;

type EventRow = {
  id: string;
  personId: string;
  clubId: string;
  eventType: string;
  memberCategory: string;
  effectiveOn: Date;
  reasonCode: string | null;
  reasonNote: string | null;
  counterpartyClubId: string | null;
  rotaryClubName: string | null;
  rotaryClubRiId: bigint | null;
  corroboratedAt: Date | null;
  supersedesEventId: string | null;
  createdAt: Date;
  club: { name: string };
  counterpartyClub: { name: string } | null;
  person: Parameters<typeof serialisePerson>[1];
  supersededBy: { id: string }[];
};

function serialiseEvent(ctx: RequestContext, row: EventRow): MembershipEvent {
  return {
    id: row.id,
    personId: row.personId,
    // Through the ONE serialiser, with the event's club as the scope test. A membership
    // history is exactly the nested case where contact details leak — nobody reviewing
    // this endpoint is thinking about phone numbers.
    person: serialisePerson(ctx, row.person, { rosterClubIds: [row.clubId] }),
    clubId: row.clubId,
    clubName: row.club.name,
    eventType: row.eventType as MembershipEvent['eventType'],
    memberCategory: row.memberCategory as MembershipEvent['memberCategory'],
    effectiveOn: isoDate(row.effectiveOn),
    reasonCode: row.reasonCode,
    reasonNote: row.reasonNote,
    counterpartyClubId: row.counterpartyClubId,
    counterpartyClubName: row.counterpartyClub?.name ?? null,
    rotaryClubName: row.rotaryClubName,
    rotaryClubRiId: row.rotaryClubRiId === null ? null : row.rotaryClubRiId.toString(),
    corroboratedAt: row.corroboratedAt?.toISOString() ?? null,
    supersedesEventId: row.supersedesEventId,
    isSuperseded: row.supersededBy.length > 0,
    recordedAt: row.createdAt.toISOString(),
  };
}

// ─── Events ──────────────────────────────────────────────────────────────────

export async function listEvents(
  ctx: RequestContext,
  query: MembershipEventListQuery,
): Promise<{ data: MembershipEvent[]; meta: PaginationMeta }> {
  if (query.clubId) requireClubScope(ctx, query.clubId);

  const where = {
    ...(query.clubId
      ? { clubId: query.clubId }
      : ctx.scopes.isDistrictWide
        ? {}
        : { clubId: { in: [...ctx.scopes.clubIds] } }),
    ...(query.personId ? { personId: query.personId } : {}),
    ...(query.eventType ? { eventType: query.eventType } : {}),
    ...(query.from || query.to
      ? {
          effectiveOn: {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to ? { lte: new Date(query.to) } : {}),
          },
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    db(ctx).membershipEvent.findMany({
      where,
      select: EVENT_SELECT,
      orderBy: [{ effectiveOn: 'desc' }, { createdAt: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    db(ctx).membershipEvent.count({ where }),
  ]);

  return {
    data: rows.map((row) => serialiseEvent(ctx, row as EventRow)),
    meta: { page: query.page, pageSize: query.pageSize, total },
  };
}

export async function getEvent(ctx: RequestContext, id: string): Promise<MembershipEvent> {
  const row = await db(ctx).membershipEvent.findFirst({ where: { id }, select: EVENT_SELECT });
  if (!row) throw notFound();
  requireClubScope(ctx, row.clubId);
  return serialiseEvent(ctx, row);
}

/**
 * Appends an event.
 *
 * Idempotent on a client-supplied id: the same UUID posted twice yields ONE row and the
 * second call gets the row that already exists. That is what makes a secretary tapping Save
 * on a bad connection safe (ADR-006) — and it is the same answer as re-posting, not a
 * failure, so the client does not have to distinguish them.
 */
export async function createEvent(
  ctx: RequestContext,
  input: CreateMembershipEvent,
): Promise<{ event: MembershipEvent; replayed: boolean }> {
  requireClubScope(ctx, input.clubId);

  if (input.id) {
    const existing = await db(ctx).membershipEvent.findFirst({
      where: { id: input.id },
      select: EVENT_SELECT,
    });
    if (existing) {
      return { event: serialiseEvent(ctx, existing), replayed: true };
    }
  }

  await assertNotDuplicate(ctx, input);
  await assertCounterparty(ctx, input);

  const created = await db(ctx).membershipEvent.create({
    data: {
      ...(input.id ? { id: input.id } : {}),
      personId: input.personId,
      clubId: input.clubId,
      eventType: input.eventType,
      memberCategory: input.memberCategory,
      effectiveOn: new Date(input.effectiveOn),
      reasonCode: input.reasonCode ?? null,
      reasonNote: input.reasonNote ?? null,
      counterpartyClubId: input.counterpartyClubId ?? null,
      rotaryClubName: input.rotaryClubName ?? null,
      rotaryClubRiId: input.rotaryClubRiId ? BigInt(input.rotaryClubRiId) : null,
      evidenceUrl: input.evidenceUrl ?? null,
      recordedByUserId: ctx.userId === '' ? null : ctx.userId,
    },
  });

  // The roster is a projection of the log and is rebuilt, never written.
  await analytics.refreshRoster();

  const event = await getEvent(ctx, created.id);
  await notifyCounterparty(ctx, event);
  return { event, replayed: false };
}

/**
 * Tells the OTHER club that a transfer naming them has been recorded.
 *
 * A transfer is one club's account of a two-sided event. Without this, the receiving club
 * learns about it when the district's numbers do not add up in April — which is the
 * conversation this notification exists to prevent. Never throws: a mail problem must not
 * refuse the event that caused it.
 */
async function notifyCounterparty(ctx: RequestContext, event: MembershipEvent): Promise<void> {
  if (!event.counterpartyClubId) return;
  if (event.eventType !== 'TRANSFER_OUT' && event.eventType !== 'TRANSFER_IN') return;

  try {
    const officers = await listClubOfficerPersonIds(ctx, event.counterpartyClubId);
    for (const personId of officers) {
      await notifyThroughQueue(ctx, {
        personId,
        templateCode: NotificationTemplate.MEMBERSHIP_TRANSFER_RECORDED,
        districtId: ctx.districtId,
        payload: {
          memberName: `${event.person.firstName} ${event.person.lastName}`,
          fromClub: event.clubName,
          toClub: event.counterpartyClubName ?? '',
          effectiveOn: event.effectiveOn,
        },
      });
    }
  } catch (error) {
    console.error('[membership] could not notify the counterparty club', error);
  }
}

/**
 * The same person, club, type and date twice is a double-tap, not two facts.
 *
 * A correction is exempt: superseding an event necessarily repeats its (person, club, type,
 * date) in order to say something different about it.
 */
async function assertNotDuplicate(
  ctx: RequestContext,
  input: CreateMembershipEvent,
): Promise<void> {
  const existing = await db(ctx).membershipEvent.findFirst({
    where: {
      personId: input.personId,
      clubId: input.clubId,
      eventType: input.eventType,
      effectiveOn: new Date(input.effectiveOn),
      supersedesEventId: null,
    },
    select: { id: true },
  });

  if (existing) {
    throw new AppError(
      409,
      ErrorCode.DUPLICATE_MEMBERSHIP_EVENT,
      'That event has already been recorded for this member on this date',
      { eventId: existing.id },
    );
  }
}

/** A counterparty club must be one this district can see, or it is a name nobody can check. */
async function assertCounterparty(
  ctx: RequestContext,
  input: CreateMembershipEvent,
): Promise<void> {
  if (!input.counterpartyClubId) return;

  const affiliated = await db(ctx).clubDistrictAffiliation.count({
    where: { clubId: input.counterpartyClubId },
  });
  if (affiliated === 0) {
    // Not a 404: the caller named it, and "that club is not in this district" is a fact
    // about the district rather than about the club.
    throw new AppError(
      422,
      ErrorCode.INVALID_SCOPE_REFERENCE,
      'The counterparty club is not affiliated to this district for this Rotary Year',
      { counterpartyClubId: input.counterpartyClubId },
    );
  }
}

/**
 * Corrects an event by APPENDING another that supersedes it.
 *
 * Two shapes, and the type says which. `CORRECTION` retracts the original outright — "this
 * never happened" — and, not being a joining type, drops the person from the roster.
 * Anything else replaces the fact: a mistyped join date is a second `JOIN` carrying the
 * right one. Either way the original row stays, because the log is never edited.
 */
export async function correctEvent(
  ctx: RequestContext,
  id: string,
  input: CorrectMembershipEvent,
): Promise<MembershipEvent> {
  const original = await db(ctx).membershipEvent.findFirst({
    where: { id },
    select: EVENT_SELECT,
  });
  if (!original) throw notFound();
  requireClubScope(ctx, original.clubId);

  const alreadyCorrected = original.supersededBy.length > 0;
  if (alreadyCorrected) {
    throw new AppError(
      422,
      ErrorCode.VALIDATION_ERROR,
      'That event has already been corrected. Correct the correction instead.',
      { supersededBy: original.supersededBy[0]?.id },
    );
  }

  const created = await db(ctx).membershipEvent.create({
    data: {
      ...(input.id ? { id: input.id } : {}),
      personId: original.personId,
      clubId: original.clubId,
      eventType: input.eventType,
      memberCategory: input.memberCategory ?? original.memberCategory,
      effectiveOn: input.effectiveOn ? new Date(input.effectiveOn) : original.effectiveOn,
      // A RETRACTION does not inherit the original's reason code. "This never happened"
      // has no reason of its own beyond the note — and inheriting one put the retracted
      // event's reason back into the statistics breakdown, where it looked like a member
      // had left for it.
      reasonCode:
        input.eventType === 'CORRECTION'
          ? (input.reasonCode ?? null)
          : (input.reasonCode ?? original.reasonCode),
      // Required on a correction: an unexplained correction to an append-only log is the
      // thing a disputed scorecard turns on eighteen months later.
      reasonNote: input.reasonNote,
      counterpartyClubId: original.counterpartyClubId,
      rotaryClubName: original.rotaryClubName,
      rotaryClubRiId: original.rotaryClubRiId,
      supersedesEventId: original.id,
      recordedByUserId: ctx.userId === '' ? null : ctx.userId,
    },
  });

  await analytics.refreshRoster();
  return getEvent(ctx, created.id);
}

// ─── Roster ──────────────────────────────────────────────────────────────────

/**
 * The current roster, or the roster as at a date.
 *
 * Today comes from `club_rosters`, the materialised view. A date comes from the LOG, walked
 * and reconstructed — the view is today, and "who were we in March" is what a disputed
 * scorecard turns on.
 */
export async function roster(
  ctx: RequestContext,
  query: RosterQuery,
): Promise<{ data: RosterEntry[]; meta: PaginationMeta }> {
  if (query.clubId) requireClubScope(ctx, query.clubId);

  const clubId = query.clubId ?? null;

  if (query.asOf) {
    const rows = await analytics.rosterAsOf(ctx, { clubId, asOf: new Date(query.asOf) });
    const page = rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
    const entries = await hydrateRoster(
      ctx,
      page.map((row) => ({
        personId: row.person_id,
        clubId: row.club_id,
        memberCategory: row.member_category,
        since: row.since,
      })),
    );
    return {
      data: entries,
      meta: { page: query.page, pageSize: query.pageSize, total: rows.length },
    };
  }

  const where = {
    ...(clubId
      ? { clubId }
      : ctx.scopes.isDistrictWide
        ? {}
        : { clubId: { in: [...ctx.scopes.clubIds] } }),
    ...(query.q
      ? {
          person: {
            deletedAt: null,
            OR: [
              { firstName: { contains: query.q, mode: 'insensitive' as const } },
              { lastName: { contains: query.q, mode: 'insensitive' as const } },
            ],
          },
        }
      : { person: { deletedAt: null } }),
  };

  const [rows, total] = await Promise.all([
    db(ctx).clubRoster.findMany({
      where,
      select: {
        personId: true,
        clubId: true,
        memberCategory: true,
        since: true,
      },
      orderBy: [{ clubId: 'asc' }, { personId: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    db(ctx).clubRoster.count({ where }),
  ]);

  return {
    data: await hydrateRoster(ctx, rows),
    meta: { page: query.page, pageSize: query.pageSize, total },
  };
}

/** Attaches people and club names to a page of roster rows, through the one serialiser. */
async function hydrateRoster(
  ctx: RequestContext,
  rows: { personId: string; clubId: string; memberCategory: string; since: Date }[],
): Promise<RosterEntry[]> {
  if (rows.length === 0) return [];

  const [persons, clubs] = await Promise.all([
    db(ctx).clubRoster.findMany({
      where: { personId: { in: rows.map((row) => row.personId) } },
      select: {
        personId: true,
        person: {
          select: {
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
            visibility: true,
          },
        },
      },
    }),
    db(ctx).clubDistrictAffiliation.findMany({
      where: { clubId: { in: rows.map((row) => row.clubId) } },
      select: { clubId: true, club: { select: { name: true } } },
    }),
  ]);

  const personById = new Map(persons.map((row) => [row.personId, row.person]));
  const clubName = new Map(clubs.map((row) => [row.clubId, row.club.name]));

  return rows.flatMap((row) => {
    const person = personById.get(row.personId);
    if (!person) return [];
    return [
      {
        personId: row.personId,
        person: serialisePerson(ctx, person, { rosterClubIds: [row.clubId] }),
        clubId: row.clubId,
        clubName: clubName.get(row.clubId) ?? '',
        memberCategory: row.memberCategory as RosterEntry['memberCategory'],
        since: isoDate(row.since),
      },
    ];
  });
}

// ─── Statistics ──────────────────────────────────────────────────────────────

/**
 * Opening, joiners, leavers, net, retention, transitions and a reason breakdown.
 *
 * This arithmetic feeds M5's scoring, so it is worth getting exactly right now. `opening` is
 * the roster the day BEFORE the window starts, reconstructed from the log; the rest are
 * tallies of live events inside it, all from one query so they reconcile by construction.
 */
export async function stats(
  ctx: RequestContext,
  query: MembershipStatsQuery,
): Promise<MembershipStats> {
  if (query.clubId) requireClubScope(ctx, query.clubId);
  const clubId = query.clubId ?? null;

  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from ? new Date(query.from) : new Date(Date.UTC(to.getUTCFullYear(), 0, 1));

  // The day BEFORE the window. A member who joined on the first day of the period is a
  // joiner, not part of the opening roster, and off-by-one here is a retention rate that
  // is wrong in the club's favour every time.
  const dayBefore = new Date(from);
  dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);

  const [opening, closing, tallies] = await Promise.all([
    analytics.rosterSizeAsOf(ctx, { clubId, asOf: dayBefore }),
    analytics.rosterSizeAsOf(ctx, { clubId, asOf: to }),
    analytics.tallyEvents(ctx, { clubId, from, to }),
  ]);

  let joiners = 0;
  let leavers = 0;
  let transitions = 0;
  const byReason = new Map<string, number>();
  const byType = new Map<string, number>();

  for (const tally of tallies) {
    const count = Number(tally.count);
    byType.set(tally.event_type, (byType.get(tally.event_type) ?? 0) + count);

    if (JOINING.has(tally.event_type)) joiners += count;
    if (LEAVING.has(tally.event_type)) leavers += count;
    if (tally.event_type === 'TRANSITION_TO_ROTARY') transitions += count;

    if (tally.reason_code) {
      byReason.set(tally.reason_code, (byReason.get(tally.reason_code) ?? 0) + count);
    }
  }

  return {
    from: isoDate(from),
    to: isoDate(to),
    clubId,
    opening,
    closing,
    joiners,
    leavers,
    netChange: closing - opening,
    // Null rather than 0 for an empty opening roster: a club chartered in October would
    // otherwise be reported as having lost everybody it never had.
    retentionRate: opening === 0 ? null : (((opening - leavers) / opening) * 100).toFixed(2),
    transitionsToRotary: transitions,
    byReason: [...byReason.entries()]
      .map(([reasonCode, count]) => ({ reasonCode, count }))
      .sort((a, b) => b.count - a.count),
    byType: [...byType.entries()]
      .map(([eventType, count]) => ({
        eventType: eventType as MembershipStats['byType'][number]['eventType'],
        count,
      }))
      .sort((a, b) => b.count - a.count),
  };
}

// ─── Transitions to Rotary ───────────────────────────────────────────────────

export async function listTransitions(
  ctx: RequestContext,
  query: TransitionListQuery,
): Promise<{ data: Transition[]; meta: PaginationMeta }> {
  if (query.clubId) requireClubScope(ctx, query.clubId);

  const where = {
    eventType: 'TRANSITION_TO_ROTARY' as const,
    ...(query.clubId
      ? { clubId: query.clubId }
      : ctx.scopes.isDistrictWide
        ? {}
        : { clubId: { in: [...ctx.scopes.clubIds] } }),
    ...(query.corroborated === 'true' ? { corroboratedAt: { not: null } } : {}),
    ...(query.corroborated === 'false' ? { corroboratedAt: null } : {}),
  };

  const [rows, total] = await Promise.all([
    db(ctx).membershipEvent.findMany({
      where,
      select: {
        id: true,
        personId: true,
        clubId: true,
        effectiveOn: true,
        rotaryClubName: true,
        rotaryClubRiId: true,
        corroboratedAt: true,
        club: { select: { name: true } },
        person: { select: { firstName: true, lastName: true } },
      },
      orderBy: { effectiveOn: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    db(ctx).membershipEvent.count({ where }),
  ]);

  return {
    data: rows.map((row) => ({
      id: row.id,
      personId: row.personId,
      // Names only. A transitions list is a governance screen, not a directory, and a name
      // is what it needs to say who moved.
      personName: `${row.person.firstName} ${row.person.lastName}`,
      clubId: row.clubId,
      clubName: row.club.name,
      effectiveOn: isoDate(row.effectiveOn),
      rotaryClubName: row.rotaryClubName,
      rotaryClubRiId: row.rotaryClubRiId === null ? null : row.rotaryClubRiId.toString(),
      corroboratedAt: row.corroboratedAt?.toISOString() ?? null,
    })),
    meta: { page: query.page, pageSize: query.pageSize, total },
  };
}

/**
 * Confirms a transition from the receiving side.
 *
 * `corroborated_at` is the ONE column the immutability guard lets through, because
 * corroborating a transition necessarily happens after the event was recorded. A transition
 * nobody corroborated is still a transition; it is simply one the district has only the
 * club's word for, and the scoring engine can tell the difference.
 */
export async function corroborate(ctx: RequestContext, id: string): Promise<Transition> {
  const event = await db(ctx).membershipEvent.findFirst({
    where: { id, eventType: 'TRANSITION_TO_ROTARY' },
    select: { id: true, clubId: true, corroboratedAt: true },
  });
  if (!event) throw notFound();
  requireClubScope(ctx, event.clubId);

  if (!event.corroboratedAt) {
    await db(ctx).membershipEvent.updateMany({
      where: { id },
      data: { corroboratedAt: new Date() },
    });
  }

  const found = await db(ctx).membershipEvent.findFirst({
    where: { id },
    select: {
      id: true,
      personId: true,
      clubId: true,
      effectiveOn: true,
      rotaryClubName: true,
      rotaryClubRiId: true,
      corroboratedAt: true,
      club: { select: { name: true } },
      person: { select: { firstName: true, lastName: true } },
    },
  });
  if (!found) throw notFound();

  return {
    id: found.id,
    personId: found.personId,
    personName: `${found.person.firstName} ${found.person.lastName}`,
    clubId: found.clubId,
    clubName: found.club.name,
    effectiveOn: isoDate(found.effectiveOn),
    rotaryClubName: found.rotaryClubName,
    rotaryClubRiId: found.rotaryClubRiId === null ? null : found.rotaryClubRiId.toString(),
    corroboratedAt: found.corroboratedAt?.toISOString() ?? null,
  };
}

/**
 * How many members a club has right now. The function `org` calls for a club summary.
 *
 * Read from `club_rosters` — never from `membership_events` directly. The view holds the tip
 * of every supersede chain, which is the fix schema v1.6 made.
 */
export async function countRoster(ctx: RequestContext, clubId: string): Promise<number> {
  return db(ctx).clubRoster.count({ where: { clubId } });
}
