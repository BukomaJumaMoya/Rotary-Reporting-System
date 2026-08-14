import type { ReactNode } from 'react';
import { useAuth } from '../features/auth/useAuth';

/**
 * Renders children only when the signed-in member holds the permission.
 *
 * **Presentation only. NEVER the security boundary.** Every endpoint re-checks
 * server-side, and a client that hid nothing would still be refused. Hiding a control the
 * server would reject is courtesy — it stops a member finding out by being told no.
 *
 * `scope` covers the case permission alone cannot: a committee chair may create
 * sub-committees under their own committee and nowhere else, so the check is
 * "do you hold this AND does your scope cover that record".
 */
export function Can({
  permission,
  scope,
  fallback = null,
  children,
}: {
  permission: string;
  /** An extra record-level condition, already evaluated by the caller via useScope(). */
  scope?: boolean;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const { permissions } = useAuth();

  const allowed = permissions.has(permission) && (scope === undefined || scope);
  return <>{allowed ? children : fallback}</>;
}
