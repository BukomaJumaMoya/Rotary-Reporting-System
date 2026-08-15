import type { RequestContext } from '@dis/contracts';

/**
 * Assessment — the scoring engine (axiom 5). Built in M5.
 *
 * What exists here now is ONE function, and it is a no-op on purpose.
 *
 * An activity write invalidates whatever the club last scored: a service project reported in
 * March changes the March scorecard, and a scorecard that does not know it is stale is a
 * scorecard somebody prints. `modules/activity` therefore calls `markStale()` today, against
 * a function that does nothing, so that M5 fills in a body rather than going back through
 * the activity module adding call sites — and so `modules/activity` never learns anything
 * about `club_assessments`.
 *
 * The dependency rule points one way: `assessment` may call `activity`, `membership`,
 * `finance` and `org`; none of them may call `assessment`. This function is the deliberate
 * exception, and it is why it takes only ids and returns nothing — it is a NOTIFICATION, not
 * a query. Nothing here may ever return assessment data to a caller in `activity`.
 */

export interface StaleTarget {
  /** The club whose scorecard is affected. */
  clubId: string;
  /** Why, for the audit trail M5 will write. */
  reason: string;
}

/**
 * Marks a club's current-period assessment as needing recomputation.
 *
 * **No-op until M5.** `club_assessment_states.is_stale` is a derived column on a view, and
 * the flag M5 will set lives on `club_assessments` — neither exists as a write path yet.
 * The signature is what matters: an id and a reason, nothing returned.
 */
export async function markStale(_ctx: RequestContext, _target: StaleTarget): Promise<void> {
  // M5: find the OPEN period for this district-year, find or create the club_assessment,
  // set is_stale, and let the scoring job pick it up.
  await Promise.resolve();
}
