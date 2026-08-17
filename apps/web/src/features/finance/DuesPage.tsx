import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Select,
  SkeletonList,
  Table,
} from '../../components/ui';
import { api } from '../../lib/api';
import { formatAmount, formatMoney } from '../../lib/money';
import { queryKeys, useApiMutation, useList } from '../../lib/queries';
import { useAuth } from '../auth/useAuth';
import type { DuesInvoiceListResponse, DuesInvoice, DuesStatusResponse } from './types';
import type { DuesStatusRow, InvoiceStatus } from '@dis/contracts';

/**
 * Dues — one screen, two audiences.
 *
 * A club officer sees their own invoice, what is still owed, and every receipt. The District
 * Treasurer sees the GRID: every club, paid or not, with the ones nobody has invoiced at the
 * top of their attention rather than missing from the page. `dues:manage:district` is what
 * separates them, and the grid is the reason this module exists.
 *
 * Nothing here computes a status. Every one arrives from the view, which counts CONFIRMED
 * payments only — a claim is not a payment, and dues standing is scored.
 */

const STATUS_TONES: Record<InvoiceStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  PAID: 'success',
  PARTIAL: 'warning',
  UNPAID: 'danger',
  WAIVED: 'neutral',
};

export function DuesPage() {
  const { permissions } = useAuth();
  const isTreasurer = permissions.has('dues:manage:district');

  return isTreasurer ? <DistrictGrid /> : <ClubDues />;
}

// ─── The District Treasurer's grid ───────────────────────────────────────────

function DistrictGrid() {
  const [isIssuing, setIsIssuing] = useState(false);
  const [paying, setPaying] = useState<DuesStatusRow | null>(null);

  const grid = useList<DuesStatusResponse>(queryKeys.dues, '/dues/status');

  if (grid.isPending) return <SkeletonList rows={6} />;
  if (grid.isError) return <ErrorState error={grid.error} onRetry={() => void grid.refetch()} />;

  const data = grid.data.data;

  return (
    <>
      <PageHeader
        title="District dues"
        description="Every club in the district, whether or not it has been invoiced."
        action={<Button onClick={() => setIsIssuing(true)}>Issue to every club</Button>}
      />

      <Card className="mb-4">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Figure label="Invoiced" value={formatMoney(data.totalDue)} />
          <Figure label="Collected" value={formatMoney(data.totalPaid)} />
          <Figure label="Outstanding" value={formatMoney(data.totalOutstanding)} />
          {/*
            The number that actually needs acting on. A club nobody invoiced does not
            appear in an invoice list at all, which is how it stays uninvoiced until March.
          */}
          <Figure
            label="Not yet invoiced"
            value={String(data.clubsWithNoInvoice)}
            tone={data.clubsWithNoInvoice > 0 ? 'danger' : 'neutral'}
          />
        </dl>
      </Card>

      <Card>
        <Table
          columns={[
            {
              key: 'club',
              header: 'Club',
              render: (row: DuesStatusRow) => (
                <span className="text-text-primary font-medium">{row.clubName}</span>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (row: DuesStatusRow) =>
                row.status === null ? (
                  // NULL is not UNPAID. "Nobody invoiced this club" and "this club has not
                  // paid" are different problems with different people to chase.
                  <Badge tone="danger">Not invoiced</Badge>
                ) : (
                  <Badge tone={STATUS_TONES[row.status]}>
                    {row.status === 'PAID' ? 'Paid' : row.status.toLowerCase()}
                  </Badge>
                ),
            },
            {
              key: 'due',
              header: 'Invoiced',
              secondary: true,
              render: (row: DuesStatusRow) => formatAmount(row.amountDue),
            },
            {
              key: 'paid',
              header: 'Paid',
              secondary: true,
              render: (row: DuesStatusRow) => formatAmount(row.amountPaid),
            },
            {
              key: 'outstanding',
              header: 'Outstanding',
              render: (row: DuesStatusRow) => (
                <span className={row.isOverdue ? 'text-danger-text font-medium' : ''}>
                  {formatAmount(row.amountOutstanding)}
                  {row.isOverdue && <span className="ml-1 text-meta">overdue</span>}
                </span>
              ),
            },
            {
              key: 'action',
              header: '',
              render: (row: DuesStatusRow) =>
                row.invoiceId ? (
                  <Button variant="ghost" onClick={() => setPaying(row)}>
                    Record payment
                  </Button>
                ) : null,
            },
          ]}
          rows={data.rows}
          rowKey={(row) => row.clubId}
        />
      </Card>

      {isIssuing && <BulkIssue onClose={() => setIsIssuing(false)} />}
      {paying?.invoiceId && (
        <RecordPayment
          invoiceId={paying.invoiceId}
          clubName={paying.clubName}
          outstanding={paying.amountOutstanding}
          onClose={() => setPaying(null)}
        />
      )}
    </>
  );
}

/**
 * Issuing to the whole district in one go.
 *
 * Idempotent on the server, which is what makes it safe to press twice — a club chartered
 * since the last run gets an invoice and everybody else is left exactly as they are,
 * including the ones who have already paid.
 */
function BulkIssue({ onClose }: { onClose: () => void }) {
  const [amountDue, setAmountDue] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [duesType, setDuesType] = useState('DISTRICT');

  const issue = useApiMutation(
    async (body: Record<string, unknown>) =>
      api.post<{ data: { issued: number; skipped: number } }>('/dues/invoices/bulk', body),
    { invalidate: [queryKeys.dues] },
  );

  return (
    <Dialog isOpen title="Issue dues to every club" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Select
          label="Type"
          value={duesType}
          options={[
            { value: 'DISTRICT', label: 'District dues' },
            { value: 'RI', label: 'RI dues' },
          ]}
          onChange={(event) => setDuesType(event.target.value)}
        />
        <Input
          label="Amount per club"
          inputMode="decimal"
          value={amountDue}
          hint={amountDue ? formatAmount(amountDue) : 'The same figure for every club.'}
          onChange={(event) => setAmountDue(event.target.value)}
        />
        <Input
          label="Due on"
          type="date"
          value={dueOn}
          onChange={(event) => setDueOn(event.target.value)}
        />

        <p className="text-text-muted text-meta">
          Clubs that already have an invoice of this type are left untouched — including their
          amount. Safe to run again after a new club is chartered.
        </p>

        <div className="mt-2 flex gap-3">
          <Button
            isLoading={issue.isPending}
            disabled={amountDue.trim() === '' || dueOn === ''}
            onClick={() => {
              issue.mutate(
                { duesType, amountDue: amountDue.trim(), dueOn },
                {
                  onSuccess: (result) => {
                    const { issued, skipped } = result.data;
                    // The real numbers, not "done". A treasurer who ran this twice needs to
                    // see that the second run issued nothing.
                    window.alert(
                      `${issued} invoice(s) issued. ${skipped} club(s) already had one.`,
                    );
                    onClose();
                  },
                },
              );
            }}
          >
            Issue
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function RecordPayment({
  invoiceId,
  clubName,
  outstanding,
  onClose,
}: {
  invoiceId: string;
  clubName: string;
  outstanding: string;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState('');
  const [reference, setReference] = useState('');
  const [confirm, setConfirm] = useState(true);

  const pay = useApiMutation(
    async (body: Record<string, unknown>) => api.post(`/dues/invoices/${invoiceId}/payments`, body),
    { invalidate: [queryKeys.dues], successMessage: 'Payment recorded' },
  );

  return (
    <Dialog isOpen title={`Payment from ${clubName}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-text-muted text-table">
          {formatMoney(outstanding)} still outstanding. An overpayment is accepted and flagged, not
          refused.
        </p>

        <Input
          label="Amount"
          inputMode="decimal"
          value={amount}
          hint={amount ? formatAmount(amount) : undefined}
          onChange={(event) => setAmount(event.target.value)}
        />
        <Input
          label="Paid on"
          type="date"
          value={paidOn}
          onChange={(event) => setPaidOn(event.target.value)}
        />
        <Input
          label="Method"
          value={method}
          hint="Bank transfer, mobile money, cash."
          onChange={(event) => setMethod(event.target.value)}
        />
        <Input
          label="Reference"
          value={reference}
          hint="The bank or mobile-money reference, if there is one."
          onChange={(event) => setReference(event.target.value)}
        />

        <label className="flex min-h-11 items-center gap-3 text-table">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={confirm}
            onChange={(event) => setConfirm(event.target.checked)}
          />
          <span>
            Confirm it has arrived
            <span className="text-text-muted block text-meta">
              Confirming issues the receipt number and tells the club. Leave it unticked to record a
              claim you have not yet checked against the bank — it will not count until you confirm.
            </span>
          </span>
        </label>

        <div className="mt-2 flex gap-3">
          <Button
            isLoading={pay.isPending}
            disabled={amount.trim() === ''}
            onClick={() =>
              pay.mutate(
                {
                  amount: amount.trim(),
                  paidOn,
                  method: method.trim() || null,
                  reference: reference.trim() || null,
                  confirm,
                },
                { onSuccess: onClose },
              )
            }
          >
            Record
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// ─── What a club sees ────────────────────────────────────────────────────────

function ClubDues() {
  const invoices = useList<DuesInvoiceListResponse>(queryKeys.dues, '/dues/invoices');

  if (invoices.isPending) return <SkeletonList rows={4} />;
  if (invoices.isError) {
    return <ErrorState error={invoices.error} onRetry={() => void invoices.refetch()} />;
  }

  return (
    <>
      <PageHeader
        title="Dues"
        description="What the district has invoiced, what has been paid, and the receipts."
      />

      {invoices.data.data.length === 0 && (
        <EmptyState
          title="Nothing invoiced yet"
          description="The district has not raised dues for your club this Rotary Year."
        />
      )}

      {invoices.data.data.map((invoice) => (
        <InvoiceCard key={invoice.id} invoice={invoice} />
      ))}
    </>
  );
}

function InvoiceCard({ invoice }: { invoice: DuesInvoice }) {
  const detail = useList<{ data: DuesInvoice }>(
    [...queryKeys.dues, invoice.id],
    `/dues/invoices/${invoice.id}`,
  );
  const payments = detail.data?.data.payments ?? [];

  return (
    <Card
      className="mb-4"
      title={invoice.duesType === 'DISTRICT' ? 'District dues' : 'RI dues'}
      actions={
        <Badge tone={STATUS_TONES[invoice.status]}>
          {invoice.status === 'PAID' ? 'Paid' : invoice.status.toLowerCase()}
        </Badge>
      }
    >
      <dl className="mb-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Figure label="Invoiced" value={formatMoney(invoice.amountDue, invoice.currencyCode)} />
        <Figure label="Paid" value={formatMoney(invoice.amountPaid, invoice.currencyCode)} />
        <Figure
          label="Outstanding"
          value={formatMoney(invoice.amountOutstanding, invoice.currencyCode)}
          tone={invoice.amountOutstanding === '0.00' ? 'success' : 'danger'}
        />
      </dl>

      {invoice.isOverpaid && (
        <p className="text-warning-text mb-3 text-table">
          This invoice has been overpaid. The district has a record of it — ask the treasurer how it
          will be applied.
        </p>
      )}
      {invoice.waiverReason && (
        <p className="text-text-secondary mb-3 text-table">Waived: {invoice.waiverReason}</p>
      )}

      <p className="text-text-muted mb-2 text-meta">Due {invoice.dueOn}</p>

      {payments.length > 0 && (
        <Table
          columns={[
            { key: 'paidOn', header: 'Paid on', render: (row) => row.paidOn },
            { key: 'amount', header: 'Amount', render: (row) => formatAmount(row.amount) },
            {
              key: 'receipt',
              header: 'Receipt',
              render: (row) =>
                // The receipt number is the reference a club quotes back when the district
                // says the money never arrived. It exists only once confirmed.
                row.receiptNo ?? <span className="text-text-muted">awaiting confirmation</span>,
            },
          ]}
          rows={payments}
          rowKey={(row) => row.id}
        />
      )}
    </Card>
  );
}

function Figure({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'success' | 'danger' | 'neutral';
}) {
  return (
    <div>
      <dt className="text-text-muted text-meta">{label}</dt>
      <dd
        className={
          tone === 'success'
            ? 'text-success-text mt-0.5 font-semibold tabular-nums'
            : tone === 'danger'
              ? 'text-danger-text mt-0.5 font-semibold tabular-nums'
              : 'text-text-primary mt-0.5 font-semibold tabular-nums'
        }
      >
        {value}
      </dd>
    </div>
  );
}
