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
import { StatGrid } from '../../components/ui/page';
import { api } from '../../lib/api';
import { formatAmount, formatMoney } from '../../lib/money';
import { queryKeys, useApiMutation, useList } from '../../lib/queries';
import { useAuth, useOwnClub } from '../auth/useAuth';
import type { ClubListResponse } from '../clubs/types';
import type { TrfClubTotal, TrfContribution } from '@dis/contracts';
import type { TrfListResponse, TrfSummaryResponse } from './types';

/**
 * The Rotary Foundation.
 *
 * **This is a TRANSCRIPTION surface.** The authoritative figures live on My Rotary and the
 * Rotary Foundation reports; there is no feed, so the District Foundation Chair works with
 * that page open in another tab, reading club by club and fund by fund. The recording form
 * is therefore built to be used repeatedly in a sitting — the club and fund stay selected
 * between entries, because the Chair is usually working down one club's row before moving on.
 *
 * The system holds the DISTRICT'S OWN figure. It does not record what My Rotary said, by
 * decision, so nothing here claims to reconcile — it shows what has been entered and what
 * has been verified.
 */

const FUND_LABELS: Record<string, string> = {
  ANNUAL_FUND: 'Annual Fund',
  POLIO_PLUS: 'PolioPlus',
  ENDOWMENT: 'Endowment',
  DISASTER_RESPONSE: 'Disaster Response',
  OTHER: 'Other',
};

const VERIFICATION_TONES: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  VERIFIED: 'success',
  UNVERIFIED: 'neutral',
  QUERIED: 'warning',
  REJECTED: 'danger',
};

export function TrfPage() {
  const { permissions } = useAuth();
  const [isRecording, setIsRecording] = useState(false);

  const summary = useList<TrfSummaryResponse>([...queryKeys.trf, 'summary'], '/trf/summary');
  const contributions = useList<TrfListResponse>(queryKeys.trf, '/trf/contributions', {
    pageSize: 50,
  });

  const canRecord = permissions.has('finance:write:club');
  const canVerify = permissions.has('trf:verify:district');

  if (summary.isPending) return <SkeletonList rows={5} />;
  if (summary.isError) {
    return <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />;
  }

  const data = summary.data.data;

  return (
    <>
      <PageHeader
        title="The Rotary Foundation"
        description="Giving as recorded by the district. Figures are read from My Rotary and entered here."
        action={
          canRecord ? <Button onClick={() => setIsRecording(true)}>Record</Button> : undefined
        }
      />

      <Card className="mb-4">
        {/* USD, always. The rubric's bands are in dollars and so is TRF's own reporting. */}
        <StatGrid
          columns={2}
          stats={[
            { label: 'Verified', value: formatMoney(data.verifiedUsd, 'USD'), tone: 'success' },
            {
              label: 'Awaiting reconciliation',
              value: formatMoney(data.pendingUsd, 'USD'),
              tone: data.pendingUsd === '0.00' ? 'default' : 'warning',
            },
          ]}
        />

        {data.byFund.length > 0 && (
          <div className="border-border-subtle mt-4 border-t pt-3">
            <p className="text-text-muted mb-2 text-meta">By fund</p>
            <ul className="flex flex-wrap gap-x-6 gap-y-1 text-table">
              {data.byFund.map((fund) => (
                <li key={fund.fundType}>
                  <span className="text-text-muted">
                    {FUND_LABELS[fund.fundType] ?? fund.fundType}
                  </span>{' '}
                  <span className="tabular-nums">{formatAmount(fund.verifiedUsd)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-text-muted mt-3 text-meta">
          Only verified giving counts toward a club&rsquo;s score. These totals are what the
          district has recorded — they are not a reconciliation against Rotary&rsquo;s own figures.
        </p>
      </Card>

      {data.byClub.length > 0 && (
        <Card title="By club" className="mb-4">
          <Table
            columns={[
              {
                key: 'club',
                header: 'Club',
                render: (row: TrfClubTotal) => (
                  <span className="text-text-primary font-medium">{row.clubName}</span>
                ),
              },
              {
                key: 'verified',
                header: 'Verified',
                render: (row: TrfClubTotal) => (
                  <span className="tabular-nums">{formatAmount(row.verifiedUsd)}</span>
                ),
              },
              {
                key: 'pending',
                header: 'Pending',
                secondary: true,
                render: (row: TrfClubTotal) => (
                  <span className="tabular-nums">{formatAmount(row.pendingUsd)}</span>
                ),
              },
              {
                key: 'rate',
                header: 'Members giving',
                render: (row: TrfClubTotal) => (
                  <span>
                    {row.contributingMembers} of {row.rosterSize}
                    <span className="text-text-muted ml-1 text-meta">
                      {Math.round(row.contributingMemberRate * 100)}%
                    </span>
                  </span>
                ),
              },
            ]}
            rows={data.byClub}
            rowKey={(row) => row.clubId}
          />
          <p className="text-text-muted mt-3 text-meta">
            A club-level gift counts toward the money but not toward &ldquo;members giving&rdquo; —
            one cheque is not every member contributing.
          </p>
        </Card>
      )}

      <Card title="Contributions">
        {contributions.isPending ? (
          <SkeletonList rows={4} />
        ) : contributions.isError ? (
          <ErrorState error={contributions.error} onRetry={() => void contributions.refetch()} />
        ) : (
          <Table
            columns={[
              {
                key: 'what',
                header: 'Contribution',
                render: (row: TrfContribution) => (
                  <div className="min-w-0">
                    <p className="text-text-primary font-medium">
                      {FUND_LABELS[row.fundType] ?? row.fundType}
                    </p>
                    <p className="text-text-muted truncate text-meta">
                      {row.clubName} · {row.personName ?? 'club gift'}
                      {row.riReceiptRef ? ` · ${row.riReceiptRef}` : ''}
                    </p>
                  </div>
                ),
              },
              {
                key: 'when',
                header: 'When',
                secondary: true,
                render: (row: TrfContribution) => row.contributedOn,
              },
              {
                key: 'amount',
                header: 'USD',
                numeric: true,
                render: (row: TrfContribution) => (
                  <span className="tabular-nums">{formatAmount(row.amountUsd)}</span>
                ),
              },
              {
                key: 'verification',
                header: 'Status',
                render: (row: TrfContribution) => (
                  <Badge tone={VERIFICATION_TONES[row.verification] ?? 'neutral'}>
                    {row.verification.toLowerCase()}
                  </Badge>
                ),
              },
              {
                key: 'verify',
                header: '',
                render: (row: TrfContribution) =>
                  canVerify && row.verification !== 'VERIFIED' ? (
                    <VerifyButton contribution={row} />
                  ) : null,
              },
            ]}
            rows={contributions.data.data}
            rowKey={(row) => row.id}
            emptyState={
              <EmptyState
                title="Nothing recorded"
                description="Giving appears here once it is entered from My Rotary."
              />
            }
          />
        )}
      </Card>

      {isRecording && <RecordContribution onClose={() => setIsRecording(false)} />}
    </>
  );
}

function VerifyButton({ contribution }: { contribution: TrfContribution }) {
  const verify = useApiMutation(
    async () => api.post(`/trf/contributions/${contribution.id}/verify`, { decision: 'VERIFIED' }),
    { invalidate: [queryKeys.trf], successMessage: 'Verified' },
  );

  return (
    <Button variant="ghost" isLoading={verify.isPending} onClick={() => verify.mutate(undefined)}>
      Verify
    </Button>
  );
}

/**
 * Recording, built for a sitting rather than a single entry.
 *
 * The club and the fund STAY SELECTED after a save, and the dialog stays open. The Chair is
 * reading down one club's row on My Rotary — Annual Fund, then PolioPlus, then the next club
 * — and a form that reset itself every time would add two taps to every line of a report
 * with dozens of them. That is how the reconciliation stops happening.
 */
function RecordContribution({ onClose }: { onClose: () => void }) {
  const ownClub = useOwnClub();
  const [chosenClubId, setChosenClubId] = useState('');
  // Derived: a member with one club never chooses, so there is nothing to get stale.
  const clubId = ownClub?.id ?? chosenClubId;
  const [fundType, setFundType] = useState('ANNUAL_FUND');
  const [amountUsd, setAmountUsd] = useState('');
  const [contributedOn, setContributedOn] = useState(new Date().toISOString().slice(0, 10));
  const [riReceiptRef, setRiReceiptRef] = useState('');
  const [saved, setSaved] = useState(0);

  const clubs = useList<ClubListResponse>([...queryKeys.clubs, 'picker'], '/clubs', {
    pageSize: 100,
  });

  const record = useApiMutation(
    async (body: Record<string, unknown>) => api.post('/trf/contributions', body),
    { invalidate: [queryKeys.trf] },
  );

  return (
    <Dialog isOpen title="Record TRF giving" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-text-muted text-table">
          Enter what My Rotary shows. The club and fund stay selected, so a whole club can be
          entered without reselecting.
        </p>

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
          label="Fund"
          value={fundType}
          options={Object.entries(FUND_LABELS).map(([value, label]) => ({ value, label }))}
          onChange={(event) => setFundType(event.target.value)}
        />

        <Input
          label="Amount (USD)"
          inputMode="decimal"
          value={amountUsd}
          hint={amountUsd ? `USD ${formatAmount(amountUsd)}` : 'Dollars, as Rotary reports them.'}
          onChange={(event) => setAmountUsd(event.target.value)}
        />

        <Input
          label="Contributed on"
          type="date"
          value={contributedOn}
          onChange={(event) => setContributedOn(event.target.value)}
        />

        <Input
          label="Rotary receipt reference"
          value={riReceiptRef}
          hint="What a dispute is settled with. Worth the extra keystrokes."
          onChange={(event) => setRiReceiptRef(event.target.value)}
        />

        <p className="text-text-muted text-meta">
          This is recorded as a CLUB gift. A named member&rsquo;s contribution is entered from their
          own record, because only a named contribution counts toward the members-giving rate.
        </p>

        {saved > 0 && (
          <p className="text-success-text text-table">
            {saved} recorded in this sitting. They stay unverified until you verify them.
          </p>
        )}

        <div className="mt-2 flex gap-3">
          <Button
            isLoading={record.isPending}
            disabled={!clubId || amountUsd.trim() === ''}
            onClick={() =>
              record.mutate(
                {
                  clubId,
                  fundType,
                  amountUsd: amountUsd.trim(),
                  contributedOn,
                  riReceiptRef: riReceiptRef.trim() || null,
                },
                {
                  onSuccess: () => {
                    // Club and fund deliberately kept. Only the figures clear.
                    setAmountUsd('');
                    setRiReceiptRef('');
                    setSaved((count) => count + 1);
                  },
                },
              )
            }
          >
            Record and keep going
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
