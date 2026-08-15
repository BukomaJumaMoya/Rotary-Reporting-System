import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import sharp from 'sharp';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  activityListResponseSchema,
  activityResponseSchema,
  activityTypeResponseSchema,
} from '@dis/contracts';
import { createApp } from '../../app.js';
import { unscopedPrisma } from '../../platform/db.js';
import { setStorageDriver, type StorageDriver } from '../../platform/storage.js';
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
} from '../../test/helpers.js';

/**
 * Activities — one model, configurable types (axiom 4).
 *
 * The assertions that matter are the ones about the TYPE. A club assembly hosted by a region
 * is refused because the type says so, not because of a branch in a handler; a service
 * project with no photograph is refused because `requires_photo` is true on a row. That is
 * the whole axiom: adding a type changes no code, and the checks read the row.
 */

const CLUB_PERMISSIONS = ['activity:read:club', 'activity:create:club'];

/** Storage in memory: these tests are about activities, not about a bucket. */
function memoryStorage(): StorageDriver {
  const objects = new Map<string, Buffer>();
  return {
    put: async (input) => {
      objects.set(input.key, input.body);
      await Promise.resolve();
      return {
        key: input.key,
        size: input.body.byteLength,
        contentType: input.contentType,
        digest: 'test',
      };
    },
    get: async (key) => {
      await Promise.resolve();
      return objects.get(key) ?? Buffer.alloc(0);
    },
    remove: async (key) => {
      objects.delete(key);
      await Promise.resolve();
    },
    signedUrl: async (key) => {
      await Promise.resolve();
      return `memory://${key}`;
    },
  };
}

async function signInAs(
  app: Express,
  org: OrgFixture,
  options: { permissions?: string[]; scopeType?: 'DISTRICT' | 'CLUB'; scopeId?: string } = {},
) {
  const user = await createUser();
  const position = await createPosition({
    districtId: org.districtId,
    scope: options.scopeType ?? 'DISTRICT',
    permissions: options.permissions ?? [...CLUB_PERMISSIONS, 'activity:verify:district'],
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

/** An activity type with whatever requirements the test is about. */
async function activityType(
  org: OrgFixture,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string }> {
  return unscopedPrisma.activityType.create({
    data: {
      districtId: org.districtId,
      code: `TYPE_${randomUUID().slice(0, 8)}`,
      name: 'Service project',
      category: 'SERVICE',
      allowedHostScopes: ['CLUB'],
      ...overrides,
    },
    select: { id: true },
  });
}

describe('activity types', () => {
  let app: Express;
  let org: OrgFixture;

  beforeEach(async () => {
    await resetDatabase();
    app = createApp();
    org = await createOrg();
  });

  it('creates a type with declared extra fields', async () => {
    const { agent } = await signInAs(app, org, {
      permissions: ['activity:read:club', 'activitytype:manage:district'],
    });

    const response = await agent.post('/api/v1/activity-types').send({
      code: 'TREE_PLANTING',
      name: 'Tree planting',
      category: 'SERVICE',
      allowedHostScopes: ['CLUB', 'CLUSTER'],
      requiresPhoto: true,
      requiresAreaOfFocus: true,
      fieldConfig: {
        fields: [
          { key: 'species', label: 'Species planted', type: 'text', required: true },
          {
            key: 'landOwner',
            label: 'Land owner',
            type: 'select',
            required: false,
            options: ['Public', 'Private', 'Institutional'],
          },
        ],
      },
    });

    expect(response.status).toBe(201);
    const type = activityTypeResponseSchema.parse(response.body).data;
    expect(type.fieldConfig.fields).toHaveLength(2);
    expect(type.fieldConfig.fields[0]?.required).toBe(true);
    // Adding a type is an INSERT: no deployment, no client release.
    expect(type.isTemplate).toBe(false);
  });

  it('refuses a select field with no options', async () => {
    const { agent } = await signInAs(app, org, {
      permissions: ['activity:read:club', 'activitytype:manage:district'],
    });

    const response = await agent.post('/api/v1/activity-types').send({
      code: 'BROKEN',
      name: 'Broken',
      category: 'SERVICE',
      fieldConfig: {
        fields: [{ key: 'choice', label: 'Choice', type: 'select', required: true }],
      },
    });

    // A select with no options reaches a secretary as a blank dropdown next to a required
    // marker, which is a form nobody can complete.
    expect(response.status).toBe(400);
    expect(errorBody(response).code).toBe('VALIDATION_ERROR');
  });

  it('refuses a write to a shared template', async () => {
    const template = await unscopedPrisma.activityType.create({
      data: { districtId: null, code: 'SHARED', name: 'Shared', category: 'SERVICE' },
      select: { id: true },
    });

    const { agent } = await signInAs(app, org, {
      permissions: ['activity:read:club', 'activitytype:manage:district'],
    });

    const response = await agent
      .patch(`/api/v1/activity-types/${template.id}`)
      .send({ name: 'Hijacked' });

    // 403 rather than 404: the row is legitimately visible, so pretending it is absent
    // would be a lie the caller can disprove with a GET.
    expect(response.status).toBe(403);
    expect(errorBody(response).code).toBe('TEMPLATE_IMMUTABLE');
  });
});

describe('reporting an activity', () => {
  let app: Express;
  let org: OrgFixture;

  beforeEach(async () => {
    await resetDatabase();
    setStorageDriver(memoryStorage());
    app = createApp();
    org = await createOrg();
  });

  it('records one, with no length limit on the description', async () => {
    const club = await createClubIn(org);
    const type = await activityType(org);
    const { agent } = await signInAs(app, org);

    // The predecessor's description limit was a logged complaint. A club that has run a
    // six-month project has more than 500 characters to say about it.
    const longDescription = 'We ran a medical camp. '.repeat(500);

    const response = await agent.post('/api/v1/activities').send({
      activityTypeId: type.id,
      hostScopeType: 'CLUB',
      hostScopeId: club.id,
      title: 'Medical camp at Nakawa',
      description: longDescription,
      startsAt: '2027-09-14T08:00:00.000Z',
      beneficiariesCount: 320,
      fundsRaised: '1250000.00',
    });

    expect(response.status).toBe(201);
    const activity = activityResponseSchema.parse(response.body).data;
    expect(activity.description).toHaveLength(longDescription.length);
    // Money is NUMERIC and travels as a string: a Decimal through a JSON number comes back
    // as a float, which is the one thing money must never be.
    expect(activity.fundsRaised).toBe('1250000');
    expect(activity.verification).toBe('UNVERIFIED');
  });

  it('is idempotent on a client-generated UUID', async () => {
    const club = await createClubIn(org);
    const type = await activityType(org);
    const { agent } = await signInAs(app, org);
    const id = randomUUID();

    const body = {
      id,
      activityTypeId: type.id,
      hostScopeType: 'CLUB',
      hostScopeId: club.id,
      title: 'Weekly fellowship',
      startsAt: '2027-09-14T17:00:00.000Z',
    };

    expect((await agent.post('/api/v1/activities').send(body)).status).toBe(201);
    const replay = await agent.post('/api/v1/activities').send(body);

    // 200, not 409: the client generated the id precisely so a retry would be safe.
    expect(replay.status).toBe(200);
    expect(await unscopedPrisma.activity.count({ where: { id } })).toBe(1);
  });

  it('refuses a host the TYPE does not allow', async () => {
    const club = await createClubIn(org);
    // A club assembly hosted by a region is not a thing, and the type says so rather than a
    // branch in a handler.
    const type = await activityType(org, { allowedHostScopes: ['DISTRICT'] });
    const { agent } = await signInAs(app, org);

    const response = await agent.post('/api/v1/activities').send({
      activityTypeId: type.id,
      hostScopeType: 'CLUB',
      hostScopeId: club.id,
      title: 'Wrong host',
      startsAt: '2027-09-14T08:00:00.000Z',
    });

    expect(response.status).toBe(422);
    expect(errorBody(response).code).toBe('SCOPE_TYPE_MISMATCH');
  });

  it('refuses a host outside the caller’s own scope', async () => {
    const mine = await createClubIn(org, 'Rotaract Club of Mine');
    const theirs = await createClubIn(org, 'Rotaract Club of Theirs');
    const type = await activityType(org);

    const { agent } = await signInAs(app, org, {
      permissions: CLUB_PERMISSIONS,
      scopeType: 'CLUB',
      scopeId: mine.id,
    });

    const response = await agent.post('/api/v1/activities').send({
      activityTypeId: type.id,
      hostScopeType: 'CLUB',
      hostScopeId: theirs.id,
      title: 'Not mine to report',
      startsAt: '2027-09-14T08:00:00.000Z',
    });

    expect(response.status).toBe(404);
  });

  it('refuses a missing field the TYPE declares, naming the key', async () => {
    const club = await createClubIn(org);
    const type = await activityType(org, {
      requiresReport: true,
      fieldConfig: {
        fields: [{ key: 'species', label: 'Species planted', type: 'text', required: true }],
      },
    });
    const { agent } = await signInAs(app, org);

    const base = {
      activityTypeId: type.id,
      hostScopeType: 'CLUB',
      hostScopeId: club.id,
      title: 'Tree planting',
      startsAt: '2027-09-14T08:00:00.000Z',
    };

    const noReport = await agent.post('/api/v1/activities').send(base);
    expect(noReport.status).toBe(422);
    expect(errorBody(noReport).code).toBe('MISSING_REQUIRED_FIELD_FOR_TYPE');
    // The key is in `details`, so a client can point at the field rather than at the form.
    expect(errorBody(noReport).details?.['key']).toBe('narrativeReport');

    const noSpecies = await agent
      .post('/api/v1/activities')
      .send({ ...base, narrativeReport: 'We planted trees.' });
    expect(errorBody(noSpecies).details?.['key']).toBe('species');

    const complete = await agent.post('/api/v1/activities').send({
      ...base,
      narrativeReport: 'We planted trees.',
      extra: { species: 'Musizi', notDeclared: 'dropped' },
    });
    expect(complete.status).toBe(201);

    // Only DECLARED keys are stored. `extra` is JSONB and a client can put anything in it;
    // keeping what was sent would make the column an unversioned schema nobody agreed to.
    const stored = activityResponseSchema.parse(complete.body).data;
    expect(stored.extra).toEqual({ species: 'Musizi' });
  });

  it('lists only activities the caller may see', async () => {
    const mine = await createClubIn(org, 'Rotaract Club of Mine');
    const theirs = await createClubIn(org, 'Rotaract Club of Theirs');
    const type = await activityType(org);

    for (const clubId of [mine.id, theirs.id]) {
      await unscopedPrisma.activity.create({
        data: {
          districtId: org.districtId,
          rotaryYearId: org.currentYearId,
          activityTypeId: type.id,
          hostScopeType: 'CLUB',
          hostScopeId: clubId,
          title: clubId === mine.id ? 'Mine' : 'Theirs',
          startsAt: new Date('2027-09-14T08:00:00.000Z'),
        },
      });
    }

    const { agent } = await signInAs(app, org, {
      permissions: CLUB_PERMISSIONS,
      scopeType: 'CLUB',
      scopeId: mine.id,
    });

    const body = activityListResponseSchema.parse((await agent.get('/api/v1/activities')).body);
    // A list must not 404 because one row in it is out of scope; the rows are filtered.
    expect(body.data.map((activity) => activity.title)).toEqual(['Mine']);
  });
});

describe('verification', () => {
  let app: Express;
  let org: OrgFixture;

  beforeEach(async () => {
    await resetDatabase();
    setStorageDriver(memoryStorage());
    app = createApp();
    org = await createOrg();
  });

  async function anActivity(): Promise<{ id: string; agent: Awaited<ReturnType<typeof signIn>> }> {
    const club = await createClubIn(org);
    const type = await activityType(org);
    const { agent } = await signInAs(app, org);

    const created = await agent.post('/api/v1/activities').send({
      activityTypeId: type.id,
      hostScopeType: 'CLUB',
      hostScopeId: club.id,
      title: 'Fellowship',
      startsAt: '2027-09-14T17:00:00.000Z',
    });

    return { id: activityResponseSchema.parse(created.body).data.id, agent };
  }

  it('verifies, and then refuses an edit', async () => {
    const { id, agent } = await anActivity();

    const verified = await agent
      .post(`/api/v1/activities/${id}/verify`)
      .send({ decision: 'VERIFY' });
    expect(verified.status).toBe(200);
    expect(activityResponseSchema.parse(verified.body).data.verification).toBe('VERIFIED');

    // A verified activity has been counted. Editing it silently would change a score
    // somebody has already read.
    const edit = await agent.patch(`/api/v1/activities/${id}`).send({ title: 'Changed' });
    expect(edit.status).toBe(422);
    expect(errorBody(edit).code).toBe('PERIOD_CLOSED');
  });

  it('queries with a comment, and an edit puts it back in the queue', async () => {
    const { id, agent } = await anActivity();

    const queried = await agent
      .post(`/api/v1/activities/${id}/verify`)
      .send({ decision: 'QUERY', comment: 'Which club actually hosted this?' });
    expect(activityResponseSchema.parse(queried.body).data.verification).toBe('QUERIED');

    // The QUERY state is what makes this two-way rather than write-only: the club fixes it
    // and it goes back into the queue rather than staying flagged.
    const fixed = await agent
      .patch(`/api/v1/activities/${id}`)
      .send({ title: 'Joint fellowship with Nakawa' });
    expect(activityResponseSchema.parse(fixed.body).data.verification).toBe('UNVERIFIED');
  });

  it('refuses a query with no reason', async () => {
    const { id, agent } = await anActivity();

    const response = await agent
      .post(`/api/v1/activities/${id}/verify`)
      .send({ decision: 'QUERY' });

    // A refusal with no reason is one the club cannot act on.
    expect(response.status).toBe(422);
  });

  it('soft-deletes', async () => {
    const { id, agent } = await anActivity();

    expect((await agent.delete(`/api/v1/activities/${id}`)).status).toBe(204);
    expect((await agent.get(`/api/v1/activities/${id}`)).status).toBe(404);

    // The row survives: a deleted activity is one the scoring engine must stop counting,
    // not one that never happened.
    const row = await unscopedPrisma.activity.findUnique({ where: { id } });
    expect(row?.deletedAt).not.toBeNull();
  });
});

describe('partners and media', () => {
  let app: Express;
  let org: OrgFixture;

  beforeEach(async () => {
    await resetDatabase();
    setStorageDriver(memoryStorage());
    app = createApp();
    org = await createOrg();
  });

  it('derives international service from the partner’s country', async () => {
    const club = await createClubIn(org);
    const type = await activityType(org);
    const { agent } = await signInAs(app, org);

    const created = await agent.post('/api/v1/activities').send({
      activityTypeId: type.id,
      hostScopeType: 'CLUB',
      hostScopeId: club.id,
      title: 'Joint water project',
      startsAt: '2027-09-14T08:00:00.000Z',
    });
    const id = activityResponseSchema.parse(created.body).data.id;

    const domestic = await agent
      .post(`/api/v1/activities/${id}/partners`)
      .send({ partnerType: 'NGO', partnerOrgName: 'Water for Uganda' });
    expect((domestic.body as { data: { isInternational: boolean } }).data.isInternational).toBe(
      false,
    );

    const foreign = await agent.post(`/api/v1/activities/${id}/partners`).send({
      partnerType: 'ROTARY_CLUB',
      partnerOrgName: 'Rotary Club of Nairobi',
      countryCode: 'KE',
    });

    // DERIVED, never declared. A club cannot tick a box to claim international service.
    expect((foreign.body as { data: { isInternational: boolean } }).data.isInternational).toBe(
      true,
    );
  });

  it('accepts a photograph and refuses a file that is not one', async () => {
    const club = await createClubIn(org);
    const type = await activityType(org);
    const { agent } = await signInAs(app, org);

    const created = await agent.post('/api/v1/activities').send({
      activityTypeId: type.id,
      hostScopeType: 'CLUB',
      hostScopeId: club.id,
      title: 'Camp',
      startsAt: '2027-09-14T08:00:00.000Z',
    });
    const id = activityResponseSchema.parse(created.body).data.id;

    const jpeg = await sharp({
      create: { width: 40, height: 30, channels: 3, background: '#c8102e' },
    })
      .jpeg()
      .toBuffer();

    const upload = await agent
      .post(`/api/v1/activities/${id}/media`)
      .attach('file', jpeg, { filename: 'camp.jpg', contentType: 'image/jpeg' });

    expect(upload.status).toBe(201);
    const media = (upload.body as { data: { url: string; isProcessed: boolean } }).data;
    // Not processed yet: the worker produces the variants, and the client shows a
    // placeholder rather than a broken image.
    expect(media.isProcessed).toBe(false);
    expect(media.url).toContain('memory://');

    // An HTML document named .jpg. Served back from a domain that holds a session cookie,
    // this is stored XSS — which is why the extension is not consulted.
    const notAnImage = await agent
      .post(`/api/v1/activities/${id}/media`)
      .attach('file', Buffer.from('<html><script>alert(1)</script></html>'), {
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
      });

    expect(notAnImage.status).toBe(415);
    expect(errorBody(notAnImage).code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });
});
