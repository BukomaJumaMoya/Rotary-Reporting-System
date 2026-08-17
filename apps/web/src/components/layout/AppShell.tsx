import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth, useClearAuth } from '../../features/auth/useAuth';
import { clearDeviceState } from '../../lib/offline/caches';
import { startOutboxScheduler, useOutbox } from '../../lib/offline/submit';
import { useSidebar } from '../../lib/theme';
import { Button } from '../ui';
import { Icon } from '../ui/icons';
import { cx } from '../../lib/cx';
import { ConnectionBanner } from './ConnectionBanner';
import { NAV_GROUPS, type NavGroup } from './navigation';
import { CommandPalette, CommandPaletteTrigger } from './CommandPalette';
import { useCommandPalette } from './useCommandPalette';

/**
 * THE FRAME.
 *
 * A fixed sidebar and header; only the content column scrolls, which is what lets a sticky
 * table header work without fighting the page.
 *
 * **The sidebar has three states.** Expanded at 264px, a 64px icon rail, and — below `md`
 * only — an overlay drawer over a scrim. The choice between the first two is the member's,
 * persisted, and read by the inline script in `index.html` BEFORE first paint: a sidebar
 * that snaps from expanded to rail once React hydrates is the layout equivalent of a theme
 * flash, and it happens on every single page load.
 *
 * **This replaced a bottom bar, and the reasoning that put the bottom bar there was sound
 * until it was not.** The original argument was that a menu behind a tap is a menu nobody
 * opens, and the thumb is already at the bottom of a phone. That holds for five
 * destinations. By M4 there were fifteen sharing one flex row — about 24px each on a 360px
 * screen, half the width of a fingertip. A bar nobody can hit is worse than a menu behind a
 * tap, and it fails silently: people just stop using the parts they cannot reach.
 *
 * Two things stay OUT of the drawer, because they are what the original argument was
 * actually about:
 *
 *  * **Report** — a button in the header. It is the screen the system exists for.
 *  * **The pending count** — a badge on the menu button itself. Three unsent reports are not
 *    something a member should have to go browsing to discover.
 */

function useVisibleGroups(): NavGroup[] {
  const { permissions } = useAuth();
  const { count } = useOutbox();

  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.permission || permissions.has(item.permission)),
  })).filter((group) => group.items.length > 0);

  // Appears only when there is something waiting. A permanent "0 pending" entry would train
  // members to ignore the one row that will one day matter.
  if (count > 0) {
    groups[0]?.items.push({ to: '/pending', label: 'Pending', icon: 'pending' });
  }
  return groups;
}

/** The Rotaract wordmark. Never the Rotary wheel — Rotaract has its own mark. */
function Wordmark({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <span
        className="text-accent text-subsection font-serif leading-none"
        aria-label="Rotaract District 9218"
      >
        R
      </span>
    );
  }
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-accent font-serif text-subsection leading-none">Rotaract</span>
      <span className="text-text-muted text-meta font-medium tracking-[0.08em]">D9218</span>
    </div>
  );
}

/**
 * The Rotary Year, made visible.
 *
 * Axiom 1 says the Rotary Year is a dimension rather than a filter, and this is where that
 * becomes something a member can see. A quiet neutral pill in the current year; amber, with
 * a history icon, the moment the context is one that cannot be written to.
 *
 * It exists to prevent the single most confusing failure in a year-scoped system: somebody
 * working in a historical context, wondering why every save is refused.
 */
function YearBadge() {
  const { context } = useAuth();
  if (!context?.rotaryYearLabel) return null;

  const readOnly = !context.isYearWritable;

  return (
    <span
      className={cx(
        'text-meta inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 font-medium tabular-nums',
        readOnly ? 'bg-warning-subtle text-warning-text' : 'text-text-muted',
      )}
      title={readOnly ? 'This year is read-only' : 'The current Rotary Year'}
    >
      {readOnly && <Icon name="history" className="size-3.5" />}
      RY {context.rotaryYearLabel}
    </span>
  );
}

/**
 * A strip across the top of the content when the year cannot be written to.
 *
 * The badge alone is too quiet for this. A member who has navigated into a locked year and
 * is halfway through a form needs to be told before they finish it, not after the server
 * refuses — `YEAR_LOCKED` arriving on submit is a wasted five minutes and an unexplained
 * failure.
 */
function ReadOnlyYearStrip() {
  const { context } = useAuth();
  if (!context?.rotaryYearLabel || context.isYearWritable) return null;

  return (
    <div className="bg-warning-subtle text-warning-text text-label flex items-center justify-center gap-2 px-4 py-2">
      <Icon name="history" className="size-4 shrink-0" />
      <span>
        Viewing <strong className="font-semibold">{context.rotaryYearLabel}</strong> — read only.
        {context.isYearLocked ? ' This year has been closed.' : ''}
      </span>
    </div>
  );
}

function SignedInAs({ compact = false }: { compact?: boolean }) {
  const { person, appointments } = useAuth();
  if (!person) return null;

  const primary = appointments[0];
  const initials = `${person.firstName[0] ?? ''}${person.lastName[0] ?? ''}`.toUpperCase();

  if (compact) {
    return (
      <span
        className="bg-accent-subtle text-accent-text text-label grid size-9 shrink-0 place-items-center rounded-full font-semibold"
        title={`${person.firstName} ${person.lastName}`}
      >
        {initials}
      </span>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <span className="bg-accent-subtle text-accent-text text-label grid size-9 shrink-0 place-items-center rounded-full font-semibold">
        {initials}
      </span>
      {/*
        The position AND the club, each on its own line and not truncated away. "Club
        Secretary" without "Rotaract Club of Kampala" reads as an account belonging to
        nobody — which is exactly how it read on a phone, where this panel lived in a
        sidebar the mobile layout never rendered.
      */}
      <div className="min-w-0">
        <p className="text-text-primary text-table truncate font-medium">
          {person.firstName} {person.lastName}
        </p>
        <p className="text-text-muted text-label truncate">
          {primary ? primary.positionName : 'No active appointment'}
        </p>
        {primary?.scopeName && (
          <p className="text-text-secondary text-label truncate">{primary.scopeName}</p>
        )}
      </div>
    </div>
  );
}

/** Straight to the reporting form, for the member whose job that is. */
function ReportShortcut() {
  const { permissions } = useAuth();
  if (!permissions.has('activity:create:club')) return null;

  return (
    <NavLink
      to="/report"
      className={({ isActive }) =>
        cx(
          'press text-table flex min-h-10 shrink-0 items-center gap-1.5 rounded-md px-3 font-medium',
          isActive
            ? 'bg-accent-subtle text-accent-text'
            : 'bg-accent text-white hover:bg-accent-hover',
        )
      }
    >
      <Icon name="report" className="size-4" />
      <span className="hidden sm:inline">Report</span>
    </NavLink>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const groups = useVisibleGroups();
  const navigate = useNavigate();
  const clearAuth = useClearAuth();
  const { count } = useOutbox();
  const { isRail, toggle: toggleSidebar } = useSidebar();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const palette = useCommandPalette();
  /** Rail hover-peek: the expanded panel floats over the content without reflowing it. */
  const [isPeeking, setIsPeeking] = useState(false);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // The drain loop lives as long as the signed-in shell does. It is what sends the queue on
  // a device where the service worker never registered — an http:// LAN address, or iOS
  // Safari, which has never shipped Background Sync.
  useEffect(() => startOutboxScheduler(), []);

  // Escape closes the drawer; `[` toggles the rail. A full-screen overlay with no keyboard
  // exit is a trap for anybody not using a touchscreen.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setIsDrawerOpen(false);
        return;
      }
      // Not while typing — `[` is a character somebody may well be entering into a field.
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable === true;
      if (event.key === '[' && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleSidebar]);

  useEffect(() => () => clearTimeout(peekTimer.current), []);

  const openPeek = () => {
    if (!isRail) return;
    clearTimeout(peekTimer.current);
    // 200ms in, 300ms out. Peeking instantly would fire every time the pointer crossed the
    // rail on its way somewhere else.
    peekTimer.current = setTimeout(() => setIsPeeking(true), 200);
  };
  const closePeek = () => {
    clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => setIsPeeking(false), 300);
  };

  const signOut = async () => {
    await api
      .post('/auth/logout', undefined, { allowUnauthenticated: true })
      .catch(() => undefined);
    clearAuth();

    // A shared phone is the normal case in a Rotaract club. A cache that survives sign-out
    // shows the next officer the previous one's district — the predecessor's failure in a
    // new form. The outbox is deliberately kept: it is the member's own unsent work.
    await clearDeviceState();

    navigate('/login', { replace: true });
  };

  /**
   * `collapsed` drives the icon-only presentation. It is NOT the same as `isRail`: a peeking
   * rail and an open drawer both render expanded contents inside a rail-width shell.
   */
  const sidebarBody = (collapsed: boolean) => (
    <>
      <div
        className={cx(
          'flex h-14 shrink-0 items-center border-b border-border-subtle',
          collapsed ? 'justify-center px-2' : 'justify-between px-4',
        )}
      >
        <Wordmark compact={collapsed} />
        <button
          type="button"
          onClick={() => setIsDrawerOpen(false)}
          aria-label="Close the menu"
          className="text-text-muted hover:bg-surface-raised -mr-2 grid size-11 place-items-center rounded-md md:hidden"
        >
          <Icon name="close" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-3">
        {groups.map((group) => (
          <div key={group.label} className="mb-4 last:mb-0">
            {/* Uppercase always carries added tracking; without it, it is the signature of
                unconsidered typography. Hidden in the rail, where there is no room. */}
            {!collapsed && (
              <p className="text-text-muted text-meta mb-1 px-3 font-medium tracking-[0.08em] uppercase">
                {group.label}
              </p>
            )}
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    // Closed here rather than by watching the location: this IS the event,
                    // and an effect chasing the URL would be a cascading render for
                    // something a click handler already knows.
                    onClick={() => setIsDrawerOpen(false)}
                    title={collapsed ? item.label : undefined}
                    className={({ isActive }) =>
                      cx(
                        'text-table relative flex min-h-11 items-center gap-3 rounded-md transition-colors duration-[var(--duration-instant)]',
                        collapsed ? 'justify-center px-0' : 'px-3',
                        isActive
                          ? // INK, NOT CRANBERRY. A 2px ink rule and a weight change, and
                            // nothing else. The brand colour has retreated to three places —
                            // the mark, the one primary action on a page, and a chart series
                            // — and a state that sits permanently on screen for every member
                            // was the least defensible place to have been spending it.
                            'text-text-primary before:bg-text-primary font-medium before:absolute before:inset-y-1.5 before:left-0 before:w-0.5'
                          : 'text-text-muted hover:text-text-primary',
                      )
                    }
                  >
                    <Icon name={item.icon} />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-border-subtle flex flex-col gap-3 border-t p-3">
        {collapsed ? <SignedInAs compact /> : <SignedInAs />}
        <div className={cx('flex gap-2', collapsed && 'flex-col')}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void signOut()}
            fullWidth={!collapsed}
            aria-label="Sign out"
          >
            <Icon name="signOut" className="size-4" />
            {!collapsed && 'Sign out'}
          </Button>
          {/* The collapse toggle lives in the footer, out of the way of the navigation it
              governs. `[` does the same thing for anybody who would rather not reach. */}
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={isRail ? 'Expand the sidebar' : 'Collapse the sidebar to icons'}
            title={`${isRail ? 'Expand' : 'Collapse'} sidebar  [`}
            className="text-text-muted hover:bg-surface-raised press hidden size-9 shrink-0 place-items-center rounded-md md:grid"
          >
            <Icon name={isRail ? 'expand' : 'collapse'} className="size-4" />
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="bg-background flex min-h-dvh">
      {/*
        The first focusable element on every page. Without it, a keyboard or screen-reader
        user tabs through the entire navigation — five groups, up to eighteen items — before
        reaching the content, on every single page load.
        Visible only when focused, which is the point: it costs sighted mouse users nothing.
      */}
      <a
        href="#main"
        className="bg-surface text-text-primary focus:ring-accent sr-only rounded-md px-4 py-2 focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-[80] focus:ring-2"
      >
        Skip to content
      </a>
      {/*
        THE WIDTH SNAPS; THE CONTENTS ANIMATE.

        Transitioning `width` would run layout on every frame of the collapse, for the whole
        page, and that is exactly the kind of thing that drops frames on a mid-range Android.
        So the rail changes width in one step and the labels cross-fade — which reads as
        smooth, because the eye is following the text, not the edge.
      */}
      <aside
        onMouseEnter={openPeek}
        onMouseLeave={closePeek}
        data-print="hide"
        className={cx(
          'border-border-subtle bg-surface sticky top-0 hidden h-dvh shrink-0 flex-col border-r md:flex',
          isRail ? 'w-16' : 'w-66',
        )}
      >
        {sidebarBody(isRail && !isPeeking)}

        {/*
          HOVER-PEEK. The expanded panel floats OVER the content at shadow-lg rather than
          pushing it, so nothing reflows and the member keeps their place on the page. It
          gives the space saving of a rail with none of its memory cost.
        */}
        {isRail && isPeeking && (
          <div
            className="border-border-subtle bg-surface absolute inset-y-0 left-0 z-30 flex w-66 flex-col border-r shadow-[var(--shadow-lg)] motion-safe:animate-[dialog-in_var(--duration-base)_var(--ease-out)]"
            onMouseEnter={openPeek}
            onMouseLeave={closePeek}
          >
            {sidebarBody(false)}
          </div>
        )}
      </aside>

      {/* The same navigation as an overlay drawer below md. */}
      {isDrawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close the menu"
            onClick={() => setIsDrawerOpen(false)}
            className="absolute inset-0 size-full bg-[var(--scrim)]"
          />
          <aside className="border-border-subtle bg-surface absolute inset-y-0 left-0 flex w-70 max-w-[85vw] flex-col border-r shadow-[var(--shadow-lg)]">
            {sidebarBody(false)}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/*
          56px, sticky, with a hairline and a backdrop blur. The blur is the ONE permitted
          use of `backdrop-filter` in the system: an 8px blur on a 56px strip is cheap even
          on mid-range hardware, where blurring a full-page panel is not.
        */}
        <header
          data-print="hide"
          className="border-border-subtle bg-surface/85 sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b px-3 backdrop-blur-lg md:px-6"
        >
          <button
            type="button"
            onClick={() => setIsDrawerOpen(true)}
            aria-label="Open the menu"
            aria-expanded={isDrawerOpen}
            className="text-text-secondary hover:bg-surface-raised press relative grid size-11 shrink-0 place-items-center rounded-md md:hidden"
          >
            <Icon name="menu" />
            {/*
              The pending count follows the menu button. It is the one thing behind the
              drawer a member must be able to see WITHOUT opening it.
            */}
            {count > 0 && (
              <span className="bg-accent text-meta absolute top-1 right-1 min-w-4 rounded-full px-1 leading-4 font-medium text-white tabular-nums">
                {count}
              </span>
            )}
          </button>

          <div className="md:hidden">
            <Wordmark />
          </div>

          <div className="ml-auto flex items-center gap-2">
            <CommandPaletteTrigger onClick={palette.open} />
            <YearBadge />
            <ReportShortcut />
          </div>
        </header>

        {palette.isOpen && <CommandPalette onClose={palette.close} />}

        <ReadOnlyYearStrip />

        {/* Above the content, never over it: a member mid-form is not interrupted. */}
        <ConnectionBanner />

        <main id="main" className="flex-1 px-4 pt-6 pb-10 md:px-8">
          {/* Content widths are a design decision, not an accident of the viewport. */}
          <div className="mx-auto w-full max-w-[1280px]">{children}</div>
        </main>

        <footer
          data-print="hide"
          className="border-border-subtle text-text-muted text-meta mt-auto border-t px-4 py-4 md:px-8"
        >
          <Link
            to="/accessibility"
            className="hover:text-text-primary underline underline-offset-2"
          >
            Accessibility statement
          </Link>
        </footer>
      </div>
    </div>
  );
}

/**
 * The frame for the signed-out screens.
 *
 * One of the three showcase surfaces, so it gets the display face and room to breathe: this
 * is the first thing anybody ever sees of the system, and a sign-in page that looks
 * provisional makes everything behind it feel provisional too.
 */
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
    <div className="bg-background relative flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      {/*
        The geometric pattern, at 3%.

        An inline SVG on `currentColor` rather than a data-URI background, which is what this
        was: a data URI cannot carry a CSS variable, so the pattern was the ONE literal hex
        left in the application and the one thing that could not follow the theme. On a dark
        ground it was painting cranberry over slate at full saturation.
      */}
      <div
        aria-hidden="true"
        className="text-accent pointer-events-none absolute inset-0 opacity-[0.04]"
      >
        <svg width="100%" height="100%">
          <defs>
            <pattern id="dis-hex" width="60" height="52" patternUnits="userSpaceOnUse">
              <path
                d="M30 0l30 17.32v34.64L30 69.28 0 51.96V17.32z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#dis-hex)" />
        </svg>
      </div>

      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Wordmark />
          <h1 className="font-serif text-title text-text-primary text-balance">{title}</h1>
          {subtitle && <p className="text-text-muted text-table text-pretty">{subtitle}</p>}
        </div>
        <div className="border-border-subtle bg-surface hairline-top rounded-lg border p-6 shadow-[var(--shadow-md)]">
          {children}
        </div>

        <p className="text-text-muted text-meta mt-6 text-center">
          <Link
            to="/accessibility"
            className="hover:text-text-primary underline underline-offset-2"
          >
            Accessibility statement
          </Link>
        </p>
      </div>
    </div>
  );
}
