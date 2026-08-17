import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cx } from '../../lib/cx';
import { Icon, type IconName } from './icons';

/**
 * PAGE-LEVEL BUILDING BLOCKS.
 *
 * The primitives in `ui/index.tsx` are controls — a button, an input, a table. These are the
 * pieces a SCREEN is made of, and they exist because the screens did not have any.
 *
 * Two design passes rebuilt the shell and the controls, and the pages underneath stayed as
 * they were first written: 156 raw Tailwind sizes against 12 uses of the type scale, and
 * every layout a bespoke stack of `flex flex-col gap-4`. That is why the application looked
 * unfinished no matter what the tokens did — the tokens never reached the part of the screen
 * that occupies most of it.
 *
 * Everything here is deliberately opinionated so that twenty screens end up looking like one
 * product rather than twenty. If a page needs something these do not do, the right move is
 * usually to add a variant here rather than to hand-roll it there.
 */

/* ─── Statistics ────────────────────────────────────────────────────────────────────────── */

export interface Stat {
  label: string;
  value: ReactNode;
  /** Sits under the figure at `meta` size — a denominator, a comparison, a period. */
  detail?: ReactNode;
  /** Draws the figure in a status colour. Use sparingly: most numbers are just numbers. */
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'accent';
  icon?: IconName;
}

const STAT_TONE: Record<NonNullable<Stat['tone']>, string> = {
  default: 'text-text-primary',
  success: 'text-success-text',
  warning: 'text-warning-text',
  danger: 'text-danger-text',
  accent: 'text-accent-text',
};

/**
 * The band of figures at the top of a list screen.
 *
 * Answers "what am I looking at, in numbers" before the reader has to parse a single row,
 * which is the question every one of these screens was previously silent about.
 */
export function StatGrid({ stats, columns = 4 }: { stats: Stat[]; columns?: 2 | 3 | 4 }) {
  if (stats.length === 0) return null;

  return (
    <dl
      className={cx(
        'grid gap-3',
        // Two across on a phone always: one per row wastes the width, three is too tight
        // at 360px for a figure plus its label.
        'grid-cols-2',
        columns === 2 && 'md:grid-cols-2',
        columns === 3 && 'md:grid-cols-3',
        columns === 4 && 'md:grid-cols-4',
      )}
    >
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="border-border-subtle bg-surface rounded-lg border p-4 shadow-[var(--shadow-sm)]"
        >
          <dt className="text-text-muted text-label flex items-center gap-1.5">
            {stat.icon && <Icon name={stat.icon} className="size-3.5 shrink-0" />}
            <span className="truncate">{stat.label}</span>
          </dt>
          <dd className={cx('text-figure-lg mt-1 font-medium', STAT_TONE[stat.tone ?? 'default'])}>
            {stat.value}
          </dd>
          {stat.detail && <dd className="text-text-muted text-meta mt-0.5">{stat.detail}</dd>}
        </div>
      ))}
    </dl>
  );
}

/* ─── List rows ─────────────────────────────────────────────────────────────────────────── */

/**
 * A row in a list of records — a club, an activity, a member, a transaction.
 *
 * One shape for all of them: a title, a line of middle-dot separated facts under it, an
 * optional trailing figure, and status badges. This is the component that most changes how
 * the application reads, because roughly half of every screen in the system is a list of
 * something.
 *
 * Renders as an `<li>`; put it in a `<ListGroup>`.
 */
export function ListRow({
  to,
  title,
  meta,
  badges,
  trailing,
  trailingLabel,
  onClick,
}: {
  /** Makes the whole row a link. The row is the target, not a "view" link inside it. */
  to?: string;
  title: ReactNode;
  /** Facts under the title. Joined with middle dots; falsy entries are dropped. */
  meta?: (ReactNode | false | null | undefined)[];
  badges?: ReactNode;
  /** A figure on the right — an amount, a count, a score. */
  trailing?: ReactNode;
  trailingLabel?: string;
  onClick?: () => void;
}) {
  const shown = (meta ?? []).filter(Boolean);

  const body = (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-text-primary text-body font-medium">{title}</span>
          {badges}
        </div>
        {shown.length > 0 && (
          <p className="text-text-muted text-label mt-0.5">
            {shown.map((entry, index) => (
              <span key={index}>
                {index > 0 && <span aria-hidden="true"> · </span>}
                {entry}
              </span>
            ))}
          </p>
        )}
      </div>

      {trailing !== undefined && (
        <div className="shrink-0 text-right">
          <p className="text-text-primary text-body font-medium">{trailing}</p>
          {trailingLabel && <p className="text-text-muted text-meta">{trailingLabel}</p>}
        </div>
      )}

      {(to ?? onClick) && (
        <Icon name="expand" className="text-text-muted size-4 shrink-0 self-center" />
      )}
    </>
  );

  const shell =
    'flex min-h-16 w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-surface-raised';

  return (
    <li className="contents">
      {to ? (
        <Link to={to} className={shell}>
          {body}
        </Link>
      ) : onClick ? (
        <button type="button" onClick={onClick} className={shell}>
          {body}
        </button>
      ) : (
        <div className={cx(shell, 'hover:bg-transparent')}>{body}</div>
      )}
    </li>
  );
}

/** The card that holds `ListRow`s, with hairlines between them. */
export function ListGroup({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <ul
      className={cx(
        'border-border-subtle bg-surface divide-border-subtle divide-y overflow-hidden rounded-lg border shadow-[var(--shadow-sm)]',
        className,
      )}
    >
      {children}
    </ul>
  );
}

/* ─── Filter bar ────────────────────────────────────────────────────────────────────────── */

/**
 * Search and facets above a list.
 *
 * Sticky under the header, because on a phone a filter you have to scroll back up to change
 * is a filter nobody changes twice.
 */
export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="bg-background sticky top-14 z-20 -mx-4 mb-4 px-4 py-3 md:-mx-8 md:px-8">
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/** A search box for a filter bar. Not the `Input` primitive: no label, and it grows. */
export function SearchField({
  value,
  onChange,
  placeholder = 'Search…',
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative min-w-0 flex-1 sm:max-w-xs">
      <Icon
        name="search"
        className="text-text-muted pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
      />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="border-border bg-surface text-text-primary placeholder:text-text-muted focus:border-accent min-h-10 w-full rounded-md border py-2 pr-3 pl-9 transition-colors"
      />
    </div>
  );
}

/**
 * A row of mutually exclusive filters.
 *
 * A segmented control rather than a `<select>`: on a list screen the available filters are
 * part of the information, and hiding three options behind a dropdown makes people forget
 * the list is filtered at all.
 */
export function FilterTabs<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="border-border bg-surface flex shrink-0 gap-0.5 rounded-md border p-0.5">
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={isActive}
            className={cx(
              'text-label min-h-9 rounded-sm px-3 font-medium transition-colors',
              isActive
                ? 'bg-accent text-white'
                : 'text-text-secondary hover:bg-surface-sunken hover:text-text-primary',
            )}
          >
            {option.label}
            {option.count !== undefined && (
              <span className={cx('ml-1.5', isActive ? 'text-white/70' : 'text-text-muted')}>
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ─── Structure ─────────────────────────────────────────────────────────────────────────── */

/**
 * A heading inside a page, above a list or a group of cards.
 *
 * Lighter than `PageHeader` and heavier than a bare `<h2>`: it carries an optional count and
 * an optional action, which is the shape almost every section on these screens actually
 * wants.
 */
export function SectionHeading({
  title,
  count,
  action,
  description,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  description?: string;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-text-primary text-subsection font-serif flex items-baseline gap-2">
          {title}
          {count !== undefined && (
            <span className="text-text-muted text-label font-sans font-normal">{count}</span>
          )}
        </h2>
        {description && <p className="text-text-muted text-label mt-0.5">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/**
 * The standard page frame: header, then content, at a width chosen for the page type.
 *
 * Reading width is a design decision rather than an accident of the viewport. A form at
 * 1280px is a hostile form; a data table at 720px is a table that scrolls for no reason.
 */
export function PageLayout({
  width = 'list',
  children,
}: {
  width?: 'list' | 'form' | 'reading' | 'wide';
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        'mx-auto w-full',
        width === 'wide' && 'max-w-[1440px]',
        width === 'list' && 'max-w-[1280px]',
        width === 'form' && 'max-w-[720px]',
        width === 'reading' && 'max-w-[680px]',
      )}
    >
      {children}
    </div>
  );
}
