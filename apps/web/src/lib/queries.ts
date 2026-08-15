import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';
import { useToast } from './toast';

/**
 * The two hooks every governance screen uses.
 *
 * Wrapping TanStack Query here rather than in each screen means the toast on failure,
 * the cache invalidation and the error typing are written once — and every mutation says
 * something, because a member who taps Save and sees nothing assumes it worked.
 */

export function useList<T>(
  key: readonly unknown[],
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
  /**
   * `enabled: false` holds the request back. For a screen that mounts before it knows
   * what to ask for — the club form in create mode has no id, and firing anyway would
   * send a request that can only 404.
   */
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: [...key, query ?? {}],
    queryFn: () => api.get<T>(path, query),
    enabled: options.enabled ?? true,
  });
}

export interface MutationOptions {
  /** Query key prefixes to invalidate on success. */
  invalidate?: readonly (readonly unknown[])[];
  successMessage?: string;
}

export function useApiMutation<TVariables, TResult>(
  mutationFn: (variables: TVariables) => Promise<TResult>,
  options: MutationOptions = {},
) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn,
    onSuccess: async () => {
      for (const key of options.invalidate ?? []) {
        await queryClient.invalidateQueries({ queryKey: key });
      }
      if (options.successMessage) toast.success(options.successMessage);
    },
    onError: (error: unknown) => {
      // The server's message, not a generic one. It was written to be read: "This
      // position cannot be deactivated while it is held" beats "Request failed".
      toast.error(
        error instanceof ApiError ? error.message : 'Something went wrong. Please try again.',
      );
    },
  });
}

export const queryKeys = {
  clubs: ['clubs'] as const,
  membership: ['membership'] as const,
  clusters: ['clusters'] as const,
  regions: ['regions'] as const,
  positions: ['positions'] as const,
  permissions: ['permissions'] as const,
  appointments: ['appointments'] as const,
  committees: ['committees'] as const,
  invitations: ['invitations'] as const,
  audit: ['audit'] as const,
  persons: ['persons'] as const,
};
