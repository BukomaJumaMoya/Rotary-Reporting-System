import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth, useClearAuth } from '../../features/auth/useAuth';
import { Button } from '../ui';
import { cx } from '../../lib/cx';

/**
 * The frame.
 *
 * Sidebar on desktop, bottom navigation on mobile — not a hamburger, because a menu
 * behind a tap is a menu nobody opens, and the thumb is already at the bottom of the
 * phone. Navigation items filter by permission, which is courtesy rather than security:
 * the server refuses regardless.
 */

interface NavItem {
  to: string;
  label: string;
  /** Undefined means every signed-in member sees it. */
  permission?: string;
  /** A short glyph for the bottom bar, where there is no room for words alone. */
  glyph: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', glyph: '◎' },
  // Held by every position on the slate, club officers included: the directory is the one
  // screen everybody uses.
  { to: '/clubs', label: 'Clubs', permission: 'club:read:district', glyph: '⌂' },
  // The most-used screen a club secretary has, so it is one tap from anywhere.
  { to: '/membership/record', label: 'Record', permission: 'membership:write:club', glyph: '✚' },
  {
    to: '/membership/transitions',
    label: 'Transitions',
    permission: 'membership:read:club',
    glyph: '⇢',
  },
  {
    to: '/admin/activity-types',
    label: 'Types',
    permission: 'activitytype:manage:district',
    glyph: '⚙',
  },
  {
    to: '/admin/clusters',
    label: 'Clusters',
    permission: 'cluster:manage:district',
    glyph: '⬡',
  },
  {
    to: '/admin/positions',
    label: 'Positions',
    permission: 'position:manage:district',
    glyph: '⬒',
  },
  {
    to: '/admin/appointments',
    label: 'Appointments',
    permission: 'appointment:read:district',
    glyph: '⚇',
  },
  {
    to: '/admin/committees',
    label: 'Committees',
    permission: 'committee:manage:district',
    glyph: '⬢',
  },
  {
    to: '/admin/invitations',
    label: 'Invites',
    permission: 'person:invite:club',
    glyph: '✉',
  },
  { to: '/admin/audit', label: 'Audit', permission: 'audit:read:district', glyph: '☰' },
  { to: '/admin/rollover', label: 'Rollover', permission: 'year:rollover:district', glyph: '⟳' },
];

function useVisibleNav(): NavItem[] {
  const { permissions } = useAuth();
  return NAV_ITEMS.filter((item) => !item.permission || permissions.has(item.permission));
}

/** The Rotaract wordmark. Never the Rotary wheel — Rotaract has its own mark. */
function Wordmark() {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-cranberry-500 text-lg font-bold tracking-tight">Rotaract</span>
      <span className="text-ink-400 text-xs font-medium">D9218</span>
    </div>
  );
}

function SignedInAs() {
  const { person, context, appointments } = useAuth();
  if (!person) return null;

  const primary = appointments[0];

  return (
    <div className="min-w-0">
      <p className="text-ink-900 truncate text-sm font-medium">
        {person.firstName} {person.lastName}
      </p>
      <p className="text-ink-500 truncate text-xs">
        {primary
          ? `${primary.positionName}${primary.scopeName ? ` · ${primary.scopeName}` : ''}`
          : 'No active appointment'}
        {context?.rotaryYearLabel ? ` · RY ${context.rotaryYearLabel}` : ''}
      </p>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const items = useVisibleNav();
  const navigate = useNavigate();
  const clearAuth = useClearAuth();

  const signOut = async () => {
    await api
      .post('/auth/logout', undefined, { allowUnauthenticated: true })
      .catch(() => undefined);
    clearAuth();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-dvh md:flex">
      <aside className="border-ink-200 hidden w-60 shrink-0 flex-col border-r bg-white md:flex">
        <div className="border-ink-200 border-b px-4 py-4">
          <Wordmark />
        </div>
        <nav className="flex-1 p-2">
          <ul className="flex flex-col gap-0.5">
            {items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    cx(
                      'flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm',
                      isActive
                        ? 'bg-cranberry-50 text-cranberry-700 font-medium'
                        : 'text-ink-600 hover:bg-ink-100',
                    )
                  }
                >
                  <span aria-hidden="true">{item.glyph}</span>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="border-ink-200 flex flex-col gap-2 border-t p-3">
          <SignedInAs />
          <Button variant="secondary" onClick={() => void signOut()} fullWidth>
            Sign out
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-ink-200 flex items-center justify-between border-b bg-white px-4 py-3 md:hidden">
          <Wordmark />
          <Button variant="ghost" onClick={() => void signOut()}>
            Sign out
          </Button>
        </header>

        {/* pb-20 keeps the last row clear of the bottom bar on mobile. */}
        <main className="flex-1 px-4 pt-4 pb-20 md:px-6 md:pt-6 md:pb-6">{children}</main>

        <nav className="border-ink-200 fixed inset-x-0 bottom-0 border-t bg-white md:hidden">
          <ul className="flex">
            {items.map((item) => (
              <li key={item.to} className="flex-1">
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    cx(
                      'flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px]',
                      isActive ? 'text-cranberry-600 font-medium' : 'text-ink-500',
                    )
                  }
                >
                  <span aria-hidden="true" className="text-base">
                    {item.glyph}
                  </span>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}

/** The frame for the signed-out screens: one centred card, nothing to navigate. */
export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Wordmark />
          <h1 className="text-ink-900 text-xl font-semibold">{title}</h1>
          {subtitle && <p className="text-ink-500 text-sm">{subtitle}</p>}
        </div>
        <div className="border-ink-200 rounded-xl border bg-white p-5">{children}</div>
      </div>
    </div>
  );
}
