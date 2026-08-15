import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonList,
} from '../../components/ui';
import { cx } from '../../lib/cx';
import { queryKeys, useList } from '../../lib/queries';
import { useAuth, useScope } from '../auth/useAuth';
import type { Club, ClubSummaryResponse } from './types';

/**
 * One club.
 *
 * Six tabs, one of which has content. The other five carry an EmptyState naming the
 * milestone that fills them, rather than being hidden — a club officer who cannot find the
 * Members tab assumes the system does not do membership, and the tab that says "arriving
 * with the membership log" is the difference between an unfinished system and a broken one.
 *
 * The Overview reads `/clubs/:id/summary`: ONE request, not six. On metered Android data
 * six round trips is the difference between a page that opens and a page a secretary gives
 * up on.
 */

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'members', label: 'Members', milestone: 'the membership log (M2 session 7)' },
  { key: 'activities', label: 'Activities', milestone: 'activity reporting (M2 session 9)' },
  { key: 'finance', label: 'Finance', milestone: 'the finance module (M4)' },
  { key: 'documents', label: 'Documents', milestone: 'document management (M7)' },
  { key: 'scorecard', label: 'Scorecard', milestone: 'the assessment engine (M5)' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function ClubProfilePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { permissions } = useAuth();
  const scope = useScope();
  const [tab, setTab] = useState<TabKey>('overview');

  const summary = useList<ClubSummaryResponse>(
    [...queryKeys.clubs, id, 'summary'],
    `/clubs/${id}/summary`,
  );

  if (summary.isPending) return <SkeletonList rows={5} />;
  if (summary.isError) {
    return <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />;
  }

  const { club, rosterCount, activities } = summary.data.data;

  // Presentation only. The server refuses an edit to somebody else's club regardless, and
  // answers 404 when it does — see clubs.service.
  const mayEdit =
    permissions.has('club:update:district') ||
    (permissions.has('club:update:own') && scope.coversClub(club.id));

  const active = TABS.find((entry) => entry.key === tab);

  return (
    <>
      <PageHeader
        title={club.name}
        description={
          club.affiliation
            ? `Tier ${club.affiliation.tier}${club.affiliation.clusterName ? ` · ${club.affiliation.clusterName}` : ''}${club.affiliation.isConfirmed ? '' : ' · affiliation not yet confirmed'}`
            : 'Not affiliated to this district for the current year'
        }
        action={
          mayEdit ? <Button onClick={() => navigate(`/clubs/${club.id}/edit`)}>Edit</Button> : null
        }
      />

      {/* Scrollable rather than wrapped: six tabs wrap to three lines at 360px, and a
          wrapped tab strip stops looking like one. */}
      <div className="border-ink-200 mb-4 -mx-1 flex gap-1 overflow-x-auto border-b px-1">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            onClick={() => setTab(entry.key)}
            className={cx(
              'min-h-11 shrink-0 border-b-2 px-3 text-sm font-medium whitespace-nowrap',
              tab === entry.key
                ? 'border-cranberry-500 text-cranberry-600'
                : 'text-ink-500 hover:text-ink-700 border-transparent',
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        <Overview club={club} rosterCount={rosterCount} activities={activities} />
      ) : (
        <Card>
          <EmptyState
            title={`${active?.label ?? ''} is not built yet`}
            description={`This tab arrives with ${active && 'milestone' in active ? active.milestone : 'a later milestone'}.`}
          />
        </Card>
      )}
    </>
  );
}

function Overview({
  club,
  rosterCount,
  activities,
}: {
  club: Club;
  rosterCount: number;
  activities: { total: number; verified: number; unverified: number };
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="grid grid-cols-2 gap-3 lg:col-span-3">
        <Stat label="Members" value={String(rosterCount)} />
        <Stat label="Activities this year" value={String(activities.total)} />
        <Stat label="Verified" value={String(activities.verified)} />
        <Stat label="Awaiting verification" value={String(activities.unverified)} />
      </div>

      <Card title="Profile" className="lg:col-span-2">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <Field label="RI Club ID" value={club.riClubId} />
          <Field label="Type" value={club.baseType} />
          <Field label="Status" value={<Badge>{club.status}</Badge>} />
          <Field label="Chartered" value={club.charteredOn} />
          <Field label="Charter members" value={club.charteredMemberCount?.toString() ?? null} />
          <Field label="Sponsor Rotary club" value={club.sponsorRotaryClub} />
          <Field label="Host institution" value={club.hostInstitution} />
          <Field label="URSB number" value={club.ursbNumber} />
          <Field label="Bank" value={club.bankName} />
          <Field label="Postal address" value={club.postalAddress} />
        </dl>
      </Card>

      <Card title="Meeting">
        <dl className="grid gap-3">
          <Field
            label="Day and time"
            value={
              club.meetingDay
                ? `${DAYS[club.meetingDay - 1] ?? ''}${club.meetingTime ? `, ${club.meetingTime}` : ''}`
                : null
            }
          />
          <Field label="Venue" value={club.isVirtual ? 'Online' : club.meetingVenue} />
          <Field label="Cluster" value={club.affiliation?.clusterName ?? null} />
          <Field label="Region" value={club.affiliation?.regionName ?? null} />
        </dl>
        {/* The incumbent system published exactly this — venue, day and time — to the open
            internet alongside 4,000 members' phone numbers. Here it needs a session. */}
        <p className="text-ink-400 mt-4 text-xs">
          Meeting details are visible to signed-in district members only.
        </p>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-ink-200 rounded-xl border bg-white p-4">
      <p className="text-ink-500 text-xs">{label}</p>
      <p className="text-ink-900 mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-ink-500 text-xs">{label}</dt>
      <dd className="text-ink-900 text-sm">{value === null || value === '' ? '—' : value}</dd>
    </div>
  );
}
