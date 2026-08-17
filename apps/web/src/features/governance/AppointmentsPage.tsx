import { useState } from 'react';
import type {
  AppointmentListResponse,
  CommitteeTreeResponse,
  PersonListResponse,
  PositionListResponse,
} from './types';
import { Can } from '../../components/Can';
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

/**
 * Appointments.
 *
 * The unit of authorisation, and therefore the screen that actually grants access. The
 * create flow follows the data model: choose a person, choose a position, and then choose
 * a scope OF THE KIND THAT POSITION IS DEFINED AT — which is why the scope picker changes
 * shape rather than offering everything.
 */
export function AppointmentsPage() {
  const [page, setPage] = useState(1);
  const [positionId, setPositionId] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const appointments = useList<AppointmentListResponse>(queryKeys.appointments, '/appointments', {
    page,
    pageSize: 25,
    ...(positionId ? { positionId } : {}),
  });
  const positions = useList<PositionListResponse>(queryKeys.positions, '/positions', {
    pageSize: 100,
  });

  const revoke = useApiMutation((id: string) => api.delete(`/appointments/${id}`), {
    invalidate: [queryKeys.appointments],
    successMessage: 'Appointment revoked',
  });

  if (appointments.isPending) return <SkeletonList rows={5} />;
  if (appointments.isError) {
    return <ErrorState error={appointments.error} onRetry={() => void appointments.refetch()} />;
  }

  return (
    <>
      <PageHeader
        title="Appointments"
        description="Nobody has a role. People hold appointments, and access resolves through them every request."
        action={
          <Can permission="appointment:manage:district">
            <Button onClick={() => setIsCreating(true)}>New appointment</Button>
          </Can>
        }
      />

      <Card>
        <div className="mb-3 max-w-sm">
          <Select
            label="Position"
            value={positionId}
            placeholder="Every position"
            options={(positions.data?.data ?? []).map((position) => ({
              value: position.id,
              label: position.name,
            }))}
            onChange={(event) => {
              setPositionId(event.target.value);
              setPage(1);
            }}
          />
        </div>

        <Table
          columns={[
            { key: 'person', header: 'Person', render: (row) => row.personName },
            {
              key: 'position',
              header: 'Position',
              render: (row) => (
                <div>
                  <p>{row.positionName}</p>
                  <p className="text-text-muted text-meta">{row.scopeName ?? row.scopeType}</p>
                </div>
              ),
            },
            {
              key: 'term',
              header: 'Term',
              render: (row) => (
                <span className="text-meta">
                  {row.startsOn} → {row.endsOn ?? 'open'}
                </span>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (row) =>
                !row.isActive ? (
                  <Badge>Revoked</Badge>
                ) : row.isCurrent ? (
                  <Badge tone="success">In force</Badge>
                ) : (
                  // Active but not yet in force. Showing one number for both would be a
                  // lie for as long as the gap lasts.
                  <Badge tone="warning">Not yet started</Badge>
                ),
            },
            {
              key: 'actions',
              header: '',
              render: (row) =>
                row.isActive ? (
                  <Can permission="appointment:manage:district">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        if (window.confirm(`Revoke ${row.personName} as ${row.positionName}?`)) {
                          revoke.mutate(row.id);
                        }
                      }}
                    >
                      Revoke
                    </Button>
                  </Can>
                ) : null,
            },
          ]}
          rows={appointments.data.data}
          rowKey={(row) => row.id}
          emptyState={<EmptyState title="No appointments" description="Nobody holds office yet." />}
        />

        <Pagination
          page={appointments.data.meta.page}
          pageSize={appointments.data.meta.pageSize}
          total={appointments.data.meta.total}
          onPageChange={setPage}
        />
      </Card>

      {isCreating && <CreateAppointmentDialog onClose={() => setIsCreating(false)} />}
    </>
  );
}

function CreateAppointmentDialog({ onClose }: { onClose: () => void }) {
  const [search, setSearch] = useState('');
  const [personId, setPersonId] = useState('');
  const [positionId, setPositionId] = useState('');
  const [scopeId, setScopeId] = useState('');
  const [startsOn, setStartsOn] = useState(new Date().toISOString().slice(0, 10));
  const [endsOn, setEndsOn] = useState('');

  const persons = useList<PersonListResponse>(queryKeys.persons, '/persons', {
    pageSize: 20,
    ...(search.length >= 2 ? { q: search } : {}),
  });
  const positions = useList<PositionListResponse>(queryKeys.positions, '/positions', {
    pageSize: 100,
    isActive: true,
  });
  const committees = useList<CommitteeTreeResponse>(queryKeys.committees, '/committees', {
    tree: true,
  });

  const position = positions.data?.data.find((candidate) => candidate.id === positionId);

  const create = useApiMutation(
    () =>
      api.post('/appointments', {
        personId,
        positionId,
        scopeType: position?.scope ?? 'CLUB',
        scopeId: position?.scope === 'DISTRICT' ? null : scopeId || null,
        startsOn,
        endsOn: endsOn || null,
      }),
    { invalidate: [queryKeys.appointments], successMessage: 'Appointment created' },
  );

  /**
   * The scope picker changes shape with the position's own scope.
   *
   * A DISTRICT position takes no scope id at all; a COMMITTEE one takes a committee. The
   * server refuses a mismatch with SCOPE_TYPE_MISMATCH, and offering the wrong list would
   * be a form that can only be filled in wrongly.
   */
  const scopeOptions = (() => {
    if (!position || position.scope === 'DISTRICT') return null;
    if (position.scope === 'COMMITTEE') {
      const flatten = (nodes: CommitteeTreeResponse['data']): { value: string; label: string }[] =>
        nodes.flatMap((node) => [
          { value: node.id, label: '— '.repeat(node.depth - 1) + node.name },
          ...flatten(node.children),
        ]);
      return flatten(committees.data?.data ?? []);
    }
    // Clubs, clusters and regions need their own endpoints, which arrive with the org
    // module in M2. Until then the id is entered directly rather than pretended at.
    return undefined;
  })();

  return (
    <Dialog
      isOpen
      onClose={onClose}
      title="New appointment"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            isLoading={create.isPending}
            disabled={!personId || !positionId}
            onClick={() => create.mutate(undefined, { onSuccess: onClose })}
          >
            Appoint
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Find a person"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          hint="Type at least two letters of a name."
        />

        <div className="border-border-subtle max-h-48 overflow-y-auto rounded-lg border">
          {persons.isPending ? (
            <SkeletonList rows={2} />
          ) : persons.data && persons.data.data.length > 0 ? (
            <ul>
              {persons.data.data.map((person) => (
                <li key={person.id}>
                  <button
                    type="button"
                    onClick={() => setPersonId(person.id)}
                    className={`flex min-h-11 w-full items-center justify-between px-3 text-left text-table ${
                      personId === person.id ? 'bg-accent-subtle text-accent-text' : ''
                    }`}
                  >
                    <span>
                      {person.firstName} {person.lastName}
                    </span>
                    <span className="text-text-muted text-meta">{person.clubs?.[0]?.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Nobody matched" />
          )}
        </div>

        <Select
          label="Position"
          value={positionId}
          placeholder="Choose a position"
          options={(positions.data?.data ?? []).map((candidate) => ({
            value: candidate.id,
            label: `${candidate.name} (${candidate.scope})`,
          }))}
          onChange={(event) => {
            setPositionId(event.target.value);
            setScopeId('');
          }}
        />

        {position && position.scope === 'DISTRICT' && (
          <p className="text-text-muted text-table">
            A district appointment names no scope — it covers the whole district.
          </p>
        )}

        {scopeOptions && (
          <Select
            label={position?.scope === 'COMMITTEE' ? 'Committee' : 'Scope'}
            value={scopeId}
            placeholder="Choose one"
            options={scopeOptions}
            onChange={(event) => setScopeId(event.target.value)}
          />
        )}

        {scopeOptions === undefined && position && (
          <Input
            label={`${position.scope.toLowerCase()} id`}
            value={scopeId}
            onChange={(event) => setScopeId(event.target.value)}
            hint="Club, cluster and region pickers arrive with the org module in M2."
          />
        )}

        <Input
          label="Term starts"
          type="date"
          value={startsOn}
          onChange={(event) => setStartsOn(event.target.value)}
        />
        <Input
          label="Term ends (optional)"
          type="date"
          value={endsOn}
          onChange={(event) => setEndsOn(event.target.value)}
          hint="Leave empty for an open-ended term. Compared against midnight in the district's timezone."
        />
      </div>
    </Dialog>
  );
}
