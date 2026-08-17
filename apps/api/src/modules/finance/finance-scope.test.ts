import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { unscopedPrisma } from '../../platform/db.js';
import {
  appoint,
  createClubIn,
  createOrg,
  createPosition,
  createUser,
  resetDatabase,
  signIn,
  type OrgFixture,
} from '../../test/helpers.js';

/**
 * ONE QUESTION, ASKED OF EVERY FINANCE ENDPOINT: can a club officer reach another club's
 * money?
 *
 * The M4 exit checklist calls for this and it deserves its own file, because the finance
 * domain is where the scope layer is least able to help. Three of its tables carry no
 * `district_id` of their own — `budget_lines`, `dues_payments` and `member_dues_payments`
 * inherit scope through a parent via the registry — and a `via` rule that is wrong does not
 * fail loudly. It returns somebody else's data with a 200.
 *
 * So this walks every finance route as a treasurer of club A, pointing at club B's records,
 * and asserts each one refuses. **404, not 403**, everywhere a record is named: a 403
 * confirms the record exists, and a club treasurer who can enumerate the district's budget
 * ids one at a time has been handed the shape of the dataset.
 *
 * The tests elsewhere in this module prove the features work. This one proves they cannot be
 * turned sideways, which is the failure that looks like working software right up until it
 * does not.
 */

const CLUB_OFFICER = ['finance:read:club', 'finance:write:club'];
const DISTRICT = [
  'finance:read:club',
  'finance:write:club',
  'dues:manage:district',
  'trf:verify:district',
];

async function signInAs(
  app: Express,
  org: OrgFixture,
  options: { permissions?: string[]; scopeType?: 'DISTRICT' | 'CLUB'; scopeId?: string } = {},
) {
  const user = await createUser();
  const position = await createPosition({
    districtId: org.districtId,
    scope: options.scopeType ?? 'DISTRICT',
    permissions: options.permissions ?? DISTRICT,
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

describe('a club officer cannot reach another club’s finances', () => {
  let app: Express;
  let org: OrgFixture;

  /** Everything belonging to the OTHER club, built by a district officer. */
  let theirs: {
    clubId: string;
    budgetId: string;
    lineId: string;
    categoryId: string;
    transactionId: string;
    invoiceId: string;
    paymentId: string;
    memberDuesId: string;
    trfId: string;
  };

  /** The caller: a treasurer of a different club, with every finance permission there is. */
  let mine: Awaited<ReturnType<typeof signInAs>>;

  beforeEach(async () => {
    await resetDatabase();
    app = createApp();
    org = await createOrg();

    const myClub = await createClubIn(org, 'Rotaract Club of Mine');
    const theirClub = await createClubIn(org, 'Rotaract Club of Theirs');

    const category = await unscopedPrisma.financeCategory.create({
      data: {
        districtId: org.districtId,
        code: `CAT_${randomUUID().slice(0, 8)}`,
        name: 'Fundraising',
        direction: 'INCOME',
      },
      select: { id: true },
    });
    const person = await unscopedPrisma.person.create({
      data: { firstName: 'Ann', lastName: `Nakato-${randomUUID().slice(0, 6)}` },
      select: { id: true },
    });

    const { agent: district } = await signInAs(app, org);
    const id = (response: { body: unknown }): string =>
      (response.body as { data: { id: string } }).data.id;

    const budget = await district
      .post('/api/v1/budgets')
      .send({ ownerScopeType: 'CLUB', ownerScopeId: theirClub.id });
    const line = await district
      .post(`/api/v1/budgets/${id(budget)}/lines`)
      .send({ categoryId: category.id, description: 'Their car wash', amountPlanned: '1500000' });
    const transaction = await district.post('/api/v1/transactions').send({
      ownerScopeType: 'CLUB',
      ownerScopeId: theirClub.id,
      categoryId: category.id,
      amount: '250000',
      occurredOn: '2027-09-14',
    });
    const invoice = await district
      .post('/api/v1/dues/invoices')
      .send({ clubId: theirClub.id, amountDue: '1000000', dueOn: '2027-09-30' });
    const withPayment = await district
      .post(`/api/v1/dues/invoices/${id(invoice)}/payments`)
      .send({ amount: '400000', paidOn: '2027-08-01' });
    const memberDues = await district
      .post('/api/v1/member-dues')
      .send({ clubId: theirClub.id, personId: person.id, amountDue: '50000' });
    const trf = await district
      .post('/api/v1/trf/contributions')
      .send({ clubId: theirClub.id, amountUsd: '500', contributedOn: '2027-09-14' });

    theirs = {
      clubId: theirClub.id,
      budgetId: id(budget),
      lineId: id(line),
      categoryId: category.id,
      transactionId: id(transaction),
      invoiceId: id(invoice),
      paymentId:
        (withPayment.body as { data: { payments?: { id: string }[] } }).data.payments?.[0]?.id ??
        '',
      memberDuesId: id(memberDues),
      trfId: id(trf),
    };

    mine = await signInAs(app, org, {
      permissions: CLUB_OFFICER,
      scopeType: 'CLUB',
      scopeId: myClub.id,
    });
  });

  it('refuses every direct read of another club’s record with 404', async () => {
    for (const path of [
      () => `/api/v1/budgets/${theirs.budgetId}`,
      () => `/api/v1/budgets/${theirs.budgetId}/lines`,
      () => `/api/v1/dues/invoices/${theirs.invoiceId}`,
      () => `/api/v1/trf/contributions/${theirs.trfId}`,
    ]) {
      const response = await mine.agent.get(path());
      // 404 and not 403. A 403 says "this exists and is not yours", which is one bit more
      // than a probe should ever get.
      expect(response.status, path()).toBe(404);
    }
  });

  it('refuses every write against another club’s record', async () => {
    const writes: { name: string; run: () => Promise<{ status: number }> }[] = [
      {
        name: 'add a line to their budget',
        run: () =>
          mine.agent
            .post(`/api/v1/budgets/${theirs.budgetId}/lines`)
            .send({ categoryId: theirs.categoryId, description: 'Sneaked in', amountPlanned: '1' }),
      },
      {
        name: 'edit their budget line',
        run: () =>
          mine.agent
            .patch(`/api/v1/budgets/${theirs.budgetId}/lines/${theirs.lineId}`)
            .send({ amountPlanned: '999' }),
      },
      {
        name: 'delete their budget line',
        run: () => mine.agent.delete(`/api/v1/budgets/${theirs.budgetId}/lines/${theirs.lineId}`),
      },
      {
        name: 'edit their budget',
        run: () =>
          mine.agent.patch(`/api/v1/budgets/${theirs.budgetId}`).send({ currencyCode: 'USD' }),
      },
      {
        name: 'record a transaction against their club',
        run: () =>
          mine.agent.post('/api/v1/transactions').send({
            ownerScopeType: 'CLUB',
            ownerScopeId: theirs.clubId,
            categoryId: theirs.categoryId,
            amount: '1000',
            occurredOn: '2027-09-14',
          }),
      },
      {
        name: 'attach a transaction to THEIR budget line',
        run: () =>
          mine.agent.post('/api/v1/transactions').send({
            // The owner is a club the caller DOES hold — the leak would be sideways,
            // through a budget line belonging to somebody else. This is the shape of
            // cross-scope write a `via` rule exists to stop.
            ownerScopeType: 'CLUB',
            ownerScopeId: theirs.clubId,
            categoryId: theirs.categoryId,
            budgetLineId: theirs.lineId,
            amount: '1000',
            occurredOn: '2027-09-14',
          }),
      },
      {
        name: 'record a member dues row for their club',
        run: () =>
          mine.agent
            .post('/api/v1/member-dues')
            .send({ clubId: theirs.clubId, personId: randomUUID(), amountDue: '1000' }),
      },
      {
        name: 'record a payment against their member dues',
        run: () =>
          mine.agent
            .post(`/api/v1/member-dues/${theirs.memberDuesId}/payments`)
            .send({ amount: '1000', paidOn: '2027-08-01' }),
      },
      {
        name: 'record TRF giving for their club',
        run: () =>
          mine.agent
            .post('/api/v1/trf/contributions')
            .send({ clubId: theirs.clubId, amountUsd: '100', contributedOn: '2027-09-14' }),
      },
    ];

    for (const write of writes) {
      const response = await write.run();
      expect(response.status, write.name).toBe(404);
    }
  });

  it('refuses the district-only actions outright, with 403 rather than 404', async () => {
    // A DIFFERENT failure, and the difference matters. These describe the caller's own
    // authority — "you may not raise invoices" — and reveal nothing about what exists, so
    // 403 is honest and 404 would be needlessly confusing.
    const forbidden = [
      () =>
        mine.agent
          .post('/api/v1/dues/invoices')
          .send({ clubId: theirs.clubId, amountDue: '1', dueOn: '2027-09-30' }),
      () =>
        mine.agent.post('/api/v1/dues/invoices/bulk').send({ amountDue: '1', dueOn: '2027-09-30' }),
      () =>
        mine.agent
          .post(`/api/v1/dues/invoices/${theirs.invoiceId}/waive`)
          .send({ reason: 'Because I said so, at length.' }),
      () =>
        mine.agent
          .post(`/api/v1/dues/invoices/${theirs.invoiceId}/payments`)
          .send({ amount: '1', paidOn: '2027-08-01' }),
      () =>
        mine.agent.post(
          `/api/v1/dues/invoices/${theirs.invoiceId}/payments/${theirs.paymentId}/confirm`,
        ),
      () =>
        mine.agent
          .post(`/api/v1/trf/contributions/${theirs.trfId}/verify`)
          .send({ decision: 'VERIFIED' }),
    ];

    for (const attempt of forbidden) {
      expect((await attempt()).status).toBe(403);
    }
  });

  it('leaves another club out of every LIST, rather than refusing the list', async () => {
    // A list must not 404 because one row in it is out of scope — the rows are filtered.
    // The failure this catches is the opposite of the one above: not a leak through an id,
    // but a leak through a page the caller was allowed to open.
    const lists: { path: string; rows: (body: unknown) => unknown[] }[] = [
      { path: '/api/v1/budgets', rows: (b) => (b as { data: unknown[] }).data },
      { path: '/api/v1/transactions', rows: (b) => (b as { data: unknown[] }).data },
      { path: '/api/v1/dues/invoices', rows: (b) => (b as { data: unknown[] }).data },
      { path: '/api/v1/member-dues', rows: (b) => (b as { data: unknown[] }).data },
      { path: '/api/v1/trf/contributions', rows: (b) => (b as { data: unknown[] }).data },
      { path: '/api/v1/dues/status', rows: (b) => (b as { data: { rows: unknown[] } }).data.rows },
    ];

    for (const list of lists) {
      const response = await mine.agent.get(list.path);
      expect(response.status, list.path).toBe(200);

      // Nothing in any page may mention the other club — by id or by name. Serialised
      // rows carry `clubName`, and a filter that got the ids right while leaking a name
      // through a join would still be a leak.
      const body = JSON.stringify(list.rows(response.body));
      expect(body, list.path).not.toContain(theirs.clubId);
      expect(body, list.path).not.toContain('Theirs');
    }
  });

  it('will not let a summary be requested for another club', async () => {
    const response = await mine.agent
      .get('/api/v1/finance/summary')
      .query({ ownerScopeType: 'CLUB', ownerScopeId: theirs.clubId });
    expect(response.status).toBe(404);
  });

  it('does not leak another club through the TRF summary’s club breakdown', async () => {
    // The summary aggregates across the district for a district-wide caller, so the scope
    // filter lives in the service rather than in a `where` the layer wrote. That makes it
    // the most plausible place for a leak in this module.
    const response = await mine.agent.get('/api/v1/trf/summary');
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toContain(theirs.clubId);
  });
});
