/**
 * Dates, in the district's timezone.
 *
 * An appointment's term is a `DATE`, not a timestamp, and "has it started" is asked on
 * every request. Compared against UTC midnight the boundary in Kampala is three hours
 * wide: between 21:00 and midnight EAT on 30 June, an incoming officer whose term begins
 * 1 July is already authorised, and on 1 July between midnight and 03:00 EAT they are
 * not. Rollover happens on exactly that boundary, once a year, and it is the one night
 * nobody wants to debug.
 *
 * Districts carry a `timezone` column for this reason. Everything that compares a term
 * against "now" goes through here, so appointment validation and context resolution
 * cannot disagree — if they did, an appointment could be creatable and not yet effective
 * for reasons nobody could see.
 */

/** Timezones already reported as invalid, so a misconfigured district warns once, not per request. */
const warned = new Set<string>();

/**
 * Midnight UTC on the calendar date it is *now* in `timezone`.
 *
 * Returned as UTC midnight because that is how Postgres `DATE` values arrive through
 * Prisma, so the result is directly comparable to `starts_on` and `ends_on`.
 */
export function localDate(timezone: string, now: Date = new Date()): Date {
  const parts = formatterFor(timezone).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  return new Date(Date.UTC(value('year'), value('month') - 1, value('day')));
}

function formatterFor(timezone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    // A district whose timezone column holds nonsense should not take the system down;
    // it should behave as it did before this existed, and say so.
    if (!warned.has(timezone)) {
      warned.add(timezone);
      console.warn(`[time] unknown district timezone ${JSON.stringify(timezone)}; using UTC`);
    }
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }
}

export interface Term {
  startsOn: Date;
  endsOn: Date | null;
}

/**
 * Whether a term covers today, in the district's timezone.
 *
 * Inclusive at both ends. A term ending 30 June is in force for the whole of 30 June —
 * an officer's last day is a day they hold office, not a day they spend locked out.
 */
export function isTermCurrent(term: Term, timezone: string, now: Date = new Date()): boolean {
  const today = localDate(timezone, now).getTime();
  if (term.startsOn.getTime() > today) return false;
  return term.endsOn === null || term.endsOn.getTime() >= today;
}

/** `YYYY-MM-DD`, for a `DATE` column arriving as UTC midnight. */
export function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Parses `YYYY-MM-DD` into the UTC midnight Prisma stores for a `DATE`. */
export function fromIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
