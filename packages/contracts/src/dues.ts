import { z } from 'zod';
import { listResponseSchema, paginationQuerySchema, singleResponseSchema } from './common.js';
import { moneyOutSchema, moneySchema } from './finance.js';

/**
 * Dues (docs/05-API-Spec.md §7, FR-5).
 *
 * **THERE IS NO STORED STATUS.** `dues_invoices.status` and `member_dues.amount_paid` were
 * removed by ADR-012 and are VIEWS derived from the payments that exist. Nothing here writes
 * a status; recording a payment inserts a row and the state follows. That is not a
 * refactoring preference — a stored status drifts the first time a payment is corrected, and
 * a club's dues standing is a scored criterion, so drift becomes an award dispute.
 *
 * Money is a decimal STRING in both directions. See `finance.ts`.
 */

export const duesTypes = ['DISTRICT', 'RI'] as const;
export type DuesType = (typeof duesTypes)[number];

export const invoiceStatuses = ['UNPAID', 'PARTIAL', 'PAID', 'WAIVED'] as const;
export type InvoiceStatus = (typeof invoiceStatuses)[number];

// ─── Invoices ────────────────────────────────────────────────────────────────

export const duesPaymentSchema = z.object({
  id: z.uuid(),
  amount: moneyOutSchema,
  paidOn: z.string(),
  method: z.string().nullable(),
  reference: z.string().nullable(),
  evidenceUrl: z.string().nullable(),
  /** Issued on CONFIRMATION, from a database sequence. Null while unconfirmed. */
  receiptNo: z.string().nullable(),
  confirmedAt: z.string().nullable(),
  isConfirmed: z.boolean(),
});
export type DuesPayment = z.infer<typeof duesPaymentSchema>;

export const duesInvoiceSchema = z.object({
  id: z.uuid(),
  clubId: z.uuid(),
  clubName: z.string().nullable(),
  duesType: z.enum(duesTypes),
  amountDue: moneyOutSchema,
  currencyCode: z.string(),
  dueOn: z.string(),

  /**
   * Everything below is READ FROM THE VIEW, never stored (ADR-012).
   */
  amountPaid: moneyOutSchema,
  amountOutstanding: moneyOutSchema,
  status: z.enum(invoiceStatuses),
  /**
   * True when payments exceed the amount due. FLAGGED, not refused — a club that has
   * overpaid has a fact about it, and rejecting the payment would leave the money
   * unrecorded while the bank statement says otherwise.
   */
  isOverpaid: z.boolean(),

  waivedAt: z.string().nullable(),
  waiverReason: z.string().nullable(),
  payments: z.array(duesPaymentSchema).optional(),
});
export type DuesInvoice = z.infer<typeof duesInvoiceSchema>;

export const createDuesInvoiceSchema = z.object({
  id: z.uuid().optional(),
  clubId: z.uuid(),
  duesType: z.enum(duesTypes).default('DISTRICT'),
  amountDue: moneySchema,
  currencyCode: z.string().trim().length(3).toUpperCase().default('UGX'),
  dueOn: z.iso.date(),
});
export type CreateDuesInvoice = z.infer<typeof createDuesInvoiceSchema>;

/**
 * Issue the same invoice to EVERY club affiliated for the year, in one operation.
 *
 * The District Treasurer's first act of the year, and doing it 68 times by hand is how it
 * ends up half done. Idempotent: a club that already has an invoice of this type for the
 * year is skipped rather than failing the batch, because the realistic reason to run it
 * twice is that a club was chartered in between.
 */
export const bulkIssueDuesSchema = z.object({
  duesType: z.enum(duesTypes).default('DISTRICT'),
  amountDue: moneySchema,
  currencyCode: z.string().trim().length(3).toUpperCase().default('UGX'),
  dueOn: z.iso.date(),
});
export type BulkIssueDues = z.infer<typeof bulkIssueDuesSchema>;

export const bulkIssueResultSchema = z.object({
  issued: z.number().int().nonnegative(),
  /** Clubs that already had one. Not an error — see above. */
  skipped: z.number().int().nonnegative(),
});

export const waiveDuesInvoiceSchema = z.object({
  /**
   * Required, and stored. A waiver is the one part of dues state a human decides, so the
   * reason is the whole audit trail — "why does this club owe nothing" is a question that
   * gets asked at an AGM.
   */
  reason: z.string().trim().min(10).max(500),
});
export type WaiveDuesInvoice = z.infer<typeof waiveDuesInvoiceSchema>;

export const recordDuesPaymentSchema = z.object({
  id: z.uuid().optional(),
  amount: moneySchema,
  paidOn: z.iso.date(),
  method: z.string().trim().max(60).nullable().optional(),
  reference: z.string().trim().max(120).nullable().optional(),
  evidenceUrl: z.url().max(500).nullable().optional(),
  /**
   * Confirming issues the receipt number and notifies the club.
   *
   * Separate from recording, because a club treasurer may enter a payment they have made
   * and the DISTRICT treasurer is the one who confirms it arrived. A single step would mean
   * a receipt number issued for money nobody has seen.
   */
  confirm: z.boolean().default(false),
});
export type RecordDuesPayment = z.infer<typeof recordDuesPaymentSchema>;

export const duesInvoiceListQuerySchema = paginationQuerySchema.extend({
  clubId: z.uuid().optional(),
  duesType: z.enum(duesTypes).optional(),
  status: z.enum(invoiceStatuses).optional(),
});

// ─── The district-wide grid ──────────────────────────────────────────────────

/**
 * `GET /dues/status` — the District Treasurer's main working screen.
 *
 * One row per club, whether or not it has an invoice. A club with NO invoice is the row
 * that matters most on this screen and would be invisible in a list of invoices.
 */
export const duesStatusRowSchema = z.object({
  clubId: z.uuid(),
  clubName: z.string(),
  invoiceId: z.uuid().nullable(),
  duesType: z.enum(duesTypes).nullable(),
  amountDue: moneyOutSchema,
  amountPaid: moneyOutSchema,
  amountOutstanding: moneyOutSchema,
  /** Null when the club has no invoice for this year — distinct from UNPAID. */
  status: z.enum(invoiceStatuses).nullable(),
  dueOn: z.string().nullable(),
  isOverdue: z.boolean(),
});
export type DuesStatusRow = z.infer<typeof duesStatusRowSchema>;

export const duesStatusSchema = z.object({
  rotaryYearId: z.uuid(),
  duesType: z.enum(duesTypes),
  totalDue: moneyOutSchema,
  totalPaid: moneyOutSchema,
  totalOutstanding: moneyOutSchema,
  clubsWithNoInvoice: z.number().int().nonnegative(),
  rows: z.array(duesStatusRowSchema),
});
export type DuesStatus = z.infer<typeof duesStatusSchema>;

export const duesStatusQuerySchema = z.object({
  duesType: z.enum(duesTypes).default('DISTRICT'),
});

// ─── Member dues ─────────────────────────────────────────────────────────────

export const memberDuesSchema = z.object({
  id: z.uuid(),
  clubId: z.uuid(),
  personId: z.uuid(),
  personName: z.string().nullable(),
  amountDue: moneyOutSchema,
  amountPaid: moneyOutSchema,
  amountOutstanding: moneyOutSchema,
  /**
   * Paid against a year that had not started yet.
   *
   * The row is scoped to the TARGET year, not the year the money arrived — otherwise next
   * year's collection rate would be missing every member who paid early, and this year's
   * would be flattered by money that is not for it.
   */
  isPrepaid: z.boolean(),
  payments: z.array(duesPaymentSchema).optional(),
});
export type MemberDues = z.infer<typeof memberDuesSchema>;

export const createMemberDuesSchema = z.object({
  id: z.uuid().optional(),
  clubId: z.uuid(),
  personId: z.uuid(),
  amountDue: moneySchema,
  /**
   * The Rotary Year this is FOR, as a label — `2028-29` for a prepayment. Absent means the
   * caller's current year. A label rather than an id: it is what a treasurer reads on the
   * screen, and an id in a request body is an internal identifier leaking into one.
   */
  forYearLabel: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}$/, 'Year must look like 2028-29')
    .optional(),
});
export type CreateMemberDues = z.infer<typeof createMemberDuesSchema>;

export const memberDuesListQuerySchema = paginationQuerySchema.extend({
  clubId: z.uuid().optional(),
  personId: z.uuid().optional(),
  /** `true` returns only rows that still owe something. */
  outstandingOnly: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

// ─── Envelopes ───────────────────────────────────────────────────────────────

export const duesInvoiceResponseSchema = singleResponseSchema(duesInvoiceSchema);
export const duesInvoiceListResponseSchema = listResponseSchema(duesInvoiceSchema);
export const duesPaymentResponseSchema = singleResponseSchema(duesPaymentSchema);
export const bulkIssueResponseSchema = singleResponseSchema(bulkIssueResultSchema);
export const duesStatusResponseSchema = singleResponseSchema(duesStatusSchema);
export const memberDuesResponseSchema = singleResponseSchema(memberDuesSchema);
export const memberDuesListResponseSchema = listResponseSchema(memberDuesSchema);
