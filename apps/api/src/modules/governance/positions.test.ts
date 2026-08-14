import {
  permissionListResponseSchema,
  positionListResponseSchema,
  positionResponseSchema,
} from '@dis/contracts';
import type TestAgent from 'supertest/lib/agent.js';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { prisma, unscopedPrisma } from '../../platform/db.js';
import { closeSessionPool } from '../../platform/session.js';
import {
  appoint,
  createClub,
  createOrg,
  createPosition,
  createUser,
  errorBody,
  resetDatabase,
  signIn,
  type OrgFixture,
} from '../../test/helpers.js';

/**
 * Positions and permissions.
 *
 * The catalogue of roles a district can appoint people to. It is configuration — D9218's
 * RY2027-28 slate has over thirty distinct roles — so the tests are about the rules that
 * keep configuration from becoming a way to grant yourself something.
 */

const app = createApp();

let org: OrgFixture;
let admin: TestAgent;

/** The DES: holds `position:manage:district`, which is the permission this surface needs. */
async function signInAsAdmin(): Promise<TestAgent> {
  const user = await createUser();
  const position = await createPosition({
    districtId: org.districtId,
    code: 'DES',
    scope: 'DISTRICT',
    permissions: ['position:manage:district', 'appointment:read:district'],
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
  // The catalogue the API validates against. Seeded by prisma/seed/reference.ts in a real
  // database; created here so the fixture does not depend on the seed having been run.
  await unscopedPrisma.permission.createMany({
    data: [
      { code: 'position:manage:district', description: 'Manage positions' },
      { code: 'appointment:read:district', description: 'Read appointments' },
      { code: 'activity:create:club', description: 'Report an activity' },
      { code: 'activity:read:club', description: 'View activities' },
      { code: 'finance:read:club', description: 'View club finance' },
    ],
    skipDuplicates: true,
  });
  admin = await signInAsAdmin();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeSessionPool();
});

describe('GET /permissions', () => {
  it('returns the catalogue, and offers no way to add to it', async () => {
    const response = await admin.get('/api/v1/permissions');

    expect(response.status).toBe(200);
    const body = permissionListResponseSchema.parse(response.body);
    expect(body.data.map((p) => p.code)).toContain('activity:create:club');

    // There is deliberately no POST. A permission code without a matching check in the
    // code is a lie, and codes are matched exactly with no wildcard — so a created row
    // containing a typo would grant nothing and say nothing.
    expect((await admin.post('/api/v1/permissions').send({ code: 'a:b:c' })).status).toBe(404);
  });
});

describe('GET /positions', () => {
  it('lists the district slate and the system-wide templates together', async () => {
    await createPosition({
      districtId: org.districtId,
      code: 'CLUB_SECRETARY',
      scope: 'CLUB',
      permissions: ['activity:create:club'],
    });
    await createPosition({ districtId: null, code: 'TEMPLATE_ROLE', scope: 'CLUB' });

    const body = positionListResponseSchema.parse((await admin.get('/api/v1/positions')).body);
    const codes = body.data.map((position) => position.code);

    expect(codes).toContain('CLUB_SECRETARY');
    expect(codes).toContain('TEMPLATE_ROLE');
    expect(body.data.find((p) => p.code === 'TEMPLATE_ROLE')?.isTemplate).toBe(true);
    expect(body.data.find((p) => p.code === 'CLUB_SECRETARY')?.isTemplate).toBe(false);
  });

  it('filters by scope and by active, and can exclude templates', async () => {
    await createPosition({ districtId: org.districtId, code: 'A_CLUB', scope: 'CLUB' });
    await createPosition({ districtId: org.districtId, code: 'A_DISTRICT', scope: 'DISTRICT' });
    await createPosition({ districtId: null, code: 'A_TEMPLATE', scope: 'CLUB' });

    const clubOnly = positionListResponseSchema.parse(
      (await admin.get('/api/v1/positions?scope=CLUB')).body,
    );
    expect(clubOnly.data.map((p) => p.code).sort()).toEqual(['A_CLUB', 'A_TEMPLATE']);

    const ownOnly = positionListResponseSchema.parse(
      (await admin.get('/api/v1/positions?includeTemplates=false')).body,
    );
    expect(ownOnly.data.map((p) => p.code)).not.toContain('A_TEMPLATE');
  });

  it('reports how many people hold each position', async () => {
    const user = await createUser();
    const club = await createClub();
    const position = await createPosition({
      districtId: org.districtId,
      code: 'CLUB_PRESIDENT',
      scope: 'CLUB',
    });
    await appoint({
      personId: user.personId,
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      positionId: position.id,
      scopeType: 'CLUB',
      scopeId: club.id,
    });

    const body = positionListResponseSchema.parse((await admin.get('/api/v1/positions')).body);
    // So the UI can warn before deactivating rather than after being refused.
    expect(body.data.find((p) => p.code === 'CLUB_PRESIDENT')?.activeAppointments).toBe(1);
  });

  it('refuses a caller without the permission', async () => {
    const nobody = await createUser();
    const position = await createPosition({
      districtId: org.districtId,
      code: 'MEMBER',
      scope: 'CLUB',
      permissions: ['activity:read:club'],
    });
    const club = await createClub();
    await appoint({
      personId: nobody.personId,
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      positionId: position.id,
      scopeType: 'CLUB',
      scopeId: club.id,
    });

    const agent = await signIn(app, nobody);
    const response = await agent.get('/api/v1/positions');

    expect(response.status).toBe(403);
    expect(errorBody(response).code).toBe('INSUFFICIENT_SCOPE');
  });
});

describe('POST /positions', () => {
  it('creates a position in the caller district with its permissions', async () => {
    const response = await admin.post('/api/v1/positions').send({
      code: 'CLUB_TREASURER',
      name: 'Club Treasurer',
      scope: 'CLUB',
      sequence: 100,
      isUniquePerScope: true,
      permissions: ['finance:read:club', 'activity:read:club'],
    });

    expect(response.status).toBe(201);
    const { data } = positionResponseSchema.parse(response.body);

    expect(data.districtId).toBe(org.districtId);
    expect(data.isTemplate).toBe(false);
    expect(data.permissions).toEqual(['activity:read:club', 'finance:read:club']);
    expect(data.activeAppointments).toBe(0);
  });

  it('rejects a permission code that is not in the catalogue', async () => {
    const response = await admin.post('/api/v1/positions').send({
      code: 'TYPO_ROLE',
      name: 'Typo Role',
      scope: 'CLUB',
      permissions: ['activity:crate:club'],
    });

    // Not a 500 from a foreign key, and not a silent grant of nothing.
    expect(response.status).toBe(422);
    expect(errorBody(response).code).toBe('UNKNOWN_PERMISSION');
    expect(errorBody(response).details).toMatchObject({ unknown: ['activity:crate:club'] });
    expect(await unscopedPrisma.position.count({ where: { code: 'TYPO_ROLE' } })).toBe(0);
  });

  it('refuses a duplicate code within the district', async () => {
    await createPosition({ districtId: org.districtId, code: 'DRR', scope: 'DISTRICT' });

    const response = await admin
      .post('/api/v1/positions')
      .send({ code: 'DRR', name: 'Another DRR', scope: 'DISTRICT' });

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('DUPLICATE_CODE');
  });

  it('cannot be talked into creating a template', async () => {
    // districtId is not part of the create contract, and the scoped layer stamps the
    // caller's district over anything sent anyway.
    const response = await admin
      .post('/api/v1/positions')
      .send({ code: 'SNEAKY', name: 'Sneaky', scope: 'CLUB', districtId: null });

    expect(response.status).toBe(201);
    expect(positionResponseSchema.parse(response.body).data.districtId).toBe(org.districtId);
  });
});

describe('PATCH and DELETE /positions/:id', () => {
  it('updates a position in the caller district', async () => {
    const position = await createPosition({
      districtId: org.districtId,
      code: 'ADRR',
      scope: 'CLUSTER',
    });

    const response = await admin
      .patch(`/api/v1/positions/${position.id}`)
      .send({ name: 'Assistant DRR', sequence: 70 });

    expect(response.status).toBe(200);
    const { data } = positionResponseSchema.parse(response.body);
    expect(data.name).toBe('Assistant DRR');
    expect(data.sequence).toBe(70);
    // The code is absent from the patch contract: the seed, the authorisation matrix and
    // anything an officer wrote down all refer to a position by it.
    expect(data.code).toBe('ADRR');
  });

  it('refuses every write to a system-wide template', async () => {
    const template = await createPosition({
      districtId: null,
      code: 'SHARED_ROLE',
      scope: 'CLUB',
    });

    const patched = await admin.patch(`/api/v1/positions/${template.id}`).send({ name: 'Mine' });
    const deleted = await admin.delete(`/api/v1/positions/${template.id}`);
    const permissions = await admin
      .put(`/api/v1/positions/${template.id}/permissions`)
      .send({ permissions: [] });

    // 403, not 404: the caller can see the row in the list, so pretending it is absent
    // would be a lie they could disprove with a GET.
    for (const response of [patched, deleted, permissions]) {
      expect(response.status).toBe(403);
      expect(errorBody(response).code).toBe('TEMPLATE_IMMUTABLE');
    }
  });

  it('deactivates a position nobody holds', async () => {
    const position = await createPosition({
      districtId: org.districtId,
      code: 'RETIRED_ROLE',
      scope: 'CLUB',
    });

    const response = await admin.delete(`/api/v1/positions/${position.id}`);

    expect(response.status).toBe(200);
    expect(positionResponseSchema.parse(response.body).data.isActive).toBe(false);
    // Soft: history references it, so it is deactivated and never deleted.
    expect(await unscopedPrisma.position.count({ where: { id: position.id } })).toBe(1);
  });

  it('refuses to deactivate a position that is held, and says how many hold it', async () => {
    const club = await createClub();
    const position = await createPosition({
      districtId: org.districtId,
      code: 'CLUB_SECRETARY',
      scope: 'CLUB',
    });

    for (let i = 0; i < 2; i += 1) {
      const holder = await createUser();
      await appoint({
        personId: holder.personId,
        districtId: org.districtId,
        rotaryYearId: org.currentYearId,
        positionId: position.id,
        scopeType: 'CLUB',
        scopeId: club.id,
      });
    }

    const response = await admin.delete(`/api/v1/positions/${position.id}`);

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('POSITION_IN_USE');
    expect(errorBody(response).details).toMatchObject({ activeAppointments: 2 });
  });

  it('allows deactivation once only PRIOR-year appointments remain', async () => {
    const club = await createClub();
    const position = await createPosition({
      districtId: org.districtId,
      code: 'LAST_YEAR_ROLE',
      scope: 'CLUB',
    });
    const holder = await createUser();
    await appoint({
      personId: holder.personId,
      districtId: org.districtId,
      rotaryYearId: org.previousYearId,
      positionId: position.id,
      scopeType: 'CLUB',
      scopeId: club.id,
      isActive: false,
    });

    // What rollover leaves behind. Refusing this would make the catalogue impossible to
    // tidy after the first year.
    expect((await admin.delete(`/api/v1/positions/${position.id}`)).status).toBe(200);
  });

  it('404s a position in another district', async () => {
    const other = await createOrg();
    const theirs = await createPosition({
      districtId: other.districtId,
      code: 'THEIRS',
      scope: 'CLUB',
    });

    expect((await admin.get(`/api/v1/positions/${theirs.id}`)).status).toBe(404);
    // A VALID body, so the 404 is the scope answering and not the validator. Body
    // validation runs first by design; it reports on the caller's own input and says
    // nothing about whether the record exists.
    const patched = await admin
      .patch(`/api/v1/positions/${theirs.id}`)
      .send({ name: 'Renamed by the wrong district' });
    expect(patched.status).toBe(404);
    expect((await admin.delete(`/api/v1/positions/${theirs.id}`)).status).toBe(404);
  });
});

describe('PUT /positions/:id/permissions', () => {
  it('replaces the whole set', async () => {
    const position = await createPosition({
      districtId: org.districtId,
      code: 'CLUB_SECRETARY',
      scope: 'CLUB',
      permissions: ['activity:create:club', 'activity:read:club'],
    });

    const response = await admin
      .put(`/api/v1/positions/${position.id}/permissions`)
      .send({ permissions: ['finance:read:club'] });

    expect(response.status).toBe(200);
    // Replace, not merge: the client sends what the grid shows.
    expect(positionResponseSchema.parse(response.body).data.permissions).toEqual([
      'finance:read:club',
    ]);
  });

  it('leaves the prior set intact when one code is unknown', async () => {
    const position = await createPosition({
      districtId: org.districtId,
      code: 'CLUB_SECRETARY',
      scope: 'CLUB',
      permissions: ['activity:create:club', 'activity:read:club'],
    });

    const response = await admin
      .put(`/api/v1/positions/${position.id}/permissions`)
      .send({ permissions: ['finance:read:club', 'finance:raed:club'] });

    expect(response.status).toBe(422);
    expect(errorBody(response).code).toBe('UNKNOWN_PERMISSION');

    // The whole point of "atomically": a half-applied permission set is a
    // half-authorised officer, and nobody would know which half.
    const after = await unscopedPrisma.positionPermission.findMany({
      where: { positionId: position.id },
      select: { permissionCode: true },
    });
    expect(after.map((row) => row.permissionCode).sort()).toEqual([
      'activity:create:club',
      'activity:read:club',
    ]);
  });

  it('accepts an empty set, and tolerates duplicates in the request', async () => {
    const position = await createPosition({
      districtId: org.districtId,
      code: 'OBSERVER',
      scope: 'CLUB',
      permissions: ['activity:read:club'],
    });

    const cleared = await admin
      .put(`/api/v1/positions/${position.id}/permissions`)
      .send({ permissions: [] });
    expect(positionResponseSchema.parse(cleared.body).data.permissions).toEqual([]);

    const duplicated = await admin
      .put(`/api/v1/positions/${position.id}/permissions`)
      .send({ permissions: ['activity:read:club', 'activity:read:club'] });
    // The composite primary key would reject the second row; de-duplicating is kinder
    // than making a checkbox grid responsible for it.
    expect(positionResponseSchema.parse(duplicated.body).data.permissions).toEqual([
      'activity:read:club',
    ]);
  });

  it('takes effect on the holder next request, with nothing to invalidate', async () => {
    const club = await createClub();
    const holder = await createUser();
    const position = await createPosition({
      districtId: org.districtId,
      code: 'CLUB_SECRETARY',
      scope: 'CLUB',
      permissions: ['activity:read:club'],
    });
    await appoint({
      personId: holder.personId,
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      positionId: position.id,
      scopeType: 'CLUB',
      scopeId: club.id,
    });

    const agent = await signIn(app, holder);
    const before = await agent.get('/api/v1/auth/me');
    expect(
      (before.body as { data: { context: { permissions: string[] } } }).data.context.permissions,
    ).toEqual(['activity:read:club']);

    await admin
      .put(`/api/v1/positions/${position.id}/permissions`)
      .send({ permissions: ['finance:read:club'] });

    // No cache to invalidate: resolveContext reads permissions from the database on every
    // request, and the only cache in the data layer is a WeakMap of Prisma clients keyed
    // on the per-request context object. This is what ADR-003 chose sessions for.
    const after = await agent.get('/api/v1/auth/me');
    expect(
      (after.body as { data: { context: { permissions: string[] } } }).data.context.permissions,
    ).toEqual(['finance:read:club']);
  });
});
