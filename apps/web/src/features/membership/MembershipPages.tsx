import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
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
import { queryKeys, useApiMutation, useList } from '../../lib/queries';
import { useAuth } from '../auth/useAuth';
import type {
  MembershipEvent,
  MembershipEventListResponse,
  MembershipStatsResponse,
  RosterEntry,
  RosterListResponse,
  Transition,
  TransitionListResponse,
} from './types';

/**
 * The membership screens: a club's roster, its history, its statistics, and the transitions
 * to Rotary waiting to be corroborated.
 *
 * Contact details appear only where the member's own visibility allows, because the person
 * inside every row here went through the one serialiser. Nothing on this screen decides that.
 */

// ─── Roster ──────────────────────────────────────────────────────────────────

export function ClubRosterPanel({ clubId }: { clubId: string }) {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [asOf, setAsOf] = useState('');
  const { permissions } = useAuth();

  const roster = useList<RosterListResponse>(
    [...queryKeys.membership, 'roster', clubId],
    '/membership/roster',
    { clubId, page, q: q || undefined, asOf: asOf || undefined },
  );

  const columns = [
    {
      key: 'name',
      header: 'Member',
      render: (entry: RosterEntry) => (
        <div className="min-w-0">
          <p className="text-text-primary font-medium">
            {entry.person.firstName} {entry.person.lastName}
          </p>
          {/* Absent, not empty — the serialiser leaves out what the caller may not see. */}
          {entry.person.email && <p className="text-text-muted text-meta">{entry.person.email}</p>}
          {entry.person.phone && <p className="text-text-muted text-meta">{entry.person.phone}</p>}
          {entry.person.isRedacted && !entry.person.email && !entry.person.phone && (
            <p className="text-text-muted text-meta">Contact details are private</p>
          )}
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      render: (entry: RosterEntry) => (
        <Badge tone={entry.memberCategory === 'ACTIVE' ? 'success' : 'neutral'}>
          {entry.memberCategory}
        </Badge>
      ),
    },
    { key: 'since', header: 'Member since', render: (entry: RosterEntry) => entry.since },
  ];

  return (
    <Card
      title="Members"
      actions={
        permissions.has('membership:write:club') ? (
          <Link to={`/membership/record?clubId=${clubId}`}>
            <Button>Record an event</Button>
          </Link>
        ) : null
      }
    >
      <div className="mb-3 grid gap-3 sm:grid-cols-2">
        <Input
          label="Search"
          placeholder="Name"
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
            setPage(1);
          }}
        />
        <Input
          label="As at"
          type="date"
          hint="Reconstructed from the event log — who the club was on that date."
          value={asOf}
          onChange={(event) => {
            setAsOf(event.target.value);
            setPage(1);
          }}
        />
      </div>

      {roster.isPending ? (
        <SkeletonList rows={5} />
      ) : roster.isError ? (
        <ErrorState error={roster.error} onRetry={() => void roster.refetch()} />
      ) : (
        <>
          <Table
            columns={columns}
            rows={roster.data.data}
            rowKey={(entry) => `${entry.personId}:${entry.clubId}`}
            emptyState={
              <EmptyState
                title="No members yet"
                description="The roster is derived from the membership event log. Record an induction to start it."
              />
            }
          />
          <Pagination
            page={roster.data.meta.page}
            pageSize={roster.data.meta.pageSize}
            total={roster.data.meta.total}
            onPageChange={setPage}
          />
        </>
      )}
    </Card>
  );
}

// ─── History ─────────────────────────────────────────────────────────────────

const TYPE_TONES: Record<string, 'success' | 'danger' | 'warning' | 'neutral' | 'info'> = {
  JOIN: 'success',
  INDUCT: 'success',
  TRANSFER_IN: 'success',
  REINSTATE: 'success',
  TRANSFER_OUT: 'warning',
  TERMINATE: 'danger',
  TRANSITION_TO_ROTARY: 'info',
  CATEGORY_CHANGE: 'neutral',
  CORRECTION: 'neutral',
};

/**
 * The event log for one club, with corrections shown LINKED to what they supersede.
 *
 * A history that showed corrections as separate rows would be a history that reads as though
 * the club did the thing twice — which is exactly the confusion an append-only log creates
 * if the relationship is not drawn.
 */
export function MembershipHistoryPage() {
  const { id: clubId = '' } = useParams();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [eventType, setEventType] = useState('');
  const [correcting, setCorrecting] = useState<MembershipEvent | null>(null);
  const { permissions } = useAuth();

  const events = useList<MembershipEventListResponse>(
    [...queryKeys.membership, 'events', clubId],
    '/membership/events',
    { clubId, page, eventType: eventType || undefined },
  );

  const byId = new Map((events.data?.data ?? []).map((event) => [event.id, event]));

  return (
    <>
      <PageHeader
        title="Membership history"
        description="Append-only. A correction is a new event pointing at the one it replaces; the original stays."
        action={
          <Button variant="secondary" onClick={() => navigate(`/clubs/${clubId}`)}>
            Back to club
          </Button>
        }
      />

      <Card>
        <div className="mb-3 max-w-xs">
          <Select
            label="Event type"
            value={eventType}
            placeholder="All events"
            options={Object.keys(TYPE_TONES).map((type) => ({ value: type, label: type }))}
            onChange={(event) => {
              setEventType(event.target.value);
              setPage(1);
            }}
          />
        </div>

        {events.isPending ? (
          <SkeletonList rows={5} />
        ) : events.isError ? (
          <ErrorState error={events.error} onRetry={() => void events.refetch()} />
        ) : events.data.data.length === 0 ? (
          <EmptyState title="Nothing recorded yet" />
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {events.data.data.map((event) => (
                <li
                  key={event.id}
                  className={[
                    'border-border-subtle rounded-lg border p-3',
                    event.isSuperseded ? 'bg-surface-sunken opacity-70' : '',
                  ].join(' ')}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-text-primary font-medium">
                        {event.person.firstName} {event.person.lastName}
                      </p>
                      <p className="text-text-muted text-meta">
                        {event.effectiveOn}
                        {event.reasonCode ? ` · ${event.reasonCode}` : ''}
                        {event.counterpartyClubName ? ` · ${event.counterpartyClubName}` : ''}
                        {event.rotaryClubName ? ` · ${event.rotaryClubName}` : ''}
                      </p>
                      {event.reasonNote && (
                        <p className="text-text-secondary mt-1 text-meta">{event.reasonNote}</p>
                      )}
                      {event.supersedesEventId && (
                        <p className="text-text-muted mt-1 text-meta">
                          Corrects{' '}
                          {byId.get(event.supersedesEventId)
                            ? `the ${byId.get(event.supersedesEventId)?.eventType} of ${byId.get(event.supersedesEventId)?.effectiveOn}`
                            : 'an earlier event'}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={TYPE_TONES[event.eventType] ?? 'neutral'}>
                        {event.eventType}
                      </Badge>
                      {event.isSuperseded && <Badge tone="warning">Corrected</Badge>}
                      {!event.isSuperseded && permissions.has('membership:write:club') && (
                        <Button variant="ghost" onClick={() => setCorrecting(event)}>
                          Correct
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <Pagination
              page={events.data.meta.page}
              pageSize={events.data.meta.pageSize}
              total={events.data.meta.total}
              onPageChange={setPage}
            />
          </>
        )}
      </Card>

      {correcting && (
        <CorrectDialog event={correcting} onClose={() => setCorrecting(null)} clubId={clubId} />
      )}
    </>
  );
}

/**
 * Correcting an event, in the two shapes the log supports.
 *
 * Retract ("this never happened") or replace ("this happened, but differently"). Naming both
 * on the same dialog is what stops a secretary reaching for whichever one is on screen.
 */
function CorrectDialog({
  event,
  clubId,
  onClose,
}: {
  event: MembershipEvent;
  clubId: string;
  onClose: () => void;
}) {
  const [shape, setShape] = useState<'RETRACT' | 'REPLACE'>('RETRACT');
  const [effectiveOn, setEffectiveOn] = useState(event.effectiveOn);
  const [note, setNote] = useState('');

  const correct = useApiMutation(
    async (body: Record<string, unknown>) =>
      api.post(`/membership/events/${event.id}/correct`, body),
    {
      invalidate: [queryKeys.membership, queryKeys.clubs],
      successMessage: 'Correction recorded',
    },
  );

  return (
    <Dialog
      isOpen
      title="Correct this event"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            isLoading={correct.isPending}
            disabled={note.trim().length === 0}
            onClick={() =>
              correct.mutate(
                shape === 'RETRACT'
                  ? { eventType: 'CORRECTION', reasonNote: note.trim() }
                  : { eventType: event.eventType, effectiveOn, reasonNote: note.trim() },
                { onSuccess: onClose },
              )
            }
          >
            Record correction
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-text-secondary text-table">
          {event.eventType} for {event.person.firstName} {event.person.lastName} on{' '}
          {event.effectiveOn}. The original stays in the log; this adds an event pointing at it.
        </p>

        <Select
          label="What kind of correction?"
          value={shape}
          options={[
            { value: 'RETRACT', label: 'This never happened' },
            { value: 'REPLACE', label: 'It happened, but the details were wrong' },
          ]}
          onChange={(changed) => setShape(changed.target.value as 'RETRACT' | 'REPLACE')}
        />

        {shape === 'REPLACE' && (
          <Input
            label="Correct date"
            type="date"
            value={effectiveOn}
            onChange={(changed) => setEffectiveOn(changed.target.value)}
          />
        )}

        <Input
          label="Why"
          required
          value={note}
          hint="Required. An unexplained correction to an append-only log is what a dispute turns on."
          onChange={(changed) => setNote(changed.target.value)}
        />
      </div>
      <input type="hidden" value={clubId} readOnly />
    </Dialog>
  );
}

// ─── Statistics ──────────────────────────────────────────────────────────────

export function MembershipStatsPanel({ clubId }: { clubId?: string }) {
  const stats = useList<MembershipStatsResponse>(
    [...queryKeys.membership, 'stats', clubId ?? 'district'],
    '/membership/stats',
    clubId ? { clubId } : undefined,
  );

  if (stats.isPending) return <SkeletonList rows={2} />;
  if (stats.isError) {
    return <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />;
  }

  const data = stats.data.data;

  return (
    <Card title={`Membership, ${data.from} to ${data.to}`}>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Figure label="Opening" value={String(data.opening)} />
        <Figure label="Joiners" value={`+${data.joiners}`} tone="success" />
        <Figure label="Leavers" value={`−${data.leavers}`} tone="danger" />
        <Figure
          label="Net"
          value={data.netChange >= 0 ? `+${data.netChange}` : String(data.netChange)}
          tone={data.netChange >= 0 ? 'success' : 'danger'}
        />
        <Figure label="Closing" value={String(data.closing)} />
        <Figure
          label="Retention"
          // Null rather than 0%: a club chartered in October has no opening roster to
          // retain, and reporting 0% would read as having lost everybody.
          value={data.retentionRate === null ? '—' : `${data.retentionRate}%`}
        />
      </dl>

      {data.byReason.length > 0 && (
        <div className="mt-4">
          <h3 className="text-text-secondary mb-2 text-table font-semibold">Why members left</h3>
          <ul className="flex flex-wrap gap-2">
            {data.byReason.map((reason) => (
              <li key={reason.reasonCode}>
                <Badge>
                  {reason.reasonCode}: {reason.count}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.transitionsToRotary > 0 && (
        <p className="text-text-secondary mt-4 text-table">
          {data.transitionsToRotary} member{data.transitionsToRotary === 1 ? '' : 's'} moved on to
          Rotary.
        </p>
      )}
    </Card>
  );
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'success' | 'danger';
}) {
  return (
    <div>
      <dt className="text-text-muted text-meta">{label}</dt>
      <dd
        className={[
          'text-section font-semibold',
          tone === 'success'
            ? 'text-success-text'
            : tone === 'danger'
              ? 'text-danger-text'
              : 'text-text-primary',
        ].join(' ')}
      >
        {value}
      </dd>
    </div>
  );
}

// ─── Transitions ─────────────────────────────────────────────────────────────

export function TransitionsPage() {
  const [page, setPage] = useState(1);
  const [corroborated, setCorroborated] = useState('');
  const { permissions } = useAuth();

  const transitions = useList<TransitionListResponse>(
    [...queryKeys.membership, 'transitions'],
    '/membership/transitions',
    { page, corroborated: corroborated || undefined },
  );

  const corroborate = useApiMutation(
    async (id: string) => api.post(`/membership/transitions/${id}/corroborate`),
    { invalidate: [queryKeys.membership], successMessage: 'Corroborated' },
  );

  const columns = [
    {
      key: 'person',
      header: 'Member',
      render: (row: Transition) => (
        <div>
          <p className="text-text-primary font-medium">{row.personName}</p>
          <p className="text-text-muted text-meta">{row.clubName}</p>
        </div>
      ),
    },
    {
      key: 'rotary',
      header: 'Rotary club',
      render: (row: Transition) => row.rotaryClubName ?? '—',
    },
    { key: 'date', header: 'Effective', render: (row: Transition) => row.effectiveOn },
    {
      key: 'state',
      header: 'Corroborated',
      render: (row: Transition) =>
        row.corroboratedAt ? (
          <Badge tone="success">Yes</Badge>
        ) : permissions.has('membership:write:club') ? (
          <Button variant="ghost" onClick={() => corroborate.mutate(row.id)}>
            Corroborate
          </Button>
        ) : (
          <Badge tone="warning">Awaiting</Badge>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Transitions to Rotary"
        description="The district's most contested figure. A transition nobody corroborated is one the district has only the club's word for."
      />

      <Card>
        <div className="mb-3 max-w-xs">
          <Select
            label="State"
            value={corroborated}
            placeholder="All"
            options={[
              { value: 'false', label: 'Awaiting corroboration' },
              { value: 'true', label: 'Corroborated' },
            ]}
            onChange={(event) => {
              setCorroborated(event.target.value);
              setPage(1);
            }}
          />
        </div>

        {transitions.isPending ? (
          <SkeletonList rows={4} />
        ) : transitions.isError ? (
          <ErrorState error={transitions.error} onRetry={() => void transitions.refetch()} />
        ) : (
          <>
            <Table
              columns={columns}
              rows={transitions.data.data}
              rowKey={(row) => row.id}
              emptyState={<EmptyState title="No transitions recorded" />}
            />
            <Pagination
              page={transitions.data.meta.page}
              pageSize={transitions.data.meta.pageSize}
              total={transitions.data.meta.total}
              onPageChange={setPage}
            />
          </>
        )}
      </Card>
    </>
  );
}
