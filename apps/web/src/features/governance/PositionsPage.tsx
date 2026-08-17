import { useState } from 'react';
import type { Permission, PermissionListResponse, Position, PositionListResponse } from './types';
import { Can } from '../../components/Can';
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Pagination,
  Select,
  SkeletonList,
} from '../../components/ui';
import { FilterBar, FilterTabs, ListGroup, ListRow, PageLayout } from '../../components/ui/page';
import { Identifier } from '../../components/ui/document';
import { api } from '../../lib/api';
import { queryKeys, useApiMutation, useList } from '../../lib/queries';

/**
 * The positions catalogue.
 *
 * This is where "adding a new district role" stops being a release and becomes a form —
 * which is the whole point of positions being data (axiom: configuration over code).
 */

const SCOPES = ['DISTRICT', 'REGION', 'CLUSTER', 'CLUB', 'COMMITTEE'] as const;

export function PositionsPage() {
  const [page, setPage] = useState(1);
  const [scope, setScope] = useState('');
  const [editing, setEditing] = useState<Position | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [permissionsFor, setPermissionsFor] = useState<Position | null>(null);

  const positions = useList<PositionListResponse>(queryKeys.positions, '/positions', {
    page,
    pageSize: 25,
    ...(scope ? { scope } : {}),
  });

  const deactivate = useApiMutation((id: string) => api.delete(`/positions/${id}`), {
    invalidate: [queryKeys.positions],
    successMessage: 'Position deactivated',
  });

  if (positions.isPending) return <SkeletonList rows={5} />;
  if (positions.isError)
    return <ErrorState error={positions.error} onRetry={() => void positions.refetch()} />;

  return (
    <PageLayout>
      <PageHeader
        title="Positions"
        description="The roles this district can appoint people to. Adding one is a form, not a release."
        action={
          <Can permission="position:manage:district">
            <Button onClick={() => setIsCreating(true)}>New position</Button>
          </Can>
        }
      />

      <FilterBar>
        <FilterTabs
          value={scope}
          onChange={(next) => {
            setScope(next);
            setPage(1);
          }}
          options={[
            { value: '', label: 'All scopes' },
            ...SCOPES.map((value) => ({ value, label: value.toLowerCase() })),
          ]}
        />
      </FilterBar>

      {positions.data.data.length === 0 ? (
        <EmptyState
          filtered={Boolean(scope)}
          onClearFilters={() => {
            setScope('');
            setPage(1);
          }}
          title="No positions yet"
          description="A position is the role an appointment attaches to. The seeded slate covers the standard district offices."
        />
      ) : (
        <ListGroup>
          {positions.data.data.map((row) => (
            <ListRow
              key={row.id}
              title={row.name}
              meta={[
                // The code is an identifier: mono, so 0 and O are distinguishable when it is
                // read down a phone or transcribed into a spreadsheet.
                <Identifier key="code">{row.code}</Identifier>,
                `${row.permissions.length} permission${row.permissions.length === 1 ? '' : 's'}`,
                row.activeAppointments > 0 ? `held by ${row.activeAppointments}` : 'held by nobody',
              ]}
              badges={
                <>
                  <Badge tone="info">{row.scope.toLowerCase()}</Badge>
                  {row.isTemplate && <Badge>template</Badge>}
                  {/* Active is the norm; inactive is the news. */}
                  {!row.isActive && <Badge tone="warning">inactive</Badge>}
                </>
              }
              trailing={
                <Can permission="position:manage:district">
                  {row.isTemplate ? (
                    // Readable by every district, editable by none — saying so beats a
                    // button that always fails.
                    <span className="text-text-muted text-meta">Shared</span>
                  ) : (
                    <span className="flex flex-wrap justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(row)}>
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setPermissionsFor(row)}>
                        Permissions
                      </Button>
                      {row.isActive && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            // The count is on the row already, so the warning is honest
                            // rather than a guess the server will correct.
                            const held = row.activeAppointments;
                            const message =
                              held > 0
                                ? `${row.name} is held by ${held} ${held === 1 ? 'person' : 'people'}. Deactivating it will be refused.`
                                : `Deactivate ${row.name}?`;
                            if (window.confirm(message)) deactivate.mutate(row.id);
                          }}
                        >
                          Deactivate
                        </Button>
                      )}
                    </span>
                  )}
                </Can>
              }
            />
          ))}
        </ListGroup>
      )}

      <Pagination
        page={positions.data.meta.page}
        pageSize={positions.data.meta.pageSize}
        total={positions.data.meta.total}
        onPageChange={setPage}
      />

      <PositionDialog
        position={editing}
        isOpen={isCreating || editing !== null}
        onClose={() => {
          setIsCreating(false);
          setEditing(null);
        }}
      />

      <PermissionMatrixDialog position={permissionsFor} onClose={() => setPermissionsFor(null)} />
    </PageLayout>
  );
}

function PositionDialog({
  position,
  isOpen,
  onClose,
}: {
  position: Position | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [scope, setScope] = useState<string>('CLUB');
  const [isUnique, setIsUnique] = useState(false);
  const [key, setKey] = useState(0);

  // Re-seeds the form when the dialog opens on a different row, without an effect.
  if (isOpen && key !== (position ? 1 : 2)) {
    setKey(position ? 1 : 2);
    setCode(position?.code ?? '');
    setName(position?.name ?? '');
    setScope(position?.scope ?? 'CLUB');
    setIsUnique(position?.isUniquePerScope ?? false);
  }

  const save = useApiMutation(
    () =>
      position
        ? api.patch(`/positions/${position.id}`, { name, scope, isUniquePerScope: isUnique })
        : api.post('/positions', { code, name, scope, isUniquePerScope: isUnique }),
    {
      invalidate: [queryKeys.positions],
      successMessage: position ? 'Position updated' : 'Position created',
    },
  );

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={position ? `Edit ${position.name}` : 'New position'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            isLoading={save.isPending}
            onClick={() => save.mutate(undefined, { onSuccess: onClose })}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Code"
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          // Immutable after creation: the seed, the authorisation matrix and anything an
          // officer wrote down all refer to a position by it.
          disabled={position !== null}
          hint={
            position ? 'A code cannot be changed once people refer to it.' : 'e.g. CLUB_SECRETARY'
          }
        />
        <Input label="Name" value={name} onChange={(event) => setName(event.target.value)} />
        <Select
          label="Scope"
          value={scope}
          options={SCOPES.map((value) => ({ value, label: value }))}
          onChange={(event) => setScope(event.target.value)}
        />
        <Checkbox
          label="One holder per scope"
          checked={isUnique}
          onChange={setIsUnique}
          description="e.g. only one DRR per district per year. Enforced when an appointment is made."
        />
      </div>
    </Dialog>
  );
}

/**
 * The permission grid.
 *
 * Grouped by resource, because thirty codes in one flat list is a list nobody audits. The
 * whole set is sent on save — a diff computed on the client would let two editors
 * silently merge each other's work.
 */
function PermissionMatrixDialog({
  position,
  onClose,
}: {
  position: Position | null;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<string> | null>(null);

  const permissions = useList<PermissionListResponse>(queryKeys.permissions, '/permissions', {
    pageSize: 100,
  });

  const save = useApiMutation(
    (codes: string[]) =>
      api.put(`/positions/${position?.id ?? ''}/permissions`, { permissions: codes }),
    { invalidate: [queryKeys.positions], successMessage: 'Permissions replaced' },
  );

  if (!position) return null;

  const current = selected ?? new Set(position.permissions);
  const grouped = new Map<string, Permission[]>();
  for (const permission of permissions.data?.data ?? []) {
    const resource = permission.code.split(':')[0] ?? 'other';
    grouped.set(resource, [...(grouped.get(resource) ?? []), permission]);
  }

  const toggle = (code: string, isOn: boolean) => {
    const next = new Set(current);
    if (isOn) next.add(code);
    else next.delete(code);
    setSelected(next);
  };

  return (
    <Dialog
      isOpen
      onClose={() => {
        setSelected(null);
        onClose();
      }}
      title={`Permissions — ${position.name}`}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              setSelected(null);
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button
            isLoading={save.isPending}
            onClick={() =>
              save.mutate([...current], {
                onSuccess: () => {
                  setSelected(null);
                  onClose();
                },
              })
            }
          >
            Replace set ({current.size})
          </Button>
        </>
      }
    >
      {permissions.isPending ? (
        <SkeletonList rows={4} />
      ) : (
        <div className="flex flex-col gap-4">
          {[...grouped.entries()].map(([resource, items]) => (
            <section key={resource}>
              <h3 className="text-text-muted mb-1 text-meta font-semibold tracking-wide uppercase">
                {resource}
              </h3>
              {items.map((permission) => (
                <Checkbox
                  key={permission.code}
                  label={permission.code}
                  description={permission.description}
                  checked={current.has(permission.code)}
                  onChange={(isOn) => toggle(permission.code, isOn)}
                />
              ))}
            </section>
          ))}
        </div>
      )}
    </Dialog>
  );
}
