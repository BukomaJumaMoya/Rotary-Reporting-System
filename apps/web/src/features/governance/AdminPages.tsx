import { useState } from 'react';
import type {
  AuditListResponse,
  InvitationBatchResponse,
  InvitationListResponse,
  PersonListResponse,
  RolloverReport,
  SingleOf,
} from './types';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Pagination,
  SkeletonList,
  Table,
} from '../../components/ui';
import {
  FilterBar,
  FilterTabs,
  ListGroup,
  ListRow,
  PageLayout,
  SectionHeading,
  StatGrid,
} from '../../components/ui/page';
import { api } from '../../lib/api';
import { queryKeys, useApiMutation, useList } from '../../lib/queries';
import { useToast } from '../../lib/toast';

// ─── Invitations ─────────────────────────────────────────────────────────────

/**
 * Outstanding invitations, and bulk invitation from the roster.
 *
 * The batch reports PER PERSON, so the screen shows which of the forty worked rather
 * than a single failure that leaves the secretary guessing.
 */
export function InvitationsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastBatch, setLastBatch] = useState<InvitationBatchResponse['data'] | null>(null);
  const toast = useToast();

  const invitations = useList<InvitationListResponse>(queryKeys.invitations, '/invitations', {
    page,
    pageSize: 25,
  });
  const persons = useList<PersonListResponse>(queryKeys.persons, '/persons', {
    pageSize: 25,
    ...(search.length >= 2 ? { q: search } : {}),
  });

  const invite = useApiMutation(
    (personIds: string[]) => api.post<InvitationBatchResponse>('/invitations', { personIds }),
    { invalidate: [queryKeys.invitations] },
  );

  const resend = useApiMutation((id: string) => api.post(`/invitations/${id}/resend`), {
    invalidate: [queryKeys.invitations],
    successMessage: 'A new link is on its way',
  });

  const toggle = (personId: string, isOn: boolean) => {
    const next = new Set(selected);
    if (isOn) next.add(personId);
    else next.delete(personId);
    setSelected(next);
  };

  if (invitations.isPending) return <SkeletonList rows={4} />;
  if (invitations.isError) {
    return <ErrorState error={invitations.error} onRetry={() => void invitations.refetch()} />;
  }

  return (
    <>
      <PageHeader
        title="Invitations"
        description="An account is created by invitation. Club-scoped inviters reach their own roster and nobody else's."
      />

      <div className="flex flex-col gap-4">
        <Card title="Invite from the roster">
          <Input
            label="Find members"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            hint="Type at least two letters of a name."
          />

          <div className="border-border-subtle mt-3 max-h-64 overflow-y-auto rounded-lg border p-1">
            {persons.isPending ? (
              <SkeletonList rows={3} />
            ) : persons.data && persons.data.data.length > 0 ? (
              persons.data.data.map((person) => (
                <Checkbox
                  key={person.id}
                  label={`${person.firstName} ${person.lastName}`}
                  description={person.clubs?.[0]?.name}
                  checked={selected.has(person.id)}
                  onChange={(isOn) => toggle(person.id, isOn)}
                />
              ))
            ) : (
              <EmptyState title="Nobody matched" />
            )}
          </div>

          <Button
            className="mt-3"
            isLoading={invite.isPending}
            disabled={selected.size === 0}
            onClick={() =>
              invite.mutate([...selected], {
                onSuccess: (result) => {
                  setLastBatch(result.data);
                  setSelected(new Set());
                  toast.success(`${result.data.sent} sent, ${result.data.failed} failed`);
                },
              })
            }
          >
            Invite {selected.size > 0 ? `${selected.size} ` : ''}selected
          </Button>

          {lastBatch && lastBatch.results.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1 text-table">
              {lastBatch.results.map((result) => (
                <li key={result.personId} className="flex items-center gap-2">
                  <Badge tone={result.status === 'SENT' ? 'success' : 'danger'}>
                    {result.status}
                  </Badge>
                  <span className="text-text-muted font-mono text-meta">
                    {result.reason ?? 'invitation sent'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <section>
          <SectionHeading title="Outstanding" count={invitations.data.meta.total} />

          {invitations.data.data.length === 0 ? (
            <EmptyState
              title="Nothing outstanding"
              description="Everybody invited has accepted, or nobody has been invited yet."
            />
          ) : (
            <ListGroup>
              {invitations.data.data.map((row) => (
                <ListRow
                  key={row.id}
                  title={row.personName}
                  meta={[
                    row.email,
                    `Issued ${row.issuedAt.slice(0, 10)}`,
                    // An unexpired date is worth stating; an expired one is a badge, because
                    // it is the only fact on the row anybody needs to act on.
                    !row.isExpired && `Expires ${row.expiresAt.slice(0, 10)}`,
                  ]}
                  badges={row.isExpired ? <Badge tone="danger">expired</Badge> : null}
                  trailing={
                    <Button
                      variant="secondary"
                      size="sm"
                      isLoading={resend.isPending && resend.variables === row.id}
                      onClick={() => resend.mutate(row.id)}
                    >
                      Resend
                    </Button>
                  }
                />
              ))}
            </ListGroup>
          )}

          <Pagination
            page={invitations.data.meta.page}
            pageSize={invitations.data.meta.pageSize}
            total={invitations.data.meta.total}
            onPageChange={setPage}
          />
        </section>
      </div>
    </>
  );
}

// ─── Audit ───────────────────────────────────────────────────────────────────

const ACTIONS = ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'EXPORT'] as const;

/**
 * The audit log, rendered as field / before / after rows.
 *
 * Never raw JSON: a diff a district officer cannot read is a diff nobody checks. Contact
 * values arrive already redacted by the server, and the screen SAYS so rather than
 * showing an empty cell that looks like a bug.
 */
export function AuditPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [from, setFrom] = useState('');

  const audit = useList<AuditListResponse>(queryKeys.audit, '/audit', {
    page,
    pageSize: 25,
    ...(action ? { action } : {}),
    ...(entityType ? { entityType } : {}),
    ...(from ? { from } : {}),
  });

  if (audit.isPending) return <SkeletonList rows={5} />;
  if (audit.isError) return <ErrorState error={audit.error} onRetry={() => void audit.refetch()} />;

  return (
    <PageLayout>
      <PageHeader
        title="Audit log"
        description="Append-only, retained indefinitely. This is what makes a contested award reconstructable."
      />

      {/*
        Action is the facet somebody actually reaches for — "show me the deletions" — so it is
        a visible control. Entity type and date are typed rarely and stay fields.
      */}
      <FilterBar>
        <FilterTabs
          value={action}
          onChange={(next) => {
            setAction(next);
            setPage(1);
          }}
          options={[
            { value: '', label: 'All' },
            ...ACTIONS.map((value) => ({ value, label: value.toLowerCase() })),
          ]}
        />
        <input
          type="search"
          value={entityType}
          onChange={(event) => {
            setEntityType(event.target.value);
            setPage(1);
          }}
          placeholder="Entity type, e.g. clubs"
          aria-label="Filter by entity type"
          className="border-border bg-surface text-text-primary placeholder:text-text-muted min-h-10 rounded-md border px-3"
        />
        <label className="text-text-muted text-label flex items-center gap-2">
          <span className="shrink-0">From</span>
          <input
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              setPage(1);
            }}
            className="border-border bg-surface text-text-primary min-h-10 rounded-md border px-3"
          />
        </label>
      </FilterBar>

      {audit.data.data.length === 0 ? (
        <EmptyState
          filtered={Boolean(action || entityType || from)}
          onClearFilters={() => {
            setAction('');
            setEntityType('');
            setFrom('');
            setPage(1);
          }}
          title="Nothing recorded yet"
          description="Every change to a governed entity is captured automatically. An empty log means nothing has been changed, not that nothing was watched."
        />
      ) : (
        <ul className="divide-border-subtle border-border-subtle bg-surface divide-y overflow-hidden rounded-lg border shadow-[var(--shadow-sm)]">
          {audit.data.data.map((entry) => (
            <li key={entry.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge tone={entry.action === 'DELETE' ? 'danger' : 'info'}>
                    {entry.action.toLowerCase()}
                  </Badge>
                  <span className="text-body font-medium">{entry.entityType}</span>
                </div>
                <span className="text-text-muted text-meta">
                  {entry.actorName ?? 'system'} · {entry.occurredAt.replace('T', ' ').slice(0, 16)}
                </span>
              </div>

              {entry.changes.length > 0 && (
                <table className="text-meta mt-3 w-full text-left">
                  <thead className="text-text-muted">
                    <tr className="border-border-strong border-b">
                      <th className="py-1 pr-4 font-medium">Field</th>
                      <th className="py-1 pr-4 font-medium">Before</th>
                      <th className="py-1 font-medium">After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entry.changes.map((change) => (
                      <tr
                        key={change.field}
                        className="border-border-subtle border-b last:border-0"
                      >
                        <td className="py-1.5 pr-4 font-mono">{change.field}</td>
                        {change.isRedacted ? (
                          // The field name survives so the log still says WHAT changed;
                          // saying "redacted" beats an empty cell that reads as a bug.
                          <td colSpan={2} className="text-text-muted py-1.5 italic">
                            redacted — contact detail
                          </td>
                        ) : (
                          <>
                            <td className="text-text-muted py-1.5 pr-4">{change.before ?? '—'}</td>
                            <td className="py-1.5">{change.after ?? '—'}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </li>
          ))}
        </ul>
      )}

      <Pagination
        page={audit.data.meta.page}
        pageSize={audit.data.meta.pageSize}
        total={audit.data.meta.total}
        onPageChange={setPage}
      />
    </PageLayout>
  );
}

export function RolloverPage() {
  const [targetYearLabel, setTargetYearLabel] = useState('');
  const [report, setReport] = useState<RolloverReport | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [isCommitted, setIsCommitted] = useState(false);
  const toast = useToast();

  const run = useApiMutation(
    (input: { dryRun: boolean; confirmToken?: string }) =>
      api.post<SingleOf<RolloverReport>>('/admin/rollover', {
        targetYearLabel,
        dryRun: input.dryRun,
        ...(input.confirmToken ? { confirmToken: input.confirmToken } : {}),
      }),
    { invalidate: [queryKeys.appointments, queryKeys.positions] },
  );

  return (
    <PageLayout>
      <PageHeader
        title="Rotary Year rollover"
        description="Runs once a year and touches every club and every appointment. Dry run first, always."
      />

      <div className="flex flex-col gap-4">
        <Card title="1 — Dry run">
          <div className="flex flex-wrap items-end gap-3">
            <div className="max-w-40">
              <Input
                label="Roll over to"
                value={targetYearLabel}
                placeholder="2028-29"
                onChange={(event) => {
                  setTargetYearLabel(event.target.value);
                  setReport(null);
                  setIsCommitted(false);
                }}
              />
            </div>
            <Button
              isLoading={run.isPending}
              disabled={!/^\d{4}-\d{2}$/.test(targetYearLabel)}
              onClick={() =>
                run.mutate(
                  { dryRun: true },
                  {
                    onSuccess: (result) => {
                      setReport(result.data);
                      setConfirmation('');
                      setIsCommitted(false);
                      toast.success('Dry run complete — nothing was changed');
                    },
                  },
                )
              }
            >
              Run a dry run
            </Button>
          </div>
          <p className="text-text-muted mt-2 text-table">
            Everything runs inside a transaction and is then rolled back, so the report below
            describes work that actually executed rather than work that was predicted.
          </p>
        </Card>

        {report && (
          <>
            <Card title="2 — The diff">
              <div className="mb-4">
                <StatGrid
                  stats={[
                    { label: 'Clubs carried forward', value: report.clubsCarriedForward },
                    { label: 'Appointments expiring', value: report.appointmentsExpired },
                    { label: 'Tier changes', value: report.tierChanges.length },
                    {
                      label: 'Clubs flagged',
                      value: report.flaggedClubs.length,
                      // The only figure here that is a PROBLEM rather than a fact. A flagged
                      // club is one the rollover could not carry forward cleanly.
                      tone: report.flaggedClubs.length > 0 ? 'warning' : 'default',
                    },
                  ]}
                />
              </div>

              {report.tierChanges.length > 0 && (
                <div className="mb-4">
                  <h3 className="mb-2 text-table font-semibold">Tier changes</h3>
                  <Table
                    columns={[
                      { key: 'club', header: 'Club', render: (row) => row.clubName },
                      {
                        key: 'change',
                        header: 'Tier',
                        render: (row) => (
                          <span>
                            {row.from} → <strong>{row.to}</strong>
                          </span>
                        ),
                      },
                      { key: 'roster', header: 'Closing roster', render: (row) => row.rosterSize },
                    ]}
                    rows={report.tierChanges}
                    rowKey={(row) => row.clubId}
                  />
                </div>
              )}

              {report.flaggedClubs.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-danger-text mb-2 text-table font-semibold">
                    Look at these before confirming
                  </h3>
                  <ul className="text-table">
                    {report.flaggedClubs.map((club) => (
                      <li key={club.clubId} className="flex items-center gap-2 py-1">
                        <Badge tone="warning">{club.reason}</Badge>
                        {club.clubName}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {report.expiringByPosition.length > 0 && (
                <div>
                  <h3 className="mb-2 text-table font-semibold">
                    Appointments expiring, by position
                  </h3>
                  <ul className="flex flex-wrap gap-2 text-table">
                    {report.expiringByPosition.map((entry) => (
                      <li key={entry.position}>
                        <Badge>
                          {entry.position} × {entry.count}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>

            {!isCommitted && (
              <Card title="3 — Commit">
                <p className="text-text-secondary mb-3 text-table">
                  This locks {report.fromYearLabel}, expires every appointment in it, and opens{' '}
                  {report.toYearLabel}. It cannot be undone. Type{' '}
                  <strong>{report.toYearLabel}</strong> to confirm.
                </p>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="max-w-40">
                    <Input
                      label="Target year"
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                    />
                  </div>
                  <Button
                    variant="danger"
                    isLoading={run.isPending}
                    disabled={confirmation !== report.toYearLabel || !report.confirmToken}
                    onClick={() =>
                      run.mutate(
                        { dryRun: false, confirmToken: report.confirmToken ?? undefined },
                        {
                          onSuccess: () => {
                            setIsCommitted(true);
                            toast.success(`Rolled over to ${report.toYearLabel}`);
                          },
                        },
                      )
                    }
                  >
                    Roll over
                  </Button>
                </div>
                <p className="text-text-muted mt-2 text-meta">
                  The confirmation expires thirty minutes after the dry run. After that, run it
                  again and read the diff again.
                </p>
              </Card>
            )}

            {isCommitted && (
              <Card>
                <EmptyState
                  title={`${report.toYearLabel} is now the current Rotary Year`}
                  description="Every appointment from the previous year has expired. The next task is appointing the new slate."
                />
              </Card>
            )}
          </>
        )}
      </div>
    </PageLayout>
  );
}
