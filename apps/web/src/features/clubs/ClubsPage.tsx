import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Pagination,
  Select,
  SkeletonList,
  Table,
} from '../../components/ui';
import { queryKeys, useList } from '../../lib/queries';
import { useAuth } from '../auth/useAuth';
import type { Club, ClubListResponse, ClusterListResponse } from './types';

/**
 * The club directory.
 *
 * The one screen every role opens, so it is the one that must work at 360px on a bad
 * connection: cards on mobile, a table on desktop, and filters that fold away rather than
 * occupying the first screenful. Search is server-side over the trigram index — a client
 * that filtered a page of 25 would appear to lose clubs the moment there were 68.
 */

const TIER_TONES: Record<string, 'info' | 'success' | 'warning'> = {
  T1: 'info',
  T2: 'success',
  IBC: 'warning',
};

const STATUS_TONES: Record<string, 'neutral' | 'success' | 'warning' | 'danger'> = {
  ACTIVE: 'success',
  PROVISIONAL: 'warning',
  SUSPENDED: 'danger',
  TERMINATED: 'danger',
  MERGED: 'neutral',
};

export function ClubsPage() {
  const navigate = useNavigate();
  const { permissions } = useAuth();

  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [tier, setTier] = useState('');
  const [baseType, setBaseType] = useState('');
  const [status, setStatus] = useState('');
  const [clusterId, setClusterId] = useState('');

  // Every filter change goes back to page one. Staying on page 3 of a narrower result set
  // shows an empty screen and reads as "there are no clubs".
  const onFilter = (set: (value: string) => void) => (value: string) => {
    set(value);
    setPage(1);
  };

  const clubs = useList<ClubListResponse>(queryKeys.clubs, '/clubs', {
    page,
    q: q || undefined,
    tier: tier || undefined,
    baseType: baseType || undefined,
    status: status || undefined,
    clusterId: clusterId || undefined,
  });

  const clusters = useList<ClusterListResponse>(queryKeys.clusters, '/clusters', { pageSize: 100 });

  const columns = [
    {
      key: 'name',
      header: 'Club',
      render: (club: Club) => (
        <div className="min-w-0">
          <p className="text-ink-900 font-medium">{club.name}</p>
          <p className="text-ink-500 text-xs">
            {club.riClubId ? `RI ${club.riClubId}` : 'No RI Club ID'}
            {club.affiliation?.clusterName ? ` · ${club.affiliation.clusterName}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'tier',
      header: 'Tier',
      render: (club: Club) =>
        club.affiliation ? (
          <Badge tone={TIER_TONES[club.affiliation.tier] ?? 'neutral'}>
            {club.affiliation.tier}
          </Badge>
        ) : (
          <span className="text-ink-400">—</span>
        ),
    },
    { key: 'type', header: 'Type', render: (club: Club) => club.baseType, secondary: true },
    {
      key: 'status',
      header: 'Status',
      render: (club: Club) => (
        <Badge tone={STATUS_TONES[club.status] ?? 'neutral'}>{club.status}</Badge>
      ),
    },
    {
      key: 'meeting',
      header: 'Meets',
      secondary: true,
      render: (club: Club) =>
        club.meetingDay
          ? `${DAYS[club.meetingDay] ?? ''}${club.meetingTime ? ` ${club.meetingTime}` : ''}`
          : '—',
    },
  ];

  return (
    <>
      <PageHeader
        title="Clubs"
        description="Clubs affiliated to this district for the current Rotary Year."
        action={
          permissions.has('club:create:district') ? (
            <Button onClick={() => navigate('/clubs/new')}>Charter a club</Button>
          ) : null
        }
      />

      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Input
            label="Search"
            placeholder="Club name"
            value={q}
            onChange={(event) => onFilter(setQ)(event.target.value)}
          />
          <Select
            label="Tier"
            value={tier}
            placeholder="Any tier"
            options={[
              { value: 'T1', label: 'T1' },
              { value: 'T2', label: 'T2' },
              { value: 'IBC', label: 'IBC' },
            ]}
            onChange={(event) => onFilter(setTier)(event.target.value)}
          />
          <Select
            label="Type"
            value={baseType}
            placeholder="Any type"
            options={[
              { value: 'CBC', label: 'Community based' },
              { value: 'IBC', label: 'Institution based' },
              { value: 'ECLUB', label: 'E-club' },
            ]}
            onChange={(event) => onFilter(setBaseType)(event.target.value)}
          />
          <Select
            label="Status"
            value={status}
            placeholder="Any status"
            options={[
              { value: 'ACTIVE', label: 'Active' },
              { value: 'PROVISIONAL', label: 'Provisional' },
              { value: 'SUSPENDED', label: 'Suspended' },
              { value: 'TERMINATED', label: 'Terminated' },
              { value: 'MERGED', label: 'Merged' },
            ]}
            onChange={(event) => onFilter(setStatus)(event.target.value)}
          />
          <Select
            label="Cluster"
            value={clusterId}
            placeholder="Any cluster"
            options={(clusters.data?.data ?? []).map((cluster) => ({
              value: cluster.id,
              label: cluster.name,
            }))}
            onChange={(event) => onFilter(setClusterId)(event.target.value)}
          />
        </div>
      </Card>

      <Card>
        {clubs.isPending ? (
          <SkeletonList rows={5} />
        ) : clubs.isError ? (
          <ErrorState error={clubs.error} onRetry={() => void clubs.refetch()} />
        ) : (
          <>
            <Table
              columns={columns}
              rows={clubs.data.data}
              rowKey={(club) => club.id}
              onRowClick={(club) => navigate(`/clubs/${club.id}`)}
              emptyState={
                <EmptyState
                  title="No clubs match"
                  description={
                    q || tier || baseType || status || clusterId
                      ? 'Try clearing a filter.'
                      : 'Clubs appear here once they are affiliated to the district for this year.'
                  }
                />
              }
            />
            <Pagination
              page={clubs.data.meta.page}
              pageSize={clubs.data.meta.pageSize}
              total={clubs.data.meta.total}
              onPageChange={setPage}
            />
          </>
        )}
      </Card>
    </>
  );
}

// 0 = Sunday, matching the column and Postgres EXTRACT(DOW).
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
