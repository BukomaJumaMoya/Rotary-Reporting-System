import type {
  Activity,
  ActivityListQuery,
  ActivityType,
  AddAttendees,
  AddPartner,
  CalendarQuery,
  CreateActivity,
  PaginationMeta,
  Partner,
  RequestContext,
  UpdateActivity,
  VerifyActivity,
} from '@dis/contracts';
import { hasScope, requireScope } from '../../platform/context.js';
import { Prisma } from '../../generated/prisma/client.js';
import { db, prisma } from '../../platform/db.js';
import { AppError, ErrorCode, notFound } from '../../platform/errors.js';
import * as assessment from '../assessment/service.js';
import * as types from './types.service.js';

/**
 * Activities — ONE model, configurable types (axiom 4).
 *
 * Every fellowship, service project, PLD session, assembly, cluster meeting and district
 * visit is a row in `activities`. What distinguishes them is `activity_type_id`, and what a
 * type REQUIRES is read from the type's own row rather than written into a branch here. A
 * new activity type is an insert; nothing in this file changes.
 */

const SELECT = {
  id: true,
  activityTypeId: true,
  hostScopeType: true,
  hostScopeId: true,
  title: true,
  description: true,
  startsAt: true,
  endsAt: true,
  venue: true,
  isVirtual: true,
  meetingUrl: true,
  status: true,
  themeAlignment: true,
  narrativeReport: true,
  attendanceMembers: true,
  attendanceVisitors: true,
  attendanceGuests: true,
  beneficiariesCount: true,
  treesPlanted: true,
  fundsRaised: true,
  volunteerHours: true,
  extra: true,
  verification: true,
  verifiedAt: true,
  createdAt: true,
  activityType: { select: { name: true, code: true, category: true } },
  areasOfFocus: { select: { areaOfFocus: { select: { code: true } } } },
  _count: { select: { media: true, partners: true, attendees: true } },
} as const;

interface ActivityRow {
  id: string;
  activityTypeId: string;
  hostScopeType: string;
  hostScopeId: string;
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date | null;
  venue: string | null;
  isVirtual: boolean;
  meetingUrl: string | null;
  status: string;
  themeAlignment: string | null;
  narrativeReport: string | null;
  attendanceMembers: number | null;
  attendanceVisitors: number | null;
  attendanceGuests: number | null;
  beneficiariesCount: number | null;
  treesPlanted: number | null;
  fundsRaised: { toString(): string } | null;
  volunteerHours: { toString(): string } | null;
  extra: unknown;
  verification: string;
  verifiedAt: Date | null;
  createdAt: Date;
  activityType: { name: string; code: string; category: string };
  areasOfFocus: { areaOfFocus: { code: string } }[];
  _count: { media: number; partners: number; attendees: number };
}

function serialise(row: ActivityRow, hostName: string | null): Activity {
  return {
    id: row.id,
    activityTypeId: row.activityTypeId,
    activityTypeName: row.activityType.name,
    activityTypeCode: row.activityType.code,
    category: row.activityType.category as Activity['category'],
    hostScopeType: row.hostScopeType as Activity['hostScopeType'],
    hostScopeId: row.hostScopeId,
    hostName,
    title: row.title,
    description: row.description,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt?.toISOString() ?? null,
    venue: row.venue,
    isVirtual: row.isVirtual,
    meetingUrl: row.meetingUrl,
    status: row.status as Activity['status'],
    themeAlignment: row.themeAlignment,
    narrativeReport: row.narrativeReport,
    attendanceMembers: row.attendanceMembers,
    attendanceVisitors: row.attendanceVisitors,
    attendanceGuests: row.attendanceGuests,
    beneficiariesCount: row.beneficiariesCount,
    treesPlanted: row.treesPlanted,
    // Money and hours are NUMERIC in the database and strings on the wire. A Decimal that
    // went through a JSON number would come back as a float, which is the one thing money
    // must never be.
    fundsRaised: row.fundsRaised?.toString() ?? null,
    volunteerHours: row.volunteerHours?.toString() ?? null,
    extra: (row.extra ?? {}) as Record<string, unknown>,
    verification: row.verification as Activity['verification'],
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    areaOfFocusCodes: row.areasOfFocus.map((entry) => entry.areaOfFocus.code),
    mediaCount: row._count.media,
    partnerCount: row._count.partners,
    attendeeCount: row._count.attendees,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The names of the org units a page of activities was hosted by.
 *
 * Resolved in one pass per scope type rather than per row: a page of 25 activities from one
 * club would otherwise be 25 lookups of the same club.
 */
async function hostNames(
  ctx: RequestContext,
  rows: { hostScopeType: string; hostScopeId: string }[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const idsFor = (scopeType: string): string[] => [
    ...new Set(rows.filter((row) => row.hostScopeType === scopeType).map((row) => row.hostScopeId)),
  ];

  const clubIds = idsFor('CLUB');
  const clusterIds = idsFor('CLUSTER');
  const committeeIds = idsFor('COMMITTEE');
  const regionIds = idsFor('REGION');

  const [clubs, clusters, committees, regions] = await Promise.all([
    clubIds.length
      ? db(ctx).clubDistrictAffiliation.findMany({
          where: { clubId: { in: clubIds } },
          select: { clubId: true, club: { select: { name: true } } },
        })
      : [],
    clusterIds.length
      ? db(ctx).cluster.findMany({
          where: { id: { in: clusterIds } },
          select: { id: true, name: true },
        })
      : [],
    committeeIds.length
      ? db(ctx).committee.findMany({
          where: { id: { in: committeeIds } },
          select: { id: true, name: true },
        })
      : [],
    regionIds.length
      ? db(ctx).region.findMany({
          where: { id: { in: regionIds } },
          select: { id: true, name: true },
        })
      : [],
  ]);

  for (const row of clubs) names.set(row.clubId, row.club.name);
  for (const row of [...clusters, ...committees, ...regions]) names.set(row.id, row.name);
  return names;
}

// ─── Validation against the TYPE ─────────────────────────────────────────────

function missingField(key: string, message: string): AppError {
  return new AppError(422, ErrorCode.MISSING_REQUIRED_FIELD_FOR_TYPE, message, { key });
}

/**
 * Whether the caller may host an activity here.
 *
 * Two questions, and both have to be yes. The TYPE must allow this kind of host — a club
 * assembly hosted by a region is not a thing — and the caller's own scope must contain the
 * host. `ctx.scopes` carries region and committee arrays as well as clubs, so a
 * committee-hosted activity is a containment check against `committeeIds`.
 */
function assertHost(ctx: RequestContext, type: ActivityType, input: CreateActivity): void {
  if (!type.allowedHostScopes.includes(input.hostScopeType)) {
    throw new AppError(
      422,
      ErrorCode.SCOPE_TYPE_MISMATCH,
      `A ${type.name} cannot be hosted by a ${input.hostScopeType.toLowerCase()}`,
      { allowedHostScopes: type.allowedHostScopes },
    );
  }

  // 404 rather than 403: the caller is holding an identifier, and confirming it exists
  // hands them the shape of the dataset.
  requireScope(ctx, { scopeType: input.hostScopeType, scopeId: input.hostScopeId });
}

/**
 * Everything the type declares, checked in one place.
 *
 * The `requires_*` flags and `field_config` are read from the TYPE's row, so "extra
 * activities should not require a photo" stays a checkbox rather than becoming a branch
 * here. `details.key` names the field that is missing, so a client can point at it.
 */
function assertTypeRequirements(
  type: ActivityType,
  input: {
    extra?: Record<string, unknown> | undefined;
    narrativeReport?: string | null | undefined;
  },
  counts: { media: number; partners: number; attendees: number; areasOfFocus: number },
): void {
  if (type.requiresPhoto && counts.media === 0) {
    throw missingField('media', `A ${type.name} needs at least one photograph`);
  }
  if (type.requiresReport && !input.narrativeReport?.trim()) {
    throw missingField('narrativeReport', `A ${type.name} needs a written report`);
  }
  if (type.requiresAttendance && counts.attendees === 0) {
    throw missingField('attendees', `A ${type.name} needs an attendance list`);
  }
  if (type.requiresPartner && counts.partners === 0) {
    throw missingField('partners', `A ${type.name} needs a partner organisation`);
  }
  if (type.requiresAreaOfFocus && counts.areasOfFocus === 0) {
    throw missingField('areaOfFocusCodes', `A ${type.name} needs an area of focus`);
  }

  const extra = input.extra ?? {};
  for (const field of type.fieldConfig.fields) {
    if (!field.required) continue;
    const value = extra[field.key];
    if (value === undefined || value === null || value === '') {
      throw missingField(field.key, `${field.label} is required for a ${type.name}`);
    }
  }
}

/**
 * Only the keys the type declares. Anything else is DROPPED rather than stored.
 *
 * `extra` is JSONB and a client can put anything in it. Storing what was sent would make the
 * column an unversioned schema nobody agreed to, and a scoring resolver reading a key that
 * was never declared is a resolver reading whatever one club decided to send.
 *
 * Typed as Prisma's JSON input, because the value has to be serialisable to be stored — and
 * a `Record<string, unknown>` is not, which is the compiler pointing at the same fact.
 */
function pickDeclaredExtra(
  type: ActivityType,
  extra: Record<string, unknown> | undefined,
): Prisma.InputJsonValue {
  if (!extra) return {};
  const declared = new Set(type.fieldConfig.fields.map((field) => field.key));
  return Object.fromEntries(
    Object.entries(extra).filter(([key]) => declared.has(key)),
  ) as Prisma.InputJsonValue;
}

// ─── Reads ───────────────────────────────────────────────────────────────────

export async function list(
  ctx: RequestContext,
  query: ActivityListQuery,
): Promise<{ data: Activity[]; meta: PaginationMeta }> {
  const where = {
    ...(query.activityTypeId ? { activityTypeId: query.activityTypeId } : {}),
    ...(query.category ? { activityType: { category: query.category } } : {}),
    ...(query.hostScopeType ? { hostScopeType: query.hostScopeType } : {}),
    ...(query.hostScopeId ? { hostScopeId: query.hostScopeId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.verification ? { verification: query.verification } : {}),
    ...(query.q ? { title: { contains: query.q, mode: 'insensitive' as const } } : {}),
    ...(query.from || query.to
      ? {
          startsAt: {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
          },
        }
      : {}),
    // A club officer sees their own clubs' activities; a district officer sees everything.
    // A list must not 404 because one row in it is out of scope, so the rows are filtered.
    ...(ctx.scopes.isDistrictWide
      ? {}
      : {
          OR: [
            { hostScopeType: 'CLUB' as const, hostScopeId: { in: [...ctx.scopes.clubIds] } },
            { hostScopeType: 'CLUSTER' as const, hostScopeId: { in: [...ctx.scopes.clusterIds] } },
            { hostScopeType: 'REGION' as const, hostScopeId: { in: [...ctx.scopes.regionIds] } },
            {
              hostScopeType: 'COMMITTEE' as const,
              hostScopeId: { in: [...ctx.scopes.committeeIds] },
            },
          ],
        }),
  };

  const [rows, total] = await Promise.all([
    db(ctx).activity.findMany({
      where,
      select: SELECT,
      orderBy: { startsAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    db(ctx).activity.count({ where }),
  ]);

  const names = await hostNames(ctx, rows);

  return {
    data: (rows as ActivityRow[]).map((row) => serialise(row, names.get(row.hostScopeId) ?? null)),
    meta: { page: query.page, pageSize: query.pageSize, total },
  };
}

export async function get(ctx: RequestContext, id: string): Promise<Activity> {
  const row = await db(ctx).activity.findFirst({ where: { id }, select: SELECT });
  if (!row) throw notFound();

  const typed = row as ActivityRow;
  requireScope(ctx, {
    scopeType: typed.hostScopeType as Activity['hostScopeType'],
    scopeId: typed.hostScopeId,
  });

  const names = await hostNames(ctx, [typed]);
  return serialise(typed, names.get(typed.hostScopeId) ?? null);
}

/** A month, grouped by day. What a planning view shows. */
export async function calendar(
  ctx: RequestContext,
  query: CalendarQuery,
): Promise<{ date: string; activities: Record<string, unknown>[] }[]> {
  const [year, month] = query.month.split('-').map(Number);
  const from = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, 1));
  const to = new Date(Date.UTC(year ?? 0, month ?? 1, 0, 23, 59, 59, 999));

  const page = await list(ctx, {
    page: 1,
    pageSize: 100,
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    ...(query.hostScopeId ? { hostScopeId: query.hostScopeId } : {}),
  });

  const byDay = new Map<string, Record<string, unknown>[]>();
  for (const activity of page.data) {
    const date = activity.startsAt.slice(0, 10);
    const list = byDay.get(date) ?? [];
    list.push({
      id: activity.id,
      title: activity.title,
      activityTypeName: activity.activityTypeName,
      status: activity.status,
      verification: activity.verification,
      hostName: activity.hostName,
    });
    byDay.set(date, list);
  }

  return [...byDay.entries()]
    .map(([date, activities]) => ({ date, activities }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ─── Writes ──────────────────────────────────────────────────────────────────

/**
 * Reports an activity.
 *
 * Idempotent on a client-supplied id: a secretary on a bad connection who taps Submit twice
 * gets one activity, and the second call gets the one that already exists (ADR-006).
 */
export async function create(
  ctx: RequestContext,
  input: CreateActivity,
): Promise<{ activity: Activity; replayed: boolean }> {
  if (input.id) {
    const existing = await db(ctx).activity.findFirst({
      where: { id: input.id },
      select: { id: true },
    });
    if (existing) return { activity: await get(ctx, input.id), replayed: true };
  }

  const type = await types.get(ctx, input.activityTypeId);
  assertHost(ctx, type, input);

  const areaCodes = input.areaOfFocusCodes ?? [];
  // Photographs, partners and attendees are attached AFTER the activity exists — they need
  // its id. So the checks that depend on them run then, and only the ones that can be
  // answered from the body run now.
  assertTypeRequirements(type, input, {
    media: type.requiresPhoto ? 1 : 0,
    partners: type.requiresPartner ? 1 : 0,
    attendees: type.requiresAttendance ? 1 : 0,
    areasOfFocus: areaCodes.length,
  });

  const created = await db(ctx).activity.create({
    data: {
      ...(input.id ? { id: input.id } : {}),
      activityTypeId: input.activityTypeId,
      hostScopeType: input.hostScopeType,
      hostScopeId: input.hostScopeId,
      title: input.title,
      description: input.description ?? null,
      startsAt: new Date(input.startsAt),
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
      venue: input.venue ?? null,
      isVirtual: input.isVirtual ?? false,
      meetingUrl: input.meetingUrl ?? null,
      status: input.status ?? 'HELD',
      themeAlignment: input.themeAlignment ?? null,
      narrativeReport: input.narrativeReport ?? null,
      attendanceMembers: input.attendanceMembers ?? null,
      attendanceVisitors: input.attendanceVisitors ?? null,
      attendanceGuests: input.attendanceGuests ?? null,
      beneficiariesCount: input.beneficiariesCount ?? null,
      treesPlanted: input.treesPlanted ?? null,
      fundsRaised: input.fundsRaised ?? null,
      volunteerHours: input.volunteerHours ?? null,
      extra: pickDeclaredExtra(type, input.extra),
      clientGenerated: Boolean(input.id),
      createdByUserId: ctx.userId === '' ? null : ctx.userId,
    },
  });

  await setAreasOfFocus(ctx, created.id, areaCodes);
  await markScorecardStale(ctx, input.hostScopeType, input.hostScopeId, 'activity reported');

  return { activity: await get(ctx, created.id), replayed: false };
}

async function setAreasOfFocus(
  ctx: RequestContext,
  activityId: string,
  codes: string[],
): Promise<void> {
  if (codes.length === 0) return;

  // `areas_of_focus` is RI's reference data, identical for every district and therefore
  // unscoped — so it comes off the plain client. An unknown code would otherwise attach
  // nothing silently, which for a type that REQUIRES an area of focus is a scored
  // criterion quietly failing.
  const areas = await prisma.areaOfFocus.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true },
  });

  const known = new Set(areas.map((area) => area.code));
  const unknown = codes.filter((code) => !known.has(code));
  if (unknown.length > 0) {
    throw new AppError(422, ErrorCode.INVALID_SCOPE_REFERENCE, 'Unknown area of focus', {
      codes: unknown,
    });
  }

  const attached = await db(ctx).activityAreaOfFocus.findMany({
    where: { activityId },
    select: { areaOfFocusId: true },
  });
  const already = new Set(attached.map((row) => row.areaOfFocusId));

  for (const area of areas) {
    if (already.has(area.id)) continue;
    await db(ctx).activityAreaOfFocus.create({ data: { activityId, areaOfFocusId: area.id } });
  }
}

export async function update(
  ctx: RequestContext,
  id: string,
  input: UpdateActivity,
): Promise<Activity> {
  const existing = await get(ctx, id);

  // A verified activity has been counted. Editing it silently would change a score that
  // somebody has already read; the club must ask for it to be queried first.
  if (existing.verification === 'VERIFIED') {
    throw new AppError(
      422,
      ErrorCode.PERIOD_CLOSED,
      'This activity has been verified. Ask the district to query it before editing.',
      { activityId: id },
    );
  }

  const type = await types.get(ctx, existing.activityTypeId);

  if (input.hostScopeType || input.hostScopeId) {
    assertHost(ctx, type, {
      activityTypeId: existing.activityTypeId,
      hostScopeType: input.hostScopeType ?? existing.hostScopeType,
      hostScopeId: input.hostScopeId ?? existing.hostScopeId,
      title: existing.title,
      startsAt: existing.startsAt,
    });
  }

  const data: Record<string, unknown> = {};
  const assign = (key: string, value: unknown): void => {
    if (value !== undefined) data[key] = value;
  };

  assign('hostScopeType', input.hostScopeType);
  assign('hostScopeId', input.hostScopeId);
  assign('title', input.title);
  assign('description', input.description);
  assign('startsAt', input.startsAt ? new Date(input.startsAt) : undefined);
  assign(
    'endsAt',
    input.endsAt === undefined ? undefined : input.endsAt === null ? null : new Date(input.endsAt),
  );
  assign('venue', input.venue);
  assign('isVirtual', input.isVirtual);
  assign('meetingUrl', input.meetingUrl);
  assign('status', input.status);
  assign('themeAlignment', input.themeAlignment);
  assign('narrativeReport', input.narrativeReport);
  assign('attendanceMembers', input.attendanceMembers);
  assign('attendanceVisitors', input.attendanceVisitors);
  assign('attendanceGuests', input.attendanceGuests);
  assign('beneficiariesCount', input.beneficiariesCount);
  assign('treesPlanted', input.treesPlanted);
  assign('fundsRaised', input.fundsRaised);
  assign('volunteerHours', input.volunteerHours);
  if (input.extra !== undefined) {
    data['extra'] = pickDeclaredExtra(type, { ...existing.extra, ...input.extra });
  }

  // A QUERIED activity that has been edited is a resubmission, so it goes back into the
  // queue rather than staying flagged.
  if (existing.verification === 'QUERIED') data['verification'] = 'UNVERIFIED';

  if (Object.keys(data).length > 0) {
    await db(ctx).activity.updateMany({ where: { id }, data });
  }
  if (input.areaOfFocusCodes) await setAreasOfFocus(ctx, id, input.areaOfFocusCodes);

  await markScorecardStale(ctx, existing.hostScopeType, existing.hostScopeId, 'activity edited');
  return get(ctx, id);
}

/** Soft. A deleted activity is one the scoring engine must stop counting, not one that never happened. */
export async function remove(ctx: RequestContext, id: string): Promise<void> {
  const existing = await get(ctx, id);

  await db(ctx).activity.updateMany({ where: { id }, data: { deletedAt: new Date() } });
  await markScorecardStale(ctx, existing.hostScopeType, existing.hostScopeId, 'activity deleted');
}

/**
 * Verify, query or reject.
 *
 * QUERY is what makes this two-way rather than write-only. A club that files something
 * incomplete gets a comment and a chance to fix it; a system whose only options are accept
 * and reject is a system clubs learn to argue with rather than use.
 */
export async function verify(
  ctx: RequestContext,
  id: string,
  input: VerifyActivity,
): Promise<Activity> {
  const existing = await get(ctx, id);

  if (input.decision !== 'VERIFY' && !input.comment?.trim()) {
    throw new AppError(
      422,
      ErrorCode.VALIDATION_ERROR,
      'Say why. A query or rejection with no reason is one the club cannot act on.',
      { field: 'comment' },
    );
  }

  const verification =
    input.decision === 'VERIFY' ? 'VERIFIED' : input.decision === 'QUERY' ? 'QUERIED' : 'REJECTED';

  await db(ctx).activity.updateMany({
    where: { id },
    data: {
      verification,
      verifiedAt: new Date(),
      verifiedByUserId: ctx.userId === '' ? null : ctx.userId,
    },
  });

  // The comment reaches the club through a notification rather than a column: there is no
  // activity_comments table, and adding one for a single string is a schema change that
  // belongs with M5's dispute surface, where comments already have a home.
  if (input.comment) {
    console.log(`[activity] ${verification} ${id}: ${input.comment}`);
  }

  await markScorecardStale(ctx, existing.hostScopeType, existing.hostScopeId, 'activity verified');
  return get(ctx, id);
}

// ─── Partners and attendees ──────────────────────────────────────────────────

export async function addPartner(
  ctx: RequestContext,
  activityId: string,
  input: AddPartner,
): Promise<Partner> {
  await get(ctx, activityId);

  const created = await db(ctx).activityPartner.create({
    data: {
      activityId,
      partnerType: input.partnerType,
      partnerClubId: input.partnerClubId ?? null,
      partnerOrgName: input.partnerOrgName ?? null,
      // NOT NULL with a domestic default, so the international-service derivation is total
      // and conservative. A partner whose country nobody recorded is domestic.
      countryCode: input.countryCode,
      contributionNote: input.contributionNote ?? null,
    },
  });

  return {
    id: created.id,
    partnerType: created.partnerType,
    partnerClubId: created.partnerClubId,
    partnerOrgName: created.partnerOrgName,
    countryCode: created.countryCode,
    contributionNote: created.contributionNote,
    isInternational: created.countryCode !== 'UG',
  };
}

export async function listPartners(ctx: RequestContext, activityId: string): Promise<Partner[]> {
  await get(ctx, activityId);

  const rows = await db(ctx).activityPartner.findMany({ where: { activityId } });
  return rows.map((row) => ({
    id: row.id,
    partnerType: row.partnerType,
    partnerClubId: row.partnerClubId,
    partnerOrgName: row.partnerOrgName,
    countryCode: row.countryCode,
    contributionNote: row.contributionNote,
    isInternational: row.countryCode !== 'UG',
  }));
}

/** Bulk, and idempotent: re-posting the same list adds nobody twice. */
export async function addAttendees(
  ctx: RequestContext,
  activityId: string,
  input: AddAttendees,
): Promise<{ added: number }> {
  const activity = await get(ctx, activityId);

  const existing = await db(ctx).activityAttendee.findMany({
    where: { activityId },
    select: { personId: true },
  });
  const already = new Set(existing.map((row) => row.personId));
  const fresh = input.attendees.filter((attendee) => !already.has(attendee.personId));

  for (const attendee of fresh) {
    await db(ctx).activityAttendee.create({
      data: { activityId, personId: attendee.personId, role: attendee.role },
    });
  }

  await markScorecardStale(
    ctx,
    activity.hostScopeType,
    activity.hostScopeId,
    'attendance recorded',
  );
  return { added: fresh.length };
}

/**
 * Tells `assessment` the club's scorecard is out of date.
 *
 * A NOTIFICATION, not a query: it takes ids and returns nothing, and `modules/activity`
 * learns nothing about `club_assessments`. The function is a no-op until M5, which is the
 * point — M5 fills in a body rather than going back through this module adding call sites.
 */
async function markScorecardStale(
  ctx: RequestContext,
  hostScopeType: string,
  hostScopeId: string,
  reason: string,
): Promise<void> {
  // Only a club has a scorecard. A cluster or committee activity affects the clubs that
  // took part, which is an attendance question M5 answers rather than one this knows.
  if (hostScopeType !== 'CLUB') return;
  await assessment.markStale(ctx, { clubId: hostScopeId, reason });
}

/**
 * Activities this club HOSTED in the context's Rotary Year. Called by `org` for a club
 * summary, through this service rather than by querying `activities` directly.
 */
export interface ClubActivityCounts {
  total: number;
  verified: number;
  unverified: number;
}

export async function countForClub(
  ctx: RequestContext,
  clubId: string,
): Promise<ClubActivityCounts> {
  const rows = await db(ctx).activity.groupBy({
    by: ['verification'],
    where: { hostScopeType: 'CLUB', hostScopeId: clubId },
    _count: { _all: true },
  });

  let total = 0;
  let verified = 0;

  for (const row of rows) {
    const count = row._count._all;
    total += count;
    if (row.verification === 'VERIFIED') verified += count;
  }

  // QUERIED and REJECTED count as unverified rather than getting their own field: the
  // question a club profile answers is "how much of what we reported has been accepted".
  return { total, verified, unverified: total - verified };
}

/** True when the caller may verify — used by the UI gate and by nothing security-bearing. */
export function mayVerify(ctx: RequestContext, activity: Activity): boolean {
  return (
    ctx.permissions.has('activity:verify:district') &&
    hasScope(ctx, { scopeType: activity.hostScopeType, scopeId: activity.hostScopeId })
  );
}
