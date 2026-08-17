import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../features/auth/useAuth';
import { cx } from '../../lib/cx';
import { Icon } from '../ui/icons';
import { NAV_GROUPS, type NavItem } from './navigation';

/**
 * THE COMMAND PALETTE.
 *
 * `⌘K` / `Ctrl+K`. Cheap to build, and one of the clearest signals that a product is modern
 * rather than merely finished.
 *
 * **It searches SCREENS, not records.** §4.9 of the design brief also wants clubs, members
 * and activities in here, permission-filtered server-side — and that is the right design,
 * but it needs a search endpoint that does the filtering in the database. Doing it on the
 * client would mean shipping the district's member list to every device in order to search
 * it, which is precisely the failure this system exists to correct. So the record half waits
 * for an endpoint that can do it properly, and this half ships now.
 *
 * Everything it can reach is filtered by the same permission list the sidebar uses, from the
 * same module, so the palette cannot open a door the navigation has hidden.
 *
 * The component is MOUNTED ONLY WHILE OPEN. That is what makes "reset the query each time"
 * free — a fresh mount has a fresh `useState` — rather than an effect that writes state on
 * open and triggers a second render every time.
 */

/**
 * Subsequence matching — the letters in order, not necessarily adjacent.
 *
 * "actyp" finds "Activity types". Cheap, predictable, and no fuzzy-search dependency for
 * twenty rows: a library here would cost more bytes than the feature.
 */
function score(item: NavItem, query: string): number {
  const haystack = `${item.label} ${item.keywords ?? ''}`.toLowerCase();
  const label = item.label.toLowerCase();

  if (label.startsWith(query)) return 1000 - label.length;
  if (label.includes(query)) return 500 - label.length;

  let index = 0;
  for (const character of query) {
    index = haystack.indexOf(character, index);
    if (index === -1) return -1;
    index += 1;
  }
  return 100 - haystack.length;
}

const RECENT_KEY = 'dis-recent-routes';

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]).slice(0, 5) : [];
  } catch {
    return [];
  }
}

function rememberRecent(to: string): void {
  try {
    const next = [to, ...readRecent().filter((entry) => entry !== to)].slice(0, 5);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Private mode. Recents are a convenience, not a requirement.
  }
}

interface Result extends NavItem {
  /** The group heading to print above this row, or null to continue the current group. */
  heading: string | null;
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { permissions } = useAuth();
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  /** Every screen this member may open, flattened, carrying its group. */
  const available = useMemo(
    () =>
      NAV_GROUPS.flatMap((group) =>
        group.items
          .filter((item) => !item.permission || permissions.has(item.permission))
          .map((item) => ({ ...item, group: group.label })),
      ),
    [permissions],
  );

  const results = useMemo<Result[]>(() => {
    const trimmed = query.trim().toLowerCase();

    const ranked =
      trimmed === ''
        ? (() => {
            // Recents first when there is nothing to match on: the palette opens on what you
            // were just doing, which is most of what people open it for.
            const recent = readRecent();
            const recents = recent.flatMap((to) =>
              available
                .filter((item) => item.to === to)
                .map((item) => ({ ...item, group: 'Recent' })),
            );
            return [...recents, ...available.filter((item) => !recent.includes(item.to))];
          })()
        : available
            .map((item) => ({ item, rank: score(item, trimmed) }))
            .filter(({ rank }) => rank >= 0)
            .sort((a, b) => b.rank - a.rank)
            // A ranked list is ordered by relevance, not by group, so headings would be
            // meaningless — and would repeat.
            .map(({ item }) => ({ ...item, group: '' }));

    // Headings are computed HERE rather than while rendering. Tracking "the previous group"
    // in a variable during the map mutates it after the render has completed, which is only
    // correct until React decides to render the list twice.
    return ranked.map((item, index) => ({
      ...item,
      heading: item.group && item.group !== ranked[index - 1]?.group ? item.group : null,
    }));
  }, [available, query]);

  const choose = useCallback(
    (to: string) => {
      rememberRecent(to);
      navigate(to);
      onClose();
    },
    [navigate, onClose],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setHighlighted((current) => (results.length === 0 ? 0 : (current + 1) % results.length));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlighted((current) =>
          results.length === 0 ? 0 : (current - 1 + results.length) % results.length,
        );
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const chosen = results[highlighted];
        if (chosen) choose(chosen.to);
      }
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [results, highlighted, choose, onClose]);

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    listRef.current?.children[highlighted]?.scrollIntoView({ block: 'nearest' });
  }, [highlighted]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-[var(--scrim)] p-4 pt-[10vh]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        onClick={(event) => event.stopPropagation()}
        className="bg-surface-overlay hairline-top flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl shadow-[var(--shadow-lg)] motion-safe:animate-[dialog-in_var(--duration-slow)_var(--ease-out)]"
      >
        <div className="border-border-subtle flex items-center gap-3 border-b px-4">
          <Icon name="search" className="text-text-muted size-4 shrink-0" />
          <input
            // The palette is opened deliberately, by a keystroke or a tap on a search box.
            // This is the one place autofocus is not an ambush.
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlighted(0);
            }}
            placeholder="Search screens…"
            aria-label="Search screens"
            className="text-body placeholder:text-text-muted h-12 flex-1 bg-transparent outline-none"
          />
          <kbd className="border-border text-text-muted text-meta hidden rounded-sm border px-1.5 py-0.5 sm:block">
            esc
          </kbd>
        </div>

        {results.length === 0 ? (
          <p className="text-text-muted text-table px-4 py-10 text-center">
            Nothing matches “{query}”. Try a shorter word.
          </p>
        ) : (
          <ul ref={listRef} className="flex-1 overflow-y-auto p-2">
            {results.map((item, index) => (
              <li key={item.to}>
                {item.heading && (
                  <p className="text-text-muted text-meta mt-2 mb-1 px-2 font-medium tracking-[0.08em] uppercase first:mt-0">
                    {item.heading}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => choose(item.to)}
                  onMouseMove={() => setHighlighted(index)}
                  className={cx(
                    'text-table flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left',
                    index === highlighted
                      ? 'bg-accent-subtle text-accent-text font-medium'
                      : 'text-text-secondary',
                  )}
                >
                  <Icon name={item.icon} className="size-4" />
                  <span className="flex-1 truncate">{item.label}</span>
                  {index === highlighted && (
                    <kbd className="text-meta text-text-muted hidden sm:block">↵</kbd>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** A muted pill on desktop; an icon on a phone, where there is no keyboard to advertise. */
export function CommandPaletteTrigger({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Search screens"
      className="text-text-muted hover:bg-surface-raised hover:text-text-secondary press md:border-border md:bg-surface-sunken flex items-center gap-2 rounded-md transition-colors md:border md:px-3 md:py-1.5"
    >
      <span className="grid size-10 place-items-center md:size-auto">
        <Icon name="search" className="size-4" />
      </span>
      <span className="text-table hidden md:inline">Search…</span>
      <kbd className="border-border text-meta ml-6 hidden rounded-sm border px-1.5 py-0.5 md:block">
        ⌘K
      </kbd>
    </button>
  );
}
