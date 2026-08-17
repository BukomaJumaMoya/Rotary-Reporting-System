import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Checkbox,
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
import { useAuth } from '../auth/useAuth';
import type { Cluster, ClubListResponse, ClusterListResponse, RegionListResponse } from './types';

/**
 * Clusters, and which clubs sit in them.
 *
 * Clusters are redrawn every year — they are year-scoped for exactly that reason — so this
 * screen is used hard in July and barely afterwards. Assignment sends the WHOLE membership
 * rather than a diff: two officers redrawing clusters from two browsers with client-computed
 * diffs merge each other's work silently, and the district would not find out until an ADRR
 * asked why a club was in two places.
 */
export function ClustersPage() {
  const { permissions } = useAuth();
  const mayManage = permissions.has('cluster:manage:district');

  const [editing, setEditing] = useState<Cluster | null>(null);
  const [creating, setCreating] = useState(false);
  const [assigning, setAssigning] = useState<Cluster | null>(null);

  const clusters = useList<ClusterListResponse>(queryKeys.clusters, '/clusters', { pageSize: 100 });
  const regions = useList<RegionListResponse>(queryKeys.regions, '/regions', { pageSize: 100 });

  if (clusters.isPending) return <SkeletonList rows={4} />;
  if (clusters.isError) {
    return <ErrorState error={clusters.error} onRetry={() => void clusters.refetch()} />;
  }

  return (
    <>
      <PageHeader
        title="Clusters"
        description="Redrawn each Rotary Year. A club sits in at most one cluster."
        action={mayManage ? <Button onClick={() => setCreating(true)}>New cluster</Button> : null}
      />

      <Card>
        {clusters.data.data.length === 0 ? (
          <EmptyState
            title="No clusters yet"
            description="Clusters group clubs under an ADRR. They are drawn fresh each year."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {clusters.data.data.map((cluster) => (
              <li
                key={cluster.id}
                className="border-border-subtle flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
              >
                <div className="min-w-0">
                  <p className="text-text-primary font-medium">{cluster.name}</p>
                  <p className="text-text-muted text-meta">{cluster.regionName ?? 'No region'}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={cluster.clubCount === 0 ? 'warning' : 'neutral'}>
                    {cluster.clubCount} clubs
                  </Badge>
                  {mayManage && (
                    <>
                      <Button variant="ghost" onClick={() => setAssigning(cluster)}>
                        Clubs
                      </Button>
                      <Button variant="ghost" onClick={() => setEditing(cluster)}>
                        Edit
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {(creating || editing) && (
        <ClusterDialog
          cluster={editing}
          regions={(regions.data?.data ?? []).map((region) => ({
            value: region.id,
            label: region.name,
          }))}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      {assigning && <AssignDialog cluster={assigning} onClose={() => setAssigning(null)} />}
    </>
  );
}

function ClusterDialog({
  cluster,
  regions,
  onClose,
}: {
  cluster: Cluster | null;
  regions: { value: string; label: string }[];
  onClose: () => void;
}) {
  const [name, setName] = useState(cluster?.name ?? '');
  const [regionId, setRegionId] = useState(cluster?.regionId ?? '');

  const save = useApiMutation(
    async (payload: { name: string; regionId: string | null }) =>
      cluster ? api.patch(`/clusters/${cluster.id}`, payload) : api.post('/clusters', payload),
    {
      invalidate: [queryKeys.clusters],
      successMessage: cluster ? 'Cluster saved' : 'Cluster created',
    },
  );

  return (
    <Dialog
      isOpen
      title={cluster ? 'Edit cluster' : 'New cluster'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            isLoading={save.isPending}
            onClick={() =>
              save.mutate(
                { name: name.trim(), regionId: regionId === '' ? null : regionId },
                { onSuccess: onClose },
              )
            }
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Input label="Name" value={name} onChange={(event) => setName(event.target.value)} />
        <Select
          label="Region"
          value={regionId}
          placeholder="No region"
          options={regions}
          onChange={(event) => setRegionId(event.target.value)}
        />
      </div>
    </Dialog>
  );
}

/**
 * Which clubs are in this cluster.
 *
 * The list is every club in the district with a checkbox, because 68 clubs is a list you
 * scroll rather than search, and a picker that needed a search would be slower for the one
 * job this screen has.
 */
function AssignDialog({ cluster, onClose }: { cluster: Cluster; onClose: () => void }) {
  const clubs = useList<ClubListResponse>([...queryKeys.clubs, 'all'], '/clubs', { pageSize: 100 });
  const [selected, setSelected] = useState<Set<string> | null>(null);

  const current =
    selected ??
    new Set(
      (clubs.data?.data ?? [])
        .filter((club) => club.affiliation?.clusterId === cluster.id)
        .map((club) => club.id),
    );

  const save = useApiMutation(
    async (clubIds: string[]) => api.post(`/clusters/${cluster.id}/clubs`, { clubIds }),
    {
      invalidate: [queryKeys.clusters, queryKeys.clubs],
      successMessage: 'Cluster membership saved',
    },
  );

  const toggle = (clubId: string, checked: boolean) => {
    const next = new Set(current);
    if (checked) next.add(clubId);
    else next.delete(clubId);
    setSelected(next);
  };

  return (
    <Dialog
      isOpen
      title={`Clubs in ${cluster.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            isLoading={save.isPending}
            onClick={() => save.mutate([...current], { onSuccess: onClose })}
          >
            Save {current.size} clubs
          </Button>
        </>
      }
    >
      {clubs.isPending ? (
        <SkeletonList rows={5} />
      ) : (
        <>
          <p className="text-text-muted mb-2 text-meta">
            A club already in another cluster moves here. The whole membership is sent, so unticking
            a club removes it.
          </p>
          <div className="max-h-80 overflow-y-auto">
            {(clubs.data?.data ?? []).map((club) => (
              <Checkbox
                key={club.id}
                label={club.name}
                description={
                  club.affiliation?.clusterName && club.affiliation.clusterId !== cluster.id
                    ? `Currently in ${club.affiliation.clusterName}`
                    : undefined
                }
                checked={current.has(club.id)}
                onChange={(checked) => toggle(club.id, checked)}
              />
            ))}
          </div>
        </>
      )}
    </Dialog>
  );
}
