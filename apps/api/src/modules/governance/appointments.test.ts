import {
  appointmentListResponseSchema,
  appointmentResponseSchema,
  meResponseSchema,
} from '@dis/contracts';
import type TestAgent from 'supertest/lib/agent.js';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app.js';
import { prisma, unscopedPrisma } from '../../platform/db.js';
import { closeSessionPool } from '../../platform/session.js';
import {
  appoint,
  assignClubToCluster,
  createCluster,
  createClub,
  createClubIn,
  createCommittee,
  createOrg,
  createPosition,
  createRegion,
  createUser,
  errorBody,
  resetDatabase,
  signIn,
  type OrgFixture,
  type SeededUser,
} from '../../test/helpers.js';

/**
 * Appointments — the unit of authorisation.
 *
 * `scope_id` is a bare UUID rather than a foreign key, because it may name a club,
 * cluster, region or committee. That is the one place the schema trades referential
 * integrity for polymorphism, and these tests are the other half of the trade.
 */

const app = createApp();

let org: OrgFixture;
let admin: TestAgent;

async function signInAsAdmin(): Promise<TestAgent> {
  const user = await createUser();
  const position = await createPosition({
    districtId: org.districtId,
    code: 'DES',
    scope: 'DISTRICT',
    permissions: ['appointment:manage:district', 'appointment:read:district'],
  });
  await appoint({
    personId: user.personId,
    districtId: org.districtId,
    rotaryYearId: org.currentYearId,
    positionId: position.id,
    scopeType: 'DISTRICT',
  });
  return signIn(app, user);
}

beforeEach(async () => {
  await resetDatabase();
  org = await createOrg();
  await unscopedPrisma.permission.createMany({
    data: [
      { code: 'appointment:manage:district', description: 'Appoint officers' },
      { code: 'appointment:read:district', description: 'Read appointments' },
      { code: 'activity:create:club', description: 'Report an activity' },
      { code: 'finance:read:club', description: 'View club finance' },
      { code: 'assessment:score:assigned', description: 'Score assigned parameters' },
    ],
    skipDuplicates: true,
  });
  admin = await signInAsAdmin();
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeSessionPool();
});

describe('POST /appointments', () => {
  it('appoints a person to a club position', async () => {
    const person = await createUser();
    const club = await createClubIn(org, 'Rotaract Club of Kampala');
    const position = await createPosition({
      districtId: org.districtId,
      code: 'CLUB_SECRETARY',
      scope: 'CLUB',
      permissions: ['activity:create:club'],
    });

    const response = await admin.post('/api/v1/appointments').send({
      personId: person.personId,
      positionId: position.id,
      scopeType: 'CLUB',
      scopeId: club.id,
      startsOn: '2027-07-01',
      endsOn: '2028-06-30',
    });

    expect(response.status).toBe(201);
    const { data } = appointmentResponseSchema.parse(response.body);

    expect(data.positionCode).toBe('CLUB_SECRETARY');
    expect(data.scopeName).toBe('Rotaract Club of Kampala');
    // The year came from the context, not the body — there is no field for it.
    expect(data.rotaryYearId).toBe(org.currentYearId);
    expect(data.isActive).toBe(true);
  });

  it('refuses a scope type the position is not defined at', async () => {
    const person = await createUser();
    const position = await createPosition({
      districtId: org.districtId,
      code: 'CLUB_SECRETARY',
      scope: 'CLUB',
    });

    const response = await admin.post('/api/v1/appointments').send({
      personId: person.personId,
      positionId: position.id,
      scopeType: 'DISTRICT',
      startsOn: '2027-07-01',
    });

    // A club role appointed district-wide would carry club permissions across every club,
    // which is not a mistake anybody would spot in a list.
    expect(response.status).toBe(422);
    expect(errorBody(response).code).toBe('SCOPE_TYPE_MISMATCH');
  });

  it('refuses a scope id that names no such record', async () => {
    const person = await createUser();
    const position = await createPosition({
      districtId: org.districtId,
      code: 'CLUB_SECRETARY',
      scope: 'CLUB',
    });

    const response = await admin.post('/api/v1/appointments').send({
      personId: person.personId,
      positionId: position.id,
      scopeType: 'CLUB',
      scopeId: '00000000-0000-4000-8000-00000000dead',
      startsOn: '2027-07-01',
    });

    expect(response.status).toBe(422);
    expect(errorBody(response).code).toBe('INVALID_SCOPE_REFERENCE');
  });

  it("refuses a club that is not this district's this year", async () => {
    const other = await createOrg();
    const person = await createUser();
    const theirClub = await createClub();
    // Affiliated to the OTHER district, so it exists globally and is not ours.
    await unscopedPrisma.clubDistrictAffiliation.create({
      data: {
        clubId: theirClub.id,
        districtId: other.districtId,
        rotaryYearId: other.currentYearId,
        tier: 'T1',
      },
    });

    const position = await createPosition({
      districtId: org.districtId,
      code: 'CLUB_SECRETARY',
      scope: 'CLUB',
    });

    const response = await admin.post('/api/v1/appointments').send({
      personId: person.personId,
      positionId: position.id,
      scopeType: 'CLUB',
      scopeId: theirClub.id,
      startsOn: '2027-07-01',
    });

    // Clubs are global; affiliation is what makes one ours, for a year (axiom 2).
    expect(response.status).toBe(422);
    expect(errorBody(response).code).toBe('INVALID_SCOPE_REFERENCE');
  });

  it('accepts cluster, region and committee scopes', async () => {
    const region = await createRegion(org.districtId);
    const cluster = await createCluster({
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      regionId: region.id,
    });
    const committee = await createCommittee({
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
    });

    for (const [scopeType, scopeId, code] of [
      ['CLUSTER', cluster.id, 'ADRR'],
      ['REGION', region.id, 'LDRR'],
      ['COMMITTEE', committee.id, 'COMMITTEE_CHAIR'],
    ] as const) {
      const person = await createUser();
      const position = await createPosition({ districtId: org.districtId, code, scope: scopeType });

      const response = await admin.post('/api/v1/appointments').send({
        personId: person.personId,
        positionId: position.id,
        scopeType,
        scopeId,
        startsOn: '2027-07-01',
      });

      expect(response.status, `${scopeType} appointment`).toBe(201);
      expect(appointmentResponseSchema.parse(response.body).data.scopeName).not.toBeNull();
    }
  });

  it('requires a district appointment to name no scope id, and others to name one', async () => {
    const person = await createUser();
    const districtPosition = await createPosition({
      districtId: org.districtId,
      code: 'DRR',
      scope: 'DISTRICT',
    });
    const clubPosition = await createPosition({
      districtId: org.districtId,
      code: 'CLUB_PRESIDENT',
      scope: 'CLUB',
    });
    const club = await createClubIn(org);

    const districtWithScope = await admin.post('/api/v1/appointments').send({
      personId: person.personId,
      positionId: districtPosition.id,
      scopeType: 'DISTRICT',
      scopeId: club.id,
      startsOn: '2027-07-01',
    });
    expect(districtWithScope.status).toBe(422);

    const clubWithout = await admin.post('/api/v1/appointments').send({
      personId: person.personId,
      positionId: clubPosition.id,
      scopeType: 'CLUB',
      startsOn: '2027-07-01',
    });
    expect(clubWithout.status).toBe(422);
    expect(errorBody(clubWithout).code).toBe('INVALID_SCOPE_REFERENCE');
  });

  it('refuses a second holder of a unique-per-scope position', async () => {
    const club = await createClubIn(org);
    const position = await createPosition({
      districtId: org.districtId,
      code: 'CLUB_PRESIDENT',
      scope: 'CLUB',
    });
    await unscopedPrisma.position.update({
      where: { id: position.id },
      data: { isUniquePerScope: true },
    });

    const first = await createUser();
    const second = await createUser();
    const body = (personId: string) => ({
      personId,
      positionId: position.id,
      scopeType: 'CLUB' as const,
      scopeId: club.id,
      startsOn: '2027-07-01',
    });

    expect((await admin.post('/api/v1/appointments').send(body(first.personId))).status).toBe(201);

    const clash = await admin.post('/api/v1/appointments').send(body(second.personId));
    expect(clash.status).toBe(409);
    expect(errorBody(clash).code).toBe('POSITION_ALREADY_HELD');
    expect(errorBody(clash).details).toMatchObject({ activeHolders: 1 });
  });

  it('allows the replacement once the first holder is revoked', async () => {
    const club = await createClubIn(org);
    const position = await createPosition({
      districtId: org.districtId,
      code: 'CLUB_PRESIDENT',
      scope: 'CLUB',
    });
    await unscopedPrisma.position.update({
      where: { id: position.id },
      data: { isUniquePerScope: true },
    });

    const outgoing = await createUser();
    const incoming = await createUser();
    const created = await admin.post('/api/v1/appointments').send({
      personId: outgoing.personId,
      positionId: position.id,
      scopeType: 'CLUB',
      scopeId: club.id,
      startsOn: '2027-07-01',
    });
    const id = appointmentResponseSchema.parse(created.body).data.id;

    await admin.delete(`/api/v1/appointments/${id}`).expect(200);

    // Uniqueness counts ACTIVE rows only. A partial unique index over a mutable flag
    // would have refused exactly the replacement the revocation exists to make room for.
    const replacement = await admin.post('/api/v1/appointments').send({
      personId: incoming.personId,
      positionId: position.id,
      scopeType: 'CLUB',
      scopeId: club.id,
      startsOn: '2027-07-01',
    });
    expect(replacement.status).toBe(201);
  });

  it('allows one person to hold several appointments at once', async () => {
    const person = await createUser();
    const club = await createClubIn(org);
    const secretary = await createPosition({
      districtId: org.districtId,
      code: 'CLUB_SECRETARY',
      scope: 'CLUB',
    });
    const assessor = await createPosition({
      districtId: org.districtId,
      code: 'ASSESSOR',
      scope: 'DISTRICT',
    });

    const first = await admin.post('/api/v1/appointments').send({
      personId: person.personId,
      positionId: secretary.id,
      scopeType: 'CLUB',
      scopeId: club.id,
      startsOn: '2027-07-01',
    });
    const second = await admin.post('/api/v1/appointments').send({
      personId: person.personId,
      positionId: assessor.id,
      scopeType: 'DISTRICT',
      startsOn: '2027-07-01',
    });

    // Normal in Rotaract, and the reason permissions are unioned rather than chosen.
    expect([first.status, second.status]).toEqual([201, 201]);
  });

  it('rejects a term that ends before it starts', async () => {
    const person = await createUser();
    const position = await createPosition({
      districtId: org.districtId,
      code: 'DRR',
      scope: 'DISTRICT',
    });

    const response = await admin.post('/api/v1/appointments').send({
      personId: person.personId,
      positionId: position.id,
      scopeType: 'DISTRICT',
      startsOn: '2028-06-30',
      endsOn: '2027-07-01',
    });

    expect(response.status).toBe(422);
  });
});

describe('the permission and scope union', () => {
  /** Two appointments, one club and one cluster, held by the same person. */
  async function seedDoubleHatted(): Promise<{
    user: SeededUser;
    clubIds: string[];
    clusterId: string;
  }> {
    const user = await createUser();
    const ownClub = await createClubIn(org);
    const clusterClub = await createClubIn(org);
    const cluster = await createCluster({
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
    });
    await assignClubToCluster({
      clubId: clusterClub.id,
      clusterId: cluster.id,
      rotaryYearId: org.currentYearId,
    });

    const secretary = await createPosition({
      districtId: org.districtId,
      code: 'CLUB_SECRETARY',
      scope: 'CLUB',
      permissions: ['activity:create:club', 'finance:read:club'],
    });
    const adrr = await createPosition({
      districtId: org.districtId,
      code: 'ADRR',
      scope: 'CLUSTER',
      permissions: ['assessment:score:assigned', 'finance:read:club'],
    });

    await appoint({
      personId: user.personId,
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      positionId: secretary.id,
      scopeType: 'CLUB',
      scopeId: ownClub.id,
    });
    await appoint({
      personId: user.personId,
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      positionId: adrr.id,
      scopeType: 'CLUSTER',
      scopeId: cluster.id,
    });

    return { user, clubIds: [ownClub.id, clusterClub.id], clusterId: cluster.id };
  }

  it('unions permissions and accumulates scopes across two appointments', async () => {
    const { user, clubIds, clusterId } = await seedDoubleHatted();
    const agent = await signIn(app, user);

    const me = meResponseSchema.parse((await agent.get('/api/v1/auth/me')).body).data;

    // The union, de-duplicated: finance:read:club comes from both.
    expect(me.context.permissions).toEqual([
      'activity:create:club',
      'assessment:score:assigned',
      'finance:read:club',
    ]);
    // The club they are secretary of, plus every club in the cluster they assist.
    expect(me.context.scopes.clubIds.sort()).toEqual([...clubIds].sort());
    expect(me.context.scopes.clusterIds).toEqual([clusterId]);
    expect(me.appointments).toHaveLength(2);
  });

  it('grants nothing from a prior-year appointment', async () => {
    const user = await createUser();
    const club = await createClubIn(org);
    const position = await createPosition({
      districtId: org.districtId,
      code: 'CLUB_SECRETARY',
      scope: 'CLUB',
      permissions: ['activity:create:club'],
    });

    await appoint({
      personId: user.personId,
      districtId: org.districtId,
      // Last year. Rollover does not have to strip anybody.
      rotaryYearId: org.previousYearId,
      positionId: position.id,
      scopeType: 'CLUB',
      scopeId: club.id,
    });

    const agent = await signIn(app, user);
    const me = meResponseSchema.parse((await agent.get('/api/v1/auth/me')).body).data;

    expect(me.context.permissions).toEqual([]);
    expect(me.context.districtId).toBeNull();
  });
});

describe('district-local term boundaries', () => {
  /**
   * The deferred item from the build log.
   *
   * Compared against UTC midnight, the boundary in Kampala is three hours wide. Between
   * 21:00 and midnight EAT on 30 June an incoming officer is already authorised; on
   * 1 July between midnight and 03:00 EAT they are not. Rollover happens on exactly that
   * boundary, once a year.
   */
  it('treats a term starting 1 July as in force at 01:00 EAT, which is 30 June in UTC', async () => {
    const user = await createUser();
    const club = await createClubIn(org);
    const position = await createPosition({
      districtId: org.districtId,
      code: 'CLUB_SECRETARY',
      scope: 'CLUB',
      permissions: ['activity:create:club'],
    });
    await appoint({
      personId: user.personId,
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      positionId: position.id,
      scopeType: 'CLUB',
      scopeId: club.id,
      startsOn: new Date(Date.UTC(2027, 6, 1)),
      endsOn: new Date(Date.UTC(2028, 5, 30)),
    });

    // 30 June 22:00 UTC = 1 July 01:00 in Africa/Kampala. Only Date is faked; faking
    // timers wholesale would stall the database driver.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-06-30T22:00:00.000Z'));

    const agent = await signIn(app, user);
    const me = meResponseSchema.parse((await agent.get('/api/v1/auth/me')).body).data;

    // Under the old UTC comparison this was empty: the officer's first three hours in
    // office were spent locked out.
    expect(me.context.permissions).toEqual(['activity:create:club']);
    expect(me.context.scopes.clubIds).toEqual([club.id]);
  });

  it('does not grant a term that has not started in district-local time either', async () => {
    const user = await createUser();
    const club = await createClubIn(org);
    const position = await createPosition({
      districtId: org.districtId,
      code: 'CLUB_SECRETARY',
      scope: 'CLUB',
      permissions: ['activity:create:club'],
    });
    await appoint({
      personId: user.personId,
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      positionId: position.id,
      scopeType: 'CLUB',
      scopeId: club.id,
      startsOn: new Date(Date.UTC(2027, 6, 1)),
    });

    // 30 June 18:00 UTC = 30 June 21:00 EAT. Still June where the district is.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-06-30T18:00:00.000Z'));

    const agent = await signIn(app, user);
    const me = meResponseSchema.parse((await agent.get('/api/v1/auth/me')).body).data;

    expect(me.context.permissions).toEqual([]);
  });

  it("counts an officer's last day as a day in office", async () => {
    const user = await createUser();
    const club = await createClubIn(org);
    const position = await createPosition({
      districtId: org.districtId,
      code: 'CLUB_SECRETARY',
      scope: 'CLUB',
      permissions: ['activity:create:club'],
    });
    await appoint({
      personId: user.personId,
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      positionId: position.id,
      scopeType: 'CLUB',
      scopeId: club.id,
      startsOn: new Date(Date.UTC(2027, 6, 1)),
      endsOn: new Date(Date.UTC(2028, 5, 30)),
    });

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2028-06-30T12:00:00.000Z'));

    const agent = await signIn(app, user);
    const me = meResponseSchema.parse((await agent.get('/api/v1/auth/me')).body).data;

    // Inclusive at both ends: a last day is a day they hold office, not a day locked out.
    expect(me.context.permissions).toEqual(['activity:create:club']);
  });

  it('reports isCurrent separately from isActive on a future term', async () => {
    const person = await createUser();
    const position = await createPosition({
      districtId: org.districtId,
      code: 'DRR',
      scope: 'DISTRICT',
    });

    const response = await admin.post('/api/v1/appointments').send({
      personId: person.personId,
      positionId: position.id,
      scopeType: 'DISTRICT',
      startsOn: '2099-07-01',
    });

    const { data } = appointmentResponseSchema.parse(response.body);
    expect(data.isActive).toBe(true);
    // Active and not yet in force. A screen showing one number for both would be lying
    // for as long as the gap lasts.
    expect(data.isCurrent).toBe(false);
  });
});

describe('GET, PATCH and DELETE', () => {
  let seedCounter = 0;

  async function seedOne(): Promise<{ id: string; personId: string; clubId: string }> {
    const person = await createUser();
    const club = await createClubIn(org);
    // A distinct code per call: (district_id, code) is unique, which is the constraint
    // doing its job rather than a problem to route around.
    seedCounter += 1;
    const position = await createPosition({
      districtId: org.districtId,
      code: `CLUB_SECRETARY_${seedCounter}`,
      scope: 'CLUB',
    });
    const created = await admin.post('/api/v1/appointments').send({
      personId: person.personId,
      positionId: position.id,
      scopeType: 'CLUB',
      scopeId: club.id,
      startsOn: '2027-07-01',
    });
    return {
      id: appointmentResponseSchema.parse(created.body).data.id,
      personId: person.personId,
      clubId: club.id,
    };
  }

  it('lists and filters', async () => {
    const { personId, clubId } = await seedOne();
    await seedOne();

    const all = appointmentListResponseSchema.parse((await admin.get('/api/v1/appointments')).body);
    // Two seeded here, plus the admin's own DISTRICT appointment.
    expect(all.meta.total).toBe(3);

    const byPerson = appointmentListResponseSchema.parse(
      (await admin.get(`/api/v1/appointments?personId=${personId}`)).body,
    );
    expect(byPerson.data).toHaveLength(1);

    const byScope = appointmentListResponseSchema.parse(
      (await admin.get(`/api/v1/appointments?scopeType=CLUB&scopeId=${clubId}`)).body,
    );
    expect(byScope.data).toHaveLength(1);
  });

  it('ends a term', async () => {
    const { id } = await seedOne();

    const response = await admin.patch(`/api/v1/appointments/${id}`).send({ endsOn: '2027-12-31' });

    expect(response.status).toBe(200);
    expect(appointmentResponseSchema.parse(response.body).data.endsOn).toBe('2027-12-31');
  });

  it('revokes without deleting', async () => {
    const { id } = await seedOne();

    const response = await admin.delete(`/api/v1/appointments/${id}`);

    expect(response.status).toBe(200);
    expect(appointmentResponseSchema.parse(response.body).data.isActive).toBe(false);
    // An appointment is the record of who held office and when. Deleting one rewrites
    // history and leaves the audit log with a removal it cannot explain.
    expect(await unscopedPrisma.appointment.count({ where: { id } })).toBe(1);
  });

  it('404s an appointment in another district', async () => {
    const other = await createOrg();
    const person = await createUser();
    const position = await createPosition({
      districtId: other.districtId,
      code: 'THEIR_DRR',
      scope: 'DISTRICT',
    });
    const theirs = await appoint({
      personId: person.personId,
      districtId: other.districtId,
      rotaryYearId: other.currentYearId,
      positionId: position.id,
      scopeType: 'DISTRICT',
    });

    expect((await admin.get(`/api/v1/appointments/${theirs.id}`)).status).toBe(404);
    expect((await admin.delete(`/api/v1/appointments/${theirs.id}`)).status).toBe(404);
  });
});

describe('GET /persons/:id/appointments', () => {
  it('lets a person read their own without any permission', async () => {
    const user = await createUser();
    const club = await createClubIn(org);
    const position = await createPosition({
      districtId: org.districtId,
      code: 'CLUB_SECRETARY',
      scope: 'CLUB',
      permissions: ['activity:create:club'],
    });
    await appoint({
      personId: user.personId,
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      positionId: position.id,
      scopeType: 'CLUB',
      scopeId: club.id,
    });

    const agent = await signIn(app, user);
    const response = await agent.get(`/api/v1/persons/${user.personId}/appointments`);

    expect(response.status).toBe(200);
    expect(appointmentListResponseSchema.parse(response.body).data).toHaveLength(1);
  });

  it("refuses somebody else's without appointment:read:district", async () => {
    const user = await createUser();
    const other = await createUser();
    const club = await createClubIn(org);
    const position = await createPosition({
      districtId: org.districtId,
      code: 'CLUB_SECRETARY',
      scope: 'CLUB',
      permissions: ['activity:create:club'],
    });
    await appoint({
      personId: user.personId,
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      positionId: position.id,
      scopeType: 'CLUB',
      scopeId: club.id,
    });

    const agent = await signIn(app, user);
    const response = await agent.get(`/api/v1/persons/${other.personId}/appointments`);

    expect(response.status).toBe(403);
    expect(errorBody(response).code).toBe('INSUFFICIENT_SCOPE');
  });

  it('carries no contact details', async () => {
    const { personId } = await (async () => {
      const person = await createUser();
      const club = await createClubIn(org);
      const position = await createPosition({
        districtId: org.districtId,
        code: 'CLUB_SECRETARY',
        scope: 'CLUB',
      });
      await appoint({
        personId: person.personId,
        districtId: org.districtId,
        rotaryYearId: org.currentYearId,
        positionId: position.id,
        scopeType: 'CLUB',
        scopeId: club.id,
      });
      return person;
    })();

    const response = await admin.get(`/api/v1/persons/${personId}/appointments`);
    const serialised = JSON.stringify(response.body);

    // Names are needed to render an appointment. Nothing else is, and the cheapest way to
    // keep contact fields out of a response is not to select them.
    expect(serialised).not.toContain('@example.org');
    expect(serialised).not.toContain('phone');
  });
});
