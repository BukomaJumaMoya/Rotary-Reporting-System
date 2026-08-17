import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  trfContributionListResponseSchema,
  trfContributionResponseSchema,
  trfSummaryResponseSchema,
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
 * The Rotary Foundation (FR-5).
 *
 * Everything here is about ONE distinction: verified versus not. M5's
 * `trf.contribution_usd` resolver reads verified rows and nothing else, and TRF giving is a
 * scored parameter with award consequences — so a club whose unverified figure counted would
 * be a club scoring itself.
 *
 * The second thing worth testing is the contributing-member RATE, because the way to get it
 * wrong is subtle: a club-level gift has no person behind it, and counting one cheque as
 * "every member gave" is exactly the misreading the rate exists to prevent.
 */

const CLUB_TREASURER = ['finance:read:club', 'finance:write:club'];
/** The District Foundation Chair: transcribes from My Rotary AND reconciles. */
const FOUNDATION_CHAIR = ['finance:read:club', 'finance:write:club', 'trf:verify:district'];

async function signInAs(
  app: Express,
  org: OrgFixture,
  options: { permissions?: string[]; scopeType?: 'DISTRICT' | 'CLUB'; scopeId?: string } = {},
) {
  const user = await createUser();
  const position = await createPosition({
    districtId: org.districtId,
    scope: options.scopeType ?? 'DISTRICT',
    permissions: options.permissions ?? FOUNDATION_CHAIR,
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

/** A member on the club's roster, so the contributing-member rate has a denominator. */
async function member(org: OrgFixture, clubId: string) {
  const person = await unscopedPrisma.person.create({
    data: { firstName: 'Ann', lastName: `Nakato-${randomUUID().slice(0, 6)}` },
    select: { id: true },
  });
  await unscopedPrisma.membershipEvent.create({
    data: {
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      personId: person.id,
      clubId,
      eventType: 'JOIN',
      effectiveOn: new Date('2027-07-15'),
    },
  });
  return person;
}

async function refreshRoster(): Promise<void> {
  await unscopedPrisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW club_rosters');
}

describe('TRF contributions', () => {
  let app: Express;
  let org: OrgFixture;

  beforeEach(async () => {
    await resetDatabase();
    app = createApp();
    org = await createOrg();
  });

  it('records as UNVERIFIED, whoever files it', async () => {
    const club = await createClubIn(org);
    const { agent } = await signInAs(app, org, {
      permissions: CLUB_TREASURER,
      scopeType: 'CLUB',
      scopeId: club.id,
    });

    const created = await agent.post('/api/v1/trf/contributions').send({
      clubId: club.id,
      fundType: 'ANNUAL_FUND',
      amountUsd: '1250.50',
      contributedOn: '2027-09-14',
      riReceiptRef: 'RI-88213',
    });

    expect(created.status).toBe(201);
    const contribution = trfContributionResponseSchema.parse(created.body).data;
    // Nothing a club sends can arrive already verified — that would be a club scoring itself.
    expect(contribution.verification).toBe('UNVERIFIED');
    // USD, stored as reported. No conversion, so a scoring band never depends on the day
    // somebody ran an import.
    expect(contribution.amountUsd).toBe('1250.50');
    expect(contribution.personId).toBeNull();
  });

  it('will not let a club verify its own contribution', async () => {
    const club = await createClubIn(org);
    const { agent: treasurer } = await signInAs(app, org, {
      permissions: CLUB_TREASURER,
      scopeType: 'CLUB',
      scopeId: club.id,
    });

    const id = trfContributionResponseSchema.parse(
      (
        await treasurer
          .post('/api/v1/trf/contributions')
          .send({ clubId: club.id, amountUsd: '500', contributedOn: '2027-09-14' })
      ).body,
    ).data.id;

    const attempt = await treasurer
      .post(`/api/v1/trf/contributions/${id}/verify`)
      .send({ decision: 'VERIFIED' });
    expect(attempt.status).toBe(403);
  });

  it('will not let an ACTIVITY verifier verify TRF giving', async () => {
    /**
     * The two are different jobs done by different officers. The authoritative TRF figures
     * are read by hand from My Rotary, and an assessor who verifies fellowship reports has
     * no way to check a dollar figure — so `activity:verify:district` deliberately does not
     * carry here. `trf:verify:district` is held by the District Foundation Chair and the DRR.
     */
    const club = await createClubIn(org);
    const { agent: chair } = await signInAs(app, org);
    const id = trfContributionResponseSchema.parse(
      (
        await chair
          .post('/api/v1/trf/contributions')
          .send({ clubId: club.id, amountUsd: '500', contributedOn: '2027-09-14' })
      ).body,
    ).data.id;

    const { agent: assessor } = await signInAs(app, org, {
      permissions: ['finance:read:club', 'activity:read:club', 'activity:verify:district'],
    });

    const attempt = await assessor
      .post(`/api/v1/trf/contributions/${id}/verify`)
      .send({ decision: 'VERIFIED' });
    expect(attempt.status).toBe(403);
    expect(errorBody(attempt).code).toBe('INSUFFICIENT_SCOPE');
  });

  it('requires a reason for anything but VERIFIED', async () => {
    const club = await createClubIn(org);
    const { agent } = await signInAs(app, org);

    const id = trfContributionResponseSchema.parse(
      (
        await agent
          .post('/api/v1/trf/contributions')
          .send({ clubId: club.id, amountUsd: '500', contributedOn: '2027-09-14' })
      ).body,
    ).data.id;

    // "Rejected" with no reason generates an email, not a correction.
    const bare = await agent
      .post(`/api/v1/trf/contributions/${id}/verify`)
      .send({ decision: 'QUERIED' });
    expect(bare.status).toBe(400);
    expect(errorBody(bare).code).toBe('VALIDATION_ERROR');

    const queried = await agent
      .post(`/api/v1/trf/contributions/${id}/verify`)
      .send({ decision: 'QUERIED', comment: 'The receipt reference does not match RI’s report.' });
    expect(trfContributionResponseSchema.parse(queried.body).data.verification).toBe('QUERIED');
  });

  it('shows a club only its own contributions', async () => {
    const mine = await createClubIn(org, 'Rotaract Club of Mine');
    const theirs = await createClubIn(org, 'Rotaract Club of Theirs');

    const { agent: district } = await signInAs(app, org);
    for (const club of [mine, theirs]) {
      await district
        .post('/api/v1/trf/contributions')
        .send({ clubId: club.id, amountUsd: '100', contributedOn: '2027-09-14' });
    }

    const { agent } = await signInAs(app, org, {
      permissions: CLUB_TREASURER,
      scopeType: 'CLUB',
      scopeId: mine.id,
    });

    const listed = trfContributionListResponseSchema.parse(
      (await agent.get('/api/v1/trf/contributions')).body,
    );
    expect(listed.data.map((row) => row.clubName)).toEqual(['Rotaract Club of Mine']);
  });
});

describe('the TRF summary', () => {
  let app: Express;
  let org: OrgFixture;

  beforeEach(async () => {
    await resetDatabase();
    app = createApp();
    org = await createOrg();
  });

  /**
   * A fixture a Foundation Chair could check on paper.
   *
   * Kampala: 1,000.00 + 250.50 verified to the Annual Fund, 400.00 verified to PolioPlus,
   *          and 999.99 recorded but NOT verified.
   * Entebbe: 300.00 verified to the Annual Fund.
   *
   * District verified = 1,950.50. District pending = 999.99.
   */
  it('separates verified from pending, by fund and by club', async () => {
    const kampala = await createClubIn(org, 'Rotaract Club of Kampala');
    const entebbe = await createClubIn(org, 'Rotaract Club of Entebbe');
    const { agent } = await signInAs(app, org);

    const record = async (clubId: string, amountUsd: string, fundType: string, personId?: string) =>
      trfContributionResponseSchema.parse(
        (
          await agent.post('/api/v1/trf/contributions').send({
            clubId,
            fundType,
            amountUsd,
            contributedOn: '2027-09-14',
            ...(personId ? { personId } : {}),
          })
        ).body,
      ).data.id;

    const verify = async (id: string) =>
      agent.post(`/api/v1/trf/contributions/${id}/verify`).send({ decision: 'VERIFIED' });

    await verify(await record(kampala.id, '1000.00', 'ANNUAL_FUND'));
    await verify(await record(kampala.id, '250.50', 'ANNUAL_FUND'));
    await verify(await record(kampala.id, '400.00', 'POLIO_PLUS'));
    await record(kampala.id, '999.99', 'ANNUAL_FUND'); // left unverified on purpose
    await verify(await record(entebbe.id, '300.00', 'ANNUAL_FUND'));

    const summary = trfSummaryResponseSchema.parse(
      (await agent.get('/api/v1/trf/summary')).body,
    ).data;

    expect(summary.verifiedUsd).toBe('1950.50');
    // Reported separately, never netted: the verified figure is what a scorecard uses, the
    // pending figure is the Foundation Chair's work queue.
    expect(summary.pendingUsd).toBe('999.99');

    const annual = summary.byFund.find((row) => row.fundType === 'ANNUAL_FUND');
    expect(annual?.verifiedUsd).toBe('1550.50');
    expect(annual?.pendingUsd).toBe('999.99');

    const polio = summary.byFund.find((row) => row.fundType === 'POLIO_PLUS');
    expect(polio?.verifiedUsd).toBe('400.00');
    expect(polio?.pendingUsd).toBe('0.00');

    const byClub = new Map(summary.byClub.map((row) => [row.clubName, row]));
    expect(byClub.get('Rotaract Club of Kampala')?.verifiedUsd).toBe('1650.50');
    expect(byClub.get('Rotaract Club of Kampala')?.pendingUsd).toBe('999.99');
    expect(byClub.get('Rotaract Club of Entebbe')?.verifiedUsd).toBe('300.00');
  });

  it('counts a member only once, and never counts a club-level gift as a member', async () => {
    /**
     * The subtle one. Four members on the roster:
     *   — Ann gives twice, both verified          → counts ONCE
     *   — Brian gives once, verified              → counts
     *   — Chloe gives once, UNVERIFIED            → does not count
     *   — the club writes one cheque with no person → does not count
     *
     * Contributing members = 2 of 4 = 0.5. Counting the cheque would say 3 of 4, and
     * counting Ann twice would say 4 of 4 — a club at 100% on two people's giving.
     */
    const club = await createClubIn(org);
    const ann = await member(org, club.id);
    const brian = await member(org, club.id);
    const chloe = await member(org, club.id);
    await member(org, club.id);
    await refreshRoster();

    const { agent } = await signInAs(app, org);

    const record = async (amountUsd: string, personId?: string) =>
      trfContributionResponseSchema.parse(
        (
          await agent.post('/api/v1/trf/contributions').send({
            clubId: club.id,
            amountUsd,
            contributedOn: '2027-09-14',
            ...(personId ? { personId } : {}),
          })
        ).body,
      ).data.id;

    const verify = async (id: string) =>
      agent.post(`/api/v1/trf/contributions/${id}/verify`).send({ decision: 'VERIFIED' });

    await verify(await record('100', ann.id));
    await verify(await record('150', ann.id));
    await verify(await record('100', brian.id));
    await record('100', chloe.id);
    await verify(await record('5000'));

    const summary = trfSummaryResponseSchema.parse(
      (await agent.get('/api/v1/trf/summary')).body,
    ).data;
    const row = summary.byClub[0];

    expect(row?.rosterSize).toBe(4);
    expect(row?.contributingMembers).toBe(2);
    expect(row?.contributingMemberRate).toBe(0.5);
    // The club cheque still counts toward the MONEY, just not toward the rate.
    expect(row?.verifiedUsd).toBe('5350.00');
  });

  it('drops a contribution out of the verified total when it is queried', async () => {
    // Verification runs both ways. A figure that was counted and is then queried must stop
    // counting, or a correction leaves the score where the mistake put it.
    const club = await createClubIn(org);
    const { agent } = await signInAs(app, org);

    const id = trfContributionResponseSchema.parse(
      (
        await agent
          .post('/api/v1/trf/contributions')
          .send({ clubId: club.id, amountUsd: '750', contributedOn: '2027-09-14' })
      ).body,
    ).data.id;

    await agent.post(`/api/v1/trf/contributions/${id}/verify`).send({ decision: 'VERIFIED' });
    const counted = trfSummaryResponseSchema.parse(
      (await agent.get('/api/v1/trf/summary')).body,
    ).data;
    expect(counted.verifiedUsd).toBe('750.00');

    await agent
      .post(`/api/v1/trf/contributions/${id}/verify`)
      .send({ decision: 'REJECTED', comment: 'No matching receipt in the RI report.' });

    const after = trfSummaryResponseSchema.parse(
      (await agent.get('/api/v1/trf/summary')).body,
    ).data;
    expect(after.verifiedUsd).toBe('0.00');
    // Rejected is not pending either — it is not in anybody's queue.
    expect(after.pendingUsd).toBe('0.00');
  });
});
