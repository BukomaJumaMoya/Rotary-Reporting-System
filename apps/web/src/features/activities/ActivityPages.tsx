import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Activity, Media, Partner } from '@dis/contracts';
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
import { api } from '../../lib/api';
import { cx } from '../../lib/cx';
import { useOutbox } from '../../lib/offline/submit';
import { queryKeys, useApiMutation, useList } from '../../lib/queries';
import { useAuth, useScope } from '../auth/useAuth';

/**
 * Reading activities: the list, one activity, and the month view.
 *
 * The verification actions live on the detail screen rather than the list, because Query
 * needs a comment and a comment needs somewhere to type it — and a Verify button on a list
 * is a Verify button somebody presses without reading the report.
 */

interface ListResponse {
  data: Activity[];
  meta: { page: number; pageSize: number; total: number };
}
interface Single<T> {
  data: T;
}
interface CalendarResponse {
  data: {
    date: string;
    activities: {
      id: string;
      title: string;
      activityTypeName: string;
      status: string;
      verification: string;
      hostName: string | null;
    }[];
  }[];
}

const VERIFICATION_TONES: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  VERIFIED: 'success',
  UNVERIFIED: 'neutral',
  QUERIED: 'warning',
  REJECTED: 'danger',
};

/**
 * Reports this device has saved but not yet sent.
 *
 * ABOVE the table, not mixed into it. A queued report has no server id, so a row in the
 * table would be a row that navigates nowhere, and it would throw off the count and the
 * paging beneath it. Separating them also tells the truth: these are on this phone, and the
 * district cannot see them yet.
 */
function QueuedActivities() {
  const { items } = useOutbox();
  const queued = items.filter((item) => item.endpoint === '/activities');
  if (queued.length === 0) return null;

  return (
    <Card className="bg-warning-100 mb-4">
      <p className="text-warning-700 mb-2 text-sm font-medium">
        {queued.length} report{queued.length === 1 ? '' : 's'} saved on this device, not yet sent
      </p>
      <ul className="flex flex-col gap-1">
        {queued.map((item) => (
          <li key={item.id} className="text-ink-700 flex items-center gap-2 text-sm">
            <Badge tone={item.status === 'failed' ? 'danger' : 'warning'}>
              {item.status === 'failed' ? 'Needs attention' : 'Waiting'}
            </Badge>
            <span className="truncate">{item.label}</span>
          </li>
        ))}
      </ul>
      <Link to="/pending" className="text-cranberry-600 mt-2 inline-block text-sm font-medium">
        See what is waiting
      </Link>
    </Card>
  );
}

export function ActivitiesPage() {
  const navigate = useNavigate();
  const { permissions } = useAuth();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [verification, setVerification] = useState('');
  const [status, setStatus] = useState('');

  const activities = useList<ListResponse>(queryKeys.activities, '/activities', {
    page,
    q: q || undefined,
    verification: verification || undefined,
    status: status || undefined,
  });

  const columns = [
    {
      key: 'title',
      header: 'Activity',
      render: (activity: Activity) => (
        <div className="min-w-0">
          <p className="text-ink-900 font-medium">{activity.title}</p>
          <p className="text-ink-500 text-xs">
            {activity.activityTypeName}
            {activity.hostName ? ` · ${activity.hostName}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'when',
      header: 'When',
      render: (activity: Activity) => activity.startsAt.slice(0, 10),
    },
    {
      key: 'verification',
      header: 'Verification',
      render: (activity: Activity) => (
        <Badge tone={VERIFICATION_TONES[activity.verification] ?? 'neutral'}>
          {activity.verification}
        </Badge>
      ),
    },
    {
      key: 'evidence',
      header: 'Evidence',
      secondary: true,
      render: (activity: Activity) =>
        [
          activity.mediaCount ? `${activity.mediaCount} photo(s)` : null,
          activity.attendeeCount ? `${activity.attendeeCount} attendee(s)` : null,
          activity.partnerCount ? `${activity.partnerCount} partner(s)` : null,
        ]
          .filter(Boolean)
          .join(' · ') || '—',
    },
  ];

  return (
    <>
      <PageHeader
        title="Activities"
        description="Everything reported in the current Rotary Year."
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => navigate('/activities/calendar')}>
              Calendar
            </Button>
            {permissions.has('activity:create:club') && (
              <Button onClick={() => navigate('/report')}>Report</Button>
            )}
          </div>
        }
      />

      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Input
            label="Search"
            placeholder="Title"
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              setPage(1);
            }}
          />
          <Select
            label="Verification"
            value={verification}
            placeholder="Any"
            options={[
              { value: 'UNVERIFIED', label: 'Awaiting verification' },
              { value: 'VERIFIED', label: 'Verified' },
              { value: 'QUERIED', label: 'Queried' },
              { value: 'REJECTED', label: 'Rejected' },
            ]}
            onChange={(event) => {
              setVerification(event.target.value);
              setPage(1);
            }}
          />
          <Select
            label="Status"
            value={status}
            placeholder="Any"
            options={[
              { value: 'PLANNED', label: 'Planned' },
              { value: 'HELD', label: 'Held' },
              { value: 'CANCELLED', label: 'Cancelled' },
            ]}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          />
        </div>
      </Card>

      <QueuedActivities />

      <Card>
        {activities.isPending ? (
          <SkeletonList rows={5} />
        ) : activities.isError ? (
          <ErrorState error={activities.error} onRetry={() => void activities.refetch()} />
        ) : (
          <>
            <Table
              columns={columns}
              rows={activities.data.data}
              rowKey={(activity) => activity.id}
              onRowClick={(activity) => navigate(`/activities/${activity.id}`)}
              emptyState={
                <EmptyState
                  title="Nothing reported yet"
                  description="Activities appear here as clubs file them."
                />
              }
            />
            <Pagination
              page={activities.data.meta.page}
              pageSize={activities.data.meta.pageSize}
              total={activities.data.meta.total}
              onPageChange={setPage}
            />
          </>
        )}
      </Card>
    </>
  );
}

export function ActivityDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { permissions } = useAuth();
  const scope = useScope();
  const [deciding, setDeciding] = useState<'VERIFY' | 'QUERY' | 'REJECT' | null>(null);

  const activity = useList<Single<Activity>>([...queryKeys.activities, id], `/activities/${id}`);
  const media = useList<{ data: Media[] }>(
    [...queryKeys.activities, id, 'media'],
    `/activities/${id}/media`,
  );
  const partners = useList<{ data: Partner[] }>(
    [...queryKeys.activities, id, 'partners'],
    `/activities/${id}/partners`,
  );

  if (activity.isPending) return <SkeletonList rows={5} />;
  if (activity.isError) {
    return <ErrorState error={activity.error} onRetry={() => void activity.refetch()} />;
  }

  const record = activity.data.data;
  // Presentation only. The server re-checks both halves and answers 404 for the scope one.
  const mayVerify =
    permissions.has('activity:verify:district') && scope.coversClub(record.hostScopeId) !== false;

  return (
    <>
      <PageHeader
        title={record.title}
        description={`${record.activityTypeName}${record.hostName ? ` · ${record.hostName}` : ''} · ${record.startsAt.slice(0, 10)}`}
        action={
          <Button variant="secondary" onClick={() => navigate('/activities')}>
            Back
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Report" className="lg:col-span-2">
          <div className="mb-3 flex flex-wrap gap-2">
            <Badge tone={VERIFICATION_TONES[record.verification] ?? 'neutral'}>
              {record.verification}
            </Badge>
            <Badge>{record.status}</Badge>
            {record.areaOfFocusCodes.map((code) => (
              <Badge key={code} tone="info">
                {code}
              </Badge>
            ))}
          </div>

          {record.description && (
            <p className="text-ink-800 mb-4 text-sm whitespace-pre-wrap">{record.description}</p>
          )}
          {record.narrativeReport && (
            <>
              <h3 className="text-ink-700 mb-1 text-sm font-semibold">Narrative report</h3>
              <p className="text-ink-800 mb-4 text-sm whitespace-pre-wrap">
                {record.narrativeReport}
              </p>
            </>
          )}

          {Object.keys(record.extra).length > 0 && (
            <dl className="mb-4 grid gap-2 sm:grid-cols-2">
              {Object.entries(record.extra).map(([key, value]) => (
                <div key={key}>
                  <dt className="text-ink-500 text-xs">{key}</dt>
                  <dd className="text-ink-900 text-sm">{String(value)}</dd>
                </div>
              ))}
            </dl>
          )}

          {mayVerify && (
            <div className="border-ink-200 flex flex-wrap gap-2 border-t pt-3">
              <Button onClick={() => setDeciding('VERIFY')}>Verify</Button>
              {/* Query is what makes this two-way rather than write-only. */}
              <Button variant="secondary" onClick={() => setDeciding('QUERY')}>
                Query
              </Button>
              <Button variant="danger" onClick={() => setDeciding('REJECT')}>
                Reject
              </Button>
            </div>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card title="Details">
            <dl className="grid gap-2 text-sm">
              <Fact label="Venue" value={record.isVirtual ? 'Online' : record.venue} />
              <Fact label="Members present" value={record.attendanceMembers?.toString() ?? null} />
              <Fact label="Guests" value={record.attendanceGuests?.toString() ?? null} />
              <Fact label="People reached" value={record.beneficiariesCount?.toString() ?? null} />
              <Fact label="Funds raised" value={record.fundsRaised} />
              <Fact label="Trees planted" value={record.treesPlanted?.toString() ?? null} />
            </dl>
          </Card>

          {partners.data && partners.data.data.length > 0 && (
            <Card title="Partners">
              <ul className="flex flex-col gap-2 text-sm">
                {partners.data.data.map((partner) => (
                  <li key={partner.id} className="flex items-center justify-between gap-2">
                    <span>{partner.partnerOrgName ?? partner.partnerType}</span>
                    {/* International service is DERIVED from the country, never declared. */}
                    {partner.isInternational && <Badge tone="info">International</Badge>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <Card title="Photographs" className="lg:col-span-3">
          {media.isPending ? (
            <SkeletonList rows={1} />
          ) : (media.data?.data.length ?? 0) === 0 ? (
            <EmptyState title="No photographs" />
          ) : (
            <ul className="flex flex-wrap gap-3">
              {(media.data?.data ?? []).map((item) => (
                <li key={item.id}>
                  {item.isProcessed ? (
                    <a href={item.url ?? '#'} target="_blank" rel="noreferrer">
                      <img
                        src={item.thumbUrl ?? item.url ?? ''}
                        alt={item.caption ?? ''}
                        className="border-ink-200 h-28 w-28 rounded-lg border object-cover"
                      />
                    </a>
                  ) : (
                    // Not processed yet: a placeholder rather than a broken image, which is
                    // what "eventually consistent" has to look like to somebody who does
                    // not know that phrase.
                    <div className="border-ink-200 bg-ink-50 text-ink-400 flex h-28 w-28 items-center justify-center rounded-lg border text-xs">
                      Processing…
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {deciding && (
        <VerifyDialog activityId={id} decision={deciding} onClose={() => setDeciding(null)} />
      )}
    </>
  );
}

function VerifyDialog({
  activityId,
  decision,
  onClose,
}: {
  activityId: string;
  decision: 'VERIFY' | 'QUERY' | 'REJECT';
  onClose: () => void;
}) {
  const [comment, setComment] = useState('');

  const verify = useApiMutation(
    async () => api.post(`/activities/${activityId}/verify`, { decision, comment: comment.trim() }),
    { invalidate: [queryKeys.activities], successMessage: 'Recorded' },
  );

  const needsComment = decision !== 'VERIFY';

  return (
    <Dialog
      isOpen
      title={decision === 'VERIFY' ? 'Verify' : decision === 'QUERY' ? 'Query' : 'Reject'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            isLoading={verify.isPending}
            disabled={needsComment && comment.trim().length === 0}
            onClick={() => verify.mutate(undefined, { onSuccess: onClose })}
          >
            Confirm
          </Button>
        </>
      }
    >
      <Input
        label="Comment"
        value={comment}
        hint={
          needsComment
            ? 'Required. A refusal with no reason is one the club cannot act on.'
            : 'Optional.'
        }
        onChange={(event) => setComment(event.target.value)}
      />
    </Dialog>
  );
}

export function ActivityCalendarPage() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));

  const calendar = useList<CalendarResponse>(
    [...queryKeys.activities, 'calendar', month],
    '/activities/calendar',
    { month },
  );

  return (
    <>
      <PageHeader title="Calendar" description="A month at a time, for planning." />

      <Card>
        <div className="mb-3 max-w-xs">
          <Input
            label="Month"
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
        </div>

        {calendar.isPending ? (
          <SkeletonList rows={4} />
        ) : calendar.isError ? (
          <ErrorState error={calendar.error} onRetry={() => void calendar.refetch()} />
        ) : calendar.data.data.length === 0 ? (
          <EmptyState title="Nothing this month" />
        ) : (
          <ul className="flex flex-col gap-3">
            {calendar.data.data.map((day) => (
              <li key={day.date}>
                <h3 className="text-ink-700 mb-1 text-sm font-semibold">{day.date}</h3>
                <ul className="flex flex-col gap-1">
                  {day.activities.map((entry) => (
                    <li key={entry.id}>
                      <Link
                        to={`/activities/${entry.id}`}
                        className={cx(
                          'border-ink-200 hover:bg-ink-50 flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm',
                        )}
                      >
                        <span className="min-w-0">
                          <span className="text-ink-900 font-medium">{entry.title}</span>
                          <span className="text-ink-500 block text-xs">
                            {entry.activityTypeName}
                            {entry.hostName ? ` · ${entry.hostName}` : ''}
                          </span>
                        </span>
                        <Badge tone={VERIFICATION_TONES[entry.verification] ?? 'neutral'}>
                          {entry.verification}
                        </Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-500">{label}</dt>
      <dd className="text-ink-900 text-right">{value ?? '—'}</dd>
    </div>
  );
}
