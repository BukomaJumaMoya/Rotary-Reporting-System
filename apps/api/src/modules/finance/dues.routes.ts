import {
  bulkIssueDuesSchema,
  createDuesInvoiceSchema,
  createMemberDuesSchema,
  duesInvoiceListQuerySchema,
  duesStatusQuerySchema,
  memberDuesListQuerySchema,
  recordDuesPaymentSchema,
  waiveDuesInvoiceSchema,
} from '@dis/contracts';
import { Router } from 'express';
import { requireContext, requirePermission } from '../../platform/context.js';
import { asyncHandler, parseQuery, pathParam, withBody } from '../../platform/validate.js';
import * as dues from './dues.service.js';

/**
 * Dues (docs/05-API-Spec.md §7).
 *
 * Two permissions, and the split is the point. `finance:read:club` lets a club see its own
 * invoice and what it still owes — the club officers are the people who have to act on it,
 * and secretaries hold it as well as treasurers. `dues:manage:district` raises invoices,
 * waives them and confirms payments, and only the DRR and the District Treasurer hold it: a
 * club confirming its own payment is a club marking its own homework.
 *
 * MEMBER dues are the exception, and deliberately: a club treasurer collects cash from
 * members, so those two writes are `finance:write:club`. The money has not reached the
 * district at that point — remitting it is a separate transaction against a `DUES_DISTRICT`
 * category.
 */
export const duesRouter: Router = Router();

// ─── Invoices ────────────────────────────────────────────────────────────────

duesRouter.get(
  '/dues/invoices',
  requirePermission('finance:read:club'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    const query = parseQuery(duesInvoiceListQuerySchema, req);
    const { data, total } = await dues.listInvoices(ctx, query);
    res.status(200).json({ data, meta: { page: query.page, pageSize: query.pageSize, total } });
  }),
);

/**
 * The district-wide grid. Declared BEFORE `/dues/invoices/:id` is irrelevant — different
 * prefix — but it is the screen this whole module exists to produce, so it reads first.
 */
duesRouter.get(
  '/dues/status',
  requirePermission('finance:read:club'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    const query = parseQuery(duesStatusQuerySchema, req);
    res.status(200).json({ data: await dues.status(ctx, query) });
  }),
);

duesRouter.get(
  '/dues/invoices/:id',
  requirePermission('finance:read:club'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    res.status(200).json({ data: await dues.getInvoice(ctx, pathParam(req, 'id')) });
  }),
);

/**
 * The whole district in one call — the District Treasurer's first act of the year.
 *
 * Declared before `/dues/invoices/:id`'s siblings for readability only; `bulk` is a POST to
 * a static path and there is no `POST /dues/invoices/:id` for it to collide with.
 * Idempotent, so running it again after a club is chartered invoices the new one and leaves
 * every other club exactly as it is, including the ones that have already paid.
 */
duesRouter.post(
  '/dues/invoices/bulk',
  requirePermission('dues:manage:district'),
  ...withBody(bulkIssueDuesSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    res.status(201).json({ data: await dues.bulkIssue(ctx, body) });
  }),
);

duesRouter.post(
  '/dues/invoices',
  requirePermission('dues:manage:district'),
  ...withBody(createDuesInvoiceSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    res.status(201).json({ data: await dues.createInvoice(ctx, body) });
  }),
);

duesRouter.post(
  '/dues/invoices/:id/waive',
  requirePermission('dues:manage:district'),
  ...withBody(waiveDuesInvoiceSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    res.status(200).json({ data: await dues.waiveInvoice(ctx, pathParam(req, 'id'), body) });
  }),
);

// ─── Payments ────────────────────────────────────────────────────────────────

/**
 * Recording is `dues:manage:district`, and so is confirming.
 *
 * A club telling the district it has paid is a message, not a ledger entry, and the ledger
 * is what a scorecard reads. If clubs are ever to submit their own claims that becomes a
 * separate endpoint with `finance:write:club` and `confirm` forced false — deliberately not
 * built until somebody asks for it.
 */
duesRouter.post(
  '/dues/invoices/:id/payments',
  requirePermission('dues:manage:district'),
  ...withBody(recordDuesPaymentSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    res.status(201).json({ data: await dues.recordPayment(ctx, pathParam(req, 'id'), body) });
  }),
);

duesRouter.post(
  '/dues/invoices/:id/payments/:paymentId/confirm',
  requirePermission('dues:manage:district'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    const invoice = await dues.confirmPayment(
      ctx,
      pathParam(req, 'id'),
      pathParam(req, 'paymentId'),
    );
    res.status(200).json({ data: invoice });
  }),
);

// ─── Member dues ─────────────────────────────────────────────────────────────

duesRouter.get(
  '/member-dues',
  requirePermission('finance:read:club'),
  asyncHandler(async (req, res) => {
    const ctx = requireContext(req);
    const query = parseQuery(memberDuesListQuerySchema, req);
    const { data, total } = await dues.listMemberDues(ctx, query);
    res.status(200).json({ data, meta: { page: query.page, pageSize: query.pageSize, total } });
  }),
);

duesRouter.post(
  '/member-dues',
  requirePermission('finance:write:club'),
  ...withBody(createMemberDuesSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    res.status(201).json({ data: await dues.createMemberDues(ctx, body) });
  }),
);

duesRouter.post(
  '/member-dues/:id/payments',
  requirePermission('finance:write:club'),
  ...withBody(recordDuesPaymentSchema, async ({ body, req, res }) => {
    const ctx = requireContext(req);
    const row = await dues.recordMemberPayment(ctx, pathParam(req, 'id'), body);
    res.status(201).json({ data: row });
  }),
);
