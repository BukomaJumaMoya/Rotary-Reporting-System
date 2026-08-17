import { z } from 'zod';
import {
  booleanQuerySchema,
  listResponseSchema,
  paginationQuerySchema,
  singleResponseSchema,
} from './common.js';
import { orgScopes } from './context.js';

/**
 * Finance (docs/05-API-Spec.md §7, docs/01-SRS.md FR-5).
 *
 * **MONEY IS A STRING, everywhere, in both directions.** `NUMERIC(14,2)` in Postgres,
 * `Decimal` in Prisma, and a decimal string on the wire — never a JavaScript number. A
 * `number` cannot hold 0.1 + 0.2, and UGX figures run to eight or nine digits, so a float
 * that reaches an award tally or a receipt is a number the district cannot defend. The
 * client formats the string; it never does arithmetic on it.
 *
 * The pattern below is deliberately strict — a plain `z.string()` would accept "abc" and
 * push the failure into Postgres, where it arrives as a 500 rather than a field error.
 */

/** Up to 12 digits before the point, at most 2 after. Optional leading minus is REFUSED. */
const MONEY = /^\d{1,12}(\.\d{1,2})?$/;

export const moneySchema = z
  .string()
  .trim()
  .regex(MONEY, 'Enter an amount like 1250000 or 1250000.50');

/**
 * Money on the way OUT.
 *
 * Looser than `moneySchema` because Prisma's `Decimal.toString()` produces forms the input
 * pattern would reject — `"0"`, and trailing zeros the database keeps. Validating a
 * response against the input rule would fail on our own correct output.
 */
export const moneyOutSchema = z.string();

export const txnDirections = ['INCOME', 'EXPENDITURE'] as const;
export type TxnDirection = (typeof txnDirections)[number];

// ─── Finance categories ──────────────────────────────────────────────────────

/**
 * Categories are DATA, like activity types (axiom 5's habit applied to finance). A district
 * treasurer who wants "Fundraising — car wash" adds a row. `districtId IS NULL` rows are
 * shared templates every district reads and none may edit.
 */
export const financeCategorySchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  direction: z.enum(txnDirections),
  isActive: z.boolean(),
  /** True for a shared template — visible to every district, editable by none. */
  isTemplate: z.boolean(),
});
export type FinanceCategory = z.infer<typeof financeCategorySchema>;

export const createFinanceCategorySchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[A-Z][A-Z0-9_]*$/, 'Use upper case, digits and underscores, e.g. CAR_WASH'),
  name: z.string().trim().min(2).max(120),
  direction: z.enum(txnDirections),
});
export type CreateFinanceCategory = z.infer<typeof createFinanceCategorySchema>;

export const financeCategoryListQuerySchema = z.object({
  direction: z.enum(txnDirections).optional(),
  isActive: booleanQuerySchema.optional(),
});

// ─── Budgets ─────────────────────────────────────────────────────────────────

export const budgetLineSchema = z.object({
  id: z.uuid(),
  categoryId: z.uuid(),
  categoryName: z.string(),
  categoryCode: z.string(),
  direction: z.enum(txnDirections),
  description: z.string(),
  amountPlanned: moneyOutSchema,
});
export type BudgetLine = z.infer<typeof budgetLineSchema>;

export const budgetSchema = z.object({
  id: z.uuid(),
  ownerScopeType: z.enum(orgScopes),
  ownerScopeId: z.uuid(),
  /** Resolved for display, so a list does not need a second call per row. */
  ownerName: z.string().nullable(),
  currencyCode: z.string(),
  approvedAt: z.string().nullable(),
  /** Approval is what locks the lines. Presented as a state, not as a timestamp to read. */
  isApproved: z.boolean(),
  totalPlannedIncome: moneyOutSchema,
  totalPlannedExpenditure: moneyOutSchema,
  lineCount: z.number().int().nonnegative(),
  lines: z.array(budgetLineSchema).optional(),
});
export type Budget = z.infer<typeof budgetSchema>;

export const createBudgetSchema = z.object({
  /** Client-generated, so an offline retry is idempotent (ADR-004). */
  id: z.uuid().optional(),
  ownerScopeType: z.enum(orgScopes),
  ownerScopeId: z.uuid(),
  currencyCode: z.string().trim().length(3).toUpperCase().default('UGX'),
});
export type CreateBudget = z.infer<typeof createBudgetSchema>;

export const updateBudgetSchema = z.object({
  currencyCode: z.string().trim().length(3).toUpperCase().optional(),
});
export type UpdateBudget = z.infer<typeof updateBudgetSchema>;

export const createBudgetLineSchema = z.object({
  id: z.uuid().optional(),
  categoryId: z.uuid(),
  description: z.string().trim().min(1).max(300),
  amountPlanned: moneySchema,
});
export type CreateBudgetLine = z.infer<typeof createBudgetLineSchema>;

export const updateBudgetLineSchema = createBudgetLineSchema
  .omit({ id: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Nothing to change');
export type UpdateBudgetLine = z.infer<typeof updateBudgetLineSchema>;

export const budgetListQuerySchema = paginationQuerySchema.extend({
  ownerScopeType: z.enum(orgScopes).optional(),
  ownerScopeId: z.uuid().optional(),
  isApproved: booleanQuerySchema.optional(),
});

// ─── Transactions ────────────────────────────────────────────────────────────

export const transactionSchema = z.object({
  id: z.uuid(),
  ownerScopeType: z.enum(orgScopes),
  ownerScopeId: z.uuid(),
  ownerName: z.string().nullable(),
  categoryId: z.uuid(),
  categoryName: z.string(),
  categoryCode: z.string(),
  budgetLineId: z.uuid().nullable(),
  direction: z.enum(txnDirections),
  amount: moneyOutSchema,
  currencyCode: z.string(),
  occurredOn: z.string(),
  description: z.string().nullable(),
  evidenceUrl: z.string().nullable(),
  activityId: z.uuid().nullable(),
  createdAt: z.string(),
});
export type Transaction = z.infer<typeof transactionSchema>;

export const createTransactionSchema = z.object({
  id: z.uuid().optional(),
  ownerScopeType: z.enum(orgScopes),
  ownerScopeId: z.uuid(),
  categoryId: z.uuid(),
  /**
   * Optional. A transaction against a budget line is what makes variance meaningful, but
   * requiring one would mean a club cannot record a receipt until somebody has built a
   * budget — and the receipt is the thing that actually happened.
   */
  budgetLineId: z.uuid().nullable().optional(),
  /**
   * NOT taken from the request when a category is given — the CATEGORY carries the
   * direction, and letting a caller send `INCOME` against an expenditure category is how a
   * club's books stop adding up. Present here only so the contract documents the field a
   * response carries; the server derives it.
   */
  amount: moneySchema,
  currencyCode: z.string().trim().length(3).toUpperCase().default('UGX'),
  occurredOn: z.iso.date(),
  description: z.string().trim().max(500).nullable().optional(),
  evidenceUrl: z.url().max(500).nullable().optional(),
  activityId: z.uuid().nullable().optional(),
});
export type CreateTransaction = z.infer<typeof createTransactionSchema>;

export const transactionListQuerySchema = paginationQuerySchema.extend({
  ownerScopeType: z.enum(orgScopes).optional(),
  ownerScopeId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  direction: z.enum(txnDirections).optional(),
  /** Inclusive, on `occurredOn`. */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

// ─── Summary ─────────────────────────────────────────────────────────────────

/**
 * Per-category variance: what was planned, what happened, and the gap.
 *
 * `variance` is planned − actual for expenditure (positive is under budget) and
 * actual − planned for income (positive is over target). Both directions therefore read
 * the same way: **positive is good**. A single subtraction would have made half the table
 * mean the opposite of the other half.
 */
export const categoryVarianceSchema = z.object({
  categoryId: z.uuid(),
  categoryCode: z.string(),
  categoryName: z.string(),
  direction: z.enum(txnDirections),
  planned: moneyOutSchema,
  actual: moneyOutSchema,
  /** Positive is good in BOTH directions. See above. */
  variance: moneyOutSchema,
});
export type CategoryVariance = z.infer<typeof categoryVarianceSchema>;

export const financeSummarySchema = z.object({
  ownerScopeType: z.enum(orgScopes),
  ownerScopeId: z.uuid(),
  currencyCode: z.string(),
  income: moneyOutSchema,
  expenditure: moneyOutSchema,
  /** income − expenditure. Negative is a deficit, and is allowed to be. */
  net: moneyOutSchema,
  plannedIncome: moneyOutSchema,
  plannedExpenditure: moneyOutSchema,
  /** Null when no budget exists for this owner and year — which is not an error. */
  budgetId: z.uuid().nullable(),
  categories: z.array(categoryVarianceSchema),
});
export type FinanceSummary = z.infer<typeof financeSummarySchema>;

export const financeSummaryQuerySchema = z.object({
  ownerScopeType: z.enum(orgScopes),
  ownerScopeId: z.uuid(),
});

// ─── Response envelopes ──────────────────────────────────────────────────────

export const budgetResponseSchema = singleResponseSchema(budgetSchema);
export const budgetListResponseSchema = listResponseSchema(budgetSchema);
export const budgetLineResponseSchema = singleResponseSchema(budgetLineSchema);
export const transactionResponseSchema = singleResponseSchema(transactionSchema);
export const transactionListResponseSchema = listResponseSchema(transactionSchema);
export const financeCategoryResponseSchema = singleResponseSchema(financeCategorySchema);
export const financeCategoryListResponseSchema = z.object({
  data: z.array(financeCategorySchema),
});
export const financeSummaryResponseSchema = singleResponseSchema(financeSummarySchema);
