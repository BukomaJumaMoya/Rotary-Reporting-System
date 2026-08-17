import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  Select,
  SkeletonList,
} from '../../components/ui';
import {
  FilterBar,
  FilterTabs,
  ListGroup,
  ListRow,
  PageLayout,
  SearchField,
} from '../../components/ui/page';
import { queryKeys, useList } from '../../lib/queries';
import { useAuth } from '../auth/useAuth';
import type { ClubListResponse, ClusterListResponse } from './types';

/**
 * The club directory.
 *
 * The one screen every role opens, so it is the one that must work at 360px on a bad
 * connection. A LIST at every width — a club is a record somebody picks out by name, not a
 * row compared across five columns — with the two filters people reach for on the bar and
 * the rest behind a disclosure.
 *
 * Search is server-side over the trigram index. A client that filtered a page of 25 would
 * appear to lose clubs the moment there were 68.
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

  return (
    <PageLayout>
      <PageHeader
        title="Clubs"
        description="Clubs affiliated to this district for the current Rotary Year."
        action={
          permissions.has('club:create:district') ? (
            <Button onClick={() => navigate('/clubs/new')}>Charter a club</Button>
          ) : null
        }
      />

      {/*
        Search and tier as a bar; the rarely-used facets behind a disclosure.

        Five labelled Selects in a grid was a form, and a form at the top of a directory
        implies you have to fill it in before the directory is valid. Tier is the filter
        people actually reach for, so it stays visible; type, status and cluster are the ones
        a district officer wants twice a year.
      */}
      <FilterBar>
        <SearchField value={q} onChange={onFilter(setQ)} placeholder="Search clubs…" />
        <FilterTabs
          value={tier}
          onChange={onFilter(setTier)}
          options={[
            { value: '', label: 'All tiers' },
            { value: 'T1', label: 'T1' },
            { value: 'T2', label: 'T2' },
            { value: 'IBC', label: 'IBC' },
          ]}
        />
        <details className="group relative">
          <summary className="border-border bg-surface text-text-secondary hover:bg-surface-sunken text-label flex min-h-10 cursor-pointer list-none items-center gap-1.5 rounded-md border px-3 font-medium">
            More filters
            {(baseType || status || clusterId) && (
              <span className="bg-accent size-1.5 rounded-full" aria-label="filters applied" />
            )}
          </summary>
          <div className="border-border bg-surface-overlay absolute right-0 z-30 mt-2 w-72 rounded-lg border p-4 shadow-[var(--shadow-lg)]">
            <div className="flex flex-col gap-3">
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
          </div>
        </details>
      </FilterBar>

      {clubs.isPending ? (
        <SkeletonList rows={6} />
      ) : clubs.isError ? (
        <ErrorState error={clubs.error} onRetry={() => void clubs.refetch()} />
      ) : clubs.data.data.length === 0 ? (
        <EmptyState
          filtered={Boolean(q || tier || baseType || status || clusterId)}
          onClearFilters={() => {
            setQ('');
            setTier('');
            setBaseType('');
            setStatus('');
            setClusterId('');
            setPage(1);
          }}
          title="No clubs yet"
          description="Clubs appear here once they are affiliated to the district for this year."
        />
      ) : (
        <>
          <ListGroup>
            {clubs.data.data.map((club) => (
              <ListRow
                key={club.id}
                to={`/clubs/${club.id}`}
                title={club.name}
                meta={[
                  club.affiliation?.clusterName,
                  club.baseType,
                  club.meetingDay !== null && club.meetingDay !== undefined
                    ? `Meets ${DAYS[club.meetingDay] ?? ''}${club.meetingTime ? ` at ${club.meetingTime}` : ''}`
                    : null,
                ]}
                badges={
                  <>
                    {club.affiliation && (
                      <Badge tone={TIER_TONES[club.affiliation.tier] ?? 'neutral'}>
                        {club.affiliation.tier}
                      </Badge>
                    )}
                    {/* ACTIVE is the norm and needs no badge. Anything else is the news. */}
                    {club.status !== 'ACTIVE' && (
                      <Badge tone={STATUS_TONES[club.status] ?? 'neutral'}>
                        {club.status.toLowerCase()}
                      </Badge>
                    )}
                  </>
                }
              />
            ))}
          </ListGroup>

          <Pagination
            page={clubs.data.meta.page}
            pageSize={clubs.data.meta.pageSize}
            total={clubs.data.meta.total}
            onPageChange={setPage}
          />
        </>
      )}
    </PageLayout>
  );
}

// 0 = Sunday, matching Postgres EXTRACT(DOW).
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
