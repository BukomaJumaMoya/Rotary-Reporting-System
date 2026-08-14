import {
  committeeMemberListResponseSchema,
  committeeResponseSchema,
  committeeTreeResponseSchema,
} from '@dis/contracts';
import type TestAgent from 'supertest/lib/agent.js';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { prisma, unscopedPrisma } from '../../platform/db.js';
import { closeSessionPool } from '../../platform/session.js';
import {
  appoint,
  createClubIn,
  createCommittee,
  createOrg,
  createPosition,
  createUser,
  errorBody,
  resetDatabase,
  signIn,
  type OrgFixture,
} from '../../test/helpers.js';

/**
 * Committees, and the delegation the district asked for and could not have:
 * *"allow chairs to create their own sub-committee, enter position and select the person."*
 *
 * The delegation is a SCOPE check, not a permission. A chair holds no district-wide
 * authority and can still run their own subtree.
 */

const app = createApp();

let org: OrgFixture;
let des: TestAgent;

async function signInAsDes(): Promise<TestAgent> {
  const user = await createUser();
  const position = await createPosition({
    districtId: org.districtId,
    code: 'DES',
    scope: 'DISTRICT',
    permissions: ['committee:manage:district', 'appointment:manage:district'],
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

/**
 * A chair: an appointment scoped to one committee, and NO district-wide permission.
 *
 * An appointment over a committee is what chairing one is — members are joined through
 * `committee_members`, which links an appointment rather than a person.
 */
async function signInAsChairOf(committeeId: string, code: string): Promise<TestAgent> {
  const user = await createUser();
  const position = await createPosition({
    districtId: org.districtId,
    code,
    scope: 'COMMITTEE',
    permissions: ['appointment:read:district'],
  });
  await appoint({
    personId: user.personId,
    districtId: org.districtId,
    rotaryYearId: org.currentYearId,
    positionId: position.id,
    scopeType: 'COMMITTEE',
    scopeId: committeeId,
  });
  return signIn(app, user);
}

beforeEach(async () => {
  await resetDatabase();
  org = await createOrg();
  await unscopedPrisma.permission.createMany({
    data: [
      { code: 'committee:manage:district', description: 'Manage committees' },
      { code: 'appointment:manage:district', description: 'Appoint officers' },
      { code: 'appointment:read:district', description: 'Read appointments' },
    ],
    skipDuplicates: true,
  });
  des = await signInAsDes();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeSessionPool();
});

describe('the district secretary', () => {
  it('creates a district committee and a sub-committee under it', async () => {
    const parent = await des
      .post('/api/v1/committees')
      .send({ name: 'Public Image', mandate: 'Brand and communications' });

    expect(parent.status).toBe(201);
    const parentData = committeeResponseSchema.parse(parent.body).data;
    expect(parentData.depth).toBe(1);

    const child = await des
      .post('/api/v1/committees')
      .send({ name: 'Social Media', parentCommitteeId: parentData.id });

    expect(child.status).toBe(201);
    expect(committeeResponseSchema.parse(child.body).data.depth).toBe(2);
  });

  it('returns the tree nested', async () => {
    const root = await createCommittee({
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      name: 'Finance',
    });
    await createCommittee({
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      name: 'Audit',
      parentCommitteeId: root.id,
    });

    const response = await des.get('/api/v1/committees?tree=true');
    const { data } = committeeTreeResponseSchema.parse(response.body);

    expect(data).toHaveLength(1);
    expect(data[0]?.name).toBe('Finance');
    expect(data[0]?.children.map((child) => child.name)).toEqual(['Audit']);
  });

  it('caps nesting at three deep', async () => {
    const first = await createCommittee({
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      name: 'Level one',
    });
    const second = await createCommittee({
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      name: 'Level two',
      parentCommitteeId: first.id,
    });
    const third = await createCommittee({
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      name: 'Level three',
      parentCommitteeId: second.id,
    });

    const tooDeep = await des
      .post('/api/v1/committees')
      .send({ name: 'Level four', parentCommitteeId: third.id });

    expect(tooDeep.status).toBe(422);
    expect(errorBody(tooDeep).code).toBe('COMMITTEE_TOO_DEEP');
  });

  it('offers no way to re-parent a committee, which would move every member silently', async () => {
    const a = await createCommittee({
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      name: 'A',
    });
    const b = await createCommittee({
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      name: 'B',
    });

    const response = await des
      .patch(`/api/v1/committees/${a.id}`)
      .send({ parentCommitteeId: b.id });

    // parentCommitteeId is absent from the patch contract, so this is an unknown field
    // rather than a cycle to guard against — the cycle is prevented by construction.
    expect(response.status).toBe(400);
    const unchanged = await unscopedPrisma.committee.findUniqueOrThrow({ where: { id: a.id } });
    expect(unchanged.parentCommitteeId).toBeNull();
  });

  it('404s a committee in another district', async () => {
    const other = await createOrg();
    const theirs = await createCommittee({
      districtId: other.districtId,
      rotaryYearId: other.currentYearId,
    });

    expect((await des.get(`/api/v1/committees/${theirs.id}`)).status).toBe(404);
  });
});

describe('a committee chair, holding no district-wide permission', () => {
  it('creates a sub-committee under their own', async () => {
    const own = await createCommittee({
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      name: 'Membership',
    });
    const chair = await signInAsChairOf(own.id, 'MEMBERSHIP_CHAIR');

    const response = await chair
      .post('/api/v1/committees')
      .send({ name: 'Retention working group', parentCommitteeId: own.id });

    // The district's own request, which the incumbent system could not satisfy.
    expect(response.status).toBe(201);
    expect(committeeResponseSchema.parse(response.body).data.depth).toBe(2);
  });

  it('is refused, with 404, on another committee subtree', async () => {
    const own = await createCommittee({
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      name: 'Membership',
    });
    const other = await createCommittee({
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      name: 'Finance',
    });
    const chair = await signInAsChairOf(own.id, 'MEMBERSHIP_CHAIR');

    const response = await chair
      .post('/api/v1/committees')
      .send({ name: 'Sneaky sub-committee', parentCommitteeId: other.id });

    // 404 rather than 403: a chair probing another chair's subtree learns nothing about
    // what is in it.
    expect(response.status).toBe(404);
  });

  it('cannot create a top-level district committee', async () => {
    const own = await createCommittee({
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
    });
    const chair = await signInAsChairOf(own.id, 'MEMBERSHIP_CHAIR');

    const response = await chair.post('/api/v1/committees').send({ name: 'My own committee' });

    // There is no subtree to be inside of. Creating a district committee is a
    // district-wide act by definition.
    expect(response.status).toBe(404);
  });

  it('inherits the whole subtree beneath their committee, not just its children', async () => {
    const root = await createCommittee({
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      name: 'Service',
    });
    const middle = await createCommittee({
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      name: 'Projects',
      parentCommitteeId: root.id,
    });
    const chair = await signInAsChairOf(root.id, 'SERVICE_CHAIR');

    // Scope expands DOWNWARDS, exactly as a region covers the clusters inside it. A chair
    // of the root can therefore work two levels down without an ancestor walk per check.
    const response = await chair
      .post('/api/v1/committees')
      .send({ name: 'Water project', parentCommitteeId: middle.id });

    expect(response.status).toBe(201);
  });

  it('adds and removes members of their own committee', async () => {
    const own = await createCommittee({
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
    });
    const chair = await signInAsChairOf(own.id, 'MEMBERSHIP_CHAIR');

    // The member joins as an APPOINTMENT: serving on a committee is something you do in a
    // capacity, for a year, and it expires with the appointment that justified it.
    const member = await createUser();
    const club = await createClubIn(org);
    const position = await createPosition({
      districtId: org.districtId,
      code: 'CLUB_SECRETARY',
      name: 'Club Secretary',
      scope: 'CLUB',
    });
    const appointment = await appoint({
      personId: member.personId,
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      positionId: position.id,
      scopeType: 'CLUB',
      scopeId: club.id,
    });

    const added = await chair
      .post(`/api/v1/committees/${own.id}/members`)
      .send({ appointmentId: appointment.id, roleLabel: 'Secretary' });

    expect(added.status).toBe(201);

    const listed = committeeMemberListResponseSchema.parse(
      (await chair.get(`/api/v1/committees/${own.id}/members`)).body,
    );
    expect(listed.data).toHaveLength(1);
    expect(listed.data[0]).toMatchObject({
      personId: member.personId,
      positionName: 'Club Secretary',
      roleLabel: 'Secretary',
    });

    const removed = await chair.delete(`/api/v1/committees/${own.id}/members/${appointment.id}`);
    expect(removed.status).toBe(204);
  });

  it('cannot add members to a committee outside their subtree', async () => {
    const own = await createCommittee({
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
    });
    const other = await createCommittee({
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
    });
    const chair = await signInAsChairOf(own.id, 'MEMBERSHIP_CHAIR');

    const member = await createUser();
    const position = await createPosition({
      districtId: org.districtId,
      code: 'DRR',
      scope: 'DISTRICT',
    });
    const appointment = await appoint({
      personId: member.personId,
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      positionId: position.id,
      scopeType: 'DISTRICT',
    });

    const response = await chair
      .post(`/api/v1/committees/${other.id}/members`)
      .send({ appointmentId: appointment.id });

    expect(response.status).toBe(404);
  });

  it('refuses an appointment from another district', async () => {
    const otherOrg = await createOrg();
    const own = await createCommittee({
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
    });
    const chair = await signInAsChairOf(own.id, 'MEMBERSHIP_CHAIR');

    const stranger = await createUser();
    const theirPosition = await createPosition({
      districtId: otherOrg.districtId,
      code: 'THEIR_DRR',
      scope: 'DISTRICT',
    });
    const theirAppointment = await appoint({
      personId: stranger.personId,
      districtId: otherOrg.districtId,
      rotaryYearId: otherOrg.currentYearId,
      positionId: theirPosition.id,
      scopeType: 'DISTRICT',
    });

    const response = await chair
      .post(`/api/v1/committees/${own.id}/members`)
      .send({ appointmentId: theirAppointment.id });

    // Read through db(ctx), so another district's appointment is not there to be added.
    expect(response.status).toBe(422);
  });

  it('refuses the same appointment twice', async () => {
    const own = await createCommittee({
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
    });
    const chair = await signInAsChairOf(own.id, 'MEMBERSHIP_CHAIR');

    const member = await createUser();
    const position = await createPosition({
      districtId: org.districtId,
      code: 'DRR',
      scope: 'DISTRICT',
    });
    const appointment = await appoint({
      personId: member.personId,
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      positionId: position.id,
      scopeType: 'DISTRICT',
    });

    await chair
      .post(`/api/v1/committees/${own.id}/members`)
      .send({ appointmentId: appointment.id })
      .expect(201);

    const again = await chair
      .post(`/api/v1/committees/${own.id}/members`)
      .send({ appointmentId: appointment.id });

    // The composite primary key would refuse this; a domain code is what a form can act on.
    expect(again.status).toBe(409);
  });
});

describe('any signed-in member', () => {
  it('can read the committee list without managing anything', async () => {
    await createCommittee({
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      name: 'Public Image',
    });

    const member = await createUser();
    const club = await createClubIn(org);
    const position = await createPosition({
      districtId: org.districtId,
      code: 'CLUB_MEMBER',
      scope: 'CLUB',
      permissions: [],
    });
    await appoint({
      personId: member.personId,
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      positionId: position.id,
      scopeType: 'CLUB',
      scopeId: club.id,
    });

    const agent = await signIn(app, member);
    const response = await agent.get('/api/v1/committees?tree=true');

    // Who sits on what is not a secret, and a member cannot volunteer for a committee
    // they cannot see.
    expect(response.status).toBe(200);
    expect(committeeTreeResponseSchema.parse(response.body).data).toHaveLength(1);
  });

  it('cannot create one', async () => {
    const member = await createUser();
    const club = await createClubIn(org);
    const position = await createPosition({
      districtId: org.districtId,
      code: 'CLUB_MEMBER',
      scope: 'CLUB',
      permissions: [],
    });
    await appoint({
      personId: member.personId,
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      positionId: position.id,
      scopeType: 'CLUB',
      scopeId: club.id,
    });

    const agent = await signIn(app, member);
    const response = await agent.post('/api/v1/committees').send({ name: 'Mine' });

    expect(response.status).toBe(404);
  });
});
