import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  membershipEventListResponseSchema,
  membershipEventResponseSchema,
  membershipStatsResponseSchema,
  rosterListResponseSchema,
  transitionListResponseSchema,
} from '@dis/contracts';
import { createApp } from '../../app.js';
import { unscopedPrisma } from '../../platform/db.js';
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
 * Membership — the event log and the roster derived from it.
 *
 * Two groups earn their keep. The roster tests prove a CORRECTION is reflected, which is
 * the bug schema v1.0 shipped: the view filtered on `supersedes_event_id IS NULL`, so every
 * correction was discarded while the row it corrected went on counting. And the statistics
 * are checked against numbers computed by hand — that arithmetic feeds M5's scoring, and a
 * retention rate that is quietly wrong is an award given to the wrong club.
 */

const MEMBERSHIP_PERMISSIONS = ['membership:read:club', 'membership:write:club'];

async function person(name = 'Member'): Promise<string> {
  const row = await unscopedPrisma.person.create({
    data: { firstName: name, lastName: `Nakato-${randomUUID().slice(0, 6)}` },
    select: { id: true },
  });
  return row.id;
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
    permissions: options.permissions ?? MEMBERSHIP_PERMISSIONS,
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

describe('the membership event log', () => {
  let app: Express;
  let org: OrgFixture;

  beforeEach(async () => {
    await resetDatabase();
    app = createApp();
    org = await createOrg();
  });

  it('derives the roster through join → transfer out → reinstate', async () => {
    const club = await createClubIn(org, 'Rotaract Club of Derivation');
    const personId = await person('Grace');
    const { agent } = await signInAs(app, org);

    const post = (body: Record<string, unknown>) =>
      agent.post('/api/v1/membership/events').send({ personId, clubId: club.id, ...body });

    expect((await post({ eventType: 'JOIN', effectiveOn: '2027-07-05' })).status).toBe(201);
    let roster = rosterListResponseSchema.parse(
      (await agent.get('/api/v1/membership/roster').query({ clubId: club.id })).body,
    );
    expect(roster.data.map((entry) => entry.personId)).toEqual([personId]);

    expect((await post({ eventType: 'TRANSFER_OUT', effectiveOn: '2027-09-01' })).status).toBe(201);
    roster = rosterListResponseSchema.parse(
      (await agent.get('/api/v1/membership/roster').query({ clubId: club.id })).body,
    );
    expect(roster.data).toHaveLength(0);

    expect((await post({ eventType: 'REINSTATE', effectiveOn: '2027-11-01' })).status).toBe(201);
    roster = rosterListResponseSchema.parse(
      (await agent.get('/api/v1/membership/roster').query({ clubId: club.id })).body,
    );
    expect(roster.data.map((entry) => entry.personId)).toEqual([personId]);
    expect(roster.data[0]?.since).toBe('2027-11-01');
  });

  it('reflects a CORRECTION in the roster — the v1.0 bug', async () => {
    const club = await createClubIn(org);
    const personId = await person('Mistake');
    const { agent } = await signInAs(app, org);

    const join = await agent
      .post('/api/v1/membership/events')
      .send({ personId, clubId: club.id, eventType: 'JOIN', effectiveOn: '2027-07-05' });
    const joinId = membershipEventResponseSchema.parse(join.body).data.id;

    // "This never happened." A CORRECTION supersedes the original and, not being a joining
    // type, drops the person from the roster. v1.0 filtered on `supersedes_event_id IS
    // NULL`, which discarded this row and kept counting the one it corrected.
    const corrected = await agent
      .post(`/api/v1/membership/events/${joinId}/correct`)
      .send({ eventType: 'CORRECTION', reasonNote: 'Recorded against the wrong club' });
    expect(corrected.status).toBe(201);

    const roster = rosterListResponseSchema.parse(
      (await agent.get('/api/v1/membership/roster').query({ clubId: club.id })).body,
    );
    expect(roster.data).toHaveLength(0);

    // The original row SURVIVES. The log is never edited.
    const events = membershipEventListResponseSchema.parse(
      (await agent.get('/api/v1/membership/events').query({ clubId: club.id })).body,
    );
    expect(events.meta.total).toBe(2);
    expect(events.data.find((event) => event.id === joinId)?.isSuperseded).toBe(true);
  });

  it('replaces a fact when the correction carries a real type', async () => {
    const club = await createClubIn(org);
    const personId = await person('Typo');
    const { agent } = await signInAs(app, org);

    const join = await agent
      .post('/api/v1/membership/events')
      .send({ personId, clubId: club.id, eventType: 'JOIN', effectiveOn: '2027-07-05' });
    const joinId = membershipEventResponseSchema.parse(join.body).data.id;

    // A mistyped join date is a second JOIN carrying the right one.
    await agent
      .post(`/api/v1/membership/events/${joinId}/correct`)
      .send({ eventType: 'JOIN', effectiveOn: '2027-08-15', reasonNote: 'Date was mistyped' });

    const roster = rosterListResponseSchema.parse(
      (await agent.get('/api/v1/membership/roster').query({ clubId: club.id })).body,
    );
    expect(roster.data).toHaveLength(1);
    expect(roster.data[0]?.since).toBe('2027-08-15');
  });

  it('refuses to mutate an event — the database guard, not a convention', async () => {
    const club = await createClubIn(org);
    const personId = await person();
    const { agent } = await signInAs(app, org);

    const created = await agent
      .post('/api/v1/membership/events')
      .send({ personId, clubId: club.id, eventType: 'JOIN', effectiveOn: '2027-07-05' });
    const id = membershipEventResponseSchema.parse(created.body).data.id;

    // No PUT and no DELETE exist. Reaching past the API to the table is refused too —
    // by `membership_events_no_mutate`, which is why this is a guard and not a convention.
    await expect(
      unscopedPrisma.membershipEvent.update({
        where: { id },
        data: { effectiveOn: new Date('2027-01-01') },
      }),
    ).rejects.toBeTruthy();

    await expect(unscopedPrisma.membershipEvent.delete({ where: { id } })).rejects.toBeTruthy();

    // Still there, and still saying what it said.
    const row = await unscopedPrisma.membershipEvent.findUnique({ where: { id } });
    expect(row?.effectiveOn.toISOString().slice(0, 10)).toBe('2027-07-05');
  });

  it('is idempotent on a client-generated id', async () => {
    const club = await createClubIn(org);
    const personId = await person();
    const { agent } = await signInAs(app, org);
    const id = randomUUID();
    const body = { id, personId, clubId: club.id, eventType: 'JOIN', effectiveOn: '2027-07-05' };

    const first = await agent.post('/api/v1/membership/events').send(body);
    const second = await agent.post('/api/v1/membership/events').send(body);

    expect(first.status).toBe(201);
    // 200, not 409: the client generated the id precisely so a retry would be safe, and
    // making it distinguish "created" from "already created" puts the burden back on the
    // connection that caused the retry.
    expect(second.status).toBe(200);
    expect(membershipEventResponseSchema.parse(second.body).data.id).toBe(id);
    expect(await unscopedPrisma.membershipEvent.count({ where: { id } })).toBe(1);
  });

  it('refuses the same event twice without an id', async () => {
    const club = await createClubIn(org);
    const personId = await person();
    const { agent } = await signInAs(app, org);
    const body = { personId, clubId: club.id, eventType: 'JOIN', effectiveOn: '2027-07-05' };

    expect((await agent.post('/api/v1/membership/events').send(body)).status).toBe(201);
    const duplicate = await agent.post('/api/v1/membership/events').send(body);

    expect(duplicate.status).toBe(409);
    expect(errorBody(duplicate).code).toBe('DUPLICATE_MEMBERSHIP_EVENT');
  });

  it('refuses to record against a club outside the caller’s scope', async () => {
    const mine = await createClubIn(org, 'Rotaract Club of Mine');
    const theirs = await createClubIn(org, 'Rotaract Club of Theirs');
    const personId = await person();

    const { agent } = await signInAs(app, org, {
      scopeType: 'CLUB',
      scopeId: mine.id,
    });

    const response = await agent
      .post('/api/v1/membership/events')
      .send({ personId, clubId: theirs.id, eventType: 'JOIN', effectiveOn: '2027-07-05' });

    expect(response.status).toBe(404);
  });

  it('requires a receiving club on a transition to Rotary', async () => {
    const club = await createClubIn(org);
    const personId = await person();
    const { agent } = await signInAs(app, org);

    const response = await agent.post('/api/v1/membership/events').send({
      personId,
      clubId: club.id,
      eventType: 'TRANSITION_TO_ROTARY',
      effectiveOn: '2027-10-01',
    });

    // Transitions to Rotary are the most contested figure in a district's return. One with
    // no receiving club is a number nobody can check.
    expect(response.status).toBe(400);
    expect(errorBody(response).code).toBe('VALIDATION_ERROR');
  });
});

describe('the roster as at a date', () => {
  let app: Express;
  let org: OrgFixture;

  beforeEach(async () => {
    await resetDatabase();
    app = createApp();
    org = await createOrg();
  });

  it('reconstructs from the log rather than reading the view', async () => {
    const club = await createClubIn(org);
    const stayed = await person('Stayed');
    const left = await person('Left');
    const { agent } = await signInAs(app, org);

    for (const [personId, eventType, effectiveOn] of [
      [stayed, 'JOIN', '2027-07-05'],
      [left, 'JOIN', '2027-07-05'],
      [left, 'TERMINATE', '2027-10-01'],
    ] as const) {
      await agent
        .post('/api/v1/membership/events')
        .send({ personId, clubId: club.id, eventType, effectiveOn });
    }

    const today = rosterListResponseSchema.parse(
      (await agent.get('/api/v1/membership/roster').query({ clubId: club.id })).body,
    );
    expect(today.data.map((entry) => entry.personId)).toEqual([stayed]);

    // In September both were members. The view says today; this says September.
    const september = rosterListResponseSchema.parse(
      (await agent.get('/api/v1/membership/roster').query({ clubId: club.id, asOf: '2027-09-30' }))
        .body,
    );
    expect(september.meta.total).toBe(2);

    // And before anybody joined, nobody was.
    const june = rosterListResponseSchema.parse(
      (await agent.get('/api/v1/membership/roster').query({ clubId: club.id, asOf: '2027-06-30' }))
        .body,
    );
    expect(june.meta.total).toBe(0);
  });
});

/**
 * The arithmetic, against numbers computed by hand.
 *
 * Twelve months of a club's membership, including a correction. Every figure below was
 * worked out on paper first; this is the fixture the session prompt asks for, and it feeds
 * M5's scoring, so it is worth more than the code it tests.
 */
describe('membership statistics', () => {
  let app: Express;
  let org: OrgFixture;

  beforeEach(async () => {
    await resetDatabase();
    app = createApp();
    org = await createOrg();
  });

  it('reconciles against a hand-computed year', async () => {
    const club = await createClubIn(org, 'Rotaract Club of Arithmetic');
    const { agent } = await signInAs(app, org);

    // Every fixture write is asserted. A POST that quietly 400s leaves the arithmetic
    // testing a smaller dataset than the comment describes, which is how a hand-computed
    // fixture stops being one.
    const record = async (body: Record<string, unknown>): Promise<string> => {
      const response = await agent
        .post('/api/v1/membership/events')
        .send({ clubId: club.id, ...body });
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      return membershipEventResponseSchema.parse(response.body).data.id;
    };

    // Six founding members, all joined before the window opens on 1 July 2027.
    const founders = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => person(`Founder${n}`)));
    for (const personId of founders) {
      await record({ personId, eventType: 'JOIN', effectiveOn: '2026-08-01' });
    }

    // Three joiners inside the year.
    const joiners = await Promise.all([1, 2, 3].map((n) => person(`Joiner${n}`)));
    const inductionDates = ['2027-08-10', '2027-09-10', '2027-10-10'];
    for (const [index, personId] of joiners.entries()) {
      await record({ personId, eventType: 'INDUCT', effectiveOn: inductionDates[index] });
    }

    // Two leavers: one terminated for non-payment, one transitioned to Rotary.
    await record({
      personId: founders[0],
      eventType: 'TERMINATE',
      effectiveOn: '2027-11-30',
      reasonCode: 'NON_PAYMENT',
    });
    await record({
      personId: founders[1],
      eventType: 'TRANSITION_TO_ROTARY',
      effectiveOn: '2028-02-01',
      rotaryClubName: 'Rotary Club of Kampala',
    });

    // A third leaver, RETRACTED. It should count for nothing at all — which is the whole
    // point of the correction machinery, and the number the v1.0 view got wrong.
    const wrongId = await record({
      personId: founders[2],
      eventType: 'TERMINATE',
      effectiveOn: '2027-12-15',
      reasonCode: 'RELOCATION',
    });
    await agent
      .post(`/api/v1/membership/events/${wrongId}/correct`)
      .send({ eventType: 'CORRECTION', reasonNote: 'Recorded against the wrong member' });

    const response = await agent
      .get('/api/v1/membership/stats')
      .query({ clubId: club.id, from: '2027-07-01', to: '2028-06-30' });

    expect(response.status).toBe(200);
    const stats = membershipStatsResponseSchema.parse(response.body).data;

    // Six founders were on the roster on 30 June 2027.
    expect(stats.opening).toBe(6);
    // Three inductions inside the window.
    expect(stats.joiners).toBe(3);
    // One termination and one transition. The retracted termination is NOT counted.
    expect(stats.leavers).toBe(2);
    expect(stats.transitionsToRotary).toBe(1);
    // 6 + 3 − 2 = 7.
    expect(stats.closing).toBe(7);
    expect(stats.netChange).toBe(1);
    // (6 − 2) / 6 = 66.67%.
    expect(stats.retentionRate).toBe('66.67');
    // NON_PAYMENT only: the RELOCATION row was retracted and is not a reason for anything.
    expect(stats.byReason).toEqual([{ reasonCode: 'NON_PAYMENT', count: 1 }]);
  });

  it('reports no retention rate rather than 0% for an empty opening roster', async () => {
    const club = await createClubIn(org, 'Rotaract Club of October');
    const { agent } = await signInAs(app, org);
    const personId = await person();

    await agent
      .post('/api/v1/membership/events')
      .send({ personId, clubId: club.id, eventType: 'JOIN', effectiveOn: '2027-10-01' });

    const stats = membershipStatsResponseSchema.parse(
      (
        await agent
          .get('/api/v1/membership/stats')
          .query({ clubId: club.id, from: '2027-07-01', to: '2028-06-30' })
      ).body,
    ).data;

    expect(stats.opening).toBe(0);
    // A club chartered in October would otherwise be reported as having lost everybody it
    // never had.
    expect(stats.retentionRate).toBeNull();
    expect(stats.joiners).toBe(1);
  });

  it('does not count another district’s events', async () => {
    const club = await createClubIn(org);
    const other = await createOrg({ riDistrictCode: 'D-9214' });
    const otherClub = await createClubIn(other, 'Rotaract Club of Elsewhere');

    const mine = await person('Mine');
    const theirs = await person('Theirs');

    for (const [districtId, rotaryYearId, personId, clubId] of [
      [org.districtId, org.currentYearId, mine, club.id],
      [other.districtId, other.currentYearId, theirs, otherClub.id],
    ] as const) {
      await unscopedPrisma.membershipEvent.create({
        data: {
          districtId,
          rotaryYearId,
          personId,
          clubId,
          eventType: 'JOIN',
          effectiveOn: new Date('2027-07-05'),
        },
      });
    }

    const { agent } = await signInAs(app, org);
    const stats = membershipStatsResponseSchema.parse(
      (await agent.get('/api/v1/membership/stats').query({ from: '2027-07-01', to: '2028-06-30' }))
        .body,
    ).data;

    // The statistics are the one place raw SQL runs, so the scope extension is not helping.
    // This is the assertion that proves the hand-bound district parameter is doing its job.
    expect(stats.joiners).toBe(1);
    expect(stats.closing).toBe(1);
  });
});

describe('transitions to Rotary', () => {
  let app: Express;
  let org: OrgFixture;

  beforeEach(async () => {
    await resetDatabase();
    app = createApp();
    org = await createOrg();
  });

  it('lists them and corroborates one', async () => {
    const club = await createClubIn(org);
    const personId = await person('Moving');
    const { agent } = await signInAs(app, org);

    await agent.post('/api/v1/membership/events').send({
      personId,
      clubId: club.id,
      eventType: 'TRANSITION_TO_ROTARY',
      effectiveOn: '2028-02-01',
      rotaryClubName: 'Rotary Club of Kampala',
      rotaryClubRiId: '12345',
    });

    const pending = transitionListResponseSchema.parse(
      (await agent.get('/api/v1/membership/transitions').query({ corroborated: 'false' })).body,
    );
    expect(pending.data).toHaveLength(1);
    expect(pending.data[0]?.rotaryClubName).toBe('Rotary Club of Kampala');
    expect(pending.data[0]?.rotaryClubRiId).toBe('12345');

    const id = pending.data[0]?.id ?? '';
    const confirmed = await agent.post(`/api/v1/membership/transitions/${id}/corroborate`);

    expect(confirmed.status).toBe(200);
    // `corroborated_at` is the ONE column the immutability guard lets through.
    expect(
      (confirmed.body as { data: { corroboratedAt: string | null } }).data.corroboratedAt,
    ).not.toBeNull();
  });
});
