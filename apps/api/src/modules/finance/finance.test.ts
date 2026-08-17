import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  budgetListResponseSchema,
  budgetResponseSchema,
  financeSummaryResponseSchema,
  transactionListResponseSchema,
  transactionResponseSchema,
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
 * Finance (FR-5).
 *
 * Three things are worth testing here and the CRUD around them is not.
 *
 * **The arithmetic.** A variance a treasurer cannot reproduce on paper is a variance that
 * ends an argument the wrong way, and money that has passed through a JavaScript `number`
 * is money that will eventually be out by a hundredth.
 *
 * **Who can see what.** A club treasurer reaching another club's books — including
 * sideways, through a budget's lines — is the failure this system exists to make
 * impossible, and it is the one that looks like working software right up until it does not.
 *
 * **That a secretary sees expenditure.** The predecessor showed secretaries what the club
 * had collected and not what it had spent. That was a logged complaint, and the fix is a
 * permission, so a test is what stops somebody "tidying" it back.
 */

const TREASURER = ['finance:read:club', 'finance:write:club'];
const SECRETARY = ['finance:read:club'];

async function signInAs(
  app: Express,
  org: OrgFixture,
  options: {
    permissions?: string[];
    scopeType?: 'DISTRICT' | 'CLUB';
    scopeId?: string;
  } = {},
) {
  const user = await createUser();
  const position = await createPosition({
    districtId: org.districtId,
    scope: options.scopeType ?? 'DISTRICT',
    permissions: options.permissions ?? TREASURER,
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

async function category(
  org: OrgFixture,
  direction: 'INCOME' | 'EXPENDITURE',
  name = 'Fundraising',
): Promise<{ id: string }> {
  return unscopedPrisma.financeCategory.create({
    data: {
      districtId: org.districtId,
      code: `CAT_${randomUUID().slice(0, 8)}`,
      name,
      direction,
    },
    select: { id: true },
  });
}

describe('budgets', () => {
  let app: Express;
  let org: OrgFixture;

  beforeEach(async () => {
    await resetDatabase();
    app = createApp();
    org = await createOrg();
  });

  it('plans income and expenditure, and totals each separately', async () => {
    const club = await createClubIn(org);
    const income = await category(org, 'INCOME', 'Fundraising');
    const expenditure = await category(org, 'EXPENDITURE', 'Projects');
    const { agent } = await signInAs(app, org);

    const created = await agent
      .post('/api/v1/budgets')
      .send({ ownerScopeType: 'CLUB', ownerScopeId: club.id });
    expect(created.status).toBe(201);

    const budgetId = budgetResponseSchema.parse(created.body).data.id;

    await agent
      .post(`/api/v1/budgets/${budgetId}/lines`)
      .send({ categoryId: income.id, description: 'Car wash', amountPlanned: '1500000' });
    await agent
      .post(`/api/v1/budgets/${budgetId}/lines`)
      .send({ categoryId: income.id, description: 'Raffle', amountPlanned: '500000.50' });
    await agent
      .post(`/api/v1/budgets/${budgetId}/lines`)
      .send({ categoryId: expenditure.id, description: 'Medical camp', amountPlanned: '1200000' });

    const budget = budgetResponseSchema.parse(
      (await agent.get(`/api/v1/budgets/${budgetId}`)).body,
    ).data;

    // A string, to two places, both directions kept apart. A single "total" would net an
    // income line against an expenditure one and produce a figure that means nothing.
    expect(budget.totalPlannedIncome).toBe('2000000.50');
    expect(budget.totalPlannedExpenditure).toBe('1200000.00');
    expect(budget.lineCount).toBe(3);
    expect(budget.ownerName).toBe(club.name);
  });

  it('refuses a second budget for the same owner and year', async () => {
    const club = await createClubIn(org);
    const { agent } = await signInAs(app, org);

    await agent.post('/api/v1/budgets').send({ ownerScopeType: 'CLUB', ownerScopeId: club.id });
    const again = await agent
      .post('/api/v1/budgets')
      .send({ ownerScopeType: 'CLUB', ownerScopeId: club.id });

    // Two budgets is two answers to "what did this club plan to spend".
    expect(again.status).toBe(409);
    expect(errorBody(again).code).toBe('BUDGET_EXISTS');
  });

  it('freezes the lines once approved, and thaws them if approval is withdrawn', async () => {
    const club = await createClubIn(org);
    const income = await category(org, 'INCOME');
    const { agent } = await signInAs(app, org);

    const budgetId = budgetResponseSchema.parse(
      (await agent.post('/api/v1/budgets').send({ ownerScopeType: 'CLUB', ownerScopeId: club.id }))
        .body,
    ).data.id;

    const line = await agent
      .post(`/api/v1/budgets/${budgetId}/lines`)
      .send({ categoryId: income.id, description: 'Car wash', amountPlanned: '1500000' });
    const lineId = (line.body as { data: { id: string } }).data.id;

    await agent.post(`/api/v1/budgets/${budgetId}/approval`).send({ isApproved: true });

    // The DATABASE refuses this, not the handler — so the rule holds for a job and for a
    // psql session during an incident, which is when somebody is most likely to try.
    const edit = await agent
      .patch(`/api/v1/budgets/${budgetId}/lines/${lineId}`)
      .send({ amountPlanned: '9999999' });
    expect(edit.status).toBe(409);
    expect(errorBody(edit).code).toBe('BUDGET_APPROVED');

    const removed = await agent.delete(`/api/v1/budgets/${budgetId}/lines/${lineId}`);
    expect(removed.status).toBe(409);
    expect(errorBody(removed).code).toBe('BUDGET_APPROVED');

    // Withdrawing approval is the way back. A treasurer who approved the wrong budget
    // should not need a database password to correct it.
    await agent.post(`/api/v1/budgets/${budgetId}/approval`).send({ isApproved: false });
    const afterThaw = await agent
      .patch(`/api/v1/budgets/${budgetId}/lines/${lineId}`)
      .send({ amountPlanned: '1600000' });
    expect(afterThaw.status).toBe(200);
  });

  it('will not let a club approve its own budget', async () => {
    const club = await createClubIn(org);
    const { agent: district } = await signInAs(app, org);
    const budgetId = budgetResponseSchema.parse(
      (
        await district
          .post('/api/v1/budgets')
          .send({ ownerScopeType: 'CLUB', ownerScopeId: club.id })
      ).body,
    ).data.id;

    // A club treasurer holds finance:write:club — scoped to their own club. Approval is a
    // district act, and the difference is the whole point of scope.
    const { agent: clubTreasurer } = await signInAs(app, org, {
      permissions: TREASURER,
      scopeType: 'CLUB',
      scopeId: club.id,
    });

    const response = await clubTreasurer
      .post(`/api/v1/budgets/${budgetId}/approval`)
      .send({ isApproved: true });

    expect(response.status).toBe(403);
    expect(errorBody(response).code).toBe('INSUFFICIENT_SCOPE');
  });
});

describe('finance scope', () => {
  let app: Express;
  let org: OrgFixture;

  beforeEach(async () => {
    await resetDatabase();
    app = createApp();
    org = await createOrg();
  });

  it('hides another club’s budget, and its lines with it', async () => {
    const mine = await createClubIn(org, 'Rotaract Club of Mine');
    const theirs = await createClubIn(org, 'Rotaract Club of Theirs');
    const income = await category(org, 'INCOME');

    const { agent: district } = await signInAs(app, org);
    const theirBudget = budgetResponseSchema.parse(
      (
        await district
          .post('/api/v1/budgets')
          .send({ ownerScopeType: 'CLUB', ownerScopeId: theirs.id })
      ).body,
    ).data.id;
    await district
      .post(`/api/v1/budgets/${theirBudget}/lines`)
      .send({ categoryId: income.id, description: 'Their car wash', amountPlanned: '1' });

    const { agent } = await signInAs(app, org, {
      permissions: TREASURER,
      scopeType: 'CLUB',
      scopeId: mine.id,
    });

    // 404, never 403: a 403 confirms the budget exists, which hands over the shape of the
    // district one identifier at a time.
    expect((await agent.get(`/api/v1/budgets/${theirBudget}`)).status).toBe(404);

    // And SIDEWAYS. Lines carry no district_id of their own — they inherit through the
    // budget — so a nested read is the route somebody forgets to close.
    expect((await agent.get(`/api/v1/budgets/${theirBudget}/lines`)).status).toBe(404);
    expect(
      (
        await agent
          .post(`/api/v1/budgets/${theirBudget}/lines`)
          .send({ categoryId: income.id, description: 'Sneaked in', amountPlanned: '1' })
      ).status,
    ).toBe(404);
  });

  it('filters a LIST rather than refusing it', async () => {
    const mine = await createClubIn(org, 'Rotaract Club of Mine');
    const theirs = await createClubIn(org, 'Rotaract Club of Theirs');

    const { agent: district } = await signInAs(app, org);
    for (const club of [mine, theirs]) {
      await district
        .post('/api/v1/budgets')
        .send({ ownerScopeType: 'CLUB', ownerScopeId: club.id });
    }

    const { agent } = await signInAs(app, org, {
      permissions: TREASURER,
      scopeType: 'CLUB',
      scopeId: mine.id,
    });

    const body = budgetListResponseSchema.parse((await agent.get('/api/v1/budgets')).body);
    expect(body.data.map((budget) => budget.ownerName)).toEqual(['Rotaract Club of Mine']);
  });

  it('gives a club SECRETARY expenditure as well as income', async () => {
    // The predecessor's failure, and a logged complaint: secretaries saw collections and
    // not spending. One permission covers both halves, so this must keep passing.
    const club = await createClubIn(org);
    const spend = await category(org, 'EXPENDITURE', 'Projects');

    const { agent: treasurer } = await signInAs(app, org);
    await treasurer.post('/api/v1/transactions').send({
      ownerScopeType: 'CLUB',
      ownerScopeId: club.id,
      categoryId: spend.id,
      amount: '750000',
      occurredOn: '2027-09-14',
      description: 'Medical camp supplies',
    });

    const { agent: secretary } = await signInAs(app, org, {
      permissions: SECRETARY,
      scopeType: 'CLUB',
      scopeId: club.id,
    });

    const listed = transactionListResponseSchema.parse(
      (await secretary.get('/api/v1/transactions')).body,
    );
    expect(listed.data).toHaveLength(1);
    expect(listed.data[0]?.direction).toBe('EXPENDITURE');
    expect(listed.data[0]?.amount).toBe('750000.00');

    // …and may not record one. Seeing and doing are different jobs; seeing and
    // not-seeing are not.
    const attempt = await secretary.post('/api/v1/transactions').send({
      ownerScopeType: 'CLUB',
      ownerScopeId: club.id,
      categoryId: spend.id,
      amount: '1000',
      occurredOn: '2027-09-15',
    });
    expect(attempt.status).toBe(403);
  });
});

describe('transactions', () => {
  let app: Express;
  let org: OrgFixture;

  beforeEach(async () => {
    await resetDatabase();
    app = createApp();
    org = await createOrg();
  });

  it('takes its direction from the CATEGORY, not from the caller', async () => {
    const club = await createClubIn(org);
    const spend = await category(org, 'EXPENDITURE', 'Projects');
    const { agent } = await signInAs(app, org);

    const created = await agent.post('/api/v1/transactions').send({
      ownerScopeType: 'CLUB',
      ownerScopeId: club.id,
      categoryId: spend.id,
      amount: '250000.25',
      occurredOn: '2027-09-14',
      // A caller cannot talk the server into filing an expense as income: the field is not
      // in the contract, and the category is the single source of truth for which way the
      // money went.
      direction: 'INCOME',
    });

    expect(created.status).toBe(201);
    const txn = transactionResponseSchema.parse(created.body).data;
    expect(txn.direction).toBe('EXPENDITURE');
    // Money survives the round trip exactly. A float would have made this 250000.249999…
    expect(txn.amount).toBe('250000.25');
  });

  it('refuses a budget line that belongs to a different category', async () => {
    const club = await createClubIn(org);
    const income = await category(org, 'INCOME');
    const spend = await category(org, 'EXPENDITURE', 'Projects');
    const { agent } = await signInAs(app, org);

    const budgetId = budgetResponseSchema.parse(
      (await agent.post('/api/v1/budgets').send({ ownerScopeType: 'CLUB', ownerScopeId: club.id }))
        .body,
    ).data.id;
    const line = await agent
      .post(`/api/v1/budgets/${budgetId}/lines`)
      .send({ categoryId: income.id, description: 'Car wash', amountPlanned: '1500000' });

    const response = await agent.post('/api/v1/transactions').send({
      ownerScopeType: 'CLUB',
      ownerScopeId: club.id,
      categoryId: spend.id,
      budgetLineId: (line.body as { data: { id: string } }).data.id,
      amount: '1000',
      occurredOn: '2027-09-14',
    });

    // Otherwise an expense lands against an income line and the variance for both is wrong.
    expect(response.status).toBe(422);
    expect(errorBody(response).code).toBe('CATEGORY_DIRECTION_MISMATCH');
  });

  it('refuses a negative amount', async () => {
    const club = await createClubIn(org);
    const income = await category(org, 'INCOME');
    const { agent } = await signInAs(app, org);

    // Direction carries the sign. A negative amount would silently invert an expense into
    // income, and the books would still balance.
    const response = await agent.post('/api/v1/transactions').send({
      ownerScopeType: 'CLUB',
      ownerScopeId: club.id,
      categoryId: income.id,
      amount: '-5000',
      occurredOn: '2027-09-14',
    });

    expect(response.status).toBe(400);
    expect(errorBody(response).code).toBe('VALIDATION_ERROR');
  });
});

describe('the finance summary', () => {
  let app: Express;
  let org: OrgFixture;

  beforeEach(async () => {
    await resetDatabase();
    app = createApp();
    org = await createOrg();
  });

  /**
   * The arithmetic, against figures a treasurer can check on paper.
   *
   * Planned: income 2,000,000 · expenditure 1,200,000
   * Actual:  income 1,750,000 · expenditure 1,325,000.75
   *
   * Income variance is actual − planned = −250,000 (under target).
   * Expenditure variance is planned − actual = −125,000.75 (overspent).
   * **Negative is bad in both**, which is the whole reason the two are computed
   * differently.
   */
  it('computes variance so that positive is good in both directions', async () => {
    const club = await createClubIn(org);
    const income = await category(org, 'INCOME', 'Fundraising');
    const spend = await category(org, 'EXPENDITURE', 'Projects');
    const { agent } = await signInAs(app, org);

    const budgetId = budgetResponseSchema.parse(
      (await agent.post('/api/v1/budgets').send({ ownerScopeType: 'CLUB', ownerScopeId: club.id }))
        .body,
    ).data.id;

    await agent
      .post(`/api/v1/budgets/${budgetId}/lines`)
      .send({ categoryId: income.id, description: 'Car wash', amountPlanned: '2000000' });
    await agent
      .post(`/api/v1/budgets/${budgetId}/lines`)
      .send({ categoryId: spend.id, description: 'Medical camp', amountPlanned: '1200000' });

    const record = async (categoryId: string, amount: string, on: string) =>
      agent.post('/api/v1/transactions').send({
        ownerScopeType: 'CLUB',
        ownerScopeId: club.id,
        categoryId,
        amount,
        occurredOn: on,
      });

    await record(income.id, '1000000', '2027-08-01');
    await record(income.id, '750000', '2027-09-01');
    await record(spend.id, '1325000.75', '2027-09-14');

    const summary = financeSummaryResponseSchema.parse(
      (
        await agent.get('/api/v1/finance/summary').query({
          ownerScopeType: 'CLUB',
          ownerScopeId: club.id,
        })
      ).body,
    ).data;

    expect(summary.income).toBe('1750000.00');
    expect(summary.expenditure).toBe('1325000.75');
    expect(summary.net).toBe('424999.25');
    expect(summary.plannedIncome).toBe('2000000.00');
    expect(summary.plannedExpenditure).toBe('1200000.00');

    const byCode = new Map(summary.categories.map((row) => [row.categoryId, row]));
    expect(byCode.get(income.id)?.variance).toBe('-250000.00');
    expect(byCode.get(spend.id)?.variance).toBe('-125000.75');
  });

  it('reports spending in a category nobody budgeted for', async () => {
    // The row a treasurer most needs: money went somewhere the plan never mentioned.
    const club = await createClubIn(org);
    const spend = await category(org, 'EXPENDITURE', 'Unplanned repairs');
    const { agent } = await signInAs(app, org);

    await agent.post('/api/v1/transactions').send({
      ownerScopeType: 'CLUB',
      ownerScopeId: club.id,
      categoryId: spend.id,
      amount: '400000',
      occurredOn: '2027-09-14',
    });

    const summary = financeSummaryResponseSchema.parse(
      (
        await agent
          .get('/api/v1/finance/summary')
          .query({ ownerScopeType: 'CLUB', ownerScopeId: club.id })
      ).body,
    ).data;

    // No budget at all is not an error. Most clubs record money before anybody writes a
    // plan, and refusing the summary until one exists would hide the figures that are real.
    expect(summary.budgetId).toBeNull();
    expect(summary.expenditure).toBe('400000.00');

    const row = summary.categories.find((entry) => entry.categoryId === spend.id);
    expect(row?.planned).toBe('0.00');
    expect(row?.variance).toBe('-400000.00');
  });

  it('refuses a summary for a club the caller cannot see', async () => {
    const mine = await createClubIn(org, 'Rotaract Club of Mine');
    const theirs = await createClubIn(org, 'Rotaract Club of Theirs');
    const { agent } = await signInAs(app, org, {
      permissions: SECRETARY,
      scopeType: 'CLUB',
      scopeId: mine.id,
    });

    const response = await agent
      .get('/api/v1/finance/summary')
      .query({ ownerScopeType: 'CLUB', ownerScopeId: theirs.id });

    expect(response.status).toBe(404);
  });
});
