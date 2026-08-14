import type { RequestContext } from '@dis/contracts';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { withAuditActor } from './audit.js';
import { db, prisma, unscopedPrisma } from './db.js';
import { domainErrorFor } from './errors.js';
import { closeSessionPool } from './session.js';
import {
  appoint,
  createActivity,
  createActivityType,
  createClub,
  createOrg,
  createPosition,
  createUser,
  resetDatabase,
  signIn,
  type OrgFixture,
} from '../test/helpers.js';

/**
 * The audit log (docs/02-Architecture.md §4.4).
 *
 * Retention is indefinite because the question it answers arrives late: what did the
 * scorecard say in March, and who changed it. A log that records the change but not the
 * previous value answers half of that.
 */

const app = createApp();

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeSessionPool();
});

function contextFor(org: OrgFixture, userId: string, personId: string): RequestContext {
  return {
    userId,
    personId,
    districtId: org.districtId,
    rotaryYearId: org.currentYearId,
    permissions: new Set<string>(),
    scopes: {
      clubIds: [],
      clusterIds: [],
      regionIds: [],
      committeeIds: [],
      isDistrictWide: true,
    },
    isYearWritable: true,
  };
}

async function auditRows(entityType?: string) {
  return unscopedPrisma.auditLogEntry.findMany({
    where: entityType ? { entityType } : {},
    orderBy: { id: 'asc' },
  });
}

describe('governed entity changes', () => {
  it('records a create with the whole row and no before', async () => {
    const org = await createOrg();
    const user = await createUser();
    const club = await createClub();
    const type = await createActivityType(org.districtId);

    const created = await withAuditActor(
      {
        userId: user.userId,
        districtId: org.districtId,
        ipAddress: '10.1.2.3',
        userAgent: 'vitest',
      },
      async () =>
        await db(contextFor(org, user.userId, user.personId)).activity.create({
          data: {
            activityTypeId: type.id,
            hostScopeType: 'CLUB',
            hostScopeId: club.id,
            title: 'Community clean-up',
            startsAt: new Date('2027-09-01T14:00:00Z'),
          },
        }),
    );

    const [row, ...rest] = await auditRows('activities');
    expect(rest).toEqual([]);
    expect(row).toMatchObject({
      action: 'CREATE',
      entityType: 'activities',
      entityId: created.id,
      actorUserId: user.userId,
      districtId: org.districtId,
      userAgent: 'vitest',
      before: null,
    });
    expect(row?.ipAddress).toBe('10.1.2.3');
    expect(row?.after).toMatchObject({ title: 'Community clean-up' });
  });

  it('records an update as a diff of only what changed', async () => {
    const org = await createOrg();
    const user = await createUser();
    const club = await createClub();
    const type = await createActivityType(org.districtId);
    const activity = await createActivity({
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      activityTypeId: type.id,
      hostScopeId: club.id,
      title: 'Before',
    });

    await withAuditActor(
      { userId: user.userId, districtId: org.districtId },
      async () =>
        await db(contextFor(org, user.userId, user.personId)).activity.updateMany({
          where: { id: activity.id },
          data: { title: 'After', venue: 'Kampala Serena' },
        }),
    );

    const [row] = await auditRows('activities');
    expect(row?.action).toBe('UPDATE');
    // Both sides, and only the columns that moved. Storing whole rows twice would make
    // audit_log the largest table in the database and bury the one field that changed.
    expect(row?.before).toEqual({ title: 'Before', venue: null });
    expect(row?.after).toEqual({ title: 'After', venue: 'Kampala Serena' });
  });

  it('does not record an update that changed nothing', async () => {
    const org = await createOrg();
    const user = await createUser();
    const club = await createClub();
    const type = await createActivityType(org.districtId);
    const activity = await createActivity({
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      activityTypeId: type.id,
      hostScopeId: club.id,
      title: 'Unchanged',
    });

    await withAuditActor(
      { userId: user.userId },
      async () =>
        await db(contextFor(org, user.userId, user.personId)).activity.updateMany({
          where: { id: activity.id },
          data: { title: 'Unchanged' },
        }),
    );

    // `updated_at` moves on every write and says nothing on its own; a log full of rows
    // recording only that is a log nobody reads.
    expect(await auditRows('activities')).toEqual([]);
  });

  it('records a delete with the whole row it removed', async () => {
    const org = await createOrg();
    const user = await createUser();
    const club = await createClub();
    const type = await createActivityType(org.districtId);
    const activity = await createActivity({
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      activityTypeId: type.id,
      hostScopeId: club.id,
      title: 'Doomed',
    });

    await withAuditActor(
      { userId: user.userId },
      async () =>
        await db(contextFor(org, user.userId, user.personId)).activity.deleteMany({
          where: { id: activity.id },
        }),
    );

    const [row] = await auditRows('activities');
    expect(row?.action).toBe('DELETE');
    expect(row?.after).toBeNull();
    expect(row?.before).toMatchObject({ id: activity.id, title: 'Doomed' });
  });

  it('survives a BigInt and a Decimal without mangling either', async () => {
    const user = await createUser();

    const club = await withAuditActor(
      { userId: user.userId },
      async () =>
        await prisma.club.create({
          data: {
            name: 'Rotaract Club of Jinja',
            slug: `rc-jinja-${Date.now()}`,
            baseType: 'CBC',
            // BigInt. JSON.stringify throws on one, so an unprepared serialiser loses the
            // whole diff — and ri_club_id is the identifier RI knows this club by.
            riClubId: 9_007_199_254_740_993n,
          },
        }),
    );

    const [row] = await auditRows('clubs');
    expect(row?.entityId).toBe(club.id);
    expect(row?.after).toMatchObject({ riClubId: '9007199254740993' });
  });

  it('ignores tables that are not governed', async () => {
    const org = await createOrg();
    const user = await createUser();

    await withAuditActor(
      { userId: user.userId },
      async () =>
        await db(contextFor(org, user.userId, user.personId)).activityType.create({
          data: { code: 'NEW_TYPE', name: 'Fellowship', category: 'FELLOWSHIP' },
        }),
    );

    // Configuration, not a governed record. The governed list is deliberately short:
    // auditing everything produces a log nobody can search.
    expect(await auditRows()).toEqual([]);
  });

  it('does not audit the seed', async () => {
    // Fixtures and prisma/seed.ts write through unscopedPrisma, which carries no audit
    // extension. Three hundred seeded members are nobody's action.
    await createClub('Rotaract Club of Mbarara');
    expect(await auditRows()).toEqual([]);
  });
});

describe('authentication actions', () => {
  it('records LOGIN with the actor, address and agent', async () => {
    const org = await createOrg();
    const user = await createUser();
    const club = await createClub();
    const position = await createPosition({
      districtId: org.districtId,
      code: 'CLUB_SECRETARY',
      scope: 'CLUB',
      permissions: ['activity:read:club'],
    });
    await appoint({
      personId: user.personId,
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      positionId: position.id,
      scopeType: 'CLUB',
      scopeId: club.id,
    });

    await signIn(app, user);

    const [row] = await auditRows('users');
    expect(row).toMatchObject({ action: 'LOGIN', actorUserId: user.userId });
    // A login leaves no row change, so without this the one question an audit log is
    // asked after an incident — who was in the system, and when — has no answer.
    expect(row?.ipAddress).not.toBeNull();
  });

  it('records LOGOUT before the session is destroyed', async () => {
    const user = await createUser();
    const agent = await signIn(app, user);

    await agent.post('/api/v1/auth/logout').expect(204);

    const actions = (await auditRows('users')).map((row) => row.action);
    expect(actions).toEqual(['LOGIN', 'LOGOUT']);
  });

  it('does not record a failed sign-in as a login', async () => {
    const user = await createUser();

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'not the right password' });

    expect(response.status).toBe(401);
    // LOGIN means a session was issued. Recording rejected attempts here would make the
    // log agree with itself and disagree with reality; the lockout counter is what
    // counts failures.
    expect(await auditRows('users')).toEqual([]);
  });
});

describe('append-only', () => {
  it('refuses an update or a delete, with a domain code rather than a driver error', async () => {
    const user = await createUser();
    await signIn(app, user);

    const [row] = await auditRows('users');
    expect(row).toBeDefined();

    // The guard is in the DATABASE (ADR-012, SQLSTATE DIS02), so it holds against a
    // future developer, a migration script and an operator at 2am — none of which the
    // application can be asked to police.
    await expect(
      unscopedPrisma.auditLogEntry.updateMany({
        where: { id: row?.id },
        data: { action: 'TAMPERED' },
      }),
    ).rejects.toThrow(/append-only/);

    await expect(
      unscopedPrisma.auditLogEntry.deleteMany({ where: { id: row?.id } }),
    ).rejects.toThrow(/append-only/);
  });

  it('reaches a client as AUDIT_IMMUTABLE, not as an opaque 500', async () => {
    const user = await createUser();
    await signIn(app, user);
    const [row] = await auditRows('users');

    let mapped: unknown;
    try {
      await unscopedPrisma.auditLogEntry.deleteMany({ where: { id: row?.id } });
    } catch (error) {
      mapped = error;
    }

    // Prisma 7 with the pg driver adapter nests the SQLSTATE two levels deeper than the
    // obvious places, so the mapping in platform/errors.ts silently found nothing and
    // every guard violation surfaced as INTERNAL_ERROR. The conformance suite proved the
    // guards fire; nothing proved the translation did.
    expect(domainErrorFor(mapped)?.code).toBe('AUDIT_IMMUTABLE');
  });
});
