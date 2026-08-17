import { useState } from 'react';
import type {
  AppointmentListResponse,
  CommitteeMemberListResponse,
  CommitteeNode,
  CommitteeTreeResponse,
} from './types';
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
} from '../../components/ui';
import { api } from '../../lib/api';
import { queryKeys, useApiMutation, useList } from '../../lib/queries';
import { useAuth, useScope } from '../auth/useAuth';

/**
 * Committees.
 *
 * The screen the district asked for and could not have: a chair creates their own
 * sub-committee and staffs it, without holding anything district-wide. That is the
 * `<Can>` case which needs SCOPE as well as permission — `committee:manage:district`
 * anywhere, or chairing this subtree.
 */
export function CommitteesPage() {
  const [addingUnder, setAddingUnder] = useState<CommitteeNode | null>(null);
  const [creatingRoot, setCreatingRoot] = useState(false);
  const [membersOf, setMembersOf] = useState<CommitteeNode | null>(null);

  const tree = useList<CommitteeTreeResponse>(queryKeys.committees, '/committees', { tree: true });
  const { permissions } = useAuth();
  const scope = useScope();

  const mayManage = (committeeId: string): boolean =>
    permissions.has('committee:manage:district') || scope.coversCommittee(committeeId);

  if (tree.isPending) return <SkeletonList rows={4} />;
  if (tree.isError) return <ErrorState error={tree.error} onRetry={() => void tree.refetch()} />;

  const renderNode = (node: CommitteeNode) => (
    <li key={node.id}>
      <div className="border-border-subtle flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
        <div className="min-w-0">
          <p className="text-text-primary font-medium">{node.name}</p>
          {node.mandate && <p className="text-text-muted text-xs">{node.mandate}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{node.memberCount} members</Badge>
          <Button variant="ghost" onClick={() => setMembersOf(node)}>
            Members
          </Button>
          {mayManage(node.id) && node.depth < 3 && (
            <Button variant="ghost" onClick={() => setAddingUnder(node)}>
              Add sub-committee
            </Button>
          )}
        </div>
      </div>
      {node.children.length > 0 && (
        <ul className="mt-2 ml-4 flex flex-col gap-2 border-l pl-4">
          {node.children.map(renderNode)}
        </ul>
      )}
    </li>
  );

  return (
    <>
      <PageHeader
        title="Committees"
        description="A chair may create sub-committees under their own and appoint members, without district-wide permission."
        action={
          permissions.has('committee:manage:district') ? (
            <Button onClick={() => setCreatingRoot(true)}>New committee</Button>
          ) : null
        }
      />

      <Card>
        {tree.data.data.length === 0 ? (
          <EmptyState
            title="No committees yet"
            description="District committees are created by the DES; chairs then build their own subtrees."
          />
        ) : (
          <ul className="flex flex-col gap-2">{tree.data.data.map(renderNode)}</ul>
        )}
      </Card>

      {(creatingRoot || addingUnder) && (
        <CreateCommitteeDialog
          parent={addingUnder}
          onClose={() => {
            setCreatingRoot(false);
            setAddingUnder(null);
          }}
        />
      )}

      {membersOf && (
        <MembersDialog
          committee={membersOf}
          canManage={mayManage(membersOf.id)}
          onClose={() => setMembersOf(null)}
        />
      )}
    </>
  );
}

function CreateCommitteeDialog({
  parent,
  onClose,
}: {
  parent: CommitteeNode | null;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [mandate, setMandate] = useState('');

  const create = useApiMutation(
    () =>
      api.post('/committees', {
        name,
        mandate: mandate || null,
        parentCommitteeId: parent?.id ?? null,
      }),
    { invalidate: [queryKeys.committees], successMessage: 'Committee created' },
  );

  return (
    <Dialog
      isOpen
      onClose={onClose}
      title={parent ? `Sub-committee of ${parent.name}` : 'New district committee'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            isLoading={create.isPending}
            disabled={name.trim().length < 2}
            onClick={() => create.mutate(undefined, { onSuccess: onClose })}
          >
            Create
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input label="Name" value={name} onChange={(event) => setName(event.target.value)} />
        <Input
          label="Mandate (optional)"
          value={mandate}
          onChange={(event) => setMandate(event.target.value)}
          hint="What this committee is for, in a sentence."
        />
        {parent && parent.depth >= 2 && (
          <p className="text-warning-text text-sm">
            Committees nest at most three deep. This will be the last level.
          </p>
        )}
      </div>
    </Dialog>
  );
}

/** Membership is by APPOINTMENT, so the picker chooses one — not a person. */
function MembersDialog({
  committee,
  canManage,
  onClose,
}: {
  committee: CommitteeNode;
  canManage: boolean;
  onClose: () => void;
}) {
  const [appointmentId, setAppointmentId] = useState('');
  const [roleLabel, setRoleLabel] = useState('');

  const members = useList<CommitteeMemberListResponse>(
    [...queryKeys.committees, committee.id, 'members'],
    `/committees/${committee.id}/members`,
    { pageSize: 100 },
  );
  const appointments = useList<AppointmentListResponse>(queryKeys.appointments, '/appointments', {
    pageSize: 100,
    isActive: true,
  });

  const add = useApiMutation(
    () =>
      api.post(`/committees/${committee.id}/members`, {
        appointmentId,
        roleLabel: roleLabel || null,
      }),
    {
      invalidate: [queryKeys.committees],
      successMessage: 'Member added',
    },
  );

  const remove = useApiMutation(
    (id: string) => api.delete(`/committees/${committee.id}/members/${id}`),
    { invalidate: [queryKeys.committees], successMessage: 'Member removed' },
  );

  return (
    <Dialog isOpen onClose={onClose} title={`${committee.name} — members`}>
      <div className="flex flex-col gap-4">
        {members.isPending ? (
          <SkeletonList rows={2} />
        ) : members.data && members.data.data.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {members.data.data.map((member) => (
              <li
                key={member.appointmentId}
                className="border-border-subtle flex items-center justify-between gap-2 rounded-lg border p-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{member.personName}</p>
                  <p className="text-text-muted truncate text-xs">
                    {member.positionName}
                    {member.roleLabel ? ` · ${member.roleLabel}` : ''}
                  </p>
                </div>
                {canManage && (
                  <Button variant="ghost" onClick={() => remove.mutate(member.appointmentId)}>
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Nobody on this committee yet" />
        )}

        {canManage && (
          <div className="border-border-subtle flex flex-col gap-3 border-t pt-4">
            <Select
              label="Add an appointment"
              value={appointmentId}
              placeholder="Choose a serving officer"
              // An appointment, not a person: serving on a committee is something you do
              // in a capacity, and it expires with the appointment that justified it.
              options={(appointments.data?.data ?? []).map((appointment) => ({
                value: appointment.id,
                label: `${appointment.personName} — ${appointment.positionName}`,
              }))}
              onChange={(event) => setAppointmentId(event.target.value)}
            />
            <Input
              label="Role on the committee (optional)"
              value={roleLabel}
              onChange={(event) => setRoleLabel(event.target.value)}
              hint="e.g. Secretary"
            />
            <Button
              isLoading={add.isPending}
              disabled={!appointmentId}
              onClick={() => add.mutate(undefined, { onSuccess: () => setAppointmentId('') })}
            >
              Add member
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}
