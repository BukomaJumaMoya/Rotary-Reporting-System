import { cx } from '../../lib/cx';

/**
 * THE ICON SET.
 *
 * Hand-written, because importing a library wholesale is one of the fastest ways to spend
 * the entire payload budget on decoration: a full Lucide import is hundreds of kilobytes,
 * and tree-shaking it reliably across a route-split build is a thing you have to keep
 * getting right rather than a thing that is true. This file is under 4 KB for the whole set
 * and cannot regress.
 *
 * They replaced text glyphs — `◎`, `⌂`, `⬡`. Those cost nothing and looked it: the glyph
 * coverage of the default Android font is not the same as the desktop one, so several
 * rendered as a dotted box on precisely the devices this system is for. A navigation rail
 * whose icons are missing-glyph boxes is worse than no rail.
 *
 * All 24×24, stroked in `currentColor` at 1.5, so weight stays even beside 15px text and
 * colour is inherited from whatever state the parent is in.
 */

const PATHS = {
  // ── Navigation ──────────────────────────────────────────────────────────────────────
  dashboard: 'M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z',
  clubs: 'M3 21h18M5 21V7l7-4 7 4v14M9 21v-5h6v5M9 11h.01M15 11h.01',
  activities: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9L12 3.5Z',
  report: 'M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5ZM14 6l4 4',
  members:
    'M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20M9.5 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM21 20v-1.5a4 4 0 0 0-3-3.9M16 3.6a4 4 0 0 1 0 7.7',
  transitions: 'M7 4 3 8l4 4M3 8h13a4 4 0 0 1 0 8h-1M17 20l4-4-4-4',
  money: 'M3 6h18v12H3V6Zm9 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6ZM6 9h.01M18 15h.01',
  budget: 'M12 3v9l6.5 4A9 9 0 1 0 12 3Z M12 3a9 9 0 0 1 8.5 6.1',
  dues: 'M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21V3Zm3.5 5h7M8.5 12h7M8.5 16h4',
  trf: 'M12 21s-7-4.6-7-9.6A4.2 4.2 0 0 1 12 8a4.2 4.2 0 0 1 7 3.4C19 16.4 12 21 12 21Z',
  types: 'M4 6h10M18 6h2M4 12h2M10 12h10M4 18h8M16 18h4M16 4v4M8 10v4M14 16v4',
  clusters: 'M12 2.5 20 7v10l-8 4.5L4 17V7l8-4.5ZM12 8.5 16 11v4l-4 2.2L8 15v-4l4-2.5Z',
  positions: 'M12 2.5 14.6 8l6 .9-4.3 4.2 1 6-5.3-2.8-5.3 2.8 1-6L3.4 8.9l6-.9L12 2.5Z',
  appointments:
    'M15 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20M8.5 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM16 11.5l2 2 4-4',
  committees:
    'M9 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2 20v-1a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v1M17.5 9.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM19 15h.5a3 3 0 0 1 3 3v2',
  invites: 'M3 6h18v12H3V6Zm0 .5 9 6.5 9-6.5',
  audit: 'M4 4h11l5 5v11H4V4Zm11 0v5h5M8 13h8M8 17h5',
  rollover: 'M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5',
  pending: 'M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',

  // ── Shell ───────────────────────────────────────────────────────────────────────────
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6L6 18',
  collapse: 'M15 6l-6 6 6 6',
  expand: 'M9 6l6 6-6 6',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z',
  history: 'M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3 4v5h5M12 7.5V12l3 2',
  signOut: 'M15 17l5-5-5-5M20 12H9M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  className,
  filled = false,
}: {
  name: IconName;
  className?: string;
  /** For the handful that read better solid — the TRF heart, the active star. */
  filled?: boolean;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Explicit dimensions, like every other image in the system: a glyph that resizes
      // once the stylesheet lands is a layout shift in the navigation.
      className={cx('size-5 shrink-0', className)}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
