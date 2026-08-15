import type { RequestContext } from '@dis/contracts';
import { db } from '../../platform/db.js';

/**
 * Membership — the event log and the roster derived from it (axiom 3).
 *
 * The module proper lands in M2 session 6. What is here now is the one function `org` needs
 * to render a club summary, exported as a SERVICE function rather than left as a query the
 * org module writes against `club_rosters` itself. The dependency rule is what keeps that
 * honest: no module reads another's tables, so the day the roster gains a
 * `member_category` filter or an `asOf` reconstruction there is one place to change.
 */

/**
 * How many members a club has right now.
 *
 * Read from `club_rosters`, the materialised view — never from `membership_events`
 * directly. The view holds the tip of every supersede chain, which is the fix schema v1.6
 * made: v1.0 filtered on `supersedes_event_id IS NULL` and so discarded every correction
 * while continuing to count the row it corrected.
 */
export async function countRoster(ctx: RequestContext, clubId: string): Promise<number> {
  return db(ctx).clubRoster.count({ where: { clubId } });
}
