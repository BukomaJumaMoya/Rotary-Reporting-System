import type {
  BulkIssueDues,
  CreateDuesInvoice,
  CreateMemberDues,
  DuesInvoice,
  DuesPayment,
  DuesStatus,
  DuesStatusRow,
  MemberDues,
  RecordDuesPayment,
  RequestContext,
  WaiveDuesInvoice,
} from '@dis/contracts';
import type { z } from 'zod';
import type {
  duesInvoiceListQuerySchema,
  duesStatusQuerySchema,
  memberDuesListQuerySchema,
} from '@dis/contracts';
import { db, prisma } from '../../platform/db.js';
import { AppError, ErrorCode, notFound } from '../../platform/errors.js';
import { requireClubScope } from '../../platform/context.js';
import { systemContext } from '../../platform/system-context.js';
import { isoDate } from '../../platform/time.js';
import * as assessment from '../assessment/service.js';
import * as governance from '../governance/appointments.service.js';
import * as notifications from '../notifications/service.js';
import { NotificationTemplate } from '../notifications/templates.js';
import * as clubs from '../org/clubs.service.js';
import { fromMoney, sum, toMoney, ZERO, type Money } from './money.js';

/**
 * Dues — invoices, payments, and the district-wide grid (FR-5).
 *
 * **NOTHING HERE WRITES A STATUS.** `dues_invoices.status` and `member_dues.amount_paid`
 * were removed by ADR-012; both are VIEWS over the payments that exist. Recording a payment
 * inserts one row and the state follows. A stored status drifts the first time a payment is
 * corrected, and a club's dues standing is a scored criterion — so drift becomes an award
 * dispute rather than a reporting inconvenience.
 *
 * The other rule that shapes this file: **a receipt number is allocated by the DATABASE**,
 * by a trigger, at the moment `confirmed_at` becomes non-null. Two treasurers confirming in
 * the same second get two different numbers, and a rolled-back confirmation burns its number
 * rather than handing it to somebody else. A gap in a receipt book invites one question; a
 * number issued twice invites an audit.
 */

type InvoiceListQuery = z.infer<typeof duesInvoiceListQuerySchema>;
type StatusQuery = z.infer<typeof duesStatusQuerySchema>;
type MemberDuesListQuery = z.infer<typeof memberDuesListQuerySchema>;

// ─── Serialisation ───────────────────────────────────────────────────────────

const PAYMENT_SELECT = {
  id: true,
  amount: true,
  paidOn: true,
  method: true,
  reference: true,
  evidenceUrl: true,
  receiptNo: true,
  confirmedAt: true,
} as const;

interface PaymentRow {
  id: string;
  amount: Money;
  paidOn: Date;
  method: string | null;
  reference: string | null;
  evidenceUrl: string | null;
  receiptNo: string | null;
  confirmedAt: Date | null;
}

function serialisePayment(row: PaymentRow): DuesPayment {
  return {
    id: row.id,
    amount: fromMoney(row.amount),
    paidOn: isoDate(row.paidOn),
    method: row.method,
    reference: row.reference,
    evidenceUrl: row.evidenceUrl,
    receiptNo: row.receiptNo,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    isConfirmed: row.confirmedAt !== null,
  };
}

/**
 * The invoice, with its state read FROM THE VIEW.
 *
 * The view is the only source for `status`, `amountPaid` and `amountOutstanding`. This
 * function never computes them from the payment rows it happens to be holding — two
 * implementations of "is this club paid up" is one that will eventually disagree with the
 * grid the District Treasurer is reading.
 */
function serialiseInvoice(
  invoice: {
    id: string;
    clubId: string;
    duesType: 'DISTRICT' | 'RI';
    amountDue: Money;
    currencyCode: string;
    dueOn: Date;
    waivedAt: Date | null;
    waiverReason: string | null;
    payments?: PaymentRow[];
  },
  state: { amountPaid: Money; amountOutstanding: Money; status: DuesInvoice['status'] } | null,
  clubName: string | null,
): DuesInvoice {
  const amountPaid = state?.amountPaid ?? ZERO;

  return {
    id: invoice.id,
    clubId: invoice.clubId,
    clubName,
    duesType: invoice.duesType,
    amountDue: fromMoney(invoice.amountDue),
    currencyCode: invoice.currencyCode,
    dueOn: isoDate(invoice.dueOn),
    amountPaid: fromMoney(amountPaid),
    amountOutstanding: fromMoney(state?.amountOutstanding ?? invoice.amountDue),
    status: state?.status ?? 'UNPAID',
    // The view clamps `amount_outstanding` at zero, so overpayment is invisible there. It
    // is a fact worth surfacing rather than one worth hiding.
    isOverpaid: amountPaid.greaterThan(invoice.amountDue),
    waivedAt: invoice.waivedAt?.toISOString() ?? null,
    waiverReason: invoice.waiverReason,
    ...(invoice.payments ? { payments: invoice.payments.map(serialisePayment) } : {}),
  };
}

/** States for a set of invoices, keyed by invoice id. */
async function statesFor(
  ctx: RequestContext,
  invoiceIds: string[],
): Promise<
  Map<string, { amountPaid: Money; amountOutstanding: Money; status: DuesInvoice['status'] }>
> {
  if (invoiceIds.length === 0) return new Map();

  const rows = await db(ctx).duesInvoiceState.findMany({
    where: { invoiceId: { in: invoiceIds } },
    select: { invoiceId: true, amountPaid: true, amountOutstanding: true, status: true },
  });
  return new Map(
    rows.map((row) => [
      row.invoiceId,
      { amountPaid: row.amountPaid, amountOutstanding: row.amountOutstanding, status: row.status },
    ]),
  );
}

async function clubNames(ctx: RequestContext, clubIds: string[]): Promise<Map<string, string>> {
  return governance.scopeNames(
    ctx,
    [...new Set(clubIds)].map((clubId) => ({ scopeType: 'CLUB' as const, scopeId: clubId })),
  );
}

// ─── Invoices ────────────────────────────────────────────────────────────────

const INVOICE_SELECT = {
  id: true,
  clubId: true,
  duesType: true,
  amountDue: true,
  currencyCode: true,
  dueOn: true,
  waivedAt: true,
  waiverReason: true,
} as const;

export async function listInvoices(
  ctx: RequestContext,
  query: InvoiceListQuery,
): Promise<{ data: DuesInvoice[]; total: number }> {
  // A list is FILTERED to what the caller may see, never refused because one row is out of
  // scope. A club treasurer sees their own invoice; the District Treasurer sees all of them.
  const scopeWhere = ctx.scopes.isDistrictWide ? {} : { clubId: { in: [...ctx.scopes.clubIds] } };

  const where = {
    ...scopeWhere,
    ...(query.clubId ? { clubId: query.clubId } : {}),
    ...(query.duesType ? { duesType: query.duesType } : {}),
  };

  const [rows, total] = await Promise.all([
    db(ctx).duesInvoice.findMany({
      where,
      select: INVOICE_SELECT,
      orderBy: [{ dueOn: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    db(ctx).duesInvoice.count({ where }),
  ]);

  const [states, names] = await Promise.all([
    statesFor(
      ctx,
      rows.map((row) => row.id),
    ),
    clubNames(
      ctx,
      rows.map((row) => row.clubId),
    ),
  ]);

  const data = rows.map((row) =>
    serialiseInvoice(row, states.get(row.id) ?? null, names.get(row.clubId) ?? null),
  );

  // `status` filters the PAGE rather than the query: it lives on the view, and joining a
  // view into the paged query to filter on derived state would make `total` mean something
  // different from what was returned.
  return { data: query.status ? data.filter((row) => row.status === query.status) : data, total };
}

export async function getInvoice(ctx: RequestContext, id: string): Promise<DuesInvoice> {
  const invoice = await db(ctx).duesInvoice.findFirst({
    where: { id },
    select: { ...INVOICE_SELECT, payments: { select: PAYMENT_SELECT } },
  });
  if (!invoice) throw notFound();
  requireClubScope(ctx, invoice.clubId);

  const [states, names] = await Promise.all([
    statesFor(ctx, [invoice.id]),
    clubNames(ctx, [invoice.clubId]),
  ]);

  return serialiseInvoice(
    { ...invoice, payments: [...invoice.payments].sort((a, b) => +a.paidOn - +b.paidOn) },
    states.get(invoice.id) ?? null,
    names.get(invoice.clubId) ?? null,
  );
}

export async function createInvoice(
  ctx: RequestContext,
  input: CreateDuesInvoice,
): Promise<DuesInvoice> {
  requireClubScope(ctx, input.clubId);

  const existing = await db(ctx).duesInvoice.findFirst({
    where: { clubId: input.clubId, duesType: input.duesType },
    select: { id: true },
  });
  // One invoice per club, year and type. Two would be two answers to what the club owes.
  if (existing) {
    throw new AppError(
      409,
      ErrorCode.DUES_INVOICE_EXISTS,
      'This club already has an invoice of that type for the current Rotary Year.',
      { invoiceId: existing.id },
    );
  }

  const created = await db(ctx).duesInvoice.create({
    data: {
      ...(input.id ? { id: input.id } : {}),
      clubId: input.clubId,
      duesType: input.duesType,
      amountDue: toMoney(input.amountDue),
      currencyCode: input.currencyCode,
      dueOn: new Date(input.dueOn),
    },
  });

  return getInvoice(ctx, created.id);
}

/**
 * Issue the same invoice to every club affiliated for the year.
 *
 * The District Treasurer's first act of the year. Doing it 68 times by hand is how it ends
 * up half done, and a club that was missed does not find out until it is marked unpaid.
 *
 * IDEMPOTENT: a club that already has an invoice of this type is skipped rather than
 * failing the batch. The realistic reason to run this twice is that a club was chartered in
 * between, and the correct behaviour then is to invoice the new one and leave the rest
 * exactly as they are — including any that have already been paid.
 *
 * Not queued. 68 inserts is one round trip with `createMany`; a job would add a screen
 * somebody has to watch for work that takes milliseconds.
 */
export async function bulkIssue(
  ctx: RequestContext,
  input: BulkIssueDues,
): Promise<{ issued: number; skipped: number }> {
  const affiliated = await clubs.affiliatedClubIds(ctx);

  const already = await db(ctx).duesInvoice.findMany({
    where: { duesType: input.duesType },
    select: { clubId: true },
  });
  const invoiced = new Set(already.map((row) => row.clubId));
  const missing = affiliated.filter((clubId) => !invoiced.has(clubId));

  if (missing.length > 0) {
    await db(ctx).duesInvoice.createMany({
      data: missing.map((clubId) => ({
        clubId,
        duesType: input.duesType,
        amountDue: toMoney(input.amountDue),
        currencyCode: input.currencyCode,
        dueOn: new Date(input.dueOn),
      })),
    });
  }

  return { issued: missing.length, skipped: affiliated.length - missing.length };
}

/**
 * Waiving.
 *
 * The ONE part of dues state a human decides, which is exactly why it is the one part
 * stored on the invoice rather than derived. The reason is mandatory and kept: "why does
 * this club owe nothing" is a question that gets asked at an AGM, and "somebody waived it"
 * is not an answer.
 */
export async function waiveInvoice(
  ctx: RequestContext,
  id: string,
  input: WaiveDuesInvoice,
): Promise<DuesInvoice> {
  const invoice = await getInvoice(ctx, id);

  await db(ctx).duesInvoice.updateMany({
    where: { id },
    data: { waivedAt: new Date(), waivedByUserId: ctx.userId, waiverReason: input.reason },
  });

  // Dues standing is a scored criterion, so a waiver changes a scorecard.
  await assessment.markStale(ctx, { clubId: invoice.clubId, reason: 'Dues invoice waived' });
  return getInvoice(ctx, id);
}

// ─── Payments ────────────────────────────────────────────────────────────────

/**
 * Records a payment, and optionally confirms it in the same step.
 *
 * The two are separate because a club treasurer may enter a payment they have MADE while
 * the District Treasurer is the one who confirms it ARRIVED. Collapsing them would mean a
 * receipt number issued for money nobody has seen — and a receipt number is the thing a club
 * quotes back six months later when the district says the transfer never came.
 *
 * Overpayment is allowed. The view flags it; nothing here refuses it. A club that has
 * overpaid has a fact about it, and rejecting the row would leave the money unrecorded while
 * the bank statement says otherwise.
 */
export async function recordPayment(
  ctx: RequestContext,
  invoiceId: string,
  input: RecordDuesPayment,
): Promise<DuesInvoice> {
  const invoice = await getInvoice(ctx, invoiceId);

  await db(ctx).duesPayment.create({
    data: {
      ...(input.id ? { id: input.id } : {}),
      invoiceId,
      amount: toMoney(input.amount),
      paidOn: new Date(input.paidOn),
      method: input.method ?? null,
      reference: input.reference ?? null,
      evidenceUrl: input.evidenceUrl ?? null,
      // The RECEIPT NUMBER is not set here. A database trigger allocates it from a sequence
      // when `confirmed_at` becomes non-null, which is what makes two concurrent
      // confirmations produce two different numbers.
      ...(input.confirm ? { confirmedAt: new Date(), confirmedByUserId: ctx.userId } : {}),
    },
  });

  if (input.confirm) await afterConfirmation(ctx, invoice.clubId, invoiceId);
  return getInvoice(ctx, invoiceId);
}

export async function confirmPayment(
  ctx: RequestContext,
  invoiceId: string,
  paymentId: string,
): Promise<DuesInvoice> {
  const invoice = await getInvoice(ctx, invoiceId);

  const payment = await db(ctx).duesPayment.findFirst({
    where: { id: paymentId, invoiceId },
    select: { id: true, confirmedAt: true },
  });
  if (!payment) throw notFound();

  // Already confirmed: not an error, and NOT re-confirmed. Re-running the update would let
  // the trigger see a fresh `confirmed_at`, and while it guards against reallocating a
  // number, the honest answer to "confirm this again" is that it is already done.
  if (payment.confirmedAt) return getInvoice(ctx, invoiceId);

  await db(ctx).duesPayment.updateMany({
    where: { id: paymentId, invoiceId },
    data: { confirmedAt: new Date(), confirmedByUserId: ctx.userId },
  });

  await afterConfirmation(ctx, invoice.clubId, invoiceId);
  return getInvoice(ctx, invoiceId);
}

/**
 * What a confirmation sets off: the club is told, and its scorecard is marked stale.
 *
 * Both go to `modules/notifications` and `modules/assessment` through their exported
 * service functions. Finance neither knows which people hold which office nor what a
 * scorecard is.
 */
async function afterConfirmation(
  ctx: RequestContext,
  clubId: string,
  invoiceId: string,
): Promise<void> {
  await assessment.markStale(ctx, { clubId, reason: 'Dues payment confirmed' });

  const [state, officers] = await Promise.all([
    db(ctx).duesInvoiceState.findFirst({
      where: { invoiceId },
      select: { amountOutstanding: true, status: true },
    }),
    governance.listClubOfficerPersonIds(ctx, clubId),
  ]);

  const names = await clubNames(ctx, [clubId]);

  for (const personId of officers) {
    // Queued, not sent inline: nobody is staring at a form waiting for this, and a mail
    // server that is down must not fail the treasurer's confirmation.
    await notifications.queueNotification({
      personId,
      templateCode: NotificationTemplate.DUES_PAYMENT_CONFIRMED,
      districtId: ctx.districtId,
      payload: {
        clubName: names.get(clubId) ?? 'your club',
        status: state?.status ?? 'UNPAID',
        amountOutstanding: fromMoney(state?.amountOutstanding ?? ZERO),
      },
    });
  }
}

// ─── The district-wide grid ──────────────────────────────────────────────────

/**
 * `GET /dues/status` — one row per CLUB, whether or not it has an invoice.
 *
 * The clubs with no invoice at all are the rows that matter most on this screen, and a list
 * of invoices cannot show them. This is the District Treasurer's main working surface, so it
 * is built from the affiliation list outward rather than from the invoice table inward.
 */
export async function status(ctx: RequestContext, query: StatusQuery): Promise<DuesStatus> {
  const affiliated = await clubs.affiliatedClubIds(ctx);
  const visible = ctx.scopes.isDistrictWide
    ? affiliated
    : affiliated.filter((clubId) => ctx.scopes.clubIds.includes(clubId));

  const invoices = await db(ctx).duesInvoice.findMany({
    where: { duesType: query.duesType, clubId: { in: visible } },
    select: INVOICE_SELECT,
  });

  const [states, names] = await Promise.all([
    statesFor(
      ctx,
      invoices.map((row) => row.id),
    ),
    clubNames(ctx, visible),
  ]);

  const invoiceByClub = new Map(invoices.map((row) => [row.clubId, row]));
  const today = new Date();

  const rows: DuesStatusRow[] = visible.map((clubId) => {
    const invoice = invoiceByClub.get(clubId);
    const state = invoice ? (states.get(invoice.id) ?? null) : null;

    return {
      clubId,
      clubName: names.get(clubId) ?? 'Unknown club',
      invoiceId: invoice?.id ?? null,
      duesType: invoice?.duesType ?? null,
      amountDue: fromMoney(invoice?.amountDue ?? ZERO),
      amountPaid: fromMoney(state?.amountPaid ?? ZERO),
      amountOutstanding: fromMoney(state?.amountOutstanding ?? invoice?.amountDue ?? ZERO),
      // NULL, not UNPAID. "Nobody has invoiced this club" and "this club has not paid" are
      // different problems with different people to chase.
      status: state?.status ?? (invoice ? 'UNPAID' : null),
      dueOn: invoice ? isoDate(invoice.dueOn) : null,
      isOverdue:
        invoice !== undefined &&
        invoice.dueOn < today &&
        state?.status !== 'PAID' &&
        state?.status !== 'WAIVED',
    };
  });

  rows.sort((a, b) => a.clubName.localeCompare(b.clubName));

  return {
    rotaryYearId: ctx.rotaryYearId,
    duesType: query.duesType,
    totalDue: fromMoney(sum(invoices.map((row) => row.amountDue))),
    totalPaid: fromMoney(sum([...states.values()].map((state) => state.amountPaid))),
    totalOutstanding: fromMoney(sum([...states.values()].map((state) => state.amountOutstanding))),
    clubsWithNoInvoice: rows.filter((row) => row.invoiceId === null).length,
    rows,
  };
}

// ─── Member dues ─────────────────────────────────────────────────────────────

const MEMBER_DUES_SELECT = {
  id: true,
  clubId: true,
  personId: true,
  amountDue: true,
  isPrepaid: true,
} as const;

function serialiseMemberDues(
  row: {
    id: string;
    clubId: string;
    personId: string;
    amountDue: Money;
    isPrepaid: boolean;
    payments?: PaymentRow[];
  },
  state: { amountPaid: Money; amountOutstanding: Money } | null,
  personName: string | null,
): MemberDues {
  return {
    id: row.id,
    clubId: row.clubId,
    personId: row.personId,
    personName,
    amountDue: fromMoney(row.amountDue),
    amountPaid: fromMoney(state?.amountPaid ?? ZERO),
    amountOutstanding: fromMoney(state?.amountOutstanding ?? row.amountDue),
    isPrepaid: row.isPrepaid,
    ...(row.payments ? { payments: row.payments.map(serialisePayment) } : {}),
  };
}

export async function listMemberDues(
  ctx: RequestContext,
  query: MemberDuesListQuery,
): Promise<{ data: MemberDues[]; total: number }> {
  const scopeWhere = ctx.scopes.isDistrictWide ? {} : { clubId: { in: [...ctx.scopes.clubIds] } };
  const where = {
    ...scopeWhere,
    ...(query.clubId ? { clubId: query.clubId } : {}),
    ...(query.personId ? { personId: query.personId } : {}),
  };

  const [rows, total] = await Promise.all([
    db(ctx).memberDues.findMany({
      where,
      select: MEMBER_DUES_SELECT,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    db(ctx).memberDues.count({ where }),
  ]);

  const states = await db(ctx).memberDuesState.findMany({
    where: { memberDuesId: { in: rows.map((row) => row.id) } },
    select: { memberDuesId: true, amountPaid: true, amountOutstanding: true },
  });
  const stateById = new Map(states.map((state) => [state.memberDuesId, state]));

  // Names come from `persons` directly rather than through the person serialiser: a NAME is
  // not a contact field, and a treasurer's collection sheet is not a directory.
  const people = await prisma.person.findMany({
    where: { id: { in: rows.map((row) => row.personId) }, deletedAt: null },
    select: { id: true, firstName: true, lastName: true },
  });
  const nameById = new Map(
    people.map((person) => [person.id, `${person.firstName} ${person.lastName}`]),
  );

  const data = rows.map((row) =>
    serialiseMemberDues(row, stateById.get(row.id) ?? null, nameById.get(row.personId) ?? null),
  );

  return {
    // `owesSomething`, not `Number(...) > 0`. The comparison would be correct for any
    // figure a UGX club will ever see, but parsing money into a double anywhere in this
    // module is the habit the next person copies — and the next place they copy it to may
    // be a sum. There is no float in the finance path, and this is how that stays true.
    data: query.outstandingOnly ? data.filter((row) => owesSomething(row.amountOutstanding)) : data,
    total,
  };
}

/**
 * Whether a serialised amount is greater than zero, decided on the STRING.
 *
 * `fromMoney` always produces a fixed two-place decimal with no sign for a non-negative
 * value, so "owes something" is exactly "is not zero" — no parsing required, and correct for
 * figures beyond what a double holds exactly.
 */
function owesSomething(amount: string): boolean {
  return !/^-?0(\.0+)?$/.test(amount.trim());
}

/**
 * A member's dues for a year — including a year that has not started yet.
 *
 * **Prepayment is scoped to the TARGET year, not the year the money arrived.** A member
 * paying next year's dues in May belongs to next year's collection rate; recording it
 * against this year would flatter this year's figure with money that is not for it, and
 * leave next year's short of a member who has already paid. `isPrepaid` marks it so the
 * treasurer can tell the difference on the sheet.
 */
export async function createMemberDues(
  ctx: RequestContext,
  input: CreateMemberDues,
): Promise<MemberDues> {
  requireClubScope(ctx, input.clubId);

  const targetYear = input.forYearLabel
    ? await resolveFutureYear(ctx, input.forYearLabel)
    : { id: ctx.rotaryYearId, isFuture: false };

  /**
   * A prepayment belongs to a DIFFERENT year than the caller's context, and the data access
   * layer stamps the context's year by design — that is axiom 1 working, not an obstacle to
   * route around. `unscopedPrisma` would be the wrong answer and ESLint forbids it here
   * anyway.
   *
   * `systemContext` is the sanctioned mechanism: one district, one year, the locked-year
   * check honoured exactly as a user context honours it, and a MANDATORY reason that reaches
   * `audit_log`. The reason names the member who asked for it, so a year from now the log
   * says why a row appeared in a year nobody was working in.
   */
  const writeCtx = targetYear.isFuture
    ? await systemContext({
        districtId: ctx.districtId,
        rotaryYearId: targetYear.id,
        reason: `Member dues prepaid for ${input.forYearLabel ?? ''}, recorded by user ${ctx.userId}`,
      })
    : ctx;

  const existing = await db(writeCtx).memberDues.findFirst({
    where: { personId: input.personId, clubId: input.clubId },
    select: { id: true },
  });
  if (existing) {
    throw new AppError(
      409,
      ErrorCode.MEMBER_DUES_EXISTS,
      'This member already has a dues row for that club and year.',
      { memberDuesId: existing.id },
    );
  }

  const created = await db(writeCtx).memberDues.create({
    data: {
      ...(input.id ? { id: input.id } : {}),
      clubId: input.clubId,
      personId: input.personId,
      amountDue: toMoney(input.amountDue),
      isPrepaid: targetYear.isFuture,
    },
  });

  const person = await prisma.person.findFirst({
    where: { id: input.personId },
    select: { firstName: true, lastName: true },
  });

  return serialiseMemberDues(
    created,
    null,
    person ? `${person.firstName} ${person.lastName}` : null,
  );
}

/**
 * The Rotary Year a prepayment is FOR.
 *
 * Only forward. Recording a payment against a year that has already closed is backdating,
 * and `?year=` is deliberately a read door — this must not become the way around it.
 */
async function resolveFutureYear(
  ctx: RequestContext,
  label: string,
): Promise<{ id: string; isFuture: boolean }> {
  const [target, current] = await Promise.all([
    prisma.rotaryYear.findFirst({ where: { label }, select: { id: true, startsOn: true } }),
    prisma.rotaryYear.findFirst({
      where: { id: ctx.rotaryYearId },
      select: { startsOn: true },
    }),
  ]);

  if (!target || !current) throw notFound();
  if (target.startsOn < current.startsOn) {
    throw new AppError(
      422,
      ErrorCode.YEAR_LOCKED,
      'Dues can be recorded for the current year or a future one, never a past one.',
      { key: 'forYearLabel' },
    );
  }

  return { id: target.id, isFuture: target.startsOn > current.startsOn };
}

export async function recordMemberPayment(
  ctx: RequestContext,
  memberDuesId: string,
  input: RecordDuesPayment,
): Promise<MemberDues> {
  // Scoped read first. A row in a FUTURE year is invisible from here, and deliberately so:
  // paying against a prepayment is done from that year's context, not this one. What this
  // refuses is a treasurer in 2027-28 quietly moving money into 2028-29's collection rate.
  const row = await db(ctx).memberDues.findFirst({
    where: { id: memberDuesId },
    select: MEMBER_DUES_SELECT,
  });
  if (!row) throw notFound();
  requireClubScope(ctx, row.clubId);

  await db(ctx).memberDuesPayment.create({
    data: {
      ...(input.id ? { id: input.id } : {}),
      memberDuesId,
      amount: toMoney(input.amount),
      paidOn: new Date(input.paidOn),
      method: input.method ?? null,
      reference: input.reference ?? null,
      evidenceUrl: input.evidenceUrl ?? null,
      // The receipt number is allocated by a database trigger on confirmation.
      ...(input.confirm ? { confirmedAt: new Date(), confirmedByUserId: ctx.userId } : {}),
    },
  });

  const [state, person] = await Promise.all([
    db(ctx).memberDuesState.findFirst({
      where: { memberDuesId },
      select: { amountPaid: true, amountOutstanding: true },
    }),
    prisma.person.findFirst({
      where: { id: row.personId },
      select: { firstName: true, lastName: true },
    }),
  ]);

  return serialiseMemberDues(row, state, person ? `${person.firstName} ${person.lastName}` : null);
}
