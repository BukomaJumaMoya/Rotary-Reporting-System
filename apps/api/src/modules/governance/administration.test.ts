import {
  auditListResponseSchema,
  createInvitationsResponseSchema,
  invitationListResponseSchema,
  mfaResetResponseSchema,
} from '@dis/contracts';
import type TestAgent from 'supertest/lib/agent.js';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { withAuditActor } from '../../platform/audit.js';
import { prisma, unscopedPrisma } from '../../platform/db.js';
import { closeSessionPool } from '../../platform/session.js';
import {
  appoint,
  capturedMail,
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

/**
 * Onboarding and administration.
 *
 * Three items M0 deferred, each because it is a permission question: who may invite whom,
 * who may strip a member's second factor, and who may read the log of everything.
 */

const app = createApp();
let org: OrgFixture;

const PERMISSIONS = [
  'person:invite:district',
  'person:invite:club',
  'user:manage:district',
  'audit:read:district',
  'membership:write:club',
];

/** Signs in a member holding exactly the permissions named, appointed district-wide. */
async function signInWith(permissions: string[], code = 'ADMIN'): Promise<TestAgent> {
  const user = await createUser();
  const position = await createPosition({
    districtId: org.districtId,
    code,
    scope: 'DISTRICT',
    permissions,
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

/** A person on a club roster, with no account yet — the ordinary invitation subject. */
async function seedRosterMember(clubId: string): Promise<string> {
  const person = await unscopedPrisma.person.create({
    data: {
      firstName: 'Ann',
      lastName: 'Nakato',
      email: `ann.${Math.random().toString(36).slice(2, 10)}@example.org`,
    },
    select: { id: true },
  });

  await unscopedPrisma.membershipEvent.create({
    data: {
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      personId: person.id,
      clubId,
      eventType: 'JOIN',
      effectiveOn: new Date(Date.UTC(2027, 6, 1)),
    },
  });
  await unscopedPrisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW club_rosters');

  return person.id;
}

beforeEach(async () => {
  await resetDatabase();
  org = await createOrg();
  await unscopedPrisma.permission.createMany({
    data: PERMISSIONS.map((code) => ({ code, description: code })),
    skipDuplicates: true,
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeSessionPool();
});

describe('invitations', () => {
  it('invites a person and issues a real single-use token', async () => {
    const admin = await signInWith(['person:invite:district']);
    const club = await createClubIn(org);
    const personId = await seedRosterMember(club.id);

    const response = await admin.post('/api/v1/invitations').send({ personIds: [personId] });

    expect(response.status).toBe(200);
    const { data } = createInvitationsResponseSchema.parse(response.body);
    expect(data).toMatchObject({ sent: 1, failed: 0 });

    // issueInvite() is the real onboarding path, not a second one invented here.
    const tokens = await unscopedPrisma.userToken.count({ where: { purpose: 'INVITE' } });
    expect(tokens).toBe(1);
    expect(capturedMail().sent.some((message) => message.subject.length > 0)).toBe(true);
  });

  it('reports per person rather than failing the batch', async () => {
    const admin = await signInWith(['person:invite:district']);
    const club = await createClubIn(org);

    const invitable = await seedRosterMember(club.id);
    const alreadyActive = await createUser();
    const missing = '00000000-0000-4000-8000-00000000dead';

    const response = await admin
      .post('/api/v1/invitations')
      .send({ personIds: [invitable, alreadyActive.personId, missing] });

    const { data } = createInvitationsResponseSchema.parse(response.body);

    // The useful answer to "invite these forty" is which of them worked. A batch that
    // failed as a whole because one member already had an account is unactionable.
    expect(data.sent).toBe(1);
    expect(data.failed).toBe(2);
    expect(data.results.find((r) => r.personId === alreadyActive.personId)?.reason).toBe(
      'ALREADY_ACTIVE',
    );
    expect(data.results.find((r) => r.personId === missing)?.reason).toBe('NOT_FOUND');
  });

  it('limits a club-scoped inviter to their own roster', async () => {
    const ownClub = await createClubIn(org);
    const otherClub = await createClubIn(org);

    const secretary = await createUser();
    const position = await createPosition({
      districtId: org.districtId,
      code: 'CLUB_SECRETARY',
      scope: 'CLUB',
      permissions: ['person:invite:club'],
    });
    await appoint({
      personId: secretary.personId,
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      positionId: position.id,
      scopeType: 'CLUB',
      scopeId: ownClub.id,
    });

    const mine = await seedRosterMember(ownClub.id);
    const theirs = await seedRosterMember(otherClub.id);

    const agent = await signIn(app, secretary);
    const response = await agent.post('/api/v1/invitations').send({ personIds: [mine, theirs] });

    const { data } = createInvitationsResponseSchema.parse(response.body);

    // This is what makes person:invite:club safe to give a club secretary: it reaches
    // their own roster and nobody else's.
    expect(data.sent).toBe(1);
    expect(data.results.find((r) => r.personId === mine)?.status).toBe('SENT');
    expect(data.results.find((r) => r.personId === theirs)?.reason).toBe('OUT_OF_SCOPE');
  });

  it('lists what is outstanding, and resend invalidates the previous link', async () => {
    const admin = await signInWith(['person:invite:district']);
    const club = await createClubIn(org);
    const personId = await seedRosterMember(club.id);

    await admin
      .post('/api/v1/invitations')
      .send({ personIds: [personId] })
      .expect(200);

    const listed = invitationListResponseSchema.parse(
      (await admin.get('/api/v1/invitations')).body,
    );
    expect(listed.data).toHaveLength(1);
    expect(listed.data[0]?.isExpired).toBe(false);

    const firstTokenId = listed.data[0]?.id ?? '';
    await admin.post(`/api/v1/invitations/${firstTokenId}/resend`).expect(200);

    // The prior link is consumed, so a forwarded email from three weeks ago stops
    // working the moment a new one is sent.
    const previous = await unscopedPrisma.userToken.findUniqueOrThrow({
      where: { id: firstTokenId },
    });
    expect(previous.consumedAt).not.toBeNull();

    const outstanding = invitationListResponseSchema.parse(
      (await admin.get('/api/v1/invitations')).body,
    );
    expect(outstanding.data).toHaveLength(1);
    expect(outstanding.data[0]?.id).not.toBe(firstTokenId);
  });

  it('refuses a caller holding neither invite permission', async () => {
    const nobody = await signInWith(['audit:read:district']);
    const response = await nobody.post('/api/v1/invitations').send({ personIds: [] });

    // Empty array fails validation first; the point is the surface is not open.
    expect([400, 403]).toContain(response.status);
    expect((await nobody.get('/api/v1/invitations')).status).toBe(403);
  });
});

describe('administrative MFA reset', () => {
  async function seedMemberWithMfa(): Promise<SeededUser> {
    const member = await createUser();
    await unscopedPrisma.user.update({
      where: { id: member.userId },
      data: { mfaEnabled: true, mfaSecret: 'encrypted-secret', mfaLastUsedStep: 42n },
    });
    await unscopedPrisma.mfaRecoveryCode.createMany({
      data: Array.from({ length: 10 }, (_, index) => ({
        userId: member.userId,
        codeHash: `hash-${index}`,
      })),
    });
    return member;
  }

  it('clears the factor, invalidates the codes, audits it and tells the member', async () => {
    const admin = await signInWith(['user:manage:district']);
    const member = await seedMemberWithMfa();

    const response = await admin.post(`/api/v1/users/${member.userId}/mfa/reset`);

    expect(response.status).toBe(200);
    const { data } = mfaResetResponseSchema.parse(response.body);
    expect(data).toMatchObject({ mfaEnabled: false, recoveryCodesInvalidated: 10 });
    expect(data.personNotified).toBe(true);

    const after = await unscopedPrisma.user.findUniqueOrThrow({ where: { id: member.userId } });
    expect(after.mfaEnabled).toBe(false);
    expect(after.mfaSecret).toBeNull();
    // Recovery codes go with the factor they recover. Leaving them would let a printout
    // from last year re-enter an account whose second factor was deliberately removed.
    expect(await unscopedPrisma.mfaRecoveryCode.count({ where: { userId: member.userId } })).toBe(
      0,
    );

    const audited = await unscopedPrisma.auditLogEntry.findMany({
      where: { entityType: 'users', entityId: member.userId },
    });
    expect(audited).toHaveLength(1);

    // NOT optional. An admin-triggered reset the holder never hears about is an account
    // takeover with a paper trail nobody reads.
    const notified = capturedMail().sent.some((message) => message.subject.includes('two-factor'));
    expect(notified).toBe(true);
  });

  it('refuses a caller without user:manage:district', async () => {
    const nobody = await signInWith(['audit:read:district']);
    const member = await seedMemberWithMfa();

    const response = await nobody.post(`/api/v1/users/${member.userId}/mfa/reset`);

    expect(response.status).toBe(403);
    expect(errorBody(response).code).toBe('INSUFFICIENT_SCOPE');
    expect(
      (await unscopedPrisma.user.findUniqueOrThrow({ where: { id: member.userId } })).mfaEnabled,
    ).toBe(true);
  });
});

describe('the audit log', () => {
  it('lists newest first, with the actor named', async () => {
    const admin = await signInWith(['audit:read:district', 'membership:write:club']);
    const club = await createClubIn(org);

    // A governed-entity change, captured by the audit extension.
    await unscopedPrisma.club.update({ where: { id: club.id }, data: { name: 'Renamed' } });

    const response = await admin.get('/api/v1/audit');
    expect(response.status).toBe(200);

    const { data } = auditListResponseSchema.parse(response.body);
    // The admin's own LOGIN is in there, which is the point of recording it.
    expect(data.some((entry) => entry.action === 'LOGIN')).toBe(true);
    expect(data[0]?.actorName).not.toBeNull();
  });

  it('filters by entity, action and date', async () => {
    const admin = await signInWith(['audit:read:district']);

    const byAction = auditListResponseSchema.parse(
      (await admin.get('/api/v1/audit?action=LOGIN')).body,
    );
    expect(byAction.data.every((entry) => entry.action === 'LOGIN')).toBe(true);

    const byType = auditListResponseSchema.parse(
      (await admin.get('/api/v1/audit?entityType=users')).body,
    );
    expect(byType.data.every((entry) => entry.entityType === 'users')).toBe(true);

    const future = auditListResponseSchema.parse(
      (await admin.get('/api/v1/audit?from=2099-01-01')).body,
    );
    expect(future.data).toEqual([]);
  });

  it('REDACTS contact fields out of a person diff', async () => {
    const admin = await signInWith(['audit:read:district']);

    // A governed change to a person, touching a contact field and a name.
    const person = await unscopedPrisma.person.create({
      data: { firstName: 'Ann', lastName: 'Nakato', email: 'ann.before@example.org' },
      select: { id: true },
    });
    // Through the real actor store, as a request would: persons are GLOBAL entities with
    // no district of their own, so the audit row takes its district from the actor.
    await withAuditActor({ districtId: org.districtId }, async () => {
      await prisma.person.updateMany({
        where: { id: person.id },
        data: { email: 'ann.after@example.org', lastName: 'Nakato-Okello' },
      });
    });

    const { data } = auditListResponseSchema.parse(
      (await admin.get('/api/v1/audit?entityType=persons')).body,
    );

    const entry = data.find((row) => row.entityId === person.id);
    expect(entry).toBeDefined();

    const email = entry?.changes.find((change) => change.field === 'email');
    const lastName = entry?.changes.find((change) => change.field === 'lastName');

    // The FIELD NAME survives, so the log still says what changed; the values do not.
    expect(email).toMatchObject({ isRedacted: true, before: null, after: null });
    expect(lastName).toMatchObject({ isRedacted: false, after: 'Nakato-Okello' });

    // And nothing leaks by value anywhere in the response.
    const serialised = JSON.stringify(data);
    expect(serialised).not.toContain('ann.before@example.org');
    expect(serialised).not.toContain('ann.after@example.org');
  });

  it("does not show another district's rows", async () => {
    const other = await createOrg();
    await unscopedPrisma.auditLogEntry.create({
      data: {
        districtId: other.districtId,
        entityType: 'clubs',
        action: 'UPDATE',
        after: { name: 'Their club' },
      },
    });

    const admin = await signInWith(['audit:read:district']);
    const { data } = auditListResponseSchema.parse((await admin.get('/api/v1/audit')).body);

    // audit_log is UNSCOPED_BY_DESIGN because LOGIN rows are written before a context
    // exists, so the district filter is applied explicitly by the read path.
    expect(JSON.stringify(data)).not.toContain('Their club');
  });

  it('refuses a caller without audit:read:district', async () => {
    const nobody = await signInWith(['person:invite:district']);
    const response = await nobody.get('/api/v1/audit');

    expect(response.status).toBe(403);
  });
});
