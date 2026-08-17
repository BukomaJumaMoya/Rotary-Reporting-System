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
  Pagination,
  Select,
  SkeletonList,
  Table,
} from '../../components/ui';
import { FilterBar, FilterTabs } from '../../components/ui/page';
import { api } from '../../lib/api';
import { formatAmount, formatMoney } from '../../lib/money';
import { queryKeys, useApiMutation, useList } from '../../lib/queries';
import { useAuth, useOwnClub } from '../auth/useAuth';
import type { ClubListResponse } from '../clubs/types';
import type { FinanceCategoryListResponse, Transaction, TransactionListResponse } from './types';

/**
 * The club's ledger: what came in, what went out.
 *
 * Readable by anybody with `finance:read:club` — secretary, treasurer and president alike,
 * and INCOME AND EXPENDITURE BOTH. The predecessor showed secretaries collections and not
 * spending; the district logged it as a complaint, and the fix is that this screen makes no
 * distinction about who sees which half.
 *
 * Recording is `finance:write:club`, which the treasurer holds and the secretary does not:
 * reading and recording are genuinely different jobs.
 */

export function TransactionsPage() {
  const { permissions } = useAuth();
  const [page, setPage] = useState(1);
  const [direction, setDirection] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [isRecording, setIsRecording] = useState(false);

  const transactions = useList<TransactionListResponse>(queryKeys.transactions, '/transactions', {
    page,
    direction: direction || undefined,
    categoryId: categoryId || undefined,
  });
  const categories = useList<FinanceCategoryListResponse>(
    queryKeys.financeCategories,
    '/finance/categories',
    { isActive: true },
  );

  const canWrite = permissions.has('finance:write:club');

  return (
    <>
      <PageHeader
        title="Transactions"
        description="Everything the club has received and spent this Rotary Year."
        action={canWrite ? <Button onClick={() => setIsRecording(true)}>Record</Button> : undefined}
      />

      {/*
        Direction is the filter a treasurer reaches for constantly — "show me what we spent"
        — so it is a visible segmented control rather than a dropdown. Category is a long
        list and stays a select.
      */}
      <FilterBar>
        <FilterTabs
          value={direction}
          onChange={(next) => {
            setDirection(next);
            setPage(1);
          }}
          options={[
            { value: '', label: 'All' },
            { value: 'INCOME', label: 'Income' },
            { value: 'EXPENDITURE', label: 'Expenditure' },
          ]}
        />
        <Select
          label=""
          aria-label="Filter by category"
          value={categoryId}
          placeholder="Every category"
          options={(categories.data?.data ?? []).map((category) => ({
            value: category.id,
            label: category.name,
          }))}
          onChange={(event) => {
            setCategoryId(event.target.value);
            setPage(1);
          }}
        />
      </FilterBar>

      <Card>
        {transactions.isPending ? (
          <SkeletonList rows={5} />
        ) : transactions.isError ? (
          <ErrorState error={transactions.error} onRetry={() => void transactions.refetch()} />
        ) : (
          <>
            <Table
              columns={[
                {
                  key: 'what',
                  header: 'What',
                  render: (row: Transaction) => (
                    <div className="min-w-0">
                      <p className="text-text-primary font-medium">{row.categoryName}</p>
                      <p className="text-text-muted truncate text-meta">
                        {row.description ?? row.ownerName ?? '—'}
                      </p>
                    </div>
                  ),
                },
                {
                  key: 'when',
                  header: 'When',
                  secondary: true,
                  render: (row: Transaction) => row.occurredOn,
                },
                {
                  key: 'direction',
                  header: 'Direction',
                  secondary: true,
                  render: (row: Transaction) => (
                    <Badge tone={row.direction === 'INCOME' ? 'success' : 'neutral'}>
                      {row.direction === 'INCOME' ? 'In' : 'Out'}
                    </Badge>
                  ),
                },
                {
                  key: 'amount',
                  header: 'Amount',
                  numeric: true,
                  render: (row: Transaction) => (
                    <span className="tabular-nums">
                      {formatMoney(row.amount, row.currencyCode)}
                    </span>
                  ),
                },
              ]}
              rows={transactions.data.data}
              rowKey={(row) => row.id}
              emptyState={
                <EmptyState
                  title="Nothing recorded yet"
                  description="Income and expenditure appear here as the treasurer records them."
                />
              }
            />
            <Pagination
              page={transactions.data.meta.page}
              pageSize={transactions.data.meta.pageSize}
              total={transactions.data.meta.total}
              onPageChange={setPage}
            />
          </>
        )}
      </Card>

      {isRecording && <RecordTransaction onClose={() => setIsRecording(false)} />}
    </>
  );
}

/**
 * Recording one.
 *
 * There is no direction field. The CATEGORY carries it — the server derives it and would
 * ignore anything sent — so the form shows what the choice implies rather than asking twice
 * and letting the two disagree.
 */
function RecordTransaction({ onClose }: { onClose: () => void }) {
  const ownClub = useOwnClub();
  const [chosenClubId, setChosenClubId] = useState('');
  // Derived: a member with one club never chooses, so there is nothing to get stale.
  const clubId = ownClub?.id ?? chosenClubId;
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [occurredOn, setOccurredOn] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');

  const categories = useList<FinanceCategoryListResponse>(
    queryKeys.financeCategories,
    '/finance/categories',
    { isActive: true },
  );
  const clubs = useList<ClubListResponse>([...queryKeys.clubs, 'picker'], '/clubs', {
    pageSize: 100,
  });

  const record = useApiMutation(
    async (body: Record<string, unknown>) => api.post('/transactions', body),
    {
      invalidate: [queryKeys.transactions, queryKeys.financeSummary],
      successMessage: 'Recorded',
    },
  );

  const chosen = (categories.data?.data ?? []).find((category) => category.id === categoryId);

  return (
    <Dialog isOpen title="Record a transaction" onClose={onClose}>
      <div className="flex flex-col gap-3">
        {ownClub ? (
          <p className="text-text-secondary text-table">
            Recording for <span className="text-text-primary font-medium">{ownClub.name}</span>
          </p>
        ) : (
          <Select
            label="Club"
            value={clubId}
            placeholder="Choose a club"
            options={(clubs.data?.data ?? []).map((club) => ({ value: club.id, label: club.name }))}
            onChange={(event) => setChosenClubId(event.target.value)}
          />
        )}

        <Select
          label="Category"
          value={categoryId}
          placeholder="What was this for?"
          hint={
            chosen
              ? chosen.direction === 'INCOME'
                ? 'Money coming IN'
                : 'Money going OUT'
              : 'The category decides whether this is income or expenditure.'
          }
          options={(categories.data?.data ?? []).map((category) => ({
            value: category.id,
            label: `${category.name} — ${category.direction === 'INCOME' ? 'in' : 'out'}`,
          }))}
          onChange={(event) => setCategoryId(event.target.value)}
        />

        <Input
          label="Amount"
          // `inputMode="decimal"` gives an Android keypad with a decimal point. `type=number`
          // would let the browser hand back a float and a spinner nobody wants on money.
          inputMode="decimal"
          value={amount}
          placeholder="1250000"
          hint={amount ? formatAmount(amount) : 'Shillings. Two decimal places at most.'}
          onChange={(event) => setAmount(event.target.value)}
        />

        <Input
          label="When"
          type="date"
          value={occurredOn}
          onChange={(event) => setOccurredOn(event.target.value)}
        />

        <Input
          label="Note"
          value={description}
          hint="Optional. What a treasurer would want to remember in March."
          onChange={(event) => setDescription(event.target.value)}
        />

        <div className="mt-2 flex gap-3">
          <Button
            isLoading={record.isPending}
            disabled={!clubId || !categoryId || amount.trim() === ''}
            onClick={() => {
              record.mutate(
                {
                  ownerScopeType: 'CLUB',
                  ownerScopeId: clubId,
                  categoryId,
                  // A STRING all the way to the server. Parsing it here to "validate" would
                  // be the one place a float gets in.
                  amount: amount.trim(),
                  occurredOn,
                  description: description.trim() || null,
                },
                { onSuccess: onClose },
              );
            }}
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
