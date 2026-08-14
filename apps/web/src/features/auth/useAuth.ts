import type { MeResponse } from '@dis/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';

/**
 * Who is signed in, and what they may do.
 *
 * `GET /auth/me` is the client's source of truth for what to RENDER. It is never the
 * security boundary: every endpoint re-checks server-side, and a client that hid nothing
 * would still be refused (docs/05-API-Spec.md §2).
 */

export const authQueryKey = ['auth', 'me'] as const;

export function useAuth() {
  const query = useQuery({
    queryKey: authQueryKey,
    queryFn: () => api.get<MeResponse>('/auth/me'),
    // A 401 here is "not signed in", which is an answer rather than a failure. Retrying
    // it three times just delays the login screen.
    retry: (failureCount, error) =>
      !(error instanceof ApiError && error.status === 401) && failureCount < 2,
    staleTime: 60_000,
  });

  const me = query.data?.data;

  return {
    isLoading: query.isPending,
    isSignedIn: me !== undefined,
    person: me
      ? { id: me.personId, userId: me.userId, firstName: me.firstName, lastName: me.lastName }
      : null,
    status: me?.status ?? null,
    mfaEnabled: me?.mfaEnabled ?? false,
    mfaRecoveryCodesRemaining: me?.mfaRecoveryCodesRemaining ?? 0,
    context: me?.context ?? null,
    appointments: me?.appointments ?? [],
    permissions: new Set(me?.context.permissions ?? []),
    refetch: query.refetch,
  };
}

/** Clears every cached query. Called on sign-out, so nothing survives into the next session. */
export function useClearAuth(): () => void {
  const client = useQueryClient();
  return () => {
    client.clear();
  };
}

/**
 * Whether the signed-in member holds a permission.
 *
 * Presentation only. Hiding a control the server would refuse is courtesy; showing one it
 * would allow is the actual requirement, and neither is a security decision.
 */
export function usePermission(permission: string): boolean {
  const { permissions } = useAuth();
  return permissions.has(permission);
}

/**
 * Whether a specific record is in the member's scope.
 *
 * The client-side twin of `requireScope`. A committee chair sees their own subtree and
 * not the district's, which permission alone cannot express.
 */
export function useScope() {
  const { context } = useAuth();

  return {
    isDistrictWide: context?.scopes.isDistrictWide ?? false,
    coversClub: (clubId: string) =>
      (context?.scopes.isDistrictWide ?? false) ||
      (context?.scopes.clubIds.includes(clubId) ?? false),
    coversCluster: (clusterId: string) =>
      (context?.scopes.isDistrictWide ?? false) ||
      (context?.scopes.clusterIds.includes(clusterId) ?? false),
    coversRegion: (regionId: string) =>
      (context?.scopes.isDistrictWide ?? false) ||
      (context?.scopes.regionIds.includes(regionId) ?? false),
    coversCommittee: (committeeId: string) =>
      (context?.scopes.isDistrictWide ?? false) ||
      (context?.scopes.committeeIds.includes(committeeId) ?? false),
  };
}
