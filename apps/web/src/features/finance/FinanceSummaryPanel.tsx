import { Badge, Card, ErrorState, SkeletonList, Table } from '../../components/ui';
import { cx } from '../../lib/cx';
import { formatAmount, formatMoney, varianceTone } from '../../lib/money';
import { queryKeys, useList } from '../../lib/queries';
import type { CategoryVariance } from '@dis/contracts';
import type { FinanceSummaryResponse } from './types';

/**
 * Income, expenditure, and the gap between plan and reality.
 *
 * Used on the club profile's Finance tab and on the district's own summary, because they are
 * the same question asked of a different owner. **Visible to secretaries as well as
 * treasurers** — the predecessor showed secretaries collections and not spending, and the
 * district logged it as a complaint.
 *
 * Every figure here arrives as a STRING and is formatted, never parsed and added. The
 * totals, including the variance, are computed by the server; a client-side sum that
 * disagreed by a hundredth would be a bug nobody could reproduce.
 */

export function FinanceSummaryPanel({
  ownerScopeType,
  ownerScopeId,
}: {
  ownerScopeType: 'CLUB' | 'CLUSTER' | 'REGION' | 'COMMITTEE' | 'DISTRICT';
  ownerScopeId: string;
}) {
  const summary = useList<FinanceSummaryResponse>(
    [...queryKeys.financeSummary, ownerScopeId],
    '/finance/summary',
    { ownerScopeType, ownerScopeId },
  );

  if (summary.isPending) return <SkeletonList rows={4} />;
  if (summary.isError) {
    return <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />;
  }

  const data = summary.data.data;
  const currency = data.currencyCode;

  return (
    <>
      <Card className="mb-4">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Figure label="Income" value={formatMoney(data.income, currency)} tone="success" />
          <Figure
            label="Expenditure"
            value={formatMoney(data.expenditure, currency)}
            tone="neutral"
          />
          {/* A deficit is allowed to be a deficit. Colour is the only thing that says so. */}
          <Figure
            label="Net"
            value={formatMoney(data.net, currency)}
            tone={varianceTone(data.net)}
          />
          <Figure
            label="Planned income"
            value={data.budgetId ? formatMoney(data.plannedIncome, currency) : 'No budget'}
            tone="neutral"
          />
        </dl>
      </Card>

      <Card title="Against the budget">
        {data.categories.length === 0 ? (
          <p className="text-ink-500 text-sm">
            Nothing recorded yet. Categories appear here as money moves.
          </p>
        ) : (
          <Table
            columns={[
              {
                key: 'category',
                header: 'Category',
                render: (row: CategoryVariance) => (
                  <div className="min-w-0">
                    <p className="text-ink-900 font-medium">{row.categoryName}</p>
                    <p className="text-ink-500 text-xs">
                      {row.direction === 'INCOME' ? 'Income' : 'Expenditure'}
                    </p>
                  </div>
                ),
              },
              {
                key: 'planned',
                header: 'Planned',
                secondary: true,
                render: (row: CategoryVariance) => formatAmount(row.planned),
              },
              {
                key: 'actual',
                header: 'Actual',
                render: (row: CategoryVariance) => formatAmount(row.actual),
              },
              {
                key: 'variance',
                header: 'Variance',
                render: (row: CategoryVariance) => (
                  // The API orients this so POSITIVE IS GOOD in both directions, which is
                  // why one colour rule covers income and expenditure alike.
                  <Badge tone={varianceTone(row.variance)}>{formatAmount(row.variance)}</Badge>
                ),
              },
            ]}
            rows={data.categories}
            rowKey={(row) => row.categoryId}
          />
        )}

        {!data.budgetId && (
          <p className="text-ink-500 mt-3 text-xs">
            This owner has no budget for the current Rotary Year, so every planned figure is zero.
            The actuals are real.
          </p>
        )}
      </Card>
    </>
  );
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'success' | 'danger' | 'neutral';
}) {
  return (
    <div>
      <dt className="text-ink-500 text-xs">{label}</dt>
      <dd
        className={cx(
          'mt-0.5 text-lg font-semibold tabular-nums',
          tone === 'success'
            ? 'text-success-700'
            : tone === 'danger'
              ? 'text-danger-700'
              : 'text-ink-900',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
