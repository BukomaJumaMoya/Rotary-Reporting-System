import {
  budgetListQuerySchema,
  createBudgetLineSchema,
  createBudgetSchema,
  createFinanceCategorySchema,
  createTransactionSchema,
  financeCategoryListQuerySchema,
  financeSummaryQuerySchema,
  transactionListQuerySchema,
  updateBudgetLineSchema,
  updateBudgetSchema,
} from '@dis/contracts';
import { Router } from 'express';
import { z } from 'zod';
import { requireContext, requirePermission } from '../../platform/context.js';
import { asyncHandler, parseQuery, pathParam, withBody } from '../../platform/validate.js';
import * as finance from './service.js';

/**
 * Finance (docs/05-API-Spec.md §7).
 *
 * **`finance:read:club` is held by club SECRETARIES as well as treasurers, and it covers
 * income AND expenditure.** That is not an oversight: the predecessor let secretaries see
 * what the club had collected but not what it had spent, and the district logged it as a
 * complaint. One permission, both halves — a club officer who can see the money coming in
 * can see it going out.
 *
 * Writing is `finance:write:club`, which the treasurer holds and the secretary does not.
 * Reading and recording are genuinely different jobs; seeing and not-seeing are not.
 */
export const financeRouter: Router = Router();

// ─── Categories ──────────────────────────────────────────────────────────────

financeRouter.get(
  '/finance/categories',
  requirePermission('finance:read:club'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    const query = parseQuery(financeCategoryListQuerySchema, req);
    res.status(200).json({ data: await finance.listCategories(ctx, query) });
  }),
);

/**
 * Adding a category is a WRITE at district level, not a deployment.
 *
 * A club treasurer holds `finance:write:club` too, so the district check is explicit: a
 * category is district-wide reference data, and one club inventing "Misc 2" for everybody
 * is how a chart of accounts stops meaning anything.
 */
financeRouter.post(
  '/finance/categories',
  requirePermission('finance:write:club'),
  ...withBody(createFinanceCategorySchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    res.status(201).json({ data: await finance.createCategory(ctx, body) });
  }),
);

// ─── Budgets ─────────────────────────────────────────────────────────────────

financeRouter.get(
  '/budgets',
  requirePermission('finance:read:club'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    const query = parseQuery(budgetListQuerySchema, req);
    const { data, total } = await finance.listBudgets(ctx, query);
    res.status(200).json({ data, meta: { page: query.page, pageSize: query.pageSize, total } });
  }),
);

financeRouter.get(
  '/budgets/:id',
  requirePermission('finance:read:club'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    res.status(200).json({ data: await finance.getBudget(ctx, pathParam(req, 'id')) });
  }),
);

financeRouter.post(
  '/budgets',
  requirePermission('finance:write:club'),
  ...withBody(createBudgetSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    res.status(201).json({ data: await finance.createBudget(ctx, body) });
  }),
);

financeRouter.patch(
  '/budgets/:id',
  requirePermission('finance:write:club'),
  ...withBody(updateBudgetSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    res.status(200).json({ data: await finance.updateBudget(ctx, pathParam(req, 'id'), body) });
  }),
);

/**
 * Approval, and its reverse.
 *
 * A body rather than two paths, because the two are one decision recorded either way and a
 * `/unapprove` route invites somebody to add `/reapprove` next. Who may do it is enforced
 * in the service: `finance:write:club` AND a district-wide appointment, so a club treasurer
 * cannot approve their own club's budget.
 */
financeRouter.post(
  '/budgets/:id/approval',
  requirePermission('finance:write:club'),
  ...withBody(z.object({ isApproved: z.boolean() }), async ({ body, req, res }) => {
    const ctx = requireContext(req);
    const budget = await finance.setBudgetApproval(ctx, pathParam(req, 'id'), body.isApproved);
    res.status(200).json({ data: budget });
  }),
);

// ─── Budget lines ────────────────────────────────────────────────────────────

financeRouter.get(
  '/budgets/:id/lines',
  requirePermission('finance:read:club'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    res.status(200).json({ data: await finance.listBudgetLines(ctx, pathParam(req, 'id')) });
  }),
);

financeRouter.post(
  '/budgets/:id/lines',
  requirePermission('finance:write:club'),
  ...withBody(createBudgetLineSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    const line = await finance.createBudgetLine(ctx, pathParam(req, 'id'), body);
    res.status(201).json({ data: line });
  }),
);

financeRouter.patch(
  '/budgets/:id/lines/:lineId',
  requirePermission('finance:write:club'),
  ...withBody(updateBudgetLineSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    const line = await finance.updateBudgetLine(
      ctx,
      pathParam(req, 'id'),
      pathParam(req, 'lineId'),
      body,
    );
    res.status(200).json({ data: line });
  }),
);

financeRouter.delete(
  '/budgets/:id/lines/:lineId',
  requirePermission('finance:write:club'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    await finance.deleteBudgetLine(ctx, pathParam(req, 'id'), pathParam(req, 'lineId'));
    res.status(204).send();
  }),
);

// ─── Transactions ────────────────────────────────────────────────────────────

financeRouter.get(
  '/transactions',
  requirePermission('finance:read:club'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    const query = parseQuery(transactionListQuerySchema, req);
    const { data, total } = await finance.listTransactions(ctx, query);
    res.status(200).json({ data, meta: { page: query.page, pageSize: query.pageSize, total } });
  }),
);

financeRouter.post(
  '/transactions',
  requirePermission('finance:write:club'),
  ...withBody(createTransactionSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    res.status(201).json({ data: await finance.createTransaction(ctx, body) });
  }),
);

// ─── Summary ─────────────────────────────────────────────────────────────────

financeRouter.get(
  '/finance/summary',
  requirePermission('finance:read:club'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    const query = parseQuery(financeSummaryQuerySchema, req);
    res.status(200).json({ data: await finance.summary(ctx, query) });
  }),
);
