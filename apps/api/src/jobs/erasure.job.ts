import { z } from 'zod';
import { performErasure } from '../modules/people/service.js';
import { defineJob, jobContextSchema } from './define.js';

/**
 * Anonymising a person, once the district has approved it.
 *
 * A job rather than a request handler for two reasons. It touches the roster history of
 * every club the member ever belonged to, which is not work that belongs on the thread of
 * an officer clicking Approve; and it must run under a SYSTEM context, so `audit_log`
 * records that the anonymisation happened because an approved erasure request said so,
 * rather than attributing a member's whole record being blanked to whichever officer
 * happened to press the button.
 *
 * It anonymises and does not delete: `membership_events` is append-only, and a club's
 * retention rate for 2027-28 is a fact about the club that must not change retroactively
 * because a member left in 2029.
 */
export const erasureJob = defineJob({
  name: 'person-erasure',
  schema: jobContextSchema.extend({ requestId: z.uuid() }),
  describe: (payload) => `erasure request ${payload.requestId} approved and executed`,
  // One retry only. If this fails twice the request stays APPROVED and visible on the
  // review screen, which is the state somebody should look at rather than a job quietly
  // trying again for an hour.
  retryLimit: 1,
  retryDelaySeconds: 30,
  expireInSeconds: 120,
  handler: async ({ payload, ctx }) => {
    const done = await performErasure(ctx, payload.requestId);
    if (!done) {
      // Not an error worth retrying: the request was rejected, already completed, or
      // belongs to a district this context cannot see. Logged so the queue's record shows
      // the job ran and chose to do nothing.
      console.log(`[jobs] erasure ${payload.requestId} skipped — not APPROVED`);
    }
  },
});
