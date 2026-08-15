import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clubListResponseSchema,
  clubResponseSchema,
  clubSummaryResponseSchema,
  clusterListResponseSchema,
} from '@dis/contracts';
import { createApp } from '../../app.js';
import { unscopedPrisma } from '../../platform/db.js';
import {
  affiliateClub,
  appoint,
  assignClubToCluster,
  createCluster,
  createClub,
  createClubIn,
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
import { recalculateTier } from './clubs.service.js';

/**
 * Clubs — the first surface built on axiom 2.
 *
 * The assertions that earn their keep are the two about affiliation: a club affiliated to
 * another district must be invisible, and it must be invisible without any handler having
 * written a district filter. That is the whole design — the join lives in the repository,
 * the scope lives in the data access layer, and a club has no district column to leak
 * through.
 */

const DISTRICT_PERMISSIONS = [
  'club:read:district',
  'club:create:district',
  'club:update:district',
  'club:affiliate:district',
  'cluster:manage:district',
];

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

describe('clubs', () => {
  let app: Express;
  let org: OrgFixture;

  beforeEach(async () => {
    await resetDatabase();
    app = createApp();
    org = await createOrg();
  });

  it('lists only clubs affiliated to the district for the current year', async () => {
    const mine = await createClubIn(org, 'Rotaract Club of Kampala');
    const other = await createOrg({ riDistrictCode: 'D-9214' });
    const theirs = await createClub('Rotaract Club of Mbale');
    await affiliateClub({
      clubId: theirs.id,
      districtId: other.districtId,
      rotaryYearId: other.currentYearId,
    });

    // Affiliated to MY district, but for last year. Same club, different dimension.
    const lastYear = await createClub('Rotaract Club of Gulu');
    await affiliateClub({
      clubId: lastYear.id,
      districtId: org.districtId,
      rotaryYearId: org.previousYearId,
    });

    const { agent } = await signInAs(app, org, { permissions: ['club:read:district'] });
    const response = await agent.get('/api/v1/clubs');

    expect(response.status).toBe(200);
    const body = clubListResponseSchema.parse(response.body);
    expect(body.data.map((club) => club.id)).toEqual([mine.id]);
    expect(body.meta.total).toBe(1);
  });

  it('404s a club affiliated to another district — it does not 403', async () => {
    const other = await createOrg({ riDistrictCode: 'D-9214' });
    const theirs = await createClub();
    await affiliateClub({
      clubId: theirs.id,
      districtId: other.districtId,
      rotaryYearId: other.currentYearId,
    });

    const { agent } = await signInAs(app, org, { permissions: ['club:read:district'] });
    const response = await agent.get(`/api/v1/clubs/${theirs.id}`);

    // 403 would confirm the club exists, which hands the shape of the dataset to anyone
    // willing to walk a list of identifiers.
    expect(response.status).toBe(404);
    expect(errorBody(response).code).toBe('NOT_FOUND');
  });

  it('creates a club with its affiliation, atomically', async () => {
    const { agent } = await signInAs(app, org, { permissions: DISTRICT_PERMISSIONS });

    const response = await agent.post('/api/v1/clubs').send({
      name: 'Rotaract Club of Entebbe',
      baseType: 'CBC',
      riClubId: '90210',
      meetingDay: 3,
      meetingTime: '18:30',
      meetingVenue: 'Lake Victoria Hotel',
    });

    expect(response.status).toBe(201);
    const club = clubResponseSchema.parse(response.body).data;
    expect(club.slug).toBe('rotaract-club-of-entebbe');
    expect(club.riClubId).toBe('90210');
    expect(club.meetingTime).toBe('18:30');
    // A new club with no roster starts at T1, and the tier is on the affiliation.
    expect(club.affiliation?.tier).toBe('T1');

    // Both rows, or neither. A club with no affiliation belongs to no district and is
    // reachable by no endpoint here.
    const affiliations = await unscopedPrisma.clubDistrictAffiliation.findMany({
      where: { clubId: club.id },
    });
    expect(affiliations).toHaveLength(1);
    expect(affiliations[0]?.districtId).toBe(org.districtId);
  });

  it('refuses a duplicate RI Club ID', async () => {
    const existing = await createClubIn(org, 'Rotaract Club of Jinja');
    await unscopedPrisma.club.update({ where: { id: existing.id }, data: { riClubId: 12345n } });

    const { agent } = await signInAs(app, org, { permissions: DISTRICT_PERMISSIONS });
    const response = await agent
      .post('/api/v1/clubs')
      .send({ name: 'Rotaract Club of Impostors', baseType: 'CBC', riClubId: '12345' });

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('RI_ID_ALREADY_CLAIMED');
  });

  it('answers a replayed create with the id it already has, not a second club', async () => {
    const { agent } = await signInAs(app, org, { permissions: DISTRICT_PERMISSIONS });
    const id = randomUUID();
    const body = { id, name: 'Rotaract Club of Offline', baseType: 'CBC' as const };

    expect((await agent.post('/api/v1/clubs').send(body)).status).toBe(201);
    const replay = await agent.post('/api/v1/clubs').send(body);

    expect(replay.status).toBe(409);
    expect(errorBody(replay).code).toBe('IDEMPOTENT_REPLAY');
    expect(await unscopedPrisma.club.count({ where: { id } })).toBe(1);
  });

  it('lets a club officer edit their own club and nobody else’s', async () => {
    const mine = await createClubIn(org, 'Rotaract Club of Mine');
    const theirs = await createClubIn(org, 'Rotaract Club of Theirs');

    const { agent } = await signInAs(app, org, {
      permissions: ['club:read:district', 'club:update:own'],
      scopeType: 'CLUB',
      scopeId: mine.id,
    });

    const own = await agent.patch(`/api/v1/clubs/${mine.id}`).send({ meetingVenue: 'The usual' });
    expect(own.status).toBe(200);
    expect(clubResponseSchema.parse(own.body).data.meetingVenue).toBe('The usual');

    // Another club in the SAME district: the caller can read it, and still may not edit it.
    const other = await agent.patch(`/api/v1/clubs/${theirs.id}`).send({ meetingVenue: 'Nope' });
    expect(other.status).toBe(404);
  });

  it('lets a district officer edit any affiliated club', async () => {
    const club = await createClubIn(org);
    const { agent } = await signInAs(app, org, { permissions: DISTRICT_PERMISSIONS });

    const response = await agent.patch(`/api/v1/clubs/${club.id}`).send({ status: 'SUSPENDED' });

    expect(response.status).toBe(200);
    expect(clubResponseSchema.parse(response.body).data.status).toBe('SUSPENDED');
  });

  it('refuses an edit from somebody holding neither update permission', async () => {
    const club = await createClubIn(org);
    const { agent } = await signInAs(app, org, { permissions: ['club:read:district'] });

    const response = await agent.patch(`/api/v1/clubs/${club.id}`).send({ meetingVenue: 'x' });

    // 403, not 404: this describes the caller's own authority and reveals nothing.
    expect(response.status).toBe(403);
    expect(errorBody(response).code).toBe('INSUFFICIENT_SCOPE');
  });

  it('refuses to affiliate a club that belongs to another district this year', async () => {
    const other = await createOrg({ riDistrictCode: 'D-9214' });
    const club = await createClub();
    await affiliateClub({
      clubId: club.id,
      districtId: other.districtId,
      rotaryYearId: other.currentYearId,
    });

    const { agent } = await signInAs(app, org, { permissions: DISTRICT_PERMISSIONS });
    const response = await agent.post(`/api/v1/clubs/${club.id}/affiliations`).send({});

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('CLUB_AFFILIATED_ELSEWHERE');
    // The refusal deliberately does not name the other district: that would be a read
    // across the boundary made to write a better error message.
    expect(JSON.stringify(errorBody(response))).not.toContain(other.districtId);
  });

  it('affiliates a club that has no district this year', async () => {
    const club = await createClub('Rotaract Club of Arrivals');
    const { agent } = await signInAs(app, org, { permissions: DISTRICT_PERMISSIONS });

    const response = await agent
      .post(`/api/v1/clubs/${club.id}/affiliations`)
      .send({ tier: 'T2', isConfirmed: true });

    expect(response.status).toBe(201);
    expect(await agent.get(`/api/v1/clubs/${club.id}`).then((r) => r.status)).toBe(200);
  });

  it('returns a whole club page in one call', async () => {
    const club = await createClubIn(org, 'Rotaract Club of Summary');
    const { agent } = await signInAs(app, org, { permissions: ['club:read:district'] });

    const response = await agent.get(`/api/v1/clubs/${club.id}/summary`);

    expect(response.status).toBe(200);
    const summary = clubSummaryResponseSchema.parse(response.body).data;
    expect(summary.club.id).toBe(club.id);
    expect(summary.rosterCount).toBe(0);
    expect(summary.activities).toEqual({ total: 0, verified: 0, unverified: 0 });
    // Shape fixed now, filled in M4 and M5. A client written against this is not rewritten.
    expect(summary.dues).toBeNull();
    expect(summary.score).toBeNull();
  });

  it('filters by cluster, tier and name', async () => {
    const region = await createRegion(org.districtId, 'Central');
    const cluster = await createCluster({
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      regionId: region.id,
      name: 'Kampala Central',
    });

    const inCluster = await createClubIn(org, 'Rotaract Club of Nakawa');
    await createClubIn(org, 'Rotaract Club of Elsewhere');
    await assignClubToCluster({
      clubId: inCluster.id,
      clusterId: cluster.id,
      rotaryYearId: org.currentYearId,
    });

    const { agent } = await signInAs(app, org, { permissions: ['club:read:district'] });

    const byCluster = clubListResponseSchema.parse(
      (await agent.get('/api/v1/clubs').query({ clusterId: cluster.id })).body,
    );
    expect(byCluster.data.map((club) => club.id)).toEqual([inCluster.id]);
    expect(byCluster.data[0]?.affiliation?.clusterName).toBe('Kampala Central');
    expect(byCluster.data[0]?.affiliation?.regionName).toBe('Central');

    const bySearch = clubListResponseSchema.parse(
      (await agent.get('/api/v1/clubs').query({ q: 'nakawa' })).body,
    );
    expect(bySearch.data.map((club) => club.id)).toEqual([inCluster.id]);

    const byTier = clubListResponseSchema.parse(
      (await agent.get('/api/v1/clubs').query({ tier: 'IBC' })).body,
    );
    expect(byTier.data).toHaveLength(0);
  });
});

describe('the tier rule', () => {
  it('puts the T1/T2 boundary at forty', () => {
    // Thirty-nine members is T1 and forty is T2. Off by one here is a club scored against
    // the wrong framework for a year.
    expect(recalculateTier('CBC', 0)).toBe('T1');
    expect(recalculateTier('CBC', 39)).toBe('T1');
    expect(recalculateTier('CBC', 40)).toBe('T2');
    expect(recalculateTier('CBC', 41)).toBe('T2');
  });

  it('is unconditional for an institution-based club', () => {
    // An IBC is assessed against other IBCs whatever its size — a university club with 200
    // members and one with 12 face the same constraints, and neither faces a CBC's.
    expect(recalculateTier('IBC', 5)).toBe('IBC');
    expect(recalculateTier('IBC', 500)).toBe('IBC');
  });
});

describe('clusters', () => {
  let app: Express;
  let org: OrgFixture;

  beforeEach(async () => {
    await resetDatabase();
    app = createApp();
    org = await createOrg();
  });

  it('creates a cluster and sets its whole club membership', async () => {
    const region = await createRegion(org.districtId, 'Eastern');
    const first = await createClubIn(org, 'Rotaract Club of A');
    const second = await createClubIn(org, 'Rotaract Club of B');
    const { agent } = await signInAs(app, org, { permissions: DISTRICT_PERMISSIONS });

    const created = await agent
      .post('/api/v1/clusters')
      .send({ name: 'Eastern One', regionId: region.id });
    expect(created.status).toBe(201);
    const clusterId = (created.body as { data: { id: string } }).data.id;

    const set = await agent
      .post(`/api/v1/clusters/${clusterId}/clubs`)
      .send({ clubIds: [first.id, second.id] });
    expect(set.status).toBe(200);
    expect((set.body as { data: { clubCount: number } }).data.clubCount).toBe(2);

    // Sending the WHOLE membership, not a diff: this call removes the second club.
    const reduced = await agent
      .post(`/api/v1/clusters/${clusterId}/clubs`)
      .send({ clubIds: [first.id] });
    expect((reduced.body as { data: { clubCount: number } }).data.clubCount).toBe(1);
  });

  it('refuses to put a club from another district into a cluster', async () => {
    const other = await createOrg({ riDistrictCode: 'D-9214' });
    const stranger = await createClub();
    await affiliateClub({
      clubId: stranger.id,
      districtId: other.districtId,
      rotaryYearId: other.currentYearId,
    });

    const cluster = await createCluster({
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
    });
    const { agent } = await signInAs(app, org, { permissions: DISTRICT_PERMISSIONS });

    const response = await agent
      .post(`/api/v1/clusters/${cluster.id}/clubs`)
      .send({ clubIds: [stranger.id] });

    expect(response.status).toBe(422);
    expect(errorBody(response).code).toBe('INVALID_SCOPE_REFERENCE');
  });

  it('does not show another district’s clusters', async () => {
    const other = await createOrg({ riDistrictCode: 'D-9214' });
    await createCluster({
      districtId: other.districtId,
      rotaryYearId: other.currentYearId,
      name: 'Not Yours',
    });
    await createCluster({
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      name: 'Yours',
    });

    const { agent } = await signInAs(app, org, { permissions: ['club:read:district'] });
    const body = clusterListResponseSchema.parse((await agent.get('/api/v1/clusters')).body);

    expect(body.data.map((cluster) => cluster.name)).toEqual(['Yours']);
  });

  it('refuses cluster management without the permission', async () => {
    const { agent } = await signInAs(app, org, { permissions: ['club:read:district'] });
    const response = await agent.post('/api/v1/clusters').send({ name: 'Sneaky' });

    expect(response.status).toBe(403);
  });
});
