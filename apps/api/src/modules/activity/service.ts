import type { RequestContext } from '@dis/contracts';
import { db } from '../../platform/db.js';

/**
 * Activities — one model, configurable types (axiom 4).
 *
 * The module proper lands in M2 session 9. What is here now is the counting `org` needs for
 * a club summary, exported as a SERVICE function rather than left as a query the org module
 * writes against `activities` itself. Dependencies point one way and modules talk through
 * exported functions; the day "counts towards the scorecard" stops meaning "every row" —
 * because `is_scoring_eligible` is false on extra club activities — there is one place to
 * change rather than two that disagree.
 */

export interface ClubActivityCounts {
  total: number;
  verified: number;
  unverified: number;
}

/**
 * Activities this club HOSTED in the context's Rotary Year.
 *
 * `host_scope_type`/`host_scope_id` rather than a `club_id` column: the same table holds
 * cluster, committee and district activities, and a polymorphic host is what lets one
 * activity model serve all of them. Soft-deleted rows are filtered by the layer.
 */
export async function countForClub(
  ctx: RequestContext,
  clubId: string,
): Promise<ClubActivityCounts> {
  const rows = await db(ctx).activity.groupBy({
    by: ['verification'],
    where: { hostScopeType: 'CLUB', hostScopeId: clubId },
    _count: { _all: true },
  });

  let total = 0;
  let verified = 0;

  for (const row of rows) {
    const count = row._count._all;
    total += count;
    if (row.verification === 'VERIFIED') verified += count;
  }

  // QUERIED and REJECTED are counted as unverified rather than given their own field: the
  // question a club profile answers is "how much of what we reported has been accepted".
  return { total, verified, unverified: total - verified };
}
