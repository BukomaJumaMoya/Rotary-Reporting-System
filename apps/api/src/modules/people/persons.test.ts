import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  personExportResponseSchema,
  personListResponseSchema,
  personResponseSchema,
  personVisibilityResponseSchema,
} from '@dis/contracts';
import { createApp } from '../../app.js';
import { unscopedPrisma } from '../../platform/db.js';
import { systemContext } from '../../platform/system-context.js';
import {
  appoint,
  createClubIn,
  createOrg,
  createPosition,
  createUser,
  errorBody,
  resetDatabase,
  signIn,
  type OrgFixture,
  type SeededUser,
} from '../../test/helpers.js';
import * as people from './service.js';
import { serialisePerson } from './serialiser.js';

/**
 * Persons, visibility and subject access.
 *
 * The predecessor system published ~4,000 members' names, photos, phone numbers, emails,
 * genders and residential areas on an unauthenticated page. Every assertion here exists
 * because of that, and the one that matters most is the LAST group: a person nested inside
 * another module's response is serialised under the same rules. Contact data leaks through
 * relations, not through the endpoint anybody reviews.
 */

async function member(
  org: OrgFixture,
  clubId: string,
  overrides: Record<string, unknown> = {},
): Promise<{ personId: string }> {
  const person = await unscopedPrisma.person.create({
    data: {
      firstName: 'Ann',
      lastName: 'Nakato',
      email: `ann-${randomUUID()}@example.org`,
      phone: '+256700000000',
      altPhone: '+256750000000',
      city: 'Kampala',
      gender: 'F',
      dateOfBirth: new Date('1999-04-02'),
      occupation: 'Architect',
      ...overrides,
    },
    select: { id: true },
  });

  // JOIN plus a roster refresh: the roster is a materialised view over the event log, and
  // nothing writes to it directly (axiom 3).
  await unscopedPrisma.membershipEvent.create({
    data: {
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      personId: person.id,
      clubId,
      eventType: 'JOIN',
      effectiveOn: new Date('2027-07-01'),
    },
  });
  await unscopedPrisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW club_rosters');

  return { personId: person.id };
}

async function signInAs(
  app: Express,
  org: OrgFixture,
  options: { permissions: string[]; scopeType?: 'DISTRICT' | 'CLUB'; scopeId?: string },
): Promise<{ agent: Awaited<ReturnType<typeof signIn>>; user: SeededUser }> {
  const user = await createUser();
  const position = await createPosition({
    districtId: org.districtId,
    scope: options.scopeType ?? 'DISTRICT',
    permissions: options.permissions,
  });
  await appoint({
    personId: user.personId,
    districtId: org.districtId,
    rotaryYearId: org.currentYearId,
    positionId: position.id,
    scopeType: options.scopeType ?? 'DISTRICT',
    scopeId: options.scopeId ?? null,
  });
  return { agent: await signIn(app, user), user };
}

describe('persons', () => {
  let app: Express;
  let org: OrgFixture;

  beforeEach(async () => {
    await resetDatabase();
    app = createApp();
    org = await createOrg();
  });

  it('withholds every contact field by default', async () => {
    const club = await createClubIn(org);
    const { personId } = await member(org, club.id);
    const { agent } = await signInAs(app, org, { permissions: ['person:read:club'] });

    const response = await agent.get(`/api/v1/persons/${personId}`);

    expect(response.status).toBe(200);
    const person = personResponseSchema.parse(response.body).data;

    // ABSENT, not null. A field that is always present and sometimes empty is one a client
    // renders as a blank line and a developer later assumes is nullable in the database.
    expect(person).not.toHaveProperty('email');
    expect(person).not.toHaveProperty('phone');
    expect(person).not.toHaveProperty('city');
    expect(person).not.toHaveProperty('dateOfBirth');
    expect(person).not.toHaveProperty('gender');
    // Photo and occupation default OPEN to an authenticated district caller.
    expect(person).toHaveProperty('occupation');
    expect(person.isRedacted).toBe(true);
    expect(person.firstName).toBe('Ann');
  });

  it('honours a flag the member has turned on', async () => {
    const club = await createClubIn(org);
    const { personId } = await member(org, club.id);
    await unscopedPrisma.personVisibility.update({
      where: { personId },
      data: { showPhone: true },
    });

    const { agent } = await signInAs(app, org, { permissions: ['person:read:club'] });
    const person = personResponseSchema.parse(
      (await agent.get(`/api/v1/persons/${personId}`)).body,
    ).data;

    expect(person.phone).toBe('+256700000000');
    // The flag covers both numbers, which is what a member choosing "show my phone" means.
    expect(person.altPhone).toBe('+256750000000');
    expect(person).not.toHaveProperty('email');
  });

  it('treats a person with NO visibility row as fully closed', async () => {
    const club = await createClubIn(org);
    const { personId } = await member(org, club.id);
    // The trigger makes this impossible in practice. The serialiser must still fail closed
    // for a caller that simply did not select the relation — defaulting open there is the
    // exact failure this project exists to correct.
    await unscopedPrisma.personVisibility.delete({ where: { personId } });

    const { agent } = await signInAs(app, org, { permissions: ['person:read:club'] });
    const person = personResponseSchema.parse(
      (await agent.get(`/api/v1/persons/${personId}`)).body,
    ).data;

    expect(person).not.toHaveProperty('email');
    expect(person).not.toHaveProperty('occupation');
    expect(person).not.toHaveProperty('photoUrl');
  });

  it('opens contact to a holder of person:read:contact within their scope', async () => {
    const mine = await createClubIn(org, 'Rotaract Club of Mine');
    const other = await createClubIn(org, 'Rotaract Club of Other');
    const ours = await member(org, mine.id);
    const theirs = await member(org, other.id);

    const { agent } = await signInAs(app, org, {
      permissions: ['person:read:club', 'person:read:contact'],
      scopeType: 'CLUB',
      scopeId: mine.id,
    });

    const visible = personResponseSchema.parse(
      (await agent.get(`/api/v1/persons/${ours.personId}`)).body,
    ).data;
    expect(visible.email).toBeTruthy();
    expect(visible.phone).toBe('+256700000000');

    // Another club's member: the permission is bounded by SCOPE, which is exactly what
    // makes it safe to give a club secretary. Out of scope entirely, so 404.
    const hidden = await agent.get(`/api/v1/persons/${theirs.personId}`);
    expect(hidden.status).toBe(404);
  });

  it('shows a member their own record in full', async () => {
    const club = await createClubIn(org);
    const { agent, user } = await signInAs(app, org, { permissions: ['person:read:club'] });
    await member(org, club.id, { id: undefined });

    // The signed-in member's own person row, with contact details on it.
    await unscopedPrisma.person.update({
      where: { id: user.personId },
      data: { phone: '+256711111111', city: 'Jinja' },
    });

    const person = personResponseSchema.parse(
      (await agent.get(`/api/v1/persons/${user.personId}`)).body,
    ).data;

    expect(person.phone).toBe('+256711111111');
    expect(person.city).toBe('Jinja');
    expect(person.isRedacted).toBe(false);
  });
});

describe('visibility', () => {
  let app: Express;
  let org: OrgFixture;

  beforeEach(async () => {
    await resetDatabase();
    app = createApp();
    org = await createOrg();
  });

  it('lets a member change their own flags', async () => {
    const { agent, user } = await signInAs(app, org, { permissions: ['person:read:club'] });

    const response = await agent
      .patch(`/api/v1/persons/${user.personId}/visibility`)
      .send({ showPhone: true, showCity: true });

    expect(response.status).toBe(200);
    const visibility = personVisibilityResponseSchema.parse(response.body).data;
    expect(visibility.showPhone).toBe(true);
    expect(visibility.showCity).toBe(true);
    expect(visibility.showEmail).toBe(false);
  });

  it('refuses to change anybody else’s, whatever the caller holds', async () => {
    const club = await createClubIn(org);
    const { personId } = await member(org, club.id);
    // Every district permission there is. None of them opens this door.
    const { agent } = await signInAs(app, org, {
      permissions: [
        'person:read:club',
        'person:read:contact',
        'person:update:club',
        'user:manage:district',
      ],
    });

    const response = await agent
      .patch(`/api/v1/persons/${personId}/visibility`)
      .send({ showEmail: true });

    // 404, not 403: for this purpose the record is not theirs to know exists.
    expect(response.status).toBe(404);
    const row = await unscopedPrisma.personVisibility.findUnique({ where: { personId } });
    expect(row?.showEmail).toBe(false);
  });
});

describe('subject access and erasure', () => {
  let app: Express;
  let org: OrgFixture;

  beforeEach(async () => {
    await resetDatabase();
    app = createApp();
    org = await createOrg();
  });

  it('exports the member’s own record, with their events and appointments', async () => {
    const club = await createClubIn(org);
    const { agent, user } = await signInAs(app, org, { permissions: ['person:read:club'] });

    await unscopedPrisma.membershipEvent.create({
      data: {
        districtId: org.districtId,
        rotaryYearId: org.currentYearId,
        personId: user.personId,
        clubId: club.id,
        eventType: 'JOIN',
        effectiveOn: new Date('2027-07-01'),
      },
    });

    const response = await agent.get(`/api/v1/persons/${user.personId}/export`);

    expect(response.status).toBe(200);
    const dump = personExportResponseSchema.parse(response.body).data;
    expect(dump.person.id).toBe(user.personId);
    // The actual rows, so a member can check them — not a summary.
    expect(dump.membershipEvents).toHaveLength(1);
    expect(dump.membershipEvents[0]?.clubName).toBe(club.name);
    expect(dump.appointments).toHaveLength(1);
    expect(dump.visibility).not.toBeNull();
  });

  it('refuses an export of somebody else’s record', async () => {
    const club = await createClubIn(org);
    const { personId } = await member(org, club.id);
    const { agent } = await signInAs(app, org, {
      permissions: ['person:read:club', 'person:read:contact'],
    });

    // There is deliberately no administrative version of this endpoint: a one-call dump of
    // somebody else's entire record is the export that ends up in a WhatsApp group.
    expect((await agent.get(`/api/v1/persons/${personId}/export`)).status).toBe(404);
  });

  it('reviews an erasure, then anonymises without deleting', async () => {
    const club = await createClubIn(org);
    const { agent, user } = await signInAs(app, org, { permissions: ['person:read:club'] });

    await unscopedPrisma.membershipEvent.create({
      data: {
        districtId: org.districtId,
        rotaryYearId: org.currentYearId,
        personId: user.personId,
        clubId: club.id,
        eventType: 'JOIN',
        effectiveOn: new Date('2027-07-01'),
      },
    });

    const requested = await agent
      .post(`/api/v1/persons/${user.personId}/erasure`)
      .send({ reason: 'Leaving Rotaract' });
    expect(requested.status).toBe(201);
    const requestId = (requested.body as { data: { id: string; status: string } }).data.id;
    expect((requested.body as { data: { status: string } }).data.status).toBe('PENDING');

    // Asking twice is asking once.
    const again = await agent.post(`/api/v1/persons/${user.personId}/erasure`).send({});
    expect((again.body as { data: { id: string } }).data.id).toBe(requestId);

    const { agent: reviewer } = await signInAs(app, org, {
      permissions: ['person:erase:district'],
    });
    const reviewed = await reviewer
      .post(`/api/v1/erasure-requests/${requestId}/review`)
      .send({ decision: 'APPROVE', note: 'Confirmed by phone' });
    expect(reviewed.status).toBe(200);
    expect((reviewed.body as { data: { status: string } }).data.status).toBe('APPROVED');

    // The job does the work. Run its body directly: the queue is proven in queue.test.ts,
    // and what matters here is that erasure ANONYMISES rather than deletes.
    const ctx = await systemContext({
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      reason: 'test erasure',
    });
    expect(await people.performErasure(ctx, requestId)).toBe(true);

    const person = await unscopedPrisma.person.findUnique({ where: { id: user.personId } });
    expect(person).not.toBeNull();
    expect(person?.firstName).toBe('Former');
    expect(person?.lastName).toBe('member');
    expect(person?.email).toBeNull();
    expect(person?.phone).toBeNull();

    // The event log survives. A club's retention rate for 2027-28 is a fact about the club
    // and must not change retroactively because a member left in 2029.
    const events = await unscopedPrisma.membershipEvent.findMany({
      where: { personId: user.personId },
    });
    expect(events).toHaveLength(1);
  });

  it('refuses an erasure request for somebody else', async () => {
    const club = await createClubIn(org);
    const { personId } = await member(org, club.id);
    const { agent } = await signInAs(app, org, { permissions: ['person:erase:district'] });

    expect((await agent.post(`/api/v1/persons/${personId}/erasure`).send({})).status).toBe(404);
  });
});

/**
 * THE IMPORTANT ONE.
 *
 * Every module that returns a person calls `serialisePerson`. This proves the function
 * itself holds the line for a record nested inside somebody else's response — which is
 * where a leak actually happens, because it is the endpoint nobody was reviewing.
 */
describe('the one serialiser, applied to a nested person', () => {
  let org: OrgFixture;

  beforeEach(async () => {
    await resetDatabase();
    org = await createOrg();
  });

  it('withholds contact fields from a person nested in another module’s response', async () => {
    const club = await createClubIn(org);
    const { personId } = await member(org, club.id);

    const record = await unscopedPrisma.person.findUniqueOrThrow({
      where: { id: personId },
      include: { visibility: true },
    });

    const base = await systemContext({
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      reason: 'test',
    });
    // A system context reads the permission CATALOGUE, which is reference data the seed
    // inserts and `resetDatabase` truncates — so it is empty here. Named explicitly, so
    // this is the most privileged caller the system has rather than an accident of
    // whichever permissions a fixture happened to create.
    const ctx = { ...base, permissions: new Set(['person:read:contact']) };
    const privileged = serialisePerson(ctx, record);
    expect(privileged.email).toBeTruthy();

    // The realistic nested case: an activity's attendees, serialised by a caller whose
    // scope was never checked against the attendee's club. `rosterClubIds` defaults to
    // empty and the flags decide, which is the safe direction.
    const clubScoped = {
      ...ctx,
      scopes: { ...ctx.scopes, isDistrictWide: false, clubIds: [club.id] },
    };
    const nested = serialisePerson(clubScoped, record);
    expect(nested).not.toHaveProperty('email');
    expect(nested).not.toHaveProperty('phone');
    expect(nested.isRedacted).toBe(true);

    // Told which clubs the person is on, the same caller does see them — that is what
    // `person:read:contact` within scope means.
    const withScope = serialisePerson(clubScoped, record, { rosterClubIds: [club.id] });
    expect(withScope.email).toBeTruthy();
  });

  it('never returns a contact field to a caller without the permission', async () => {
    const club = await createClubIn(org);
    const { personId } = await member(org, club.id);

    const record = await unscopedPrisma.person.findUniqueOrThrow({
      where: { id: personId },
      include: { visibility: true },
    });

    const ctx = await systemContext({
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      reason: 'test',
    });
    const withoutPermission = { ...ctx, permissions: new Set<string>(['person:read:club']) };

    const person = serialisePerson(withoutPermission, record, { rosterClubIds: [club.id] });
    expect(person).not.toHaveProperty('email');
    expect(person).not.toHaveProperty('phone');
    expect(person).not.toHaveProperty('city');
    expect(person).not.toHaveProperty('dateOfBirth');
  });
});

describe('the person list', () => {
  let app: Express;
  let org: OrgFixture;

  beforeEach(async () => {
    await resetDatabase();
    app = createApp();
    org = await createOrg();
  });

  it('is scoped through the roster, so a club officer sees their own members', async () => {
    const mine = await createClubIn(org, 'Rotaract Club of Mine');
    const other = await createClubIn(org, 'Rotaract Club of Other');
    const ours = await member(org, mine.id);
    await member(org, other.id);

    const { agent } = await signInAs(app, org, {
      permissions: ['person:read:club'],
      scopeType: 'CLUB',
      scopeId: mine.id,
    });

    const body = personListResponseSchema.parse((await agent.get('/api/v1/persons')).body);
    expect(body.data.map((person) => person.id)).toEqual([ours.personId]);
  });

  it('refuses a list filtered to a club outside the caller’s scope', async () => {
    const mine = await createClubIn(org, 'Rotaract Club of Mine');
    const other = await createClubIn(org, 'Rotaract Club of Other');

    const { agent } = await signInAs(app, org, {
      permissions: ['person:read:club'],
      scopeType: 'CLUB',
      scopeId: mine.id,
    });

    const response = await agent.get('/api/v1/persons').query({ clubId: other.id });
    expect(response.status).toBe(404);
    expect(errorBody(response).code).toBe('NOT_FOUND');
  });
});
