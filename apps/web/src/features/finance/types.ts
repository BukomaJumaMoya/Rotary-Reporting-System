import type {
  Budget,
  BudgetLine,
  DuesInvoice,
  DuesStatus,
  FinanceCategory,
  FinanceSummary,
  MemberDues,
  PaginationMeta,
  Transaction,
  TrfContribution,
  TrfSummary,
} from '@dis/contracts';

/**
 * Response shapes for the finance screens, named once.
 *
 * Typed against the CONTRACTS package rather than hand-written interfaces, so a field
 * renamed on the server is a compile error here rather than an empty cell a treasurer
 * notices in March — or worse, a blank where an amount should be.
 */

export type {
  Budget,
  BudgetLine,
  DuesInvoice,
  DuesStatus,
  FinanceCategory,
  FinanceSummary,
  MemberDues,
  Transaction,
  TrfContribution,
  TrfSummary,
};

interface ListOf<T> {
  data: T[];
  meta: PaginationMeta;
}
interface SingleOf<T> {
  data: T;
}

export type BudgetListResponse = ListOf<Budget>;
export type BudgetResponse = SingleOf<Budget>;
export type BudgetLineResponse = SingleOf<BudgetLine>;
export type TransactionListResponse = ListOf<Transaction>;
export type TransactionResponse = SingleOf<Transaction>;
export type FinanceSummaryResponse = SingleOf<FinanceSummary>;
export type DuesInvoiceListResponse = ListOf<DuesInvoice>;
export type DuesInvoiceResponse = SingleOf<DuesInvoice>;
export type DuesStatusResponse = SingleOf<DuesStatus>;
export type MemberDuesListResponse = ListOf<MemberDues>;
export type TrfListResponse = ListOf<TrfContribution>;
export type TrfResponse = SingleOf<TrfContribution>;
export type TrfSummaryResponse = SingleOf<TrfSummary>;

/** `GET /finance/categories` returns a bare list — reference data is never paginated. */
export interface FinanceCategoryListResponse {
  data: FinanceCategory[];
}

/** `GET /budgets/:id/lines` likewise: a budget has tens of lines, not thousands. */
export interface BudgetLineListResponse {
  data: BudgetLine[];
}
