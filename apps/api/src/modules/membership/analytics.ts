import type { RequestContext } from '@dis/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import { unscopedPrisma } from '../../platform/db.js';

/**
 * The two membership questions Prisma cannot express, and the ONE place in this module
 * that uses raw SQL.
 *
 * ⚠️ **RAW SQL BYPASSES THE SCOPE EXTENSION ENTIRELY.** `db(ctx)` rewrites arguments to
 * Prisma delegates; a `$queryRaw` goes straight to the driver and the extension never sees
 * it. So every query below takes `districtId`, `rotaryYearId` and `clubId` as BOUND
 * PARAMETERS read from the context, and every one of them names all three in its `WHERE`.
 * This is the one place in the codebase where the layer cannot protect you, and a query
 * here that forgets the district returns every district's membership.
 *
 * Parameters are bound through `Prisma.sql` tagged templates, never interpolated. That is
 * both the injection defence and the reason the district filter cannot be accidentally
 * dropped by a string concatenation.
 *
 * Why raw at all, against the convention that confines it to the assessment resolvers:
 *
 *  * **AS-AT reconstruction** needs `DISTINCT ON` over the event log with the supersede
 *    chain resolved. `club_rosters` answers "today"; a disputed scorecard turns on "who
 *    were we in March", and Prisma has no window functions.
 *  * **The statistics** are four aggregates over the same filtered set. Prisma `groupBy`
 *    could produce them as four round trips against a table that will hold six figures of
 *    rows by M5, and the arithmetic has to reconcile — a retention rate assembled from
 *    four separately-filtered queries is four chances for the filters to disagree.
 *
 * `unscopedPrisma` is the client because a raw query cannot be scoped by the extension
 * anyway; using `db(ctx)` here would suggest a protection that is not there. ESLint permits
 * the import from `platform/`, `modules/governance/` and `src/test/` only, so this file
 * carries an explicit exemption and the reason above.
 */

/** The event types that leave somebody ON the roster. Mirrors the club_rosters predicate. */
const JOINING = Prisma.sql`('JOIN','INDUCT','TRANSFER_IN','REINSTATE','CATEGORY_CHANGE')`;

/**
 * Only the tip of every supersede chain.
 *
 * Excludes events that HAVE BEEN superseded, not events that supersede — v1.0 of the schema
 * had this inverted, which discarded every correction while continuing to count the row it
 * corrected. The same predicate as `club_rosters`, deliberately: two definitions of "live"
 * is one definition that will disagree with the roster.
 */
function liveEvents(ctx: RequestContext, clubId: string | null, upTo: Date | null): Prisma.Sql {
  return Prisma.sql`
    SELECT me.*
    FROM membership_events me
    WHERE me.district_id = ${ctx.districtId}::uuid
      AND me.rotary_year_id = ${ctx.rotaryYearId}::uuid
      ${clubId ? Prisma.sql`AND me.club_id = ${clubId}::uuid` : Prisma.empty}
      ${upTo ? Prisma.sql`AND me.effective_on <= ${upTo}::date` : Prisma.empty}
      AND NOT EXISTS (
        SELECT 1 FROM membership_events c
        WHERE c.supersedes_event_id = me.id
          AND c.district_id = ${ctx.districtId}::uuid
      )
  `;
}

export interface RosterRow {
  person_id: string;
  club_id: string;
  member_category: string;
  since: Date;
}

/**
 * The roster as at a date, reconstructed from the log.
 *
 * NOT read from `club_rosters`: that view is today. This walks the events, resolves each
 * supersede chain to its tip, takes the latest event per (person, club) on or before the
 * date, and keeps the people whose latest event was a joining one.
 */
export async function rosterAsOf(
  ctx: RequestContext,
  input: { clubId: string | null; asOf: Date; personIds?: string[] },
): Promise<RosterRow[]> {
  return unscopedPrisma.$queryRaw<RosterRow[]>`
    WITH live AS (${liveEvents(ctx, input.clubId, input.asOf)}),
    ranked AS (
      SELECT DISTINCT ON (person_id, club_id)
             person_id, club_id, event_type, member_category, effective_on
      FROM live
      -- A CORRECTION is a retraction, not a state: it has already done its work by
      -- superseding its target, and ranking it would leave a member whose wrongly
      -- recorded TERMINATE was retracted still off the roster. Same predicate as
      -- club_rosters, deliberately.
      WHERE event_type <> 'CORRECTION'
      ORDER BY person_id, club_id, effective_on DESC, created_at DESC
    )
    SELECT person_id, club_id, member_category, effective_on AS since
    FROM ranked
    WHERE event_type IN ${JOINING}
    ORDER BY person_id
  `;
}

/** How many people were on the roster as at a date. */
export async function rosterSizeAsOf(
  ctx: RequestContext,
  input: { clubId: string | null; asOf: Date },
): Promise<number> {
  const rows = await unscopedPrisma.$queryRaw<{ count: bigint }[]>`
    WITH live AS (${liveEvents(ctx, input.clubId, input.asOf)}),
    ranked AS (
      SELECT DISTINCT ON (person_id, club_id) person_id, club_id, event_type
      FROM live
      WHERE event_type <> 'CORRECTION'
      ORDER BY person_id, club_id, effective_on DESC, created_at DESC
    )
    SELECT COUNT(*)::bigint AS count FROM ranked WHERE event_type IN ${JOINING}
  `;
  return Number(rows[0]?.count ?? 0);
}

export interface EventTally {
  event_type: string;
  reason_code: string | null;
  count: bigint;
}

/**
 * Every live event in the window, tallied by type and reason.
 *
 * ONE query rather than four, so the numbers reconcile by construction: joiners, leavers,
 * transitions and the reason breakdown are all projections of the same filtered set, and
 * four separately-filtered queries are four chances for the filters to disagree.
 */
export async function tallyEvents(
  ctx: RequestContext,
  input: { clubId: string | null; from: Date; to: Date },
): Promise<EventTally[]> {
  return unscopedPrisma.$queryRaw<EventTally[]>`
    WITH live AS (${liveEvents(ctx, input.clubId, null)})
    SELECT event_type::text AS event_type, reason_code, COUNT(*)::bigint AS count
    FROM live
    WHERE effective_on >= ${input.from}::date
      AND effective_on <= ${input.to}::date
    GROUP BY event_type, reason_code
  `;
}

/**
 * Rebuilds `club_rosters`.
 *
 * CONCURRENTLY, so readers are not blocked while it runs — which matters because it runs
 * after every membership write, and a club secretary recording twelve inductions should not
 * lock the roster twelve times. It needs the unique index `club_rosters_pk`, which exists.
 *
 * Never fails its caller: a stale roster is a page showing yesterday's number, and a
 * membership event that was refused because the view could not be rebuilt is a fact the
 * district has lost.
 */
export async function refreshRoster(): Promise<void> {
  try {
    await unscopedPrisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW CONCURRENTLY club_rosters');
  } catch (error) {
    // CONCURRENTLY cannot run inside a transaction block and cannot populate a view for
    // the first time. Fall back rather than leave the roster wrong.
    try {
      await unscopedPrisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW club_rosters');
    } catch (fallbackError) {
      console.error('[membership] roster refresh failed', error, fallbackError);
    }
  }
}
