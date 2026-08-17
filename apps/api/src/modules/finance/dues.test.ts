import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  bulkIssueResponseSchema,
  duesInvoiceResponseSchema,
  duesStatusResponseSchema,
  memberDuesListResponseSchema,
  memberDuesResponseSchema,
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
 * Dues (FR-5).
 *
 * The assertions here are all about ARITHMETIC and about the fact that no status is stored.
 *
 * A club's dues standing is a scored criterion, so a figure that is out by a hundredth, or a
 * status that has drifted from the payments behind it, does not stay a reporting problem —
 * it becomes an award dispute at an AGM. Every number below is one a treasurer could
 * reproduce on paper, and every status is read back from the view rather than from anything
 * this code wrote down.
 */

const DISTRICT_TREASURER = ['finance:read:club', 'finance:write:club', 'dues:manage:district'];
const CLUB_OFFICER = ['finance:read:club', 'finance:write:club'];

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
    permissions: options.permissions ?? DISTRICT_TREASURER,
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

describe('dues invoices', () => {
  let app: Express;
  let org: OrgFixture;

  beforeEach(async () => {
    await resetDatabase();
    app = createApp();
    org = await createOrg();
  });

  it('reaches exactly PAID through partial payments, with no rounding drift', async () => {
    // 1,500,000.33 in three uneven parts. A float would land this at 1500000.3299999999 and
    // leave the invoice PARTIAL forever — a club that has paid in full and is chased for it.
    const club = await createClubIn(org);
    const { agent } = await signInAs(app, org);

    const invoiceId = duesInvoiceResponseSchema.parse(
      (
        await agent.post('/api/v1/dues/invoices').send({
          clubId: club.id,
          amountDue: '1500000.33',
          dueOn: '2027-09-30',
        })
      ).body,
    ).data.id;

    const pay = async (amount: string) =>
      duesInvoiceResponseSchema.parse(
        (
          await agent
            .post(`/api/v1/dues/invoices/${invoiceId}/payments`)
            .send({ amount, paidOn: '2027-08-01', confirm: true })
        ).body,
      ).data;

    const first = await pay('500000.11');
    expect(first.status).toBe('PARTIAL');
    expect(first.amountPaid).toBe('500000.11');
    expect(first.amountOutstanding).toBe('1000000.22');

    const second = await pay('750000.22');
    expect(second.status).toBe('PARTIAL');
    expect(second.amountOutstanding).toBe('250000.00');

    const third = await pay('250000.00');
    // EXACTLY paid, not "close enough".
    expect(third.status).toBe('PAID');
    expect(third.amountPaid).toBe('1500000.33');
    expect(third.amountOutstanding).toBe('0.00');
    expect(third.isOverpaid).toBe(false);
  });

  it('accepts an overpayment and flags it rather than refusing it', async () => {
    // A club that has overpaid has a FACT about it. Rejecting the row would leave the money
    // unrecorded while the bank statement says otherwise, which is the worse of the two.
    const club = await createClubIn(org);
    const { agent } = await signInAs(app, org);

    const invoiceId = duesInvoiceResponseSchema.parse(
      (
        await agent
          .post('/api/v1/dues/invoices')
          .send({ clubId: club.id, amountDue: '1000000', dueOn: '2027-09-30' })
      ).body,
    ).data.id;

    const paid = duesInvoiceResponseSchema.parse(
      (
        await agent
          .post(`/api/v1/dues/invoices/${invoiceId}/payments`)
          .send({ amount: '1200000', paidOn: '2027-08-01', confirm: true })
      ).body,
    ).data;

    expect(paid.status).toBe('PAID');
    expect(paid.amountPaid).toBe('1200000.00');
    // The view clamps outstanding at zero, so the overpayment is only visible as a flag.
    expect(paid.amountOutstanding).toBe('0.00');
    expect(paid.isOverpaid).toBe(true);
  });

  it('issues a receipt number ON CONFIRMATION, and never before', async () => {
    const club = await createClubIn(org);
    const { agent } = await signInAs(app, org);

    const invoiceId = duesInvoiceResponseSchema.parse(
      (
        await agent
          .post('/api/v1/dues/invoices')
          .send({ clubId: club.id, amountDue: '500000', dueOn: '2027-09-30' })
      ).body,
    ).data.id;

    const recorded = duesInvoiceResponseSchema.parse(
      (
        await agent
          .post(`/api/v1/dues/invoices/${invoiceId}/payments`)
          .send({ amount: '500000', paidOn: '2027-08-01' })
      ).body,
    ).data;

    // Unconfirmed: a claim, not a receipt. Issuing a number here would be issuing a receipt
    // for money nobody has seen.
    const pending = recorded.payments?.[0];
    expect(pending?.isConfirmed).toBe(false);
    expect(pending?.receiptNo).toBeNull();
    // …and the invoice is still UNPAID, because the view counts CONFIRMED payments only.
    // An unconfirmed row is a claim, and a claim must not mark a club paid — dues status is
    // a scored criterion, so it would award points for money nobody has verified.
    expect(recorded.status).toBe('UNPAID');
    expect(recorded.amountPaid).toBe('0.00');

    const confirmed = duesInvoiceResponseSchema.parse(
      (await agent.post(`/api/v1/dues/invoices/${invoiceId}/payments/${pending?.id ?? ''}/confirm`))
        .body,
    ).data;

    const receipt = confirmed.payments?.[0];
    expect(receipt?.isConfirmed).toBe(true);
    expect(receipt?.receiptNo).toMatch(/^RCT-\d{6}$/);
  });

  it('never issues the same receipt number twice, even under concurrent confirmation', async () => {
    // The reason this is a database SEQUENCE and not `SELECT max(receipt_no) + 1`. Two
    // treasurers confirming in the same second is not exotic; it is a Monday morning.
    const club = await createClubIn(org);
    const { agent } = await signInAs(app, org);

    const invoiceId = duesInvoiceResponseSchema.parse(
      (
        await agent
          .post('/api/v1/dues/invoices')
          .send({ clubId: club.id, amountDue: '5000000', dueOn: '2027-09-30' })
      ).body,
    ).data.id;

    const paymentIds: string[] = [];
    for (let index = 0; index < 8; index += 1) {
      const body = duesInvoiceResponseSchema.parse(
        (
          await agent
            .post(`/api/v1/dues/invoices/${invoiceId}/payments`)
            .send({ amount: '100000', paidOn: '2027-08-01' })
        ).body,
      ).data;
      paymentIds.push(body.payments?.at(-1)?.id ?? '');
    }

    // All at once, on purpose.
    await Promise.all(
      paymentIds.map((paymentId) =>
        agent.post(`/api/v1/dues/invoices/${invoiceId}/payments/${paymentId}/confirm`),
      ),
    );

    const receipts = (
      await unscopedPrisma.duesPayment.findMany({
        where: { invoiceId },
        select: { receiptNo: true },
      })
    ).map((row) => row.receiptNo);

    expect(receipts).toHaveLength(8);
    expect(receipts.every((receipt) => receipt !== null)).toBe(true);
    expect(new Set(receipts).size).toBe(8);
  });

  it('refuses a second invoice of the same type for one club and year', async () => {
    const club = await createClubIn(org);
    const { agent } = await signInAs(app, org);

    const send = () =>
      agent
        .post('/api/v1/dues/invoices')
        .send({ clubId: club.id, amountDue: '1000000', dueOn: '2027-09-30' });

    expect((await send()).status).toBe(201);
    const again = await send();
    expect(again.status).toBe(409);
    expect(errorBody(again).code).toBe('DUES_INVOICE_EXISTS');

    // A DIFFERENT type is a different debt and is allowed.
    const ri = await agent
      .post('/api/v1/dues/invoices')
      .send({ clubId: club.id, duesType: 'RI', amountDue: '400000', dueOn: '2027-09-30' });
    expect(ri.status).toBe(201);
  });

  it('waives with a reason, and the view says WAIVED without any payment', async () => {
    const club = await createClubIn(org);
    const { agent } = await signInAs(app, org);

    const invoiceId = duesInvoiceResponseSchema.parse(
      (
        await agent
          .post('/api/v1/dues/invoices')
          .send({ clubId: club.id, amountDue: '1000000', dueOn: '2027-09-30' })
      ).body,
    ).data.id;

    const waived = duesInvoiceResponseSchema.parse(
      (
        await agent
          .post(`/api/v1/dues/invoices/${invoiceId}/waive`)
          .send({ reason: 'Club chartered in May; district agreed a pro-rata exemption.' })
      ).body,
    ).data;

    // Waiving is the ONE part of dues state a human decides, which is why it is the one
    // part stored on the invoice rather than derived.
    expect(waived.status).toBe('WAIVED');
    expect(waived.waiverReason).toContain('pro-rata');
    expect(waived.waivedAt).not.toBeNull();

    // A reason is required and a short one is not a reason.
    const bad = await agent.post(`/api/v1/dues/invoices/${invoiceId}/waive`).send({ reason: 'ok' });
    expect(bad.status).toBe(400);
  });
});

describe('bulk issue', () => {
  let app: Express;
  let org: OrgFixture;

  beforeEach(async () => {
    await resetDatabase();
    app = createApp();
    org = await createOrg();
  });

  it('invoices every affiliated club, and skips the ones already done', async () => {
    const clubs = [
      await createClubIn(org, 'Rotaract Club of A'),
      await createClubIn(org, 'Rotaract Club of B'),
      await createClubIn(org, 'Rotaract Club of C'),
    ];
    const { agent } = await signInAs(app, org);

    // One club already invoiced by hand — the realistic state when somebody runs this.
    await agent
      .post('/api/v1/dues/invoices')
      .send({ clubId: clubs[0]?.id, amountDue: '999', dueOn: '2027-09-30' });

    const first = bulkIssueResponseSchema.parse(
      (
        await agent
          .post('/api/v1/dues/invoices/bulk')
          .send({ amountDue: '1000000', dueOn: '2027-09-30' })
      ).body,
    ).data;

    expect(first.issued).toBe(2);
    expect(first.skipped).toBe(1);

    // Idempotent. Running it again after a new club is chartered must invoice the new one
    // and leave every other club exactly as it is — including the hand-made 999 invoice,
    // which must not be overwritten with the bulk amount.
    await createClubIn(org, 'Rotaract Club of D');
    const second = bulkIssueResponseSchema.parse(
      (
        await agent
          .post('/api/v1/dues/invoices/bulk')
          .send({ amountDue: '1000000', dueOn: '2027-09-30' })
      ).body,
    ).data;

    expect(second.issued).toBe(1);
    expect(second.skipped).toBe(3);

    const untouched = await unscopedPrisma.duesInvoice.findFirst({
      where: { clubId: clubs[0]?.id },
      select: { amountDue: true },
    });
    expect(untouched?.amountDue.toFixed(2)).toBe('999.00');
  });
});

describe('the district-wide grid', () => {
  let app: Express;
  let org: OrgFixture;

  beforeEach(async () => {
    await resetDatabase();
    app = createApp();
    org = await createOrg();
  });

  it('shows a club that has NO invoice, which a list of invoices could not', async () => {
    const paid = await createClubIn(org, 'Rotaract Club of Paid');
    await createClubIn(org, 'Rotaract Club of Forgotten');
    const { agent } = await signInAs(app, org);

    const invoiceId = duesInvoiceResponseSchema.parse(
      (
        await agent
          .post('/api/v1/dues/invoices')
          .send({ clubId: paid.id, amountDue: '1000000', dueOn: '2027-09-30' })
      ).body,
    ).data.id;
    await agent
      .post(`/api/v1/dues/invoices/${invoiceId}/payments`)
      .send({ amount: '1000000', paidOn: '2027-08-01', confirm: true });

    const grid = duesStatusResponseSchema.parse((await agent.get('/api/v1/dues/status')).body).data;

    expect(grid.rows).toHaveLength(2);
    expect(grid.clubsWithNoInvoice).toBe(1);

    const forgotten = grid.rows.find((row) => row.clubName.includes('Forgotten'));
    // NULL, not UNPAID. "Nobody invoiced this club" and "this club has not paid" are
    // different problems with different people to chase.
    expect(forgotten?.status).toBeNull();
    expect(forgotten?.invoiceId).toBeNull();

    const settled = grid.rows.find((row) => row.clubName.includes('Paid'));
    expect(settled?.status).toBe('PAID');
    expect(grid.totalPaid).toBe('1000000.00');
    expect(grid.totalOutstanding).toBe('0.00');
  });

  it('shows a club treasurer only their own club', async () => {
    const mine = await createClubIn(org, 'Rotaract Club of Mine');
    const theirs = await createClubIn(org, 'Rotaract Club of Theirs');

    const { agent: district } = await signInAs(app, org);
    for (const club of [mine, theirs]) {
      await district
        .post('/api/v1/dues/invoices')
        .send({ clubId: club.id, amountDue: '1000000', dueOn: '2027-09-30' });
    }

    const { agent } = await signInAs(app, org, {
      permissions: CLUB_OFFICER,
      scopeType: 'CLUB',
      scopeId: mine.id,
    });

    const grid = duesStatusResponseSchema.parse((await agent.get('/api/v1/dues/status')).body).data;
    expect(grid.rows.map((row) => row.clubName)).toEqual(['Rotaract Club of Mine']);
  });

  it('will not let a club officer raise or waive an invoice', async () => {
    const club = await createClubIn(org);
    const { agent } = await signInAs(app, org, {
      permissions: CLUB_OFFICER,
      scopeType: 'CLUB',
      scopeId: club.id,
    });

    // A club confirming its own dues is a club marking its own homework.
    const raised = await agent
      .post('/api/v1/dues/invoices')
      .send({ clubId: club.id, amountDue: '1000000', dueOn: '2027-09-30' });
    expect(raised.status).toBe(403);
  });
});

describe('member dues', () => {
  let app: Express;
  let org: OrgFixture;

  beforeEach(async () => {
    await resetDatabase();
    app = createApp();
    org = await createOrg();
  });

  it('records a collection and derives what is still owed', async () => {
    const club = await createClubIn(org);
    const person = await createPerson();
    const { agent } = await signInAs(app, org);

    const created = memberDuesResponseSchema.parse(
      (
        await agent
          .post('/api/v1/member-dues')
          .send({ clubId: club.id, personId: person.id, amountDue: '50000' })
      ).body,
    ).data;

    expect(created.isPrepaid).toBe(false);
    expect(created.amountOutstanding).toBe('50000.00');

    const afterPayment = memberDuesResponseSchema.parse(
      (
        await agent
          .post(`/api/v1/member-dues/${created.id}/payments`)
          .send({ amount: '20000', paidOn: '2027-08-01', confirm: true })
      ).body,
    ).data;

    expect(afterPayment.amountPaid).toBe('20000.00');
    expect(afterPayment.amountOutstanding).toBe('30000.00');
  });

  it('puts a prepayment in the year it is FOR, not the year it arrived', async () => {
    /**
     * The whole point. A member paying next year's dues in May belongs to NEXT year's
     * collection rate; recording it against this year would flatter this year's figure with
     * money that is not for it and leave next year short of a member who has already paid.
     */
    const club = await createClubIn(org);
    const person = await createPerson();
    const { agent } = await signInAs(app, org);

    // 2028-29 exists as a Rotary Year and is open for this district.
    const nextYear = await unscopedPrisma.rotaryYear.create({
      data: {
        label: '2028-29',
        startsOn: new Date('2028-07-01'),
        endsOn: new Date('2029-06-30'),
      },
      select: { id: true },
    });
    await unscopedPrisma.districtYear.create({
      data: { districtId: org.districtId, rotaryYearId: nextYear.id, isCurrent: false },
    });

    const created = memberDuesResponseSchema.parse(
      (
        await agent.post('/api/v1/member-dues').send({
          clubId: club.id,
          personId: person.id,
          amountDue: '55000',
          forYearLabel: '2028-29',
        })
      ).body,
    ).data;

    expect(created.isPrepaid).toBe(true);

    // The row lives in 2028-29 …
    const stored = await unscopedPrisma.memberDues.findFirst({
      where: { id: created.id },
      select: { rotaryYearId: true },
    });
    expect(stored?.rotaryYearId).toBe(nextYear.id);

    // … and is therefore INVISIBLE from this year's list, which is the behaviour that keeps
    // this year's collection rate honest.
    const thisYear = memberDuesListResponseSchema.parse(
      (await agent.get('/api/v1/member-dues')).body,
    );
    expect(thisYear.data).toHaveLength(0);
  });

  it('refuses a payment recorded against a year that has closed', async () => {
    // `?year=` is a read door. This must not become the way around it.
    const club = await createClubIn(org);
    const person = await createPerson();
    const { agent } = await signInAs(app, org);

    const response = await agent.post('/api/v1/member-dues').send({
      clubId: club.id,
      personId: person.id,
      amountDue: '50000',
      forYearLabel: org.previousYearLabel,
    });

    expect(response.status).toBe(422);
    expect(errorBody(response).code).toBe('YEAR_LOCKED');
  });

  it('refuses a second dues row for the same member, club and year', async () => {
    const club = await createClubIn(org);
    const person = await createPerson();
    const { agent } = await signInAs(app, org);

    const send = () =>
      agent
        .post('/api/v1/member-dues')
        .send({ clubId: club.id, personId: person.id, amountDue: '50000' });

    expect((await send()).status).toBe(201);
    const again = await send();
    expect(again.status).toBe(409);
    expect(errorBody(again).code).toBe('MEMBER_DUES_EXISTS');
  });

  it('will not show one club’s collection sheet to another club', async () => {
    const mine = await createClubIn(org, 'Rotaract Club of Mine');
    const theirs = await createClubIn(org, 'Rotaract Club of Theirs');
    const person = await createPerson();

    const { agent: district } = await signInAs(app, org);
    await district
      .post('/api/v1/member-dues')
      .send({ clubId: theirs.id, personId: person.id, amountDue: '50000' });

    const { agent } = await signInAs(app, org, {
      permissions: CLUB_OFFICER,
      scopeType: 'CLUB',
      scopeId: mine.id,
    });

    const listed = memberDuesListResponseSchema.parse(
      (await agent.get('/api/v1/member-dues')).body,
    );
    expect(listed.data).toHaveLength(0);
  });
});

/** A person with no club and no account, for the member-dues rows above. */
async function createPerson() {
  return unscopedPrisma.person.create({
    data: { firstName: 'Ann', lastName: `Nakato-${randomUUID().slice(0, 6)}` },
    select: { id: true },
  });
}
