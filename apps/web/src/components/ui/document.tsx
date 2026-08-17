import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';

/**
 * THE DOCUMENT APPARATUS.
 *
 * The interface behaves like a report, because that is what this audience trusts. These are
 * the pieces that make it one: numbered sections, numbered tables and figures with captions,
 * a document header that states what the thing IS, and — the important one — a provenance
 * line under every figure.
 *
 * None of this is decoration. It is the difference between a number and a citable number.
 */

/* ─── Provenance ────────────────────────────────────────────────────────────────────────── */

/**
 * THE MOST IMPORTANT COMPONENT IN THIS FILE.
 *
 * Every figure, table and statistic carries origin, verification status, as-at time and
 * coverage. The last of those is what separates a credible reporting system from a
 * dashboard: a reader from a donor or a ministry will ask "of how many, and what about the
 * rest?" within seconds of seeing any aggregate, and a system that answers before it is
 * asked has already won the argument.
 *
 * Coverage is deliberately required rather than optional wherever a denominator exists. An
 * aggregate over 61 of 68 clubs presented without saying so is not a summary, it is a
 * mistake waiting to be quoted in a board paper.
 */
export function Provenance({
  origin,
  verified,
  asAt,
  coverage,
  className,
}: {
  /** Where the numbers came from — "Club submissions", "My Rotary transcription". */
  origin: string;
  /** Whether what is shown counts only verified records. Stated either way, never omitted. */
  verified?: boolean;
  /** When the underlying data was read. A Date, or a pre-formatted string. */
  asAt?: Date | string;
  /** `{ of: 68, have: 61 }` — rendered as a count and a percentage. */
  coverage?: { have: number; of: number };
  className?: string;
}) {
  const parts = [origin];

  if (verified !== undefined) parts.push(verified ? 'verified' : 'including unverified');
  if (asAt) parts.push(`As at ${typeof asAt === 'string' ? asAt : formatAsAt(asAt)}`);
  if (coverage) {
    const percent = coverage.of === 0 ? 0 : Math.round((coverage.have / coverage.of) * 100);
    parts.push(`Coverage ${coverage.have} of ${coverage.of} (${percent}%)`);
  }

  return (
    /*
     * NEVER TRUNCATED. It wraps instead, at every width. A half-shown provenance line is
     * worse than none, because it looks like something is being concealed — and on a phone,
     * truncation is what a naive `truncate` class would do to it by default.
     */
    <p className={cx('text-text-muted text-meta mt-2 text-pretty', className)}>
      Source: {parts.join('. ')}.
    </p>
  );
}

/** `14 Nov 2027, 09:12 EAT`. Never US ordering, and the zone is always stated. */
function formatAsAt(date: Date): string {
  const day = date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${time} EAT`;
}

/* ─── Captions ──────────────────────────────────────────────────────────────────────────── */

/**
 * `Table 3 — Club performance by parameter, Q2 2027-28`.
 *
 * The caption states WHAT, DISAGGREGATED HOW, and WHEN. Not "Performance" — a caption that
 * only names the subject is a title, and a title is not a caption.
 *
 * Sits above a table and below a figure, following statistical publication convention.
 */
export function Caption({
  kind,
  number,
  children,
  note,
}: {
  kind: 'Table' | 'Figure';
  number: number;
  children: ReactNode;
  /** A qualification about method or applicability, printed under the caption. */
  note?: ReactNode;
}) {
  return (
    <div className={cx('text-table', kind === 'Table' ? 'mb-2' : 'mt-2')}>
      <p className="text-text-primary">
        <span className="font-medium">
          {kind} {number}
        </span>
        {' — '}
        {children}
      </p>
      {note && <p className="text-text-muted text-meta mt-1 text-pretty">Note: {note}</p>}
    </div>
  );
}

/* ─── Sections ──────────────────────────────────────────────────────────────────────────── */

/**
 * A numbered section — `1.`, `2.1`.
 *
 * The number sits in the margin at ≥ lg, outside the text column, so it is available for
 * reference without intruding on the reading. Below that it moves inline before the heading,
 * because a margin does not exist on a 360px screen.
 *
 * This single change does more for perceived seriousness than any visual treatment, because
 * it signals that the content has a structure somebody thought about.
 */
export function Section({
  number,
  title,
  children,
  id,
}: {
  number: string;
  title: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="relative scroll-mt-20">
      <h2 className="font-serif text-section text-text-primary mb-3 flex items-baseline gap-3 lg:block">
        <span
          className="text-text-muted text-meta font-sans tabular-nums lg:absolute lg:-left-14 lg:top-1.5 lg:w-10 lg:text-right"
          aria-hidden="true"
        >
          {number}
        </span>
        <span>{title}</span>
      </h2>
      {children}
    </section>
  );
}

/* ─── Document header ───────────────────────────────────────────────────────────────────── */

/**
 * The header of a report surface.
 *
 * `Draft`, `Provisional` and `Final` are meaningful words to this audience, and using them
 * correctly signals that the difference is understood. They are not decoration: a provisional
 * figure quoted as final is how somebody ends up correcting a minister in public.
 */
export type DocumentStatus = 'Draft' | 'Provisional' | 'Final';

const STATUS_TONE: Record<DocumentStatus, string> = {
  Draft: 'text-text-muted border-border',
  Provisional: 'text-warning-text border-warning',
  Final: 'text-text-primary border-border-strong',
};

export function DocumentHeader({
  title,
  period,
  district,
  office,
  status,
  asAt,
}: {
  title: string;
  /** What the document covers — "Quarter 2, 2027-28". */
  period?: string;
  district?: string;
  /** The office that prepared it — "Office of the District Rotaract Representative". */
  office?: string;
  status?: DocumentStatus;
  asAt?: Date;
}) {
  const facts = [district, period, office].filter(Boolean);

  return (
    <header className="border-border-strong mb-8 border-b pb-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="font-serif text-title text-text-primary max-w-3xl text-balance">{title}</h1>
        {status && (
          <span
            className={cx(
              'text-meta shrink-0 rounded-sm border px-2 py-1 font-medium tracking-[0.06em] uppercase',
              STATUS_TONE[status],
            )}
          >
            {status}
          </span>
        )}
      </div>
      {facts.length > 0 && (
        <p className="text-text-secondary text-table mt-2">{facts.join(' · ')}</p>
      )}
      {asAt && <p className="text-text-muted text-meta mt-1">As at {formatAsAt(asAt)}</p>}
    </header>
  );
}

/* ─── Figures ───────────────────────────────────────────────────────────────────────────── */

/**
 * A headline statistic.
 *
 * Tops out at `figure-xl` — 2.75rem. A 56px number is a marketing gesture; this earns
 * attention through position and whitespace instead. The unit sits beside the figure at
 * `meta` size rather than at the same size, so the number reads as the number.
 */
export function Statistic({
  value,
  unit,
  label,
  provenance,
  provisional = false,
}: {
  value: ReactNode;
  unit?: string;
  label: string;
  provenance?: ReactNode;
  /** Hatched rather than tinted, so the mark survives greyscale and a photocopier. */
  provisional?: boolean;
}) {
  return (
    <div className={cx('py-1', provisional && 'hatched')}>
      <p className="text-text-muted text-label">{label}</p>
      <p className="text-text-primary text-figure-lg mt-1 flex items-baseline gap-1.5 font-medium">
        {value}
        {unit && <span className="text-text-muted text-meta font-normal">{unit}</span>}
      </p>
      {provisional && (
        <p className="text-text-muted text-meta mt-1">Provisional — not yet verified.</p>
      )}
      {provenance}
    </div>
  );
}

/**
 * An identifier: an RI club number, a reference code, a receipt number.
 *
 * Set in the mono face with a slashed zero, because these get read aloud down a phone line
 * and transcribed by hand, and `0` against `O` is the transcription error that costs an
 * afternoon.
 */
export function Identifier({ children }: { children: ReactNode }) {
  return <span className="font-mono text-code">{children}</span>;
}
