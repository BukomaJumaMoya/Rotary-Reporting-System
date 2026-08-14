import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { prisma } from './db.js';
import { closeSessionPool } from './session.js';
import {
  appoint,
  assignClubToCluster,
  createCluster,
  createClub,
  createOrg,
  createPosition,
  createRegion,
  createUser,
  errorBody,
  meBody,
  resetDatabase,
  signIn,
  type OrgFixture,
  type SeededUser,
} from '../test/helpers.js';
import { mountProbeRoutes } from '../test/probe-routes.js';

/**
 * Context resolution: who the caller is, in which district, for which year, with which
 * permissions, over which records.
 *
 * Everything here goes through the real app — session middleware, then the context
 * middleware, then a route — because the thing worth proving is that a handler receives
 * a correct context without doing anything to get one.
 */

const app = createApp(mountProbeRoutes);

const contextSchema = 'GET /api/v1/__probe/context';

interface ProbeContext {
  userId: string;
  personId: string;
  districtId: string;
  rotaryYearId: string;
  isYearWritable: boolean;
  permissions: string[];
  scopes: { clubIds: string[]; clusterIds: string[]; isDistrictWide: boolean };
}

function contextBody(response: { body: unknown }): ProbeContext {
  return (response.body as { data: ProbeContext }).data;
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeSessionPool();
});

/** A club secretary: one club, three permissions, no sight of anything else. */
async function seedClubSecretary(org: OrgFixture) {
  const user = await createUser();
  const club = await createClub('Rotaract Club of Kampala');
  const position = await createPosition({
    districtId: org.districtId,
    code: 'CLUB_SECRETARY',
    name: 'Club Secretary',
    scope: 'CLUB',
    permissions: ['activity:create:club', 'activity:read:club', 'membership:write:club'],
  });
  await appoint({
    personId: user.personId,
    districtId: org.districtId,
    rotaryYearId: org.currentYearId,
    positionId: position.id,
    scopeType: 'CLUB',
    scopeId: club.id,
  });
  return { user, club, position };
}

describe('context resolution', () => {
  it('resolves a club secretary to their own club and nothing more', async () => {
    const org = await createOrg();
    const { user, club } = await seedClubSecretary(org);

    const agent = await signIn(app, user);
    const response = await agent.get('/api/v1/__probe/context');

    expect(response.status, contextSchema).toBe(200);
    const ctx = contextBody(response);

    expect(ctx.userId).toBe(user.userId);
    expect(ctx.personId).toBe(user.personId);
    expect(ctx.districtId).toBe(org.districtId);
    expect(ctx.rotaryYearId).toBe(org.currentYearId);
    expect(ctx.permissions).toEqual([
      'activity:create:club',
      'activity:read:club',
      'membership:write:club',
    ]);
    expect(ctx.scopes.clubIds).toEqual([club.id]);
    expect(ctx.scopes.clusterIds).toEqual([]);
    expect(ctx.scopes.isDistrictWide).toBe(false);
    expect(ctx.isYearWritable).toBe(true);
  });

  it('expands an ADRR to every club in their cluster', async () => {
    const org = await createOrg();
    const user = await createUser();

    const cluster = await createCluster({
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      name: 'Central Cluster',
    });
    const first = await createClub('Rotaract Club of Nakawa');
    const second = await createClub('Rotaract Club of Ntinda');
    // A third club in the district but NOT in the cluster: the assertion is only
    // meaningful if there is something for the expansion to leave out.
    const outside = await createClub('Rotaract Club of Gulu');

    for (const club of [first, second]) {
      await assignClubToCluster({
        clubId: club.id,
        clusterId: cluster.id,
        rotaryYearId: org.currentYearId,
      });
    }

    const position = await createPosition({
      districtId: org.districtId,
      code: 'ADRR',
      name: 'Assistant District Rotaract Representative',
      scope: 'CLUSTER',
      permissions: ['activity:verify:district'],
    });
    await appoint({
      personId: user.personId,
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      positionId: position.id,
      scopeType: 'CLUSTER',
      scopeId: cluster.id,
    });

    const agent = await signIn(app, user);
    const ctx = contextBody(await agent.get('/api/v1/__probe/context'));

    expect(ctx.scopes.clusterIds).toEqual([cluster.id]);
    expect(ctx.scopes.clubIds).toEqual([first.id, second.id].sort());
    expect(ctx.scopes.clubIds).not.toContain(outside.id);
    expect(ctx.scopes.isDistrictWide).toBe(false);
  });

  it('expands a region appointment through its clusters to their clubs', async () => {
    const org = await createOrg();
    const user = await createUser();

    const region = await createRegion(org.districtId, 'Central Region');
    const cluster = await createCluster({
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      regionId: region.id,
    });
    const club = await createClub();
    await assignClubToCluster({
      clubId: club.id,
      clusterId: cluster.id,
      rotaryYearId: org.currentYearId,
    });

    const position = await createPosition({
      districtId: org.districtId,
      code: 'LDRR',
      scope: 'REGION',
      permissions: ['activity:verify:district'],
    });
    await appoint({
      personId: user.personId,
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      positionId: position.id,
      scopeType: 'REGION',
      scopeId: region.id,
    });

    const agent = await signIn(app, user);
    const ctx = contextBody(await agent.get('/api/v1/__probe/context'));

    expect(ctx.scopes.clusterIds).toEqual([cluster.id]);
    expect(ctx.scopes.clubIds).toEqual([club.id]);
  });

  it('resolves the PIME Chair district-wide without enumerating every club', async () => {
    const org = await createOrg();
    const user = await createUser();
    await createClub();
    await createClub();

    const position = await createPosition({
      districtId: org.districtId,
      code: 'PIME_CHAIR',
      name: 'PIME Chair',
      scope: 'DISTRICT',
      permissions: [
        'assessment:finalise:district',
        'framework:manage:district',
        'year:read:historical',
      ],
    });
    await appoint({
      personId: user.personId,
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      positionId: position.id,
      scopeType: 'DISTRICT',
      scopeId: null,
    });

    const agent = await signIn(app, user);
    const ctx = contextBody(await agent.get('/api/v1/__probe/context'));

    expect(ctx.scopes.isDistrictWide).toBe(true);
    // A boolean answers the question. Listing 140 club ids into every request would be
    // work done 140 times to no purpose.
    expect(ctx.scopes.clubIds).toEqual([]);
    expect(ctx.permissions).toContain('assessment:finalise:district');
  });

  it('unions the permissions of every position a member holds', async () => {
    const org = await createOrg();
    const user = await createUser();
    const club = await createClub();

    const secretary = await createPosition({
      districtId: org.districtId,
      code: 'CLUB_SECRETARY',
      scope: 'CLUB',
      permissions: ['activity:create:club'],
    });
    const assessor = await createPosition({
      districtId: org.districtId,
      code: 'ASSESSOR',
      scope: 'DISTRICT',
      permissions: ['assessment:score:assigned'],
    });

    await appoint({
      personId: user.personId,
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      positionId: secretary.id,
      scopeType: 'CLUB',
      scopeId: club.id,
    });
    await appoint({
      personId: user.personId,
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      positionId: assessor.id,
      scopeType: 'DISTRICT',
    });

    const agent = await signIn(app, user);
    const ctx = contextBody(await agent.get('/api/v1/__probe/context'));

    expect(ctx.permissions).toEqual(['activity:create:club', 'assessment:score:assigned']);
    expect(ctx.scopes.isDistrictWide).toBe(true);
    expect(ctx.scopes.clubIds).toEqual([club.id]);
  });
});

describe('a member with no authority', () => {
  it('signs in, sees their own account, and is refused every scoped route', async () => {
    await createOrg();
    const user = await createUser();

    const agent = await signIn(app, user);

    const me = meBody(await agent.get('/api/v1/auth/me'));
    expect(me.context.districtId).toBeNull();
    expect(me.context.rotaryYearId).toBeNull();
    expect(me.context.permissions).toEqual([]);
    expect(me.appointments).toEqual([]);

    const probe = await agent.get('/api/v1/__probe/context');
    // 403, not 404: this says nothing about whether any record exists, only what the
    // caller holds — which they already know.
    expect(probe.status).toBe(403);
    expect(errorBody(probe).code).toBe('INSUFFICIENT_SCOPE');
  });

  it('ignores an appointment held only in a past year', async () => {
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
      // Last year. Rollover does not have to remove anybody; the appointment simply
      // stops being in the current year.
      rotaryYearId: org.previousYearId,
      positionId: position.id,
      scopeType: 'CLUB',
      scopeId: club.id,
    });

    const agent = await signIn(app, user);
    expect((await agent.get('/api/v1/__probe/context')).status).toBe(403);
  });

  it('ignores a revoked appointment', async () => {
    const org = await createOrg();
    const user = await createUser();
    const club = await createClub();
    const position = await createPosition({
      districtId: org.districtId,
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
      isActive: false,
    });

    const agent = await signIn(app, user);
    expect((await agent.get('/api/v1/__probe/context')).status).toBe(403);
  });

  it('ignores an appointment whose term has ended', async () => {
    const org = await createOrg();
    const user = await createUser();
    const club = await createClub();
    const position = await createPosition({
      districtId: org.districtId,
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
      endsOn: new Date(Date.UTC(2021, 5, 30)),
    });

    const agent = await signIn(app, user);
    expect((await agent.get('/api/v1/__probe/context')).status).toBe(403);
  });

  it('refuses an unauthenticated caller before anything else', async () => {
    const response = await request(app).get('/api/v1/__probe/context');

    expect(response.status).toBe(401);
    expect(errorBody(response).code).toBe('UNAUTHENTICATED');
  });
});

describe('POST /auth/login', () => {
  it('returns the resolved context, not the empty shape a member without one gets', async () => {
    const org = await createOrg();
    const { user, club } = await seedClubSecretary(org);

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password });

    expect(response.status).toBe(200);
    const me = meBody(response);

    // The context middleware runs before the session exists on this one request, so
    // without the login handler resolving it explicitly the response reports nulls —
    // indistinguishable from "you hold no appointment", and a client that renders
    // straight from the login response would tell an officer they have no authority.
    expect(me.context.districtId).toBe(org.districtId);
    expect(me.context.rotaryYearLabel).toBe(org.currentYearLabel);
    expect(me.context.permissions).toContain('activity:create:club');
    expect(me.context.scopes.clubIds).toEqual([club.id]);
    expect(me.appointments).toHaveLength(1);
  });

  it('is identical to what the next call to /auth/me reports', async () => {
    const org = await createOrg();
    const { user } = await seedClubSecretary(org);

    const agent = await signIn(app, user);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password });

    expect(meBody(login).context).toEqual(meBody(await agent.get('/api/v1/auth/me')).context);
  });
});

describe('GET /auth/me', () => {
  it('returns the resolved context and the appointments behind it', async () => {
    const org = await createOrg();
    const { user, club } = await seedClubSecretary(org);

    const agent = await signIn(app, user);
    const me = meBody(await agent.get('/api/v1/auth/me'));

    expect(me.context.districtId).toBe(org.districtId);
    expect(me.context.districtName).toBe(org.districtName);
    expect(me.context.rotaryYearId).toBe(org.currentYearId);
    expect(me.context.rotaryYearLabel).toBe(org.currentYearLabel);
    expect(me.context.isYearLocked).toBe(false);
    expect(me.context.isYearWritable).toBe(true);
    expect(me.context.scopes.clubIds).toEqual([club.id]);

    expect(me.appointments).toHaveLength(1);
    expect(me.appointments[0]).toMatchObject({
      positionCode: 'CLUB_SECRETARY',
      positionName: 'Club Secretary',
      scopeType: 'CLUB',
      scopeId: club.id,
      // Resolved server-side: scopeId is polymorphic, so a client would otherwise have
      // to guess which of four tables to look it up in.
      scopeName: 'Rotaract Club of Kampala',
      startsOn: '2020-01-01',
      endsOn: null,
    });
  });

  it('names a district-scoped appointment after the district', async () => {
    const org = await createOrg();
    const user = await createUser();
    const position = await createPosition({
      districtId: org.districtId,
      code: 'DRR',
      name: 'District Rotaract Representative',
      scope: 'DISTRICT',
      permissions: [],
    });
    await appoint({
      personId: user.personId,
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      positionId: position.id,
      scopeType: 'DISTRICT',
    });

    const agent = await signIn(app, user);
    const me = meBody(await agent.get('/api/v1/auth/me'));

    expect(me.appointments[0]?.scopeName).toBe(org.districtName);
  });

  it('carries no contact details', async () => {
    const org = await createOrg();
    const { user } = await seedClubSecretary(org);

    const agent = await signIn(app, user);
    const response = await agent.get('/api/v1/auth/me');

    // /auth/me is called on every page load by every client, on metered mobile data.
    // It is also the endpoint most likely to grow a "convenient" contact field.
    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toContain(user.email);
    expect(serialised).not.toContain('phone');
  });
});

describe('the ?year= override', () => {
  async function seedHistorian(
    org: OrgFixture,
    permissions: string[],
  ): Promise<{ user: SeededUser }> {
    const user = await createUser();
    const position = await createPosition({
      districtId: org.districtId,
      code: 'PIME_CHAIR',
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
    return { user };
  }

  it('is refused without year:read:historical', async () => {
    const org = await createOrg();
    const { user } = await seedHistorian(org, ['assessment:finalise:district']);

    const agent = await signIn(app, user);
    const response = await agent.get(`/api/v1/__probe/context?year=${org.previousYearLabel}`);

    // Refused, not silently ignored. Serving the current year under a past year's label
    // is the error nobody catches until the number is quoted in a district assembly.
    expect(response.status).toBe(403);
    expect(errorBody(response).code).toBe('INSUFFICIENT_SCOPE');
  });

  it('moves the whole context to the requested year when the permission is held', async () => {
    const org = await createOrg();
    const { user } = await seedHistorian(org, ['year:read:historical']);

    const agent = await signIn(app, user);
    const ctx = contextBody(
      await agent.get(`/api/v1/__probe/context?year=${org.previousYearLabel}`),
    );

    expect(ctx.rotaryYearId).toBe(org.previousYearId);
    // A read door. `year:read:historical` grants no right to write into a closed year.
    expect(ctx.isYearWritable).toBe(false);
  });

  it('accepts the current year by name without any permission', async () => {
    const org = await createOrg();
    const { user } = await seedHistorian(org, []);

    const agent = await signIn(app, user);
    const response = await agent.get(`/api/v1/__probe/context?year=${org.currentYearLabel}`);

    expect(response.status).toBe(200);
    expect(contextBody(response).rotaryYearId).toBe(org.currentYearId);
    expect(contextBody(response).isYearWritable).toBe(true);
  });

  it('404s a year the district never ran', async () => {
    const org = await createOrg();
    const { user } = await seedHistorian(org, ['year:read:historical']);

    const agent = await signIn(app, user);
    const response = await agent.get('/api/v1/__probe/context?year=1999-00');

    // 404 rather than 403: a year the district did not run and a year that does not
    // exist are the same answer, so guessing labels maps nothing.
    expect(response.status).toBe(404);
  });

  it('rejects a malformed year before it can reach a query', async () => {
    const org = await createOrg();
    const { user } = await seedHistorian(org, ['year:read:historical']);

    const agent = await signIn(app, user);
    const response = await agent.get('/api/v1/__probe/context?year=last-year');

    expect(response.status).toBe(400);
    expect(errorBody(response).code).toBe('VALIDATION_ERROR');
  });

  it('reports a locked year as unwritable', async () => {
    const org = await createOrg({ isCurrentYearLocked: true });
    const { user } = await seedHistorian(org, []);

    const agent = await signIn(app, user);
    const ctx = contextBody(await agent.get('/api/v1/__probe/context'));

    expect(ctx.rotaryYearId).toBe(org.currentYearId);
    expect(ctx.isYearWritable).toBe(false);
  });
});
