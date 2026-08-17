import type {
  Budget,
  BudgetLine,
  CategoryVariance,
  CreateBudget,
  CreateBudgetLine,
  CreateFinanceCategory,
  CreateTransaction,
  FinanceCategory,
  FinanceSummary,
  OrgScopeValue,
  RequestContext,
  Transaction,
  UpdateBudget,
  UpdateBudgetLine,
} from '@dis/contracts';
import type { z } from 'zod';
import type {
  budgetListQuerySchema,
  financeCategoryListQuerySchema,
  financeSummaryQuerySchema,
  transactionListQuerySchema,
} from '@dis/contracts';
import { db } from '../../platform/db.js';
import { AppError, ErrorCode, notFound } from '../../platform/errors.js';
import { requireScope } from '../../platform/context.js';
import * as governance from '../governance/appointments.service.js';
import { fromMoney, sum, toMoney, variance, ZERO, type Money } from './money.js';

/**
 * Finance — budgets, transactions, and the variance between them (FR-5).
 *
 * Two things run through everything here.
 *
 * **Money never becomes a number.** `Decimal` end to end, a string on the wire. See
 * `money.ts`.
 *
 * **A budget or a transaction belongs to an OWNER, and the owner may be any org unit.** A
 * club, a cluster, a committee or the district itself all keep books, so `ownerScopeType`
 * is polymorphic and every write checks the owner against the caller's scopes through
 * `requireScope` — which answers with a 404 rather than a 403, so a club treasurer probing
 * for another club's budget learns nothing.
 */

type BudgetListQuery = z.infer<typeof budgetListQuerySchema>;
type TransactionListQuery = z.infer<typeof transactionListQuerySchema>;
type CategoryListQuery = z.infer<typeof financeCategoryListQuerySchema>;
type SummaryQuery = z.infer<typeof financeSummaryQuerySchema>;

// ─── Categories ──────────────────────────────────────────────────────────────

const CATEGORY_SELECT = {
  id: true,
  districtId: true,
  code: true,
  name: true,
  direction: true,
  isActive: true,
} as const;

function serialiseCategory(row: {
  id: string;
  districtId: string | null;
  code: string;
  name: string;
  direction: 'INCOME' | 'EXPENDITURE';
  isActive: boolean;
}): FinanceCategory {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    direction: row.direction,
    isActive: row.isActive,
    // A shared template, readable by every district and editable by none. The flag is
    // derived rather than stored: `district_id IS NULL` IS the fact.
    isTemplate: row.districtId === null,
  };
}

/**
 * The district's own categories AND the shared templates.
 *
 * `sharedWhenNull` in the scope registry does this for reads. Categories are data for the
 * same reason activity types are: a treasurer who wants "Fundraising — car wash" adds a
 * row, not a release.
 */
export async function listCategories(
  ctx: RequestContext,
  query: CategoryListQuery,
): Promise<FinanceCategory[]> {
  const rows = await db(ctx).financeCategory.findMany({
    where: {
      ...(query.direction ? { direction: query.direction } : {}),
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
    },
    select: CATEGORY_SELECT,
    orderBy: [{ direction: 'asc' }, { name: 'asc' }],
  });
  return rows.map(serialiseCategory);
}

export async function createCategory(
  ctx: RequestContext,
  input: CreateFinanceCategory,
): Promise<FinanceCategory> {
  const clash = await db(ctx).financeCategory.findFirst({
    where: { code: input.code },
    select: { id: true, districtId: true },
  });
  // A template's code is not the district's to reuse: two rows reading FUNDRAISING in one
  // picker is a treasurer choosing at random.
  if (clash) {
    throw new AppError(
      409,
      ErrorCode.DUPLICATE_CODE,
      clash.districtId === null
        ? `${input.code} is a shared category that every district already has.`
        : `${input.code} is already a category in this district.`,
      { code: input.code },
    );
  }

  // A scoped `create` returns the row's SCALARS and takes no `select` — the layer stamps
  // the district and the year, and a caller-supplied select could omit them. That is fine
  // here: a category is scalars all the way down.
  const created = await db(ctx).financeCategory.create({
    data: { code: input.code, name: input.name, direction: input.direction },
  });
  return serialiseCategory(created);
}

/** The category, with its direction — which is what a line or a transaction must agree with. */
async function requireCategory(
  ctx: RequestContext,
  categoryId: string,
): Promise<{ id: string; code: string; name: string; direction: 'INCOME' | 'EXPENDITURE' }> {
  const category = await db(ctx).financeCategory.findFirst({
    where: { id: categoryId, isActive: true },
    select: { id: true, code: true, name: true, direction: true },
  });
  if (!category) throw notFound();
  return category;
}

// ─── Owner scope ─────────────────────────────────────────────────────────────

/**
 * May the caller act on this owner's books, and what is the owner called?
 *
 * The scope check is `requireScope`, so it covers all four unit types and answers 404 for
 * anything outside them. The NAME is fetched at the same time because a list of budgets
 * showing bare UUIDs is a list nobody can read, and resolving it per row on the client
 * would be one request per row.
 */
async function requireOwner(
  ctx: RequestContext,
  ownerScopeType: OrgScopeValue,
  ownerScopeId: string,
): Promise<string | null> {
  requireScope(ctx, { scopeType: ownerScopeType, scopeId: ownerScopeId });
  const names = await governance.scopeNames(ctx, [
    { scopeType: ownerScopeType, scopeId: ownerScopeId },
  ]);
  return names.get(ownerScopeId) ?? null;
}

/**
 * A `where` fragment narrowing a LIST to owners the caller may see.
 *
 * A list must not 404 because one row in it is out of scope — the rows are filtered. A
 * district-wide caller gets no filter at all.
 */
function ownerScopeWhere(ctx: RequestContext): Record<string, unknown> {
  if (ctx.scopes.isDistrictWide) return {};

  const { clubIds, clusterIds, regionIds, committeeIds } = ctx.scopes;
  return {
    OR: [
      { ownerScopeType: 'CLUB' as const, ownerScopeId: { in: [...clubIds] } },
      { ownerScopeType: 'CLUSTER' as const, ownerScopeId: { in: [...clusterIds] } },
      { ownerScopeType: 'REGION' as const, ownerScopeId: { in: [...regionIds] } },
      { ownerScopeType: 'COMMITTEE' as const, ownerScopeId: { in: [...committeeIds] } },
    ],
  };
}

// ─── Budgets ─────────────────────────────────────────────────────────────────

const LINE_SELECT = {
  id: true,
  categoryId: true,
  description: true,
  amountPlanned: true,
  category: { select: { code: true, name: true, direction: true } },
} as const;

const BUDGET_SELECT = {
  id: true,
  ownerScopeType: true,
  ownerScopeId: true,
  currencyCode: true,
  approvedAt: true,
  // No `orderBy` here: Prisma's `Exact<>` rejects the readonly array that `as const`
  // produces on a nested select. Lines are sorted in `serialiseBudget`, which is cheap —
  // a budget has tens of lines, not thousands.
  lines: { select: LINE_SELECT },
} as const;

interface BudgetRow {
  id: string;
  ownerScopeType: OrgScopeValue;
  ownerScopeId: string;
  currencyCode: string;
  approvedAt: Date | null;
  lines: {
    id: string;
    categoryId: string;
    description: string;
    amountPlanned: Money;
    category: { code: string; name: string; direction: 'INCOME' | 'EXPENDITURE' };
  }[];
}

function serialiseLine(row: BudgetRow['lines'][number]): BudgetLine {
  return {
    id: row.id,
    categoryId: row.categoryId,
    categoryName: row.category.name,
    categoryCode: row.category.code,
    direction: row.category.direction,
    description: row.description,
    amountPlanned: fromMoney(row.amountPlanned),
  };
}

function serialiseBudget(row: BudgetRow, ownerName: string | null, withLines: boolean): Budget {
  const lines = [...row.lines].sort((a, b) => a.description.localeCompare(b.description));
  const income = lines.filter((line) => line.category.direction === 'INCOME');
  const expenditure = lines.filter((line) => line.category.direction === 'EXPENDITURE');

  return {
    id: row.id,
    ownerScopeType: row.ownerScopeType,
    ownerScopeId: row.ownerScopeId,
    ownerName,
    currencyCode: row.currencyCode,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    isApproved: row.approvedAt !== null,
    totalPlannedIncome: fromMoney(sum(income.map((line) => line.amountPlanned))),
    totalPlannedExpenditure: fromMoney(sum(expenditure.map((line) => line.amountPlanned))),
    lineCount: lines.length,
    ...(withLines ? { lines: lines.map(serialiseLine) } : {}),
  };
}

export async function listBudgets(
  ctx: RequestContext,
  query: BudgetListQuery,
): Promise<{ data: Budget[]; total: number }> {
  const where = {
    ...ownerScopeWhere(ctx),
    ...(query.ownerScopeType ? { ownerScopeType: query.ownerScopeType } : {}),
    ...(query.ownerScopeId ? { ownerScopeId: query.ownerScopeId } : {}),
    ...(query.isApproved === undefined
      ? {}
      : { approvedAt: query.isApproved ? { not: null } : null }),
  };

  const [rows, total] = await Promise.all([
    db(ctx).budget.findMany({
      where,
      select: BUDGET_SELECT,
      orderBy: [{ ownerScopeType: 'asc' }, { ownerScopeId: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    db(ctx).budget.count({ where }),
  ]);

  // Names resolved in one pass rather than per row: 68 budgets would otherwise be 68 club
  // lookups for a screen the district treasurer opens every week.
  const names = await ownerNames(ctx, rows);
  return {
    data: rows.map((row) => serialiseBudget(row, names.get(row.ownerScopeId) ?? null, false)),
    total,
  };
}

export async function getBudget(ctx: RequestContext, id: string): Promise<Budget> {
  const row = await db(ctx).budget.findFirst({ where: { id }, select: BUDGET_SELECT });
  if (!row) throw notFound();

  const ownerName = await requireOwner(ctx, row.ownerScopeType, row.ownerScopeId);
  return serialiseBudget(row, ownerName, true);
}

export async function createBudget(ctx: RequestContext, input: CreateBudget): Promise<Budget> {
  const ownerName = await requireOwner(ctx, input.ownerScopeType, input.ownerScopeId);

  // One budget per owner per year, so a retry of a create that already succeeded must be
  // told which one it is rather than producing a second set of figures.
  const existing = await db(ctx).budget.findFirst({
    where: { ownerScopeType: input.ownerScopeType, ownerScopeId: input.ownerScopeId },
    select: { id: true },
  });
  if (existing) {
    throw new AppError(
      409,
      ErrorCode.BUDGET_EXISTS,
      'This owner already has a budget for the current Rotary Year.',
      { budgetId: existing.id },
    );
  }

  const created = await db(ctx).budget.create({
    data: {
      ...(input.id ? { id: input.id } : {}),
      ownerScopeType: input.ownerScopeType,
      ownerScopeId: input.ownerScopeId,
      currencyCode: input.currencyCode,
    },
  });

  // A scoped create returns scalars and takes no `select`, so the relations come from a
  // read. A new budget has no lines, so this is the empty shape rather than a second query.
  return serialiseBudget(
    { ...created, ownerScopeType: created.ownerScopeType, lines: [] },
    ownerName,
    true,
  );
}

export async function updateBudget(
  ctx: RequestContext,
  id: string,
  input: UpdateBudget,
): Promise<Budget> {
  await getBudget(ctx, id);
  await db(ctx).budget.updateMany({ where: { id }, data: input });
  return getBudget(ctx, id);
}

/**
 * Approving, and un-approving.
 *
 * Approval freezes the lines — enforced by a database guard (DIS03), not by this function,
 * so it holds for the seed, for a job, and for anybody with a psql session during an
 * incident. Un-approval is deliberately available: a treasurer who approved the wrong
 * budget needs a way back that leaves an audit row rather than one that requires a database
 * password.
 *
 * Who may approve is the interesting question. There is no `budget:approve` permission and
 * there should not be one — the rule is that approval needs `finance:write:club` AND a
 * DISTRICT-WIDE appointment, so a club treasurer holding `finance:write:club` scoped to
 * their own club cannot approve their own budget. That is the actual governance rule
 * expressed in the permissions that exist.
 */
export async function setBudgetApproval(
  ctx: RequestContext,
  id: string,
  isApproved: boolean,
): Promise<Budget> {
  await getBudget(ctx, id);

  if (!ctx.scopes.isDistrictWide) {
    throw new AppError(
      403,
      ErrorCode.INSUFFICIENT_SCOPE,
      'A budget is approved at district level. A club cannot approve its own.',
    );
  }

  await db(ctx).budget.updateMany({
    where: { id },
    data: isApproved
      ? { approvedAt: new Date(), approvedByUserId: ctx.userId }
      : { approvedAt: null, approvedByUserId: null },
  });
  return getBudget(ctx, id);
}

// ─── Budget lines ────────────────────────────────────────────────────────────

/**
 * Lines are reached THROUGH the budget, never directly.
 *
 * `BudgetLine` has no `district_id` — it inherits scope from its budget through `via` in
 * the scope registry, and the layer checks the parent on write. This function performs the
 * read-side equivalent: loading the budget first means an out-of-scope budget id 404s
 * before a line is ever touched.
 */
async function requireBudgetForWrite(
  ctx: RequestContext,
  budgetId: string,
): Promise<{ id: string; approvedAt: Date | null }> {
  const budget = await db(ctx).budget.findFirst({
    where: { id: budgetId },
    select: { id: true, ownerScopeType: true, ownerScopeId: true, approvedAt: true },
  });
  if (!budget) throw notFound();
  requireScope(ctx, { scopeType: budget.ownerScopeType, scopeId: budget.ownerScopeId });
  return { id: budget.id, approvedAt: budget.approvedAt };
}

export async function listBudgetLines(
  ctx: RequestContext,
  budgetId: string,
): Promise<BudgetLine[]> {
  await requireBudgetForWrite(ctx, budgetId);
  const rows = await db(ctx).budgetLine.findMany({
    where: { budgetId },
    select: LINE_SELECT,
    orderBy: [{ description: 'asc' }],
  });
  return rows.map((row) => serialiseLine(row));
}

export async function createBudgetLine(
  ctx: RequestContext,
  budgetId: string,
  input: CreateBudgetLine,
): Promise<BudgetLine> {
  await requireBudgetForWrite(ctx, budgetId);
  const category = await requireCategory(ctx, input.categoryId);

  // An approved budget is refused by the DIS03 guard rather than by a check here, so the
  // rule holds for the seed and for a job as surely as it does for this handler.
  const created = await db(ctx).budgetLine.create({
    data: {
      ...(input.id ? { id: input.id } : {}),
      budgetId,
      categoryId: input.categoryId,
      description: input.description,
      amountPlanned: toMoney(input.amountPlanned),
    },
  });

  return serialiseLine({ ...created, category });
}

export async function updateBudgetLine(
  ctx: RequestContext,
  budgetId: string,
  lineId: string,
  input: UpdateBudgetLine,
): Promise<BudgetLine> {
  await requireBudgetForWrite(ctx, budgetId);
  if (input.categoryId) await requireCategory(ctx, input.categoryId);

  const updated = await db(ctx).budgetLine.updateMany({
    where: { id: lineId, budgetId },
    data: {
      ...(input.categoryId ? { categoryId: input.categoryId } : {}),
      ...(input.description ? { description: input.description } : {}),
      ...(input.amountPlanned ? { amountPlanned: toMoney(input.amountPlanned) } : {}),
    },
  });
  if (updated.count === 0) throw notFound();

  const row = await db(ctx).budgetLine.findFirst({ where: { id: lineId }, select: LINE_SELECT });
  if (!row) throw notFound();
  return serialiseLine(row);
}

export async function deleteBudgetLine(
  ctx: RequestContext,
  budgetId: string,
  lineId: string,
): Promise<void> {
  await requireBudgetForWrite(ctx, budgetId);
  // A hard delete: a budget line is a plan, not a fact, and an approved budget's lines are
  // frozen by the guard — so the only lines that can reach here are drafts nobody has
  // agreed to.
  const deleted = await db(ctx).budgetLine.deleteMany({ where: { id: lineId, budgetId } });
  if (deleted.count === 0) throw notFound();
}

// ─── Transactions ────────────────────────────────────────────────────────────

const TXN_SELECT = {
  id: true,
  ownerScopeType: true,
  ownerScopeId: true,
  categoryId: true,
  budgetLineId: true,
  direction: true,
  amount: true,
  currencyCode: true,
  occurredOn: true,
  description: true,
  evidenceUrl: true,
  activityId: true,
  createdAt: true,
  category: { select: { code: true, name: true } },
} as const;

interface TxnRow {
  id: string;
  ownerScopeType: OrgScopeValue;
  ownerScopeId: string;
  categoryId: string;
  budgetLineId: string | null;
  direction: 'INCOME' | 'EXPENDITURE';
  amount: Money;
  currencyCode: string;
  occurredOn: Date;
  description: string | null;
  evidenceUrl: string | null;
  activityId: string | null;
  createdAt: Date;
  category: { code: string; name: string };
}

function serialiseTransaction(row: TxnRow, ownerName: string | null): Transaction {
  return {
    id: row.id,
    ownerScopeType: row.ownerScopeType,
    ownerScopeId: row.ownerScopeId,
    ownerName,
    categoryId: row.categoryId,
    categoryName: row.category.name,
    categoryCode: row.category.code,
    budgetLineId: row.budgetLineId,
    direction: row.direction,
    amount: fromMoney(row.amount),
    currencyCode: row.currencyCode,
    occurredOn: row.occurredOn.toISOString().slice(0, 10),
    description: row.description,
    evidenceUrl: row.evidenceUrl,
    activityId: row.activityId,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listTransactions(
  ctx: RequestContext,
  query: TransactionListQuery,
): Promise<{ data: Transaction[]; total: number }> {
  const where = {
    ...ownerScopeWhere(ctx),
    ...(query.ownerScopeType ? { ownerScopeType: query.ownerScopeType } : {}),
    ...(query.ownerScopeId ? { ownerScopeId: query.ownerScopeId } : {}),
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.direction ? { direction: query.direction } : {}),
    ...(query.from || query.to
      ? {
          occurredOn: {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to ? { lte: new Date(query.to) } : {}),
          },
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    db(ctx).financialTransaction.findMany({
      where,
      select: TXN_SELECT,
      orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    db(ctx).financialTransaction.count({ where }),
  ]);

  const names = await ownerNames(ctx, rows);
  return {
    data: rows.map((row) => serialiseTransaction(row, names.get(row.ownerScopeId) ?? null)),
    total,
  };
}

export async function createTransaction(
  ctx: RequestContext,
  input: CreateTransaction,
): Promise<Transaction> {
  const ownerName = await requireOwner(ctx, input.ownerScopeType, input.ownerScopeId);
  const category = await requireCategory(ctx, input.categoryId);

  /**
   * The CATEGORY carries the direction, not the request.
   *
   * A caller who could send `INCOME` against an expenditure category would produce books
   * that do not add up, and the error would surface months later as a variance nobody can
   * explain. There is exactly one source of truth for which way the money went.
   */
  const direction = category.direction;

  if (input.budgetLineId) {
    // A line from another owner's budget would silently credit their variance.
    const line = await db(ctx).budgetLine.findFirst({
      where: { id: input.budgetLineId },
      select: {
        id: true,
        categoryId: true,
        budget: { select: { ownerScopeType: true, ownerScopeId: true } },
      },
    });
    if (!line) throw notFound();
    requireScope(ctx, {
      scopeType: line.budget.ownerScopeType,
      scopeId: line.budget.ownerScopeId,
    });
    if (line.categoryId !== input.categoryId) {
      throw new AppError(
        422,
        ErrorCode.CATEGORY_DIRECTION_MISMATCH,
        'That budget line is for a different category.',
        { key: 'budgetLineId' },
      );
    }
  }

  const created = await db(ctx).financialTransaction.create({
    data: {
      ...(input.id ? { id: input.id } : {}),
      ownerScopeType: input.ownerScopeType,
      ownerScopeId: input.ownerScopeId,
      categoryId: input.categoryId,
      budgetLineId: input.budgetLineId ?? null,
      direction,
      amount: toMoney(input.amount),
      currencyCode: input.currencyCode,
      occurredOn: new Date(input.occurredOn),
      description: input.description ?? null,
      evidenceUrl: input.evidenceUrl ?? null,
      activityId: input.activityId ?? null,
      recordedByUserId: ctx.userId,
    },
  });
  return serialiseTransaction({ ...created, category }, ownerName);
}

// ─── Summary ─────────────────────────────────────────────────────────────────

/**
 * Income, expenditure, net, and per-category variance against the budget.
 *
 * Aggregated in the DATABASE, not in Node: a club with three years of transactions would
 * otherwise stream every row across the wire so JavaScript could add them up, and the
 * addition is the one part Postgres does better — it is the side that holds NUMERIC.
 *
 * A missing budget is not an error. Most clubs will record transactions before anybody
 * writes a budget, and refusing the summary until one exists would hide the figures that
 * are actually there.
 */
export async function summary(ctx: RequestContext, query: SummaryQuery): Promise<FinanceSummary> {
  await requireOwner(ctx, query.ownerScopeType, query.ownerScopeId);

  const owner = { ownerScopeType: query.ownerScopeType, ownerScopeId: query.ownerScopeId };

  const [budget, actuals, categories] = await Promise.all([
    db(ctx).budget.findFirst({
      where: owner,
      select: { id: true, currencyCode: true, lines: { select: LINE_SELECT } },
    }),
    db(ctx).financialTransaction.groupBy({
      by: ['categoryId'],
      where: owner,
      _sum: { amount: true },
    }),
    db(ctx).financeCategory.findMany({ select: CATEGORY_SELECT }),
  ]);

  const categoryById = new Map(categories.map((row) => [row.id, row]));
  const actualByCategory = new Map<string, Money>(
    actuals.map((row) => [row.categoryId, row._sum.amount ?? ZERO]),
  );

  const plannedByCategory = new Map<string, Money>();
  for (const line of budget?.lines ?? []) {
    const running = plannedByCategory.get(line.categoryId) ?? ZERO;
    plannedByCategory.set(line.categoryId, running.add(line.amountPlanned));
  }

  // Every category that appears in EITHER the budget or the actuals. A category that was
  // budgeted and never spent is exactly as interesting as one that was spent and never
  // budgeted — the second is the one a treasurer needs to see.
  const involved = new Set([...plannedByCategory.keys(), ...actualByCategory.keys()]);

  const rows: CategoryVariance[] = [];
  let income = ZERO;
  let expenditure = ZERO;

  for (const categoryId of involved) {
    const category = categoryById.get(categoryId);
    if (!category) continue;

    const planned = plannedByCategory.get(categoryId) ?? ZERO;
    const actual = actualByCategory.get(categoryId) ?? ZERO;

    if (category.direction === 'INCOME') income = income.add(actual);
    else expenditure = expenditure.add(actual);

    rows.push({
      categoryId,
      categoryCode: category.code,
      categoryName: category.name,
      direction: category.direction,
      planned: fromMoney(planned),
      actual: fromMoney(actual),
      variance: fromMoney(variance(category.direction, planned, actual)),
    });
  }

  rows.sort((a, b) =>
    a.direction === b.direction
      ? a.categoryName.localeCompare(b.categoryName)
      : a.direction === 'INCOME'
        ? -1
        : 1,
  );

  const plannedIncome = sumPlanned(budget?.lines ?? [], categoryById, 'INCOME');
  const plannedExpenditure = sumPlanned(budget?.lines ?? [], categoryById, 'EXPENDITURE');

  return {
    ownerScopeType: query.ownerScopeType,
    ownerScopeId: query.ownerScopeId,
    currencyCode: budget?.currencyCode ?? 'UGX',
    income: fromMoney(income),
    expenditure: fromMoney(expenditure),
    net: fromMoney(income.sub(expenditure)),
    plannedIncome: fromMoney(plannedIncome),
    plannedExpenditure: fromMoney(plannedExpenditure),
    budgetId: budget?.id ?? null,
    categories: rows,
  };
}

function sumPlanned(
  lines: { categoryId: string; amountPlanned: Money }[],
  categories: Map<string, { direction: 'INCOME' | 'EXPENDITURE' }>,
  direction: 'INCOME' | 'EXPENDITURE',
): Money {
  return sum(
    lines
      .filter((line) => categories.get(line.categoryId)?.direction === direction)
      .map((line) => line.amountPlanned),
  );
}

// ─── Owner names ─────────────────────────────────────────────────────────────

/**
 * Names for a page of owners, in one round trip per KIND rather than one per row.
 *
 * Through `governance.scopeNames`, never by querying clubs and clusters here: the
 * polymorphic scope id is governance's problem, and a second implementation would be a
 * second answer to "what is this club called" the first time one is renamed.
 */
async function ownerNames(
  ctx: RequestContext,
  rows: readonly { ownerScopeType: OrgScopeValue; ownerScopeId: string }[],
): Promise<Map<string, string>> {
  return governance.scopeNames(
    ctx,
    rows.map((row) => ({ scopeType: row.ownerScopeType, scopeId: row.ownerScopeId })),
  );
}
