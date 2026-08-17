import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
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
import { useAuth, useOwnClub, useScope } from '../auth/useAuth';
import type { ClubListResponse } from '../clubs/types';
import type {
  Budget,
  BudgetLine,
  BudgetListResponse,
  BudgetResponse,
  FinanceCategoryListResponse,
} from './types';

/**
 * Building a budget, line by line, with the running totals visible while you type.
 *
 * The totals come from the SERVER on every refetch rather than being accumulated here. That
 * looks like an extra round trip and is deliberate: a client-side sum of decimal strings is
 * where a float gets in, and a planned-income figure that disagreed with the variance table
 * by a hundredth would be a bug nobody could reproduce.
 *
 * **Approval freezes the lines** — enforced by a database guard, so this screen does not
 * hide the buttons to be clever, it hides them because the server would refuse.
 */

export function BudgetPage() {
  const { permissions } = useAuth();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const budgets = useList<BudgetListResponse>(queryKeys.budgets, '/budgets', { pageSize: 100 });
  const canWrite = permissions.has('finance:write:club');

  if (budgets.isPending) return <SkeletonList rows={4} />;
  if (budgets.isError) {
    return <ErrorState error={budgets.error} onRetry={() => void budgets.refetch()} />;
  }

  const rows = budgets.data.data;
  const current = selectedId ?? rows[0]?.id ?? null;

  return (
    <>
      <PageHeader
        title="Budget"
        description="What was planned for the Rotary Year, and what the district approved."
        action={canWrite ? <CreateBudget /> : undefined}
      />

      {rows.length === 0 ? (
        <EmptyState
          title="No budget yet"
          description="A budget is one row per category with a planned amount. It can be built over several sittings."
        />
      ) : (
        <>
          {rows.length > 1 && (
            <Card className="mb-4">
              <Select
                label="Budget"
                value={current ?? ''}
                options={rows.map((budget) => ({
                  value: budget.id,
                  label: `${budget.ownerName ?? budget.ownerScopeType}${budget.isApproved ? ' — approved' : ''}`,
                }))}
                onChange={(event) => setSelectedId(event.target.value)}
              />
            </Card>
          )}
          {current && <BudgetDetail budgetId={current} canWrite={canWrite} />}
        </>
      )}
    </>
  );
}

function CreateBudget() {
  const ownClub = useOwnClub();
  const [chosenClubId, setChosenClubId] = useState('');
  // Derived: a club treasurer budgets for their own club and nobody else's.
  const clubId = ownClub?.id ?? chosenClubId;

  const clubs = useList<ClubListResponse>(
    [...queryKeys.clubs, 'picker'],
    '/clubs',
    { pageSize: 100 },
    { enabled: ownClub === null },
  );

  const create = useApiMutation(
    async (body: Record<string, unknown>) => api.post<BudgetResponse>('/budgets', body),
    { invalidate: [queryKeys.budgets], successMessage: 'Budget started' },
  );

  return (
    <div className="flex flex-wrap items-end gap-2">
      {ownClub ? null : (
        <Select
          label="For"
          value={clubId}
          placeholder="Choose a club"
          options={(clubs.data?.data ?? []).map((club) => ({ value: club.id, label: club.name }))}
          onChange={(event) => setChosenClubId(event.target.value)}
        />
      )}
      <Button
        isLoading={create.isPending}
        disabled={!clubId}
        onClick={() =>
          create.mutate({ ownerScopeType: 'CLUB', ownerScopeId: clubId, currencyCode: 'UGX' })
        }
      >
        {ownClub ? `Start a budget for ${ownClub.name}` : 'Start a budget'}
      </Button>
    </div>
  );
}

function BudgetDetail({ budgetId, canWrite }: { budgetId: string; canWrite: boolean }) {
  const { permissions } = useAuth();
  const scope = useScope();
  const budget = useList<BudgetResponse>([...queryKeys.budgets, budgetId], `/budgets/${budgetId}`);

  const approve = useApiMutation(
    async (isApproved: boolean) => api.post(`/budgets/${budgetId}/approval`, { isApproved }),
    { invalidate: [queryKeys.budgets] },
  );

  if (budget.isPending) return <SkeletonList rows={4} />;
  if (budget.isError) {
    return <ErrorState error={budget.error} onRetry={() => void budget.refetch()} />;
  }

  const data: Budget = budget.data.data;
  // Approval is a DISTRICT act. A club treasurer holds `finance:write:club` for their own
  // club and the server refuses them here, so showing the button would be a lie.
  const canApprove = permissions.has('finance:write:club') && scope.isDistrictWide;

  return (
    <>
      <Card className="mb-4">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Figure
            label="Planned income"
            value={formatMoney(data.totalPlannedIncome, data.currencyCode)}
          />
          <Figure
            label="Planned expenditure"
            value={formatMoney(data.totalPlannedExpenditure, data.currencyCode)}
          />
          <div>
            <dt className="text-text-muted text-xs">Status</dt>
            <dd className="mt-0.5">
              <Badge tone={data.isApproved ? 'success' : 'warning'}>
                {data.isApproved ? 'Approved' : 'Draft'}
              </Badge>
            </dd>
          </div>
        </dl>

        {canApprove && (
          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              variant={data.isApproved ? 'secondary' : 'primary'}
              isLoading={approve.isPending}
              onClick={() => approve.mutate(!data.isApproved)}
            >
              {data.isApproved ? 'Withdraw approval' : 'Approve'}
            </Button>
            <p className="text-text-muted self-center text-xs">
              {data.isApproved
                ? 'Withdrawing approval unlocks the lines again. It is recorded.'
                : 'Approving locks the lines. Record differences as transactions afterwards.'}
            </p>
          </div>
        )}
      </Card>

      <Card
        title="Lines"
        actions={
          data.isApproved ? (
            <span className="text-text-muted text-xs">Frozen by approval</span>
          ) : undefined
        }
      >
        <Table
          columns={[
            {
              key: 'category',
              header: 'Category',
              render: (line: BudgetLine) => (
                <div className="min-w-0">
                  <p className="text-text-primary font-medium">{line.categoryName}</p>
                  <p className="text-text-muted truncate text-xs">{line.description}</p>
                </div>
              ),
            },
            {
              key: 'direction',
              header: 'Direction',
              secondary: true,
              render: (line: BudgetLine) => (
                <Badge tone={line.direction === 'INCOME' ? 'success' : 'neutral'}>
                  {line.direction === 'INCOME' ? 'In' : 'Out'}
                </Badge>
              ),
            },
            {
              key: 'amount',
              header: 'Planned',
              render: (line: BudgetLine) => (
                <span className="tabular-nums">{formatAmount(line.amountPlanned)}</span>
              ),
            },
            {
              key: 'remove',
              header: '',
              render: (line: BudgetLine) =>
                canWrite && !data.isApproved ? (
                  <RemoveLine budgetId={budgetId} line={line} />
                ) : null,
            },
          ]}
          rows={data.lines ?? []}
          rowKey={(line) => line.id}
          emptyState={
            <EmptyState
              title="No lines yet"
              description="Add one per category. The totals above follow."
            />
          }
        />

        {canWrite && !data.isApproved && <AddLine budgetId={budgetId} />}
      </Card>
    </>
  );
}

function AddLine({ budgetId }: { budgetId: string }) {
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [amountPlanned, setAmountPlanned] = useState('');

  const categories = useList<FinanceCategoryListResponse>(
    queryKeys.financeCategories,
    '/finance/categories',
    { isActive: true },
  );

  const add = useApiMutation(
    async (body: Record<string, unknown>) => api.post(`/budgets/${budgetId}/lines`, body),
    { invalidate: [queryKeys.budgets] },
  );

  return (
    <div className="border-border-subtle mt-4 grid gap-3 border-t pt-4 sm:grid-cols-4">
      <Select
        label="Category"
        value={categoryId}
        placeholder="Choose"
        options={(categories.data?.data ?? []).map((category) => ({
          value: category.id,
          label: `${category.name} — ${category.direction === 'INCOME' ? 'in' : 'out'}`,
        }))}
        onChange={(event) => setCategoryId(event.target.value)}
      />
      <Input
        label="What for"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />
      <Input
        label="Planned"
        inputMode="decimal"
        value={amountPlanned}
        hint={amountPlanned ? formatAmount(amountPlanned) : undefined}
        onChange={(event) => setAmountPlanned(event.target.value)}
      />
      <div className="flex items-end">
        <Button
          isLoading={add.isPending}
          disabled={!categoryId || description.trim() === '' || amountPlanned.trim() === ''}
          onClick={() =>
            add.mutate(
              {
                categoryId,
                description: description.trim(),
                amountPlanned: amountPlanned.trim(),
              },
              {
                onSuccess: () => {
                  // Category deliberately kept: a treasurer entering a budget usually adds
                  // several lines to the same category in a row.
                  setDescription('');
                  setAmountPlanned('');
                },
              },
            )
          }
        >
          Add
        </Button>
      </div>
    </div>
  );
}

function RemoveLine({ budgetId, line }: { budgetId: string; line: BudgetLine }) {
  const remove = useApiMutation(async () => api.delete(`/budgets/${budgetId}/lines/${line.id}`), {
    invalidate: [queryKeys.budgets],
  });

  return (
    <Button variant="ghost" isLoading={remove.isPending} onClick={() => remove.mutate(undefined)}>
      Remove
    </Button>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-text-muted text-xs">{label}</dt>
      <dd className="text-text-primary mt-0.5 font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
