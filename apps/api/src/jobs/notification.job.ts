import type { RequestContext } from '@dis/contracts';
import { z } from 'zod';
import {
  deliverNotification,
  notify,
  queueNotification,
  type NotifyInput,
} from '../modules/notifications/service.js';
import { currentQueue, enqueue } from './boss.js';
import { defineJob, jobContextSchema } from './define.js';

/**
 * Delivering one notification, off the request thread.
 *
 * The `notifications` row was always the queue conceptually (build log §5); this is what
 * makes it real. Delivery is a network call to a mail server, and a mail server that is
 * slow used to be an activity report that was slow to save.
 */

const notificationDeliveryPayload = jobContextSchema.extend({
  notificationId: z.uuid(),
});

export const notificationDeliveryJob = defineJob({
  name: 'notification-deliver',
  schema: notificationDeliveryPayload,
  describe: (payload) => `deliver notification ${payload.notificationId}`,
  // Mail servers fail for minutes, not seconds. Five attempts over roughly five minutes
  // with backoff, then the dead letter, which an administrator can read.
  retryLimit: 5,
  retryDelaySeconds: 15,
  retryBackoff: true,
  expireInSeconds: 60,
  handler: async ({ payload }) => {
    // Throws on a transport failure, which is what makes pg-boss retry. A permanent
    // failure — no template, no address — returns false and is recorded on the row.
    await deliverNotification(payload.notificationId);
  },
});

/**
 * Queues a notification and hands delivery to the worker.
 *
 * For callers that HAVE a context, which is every authenticated one. The unauthenticated
 * flows use `notify()` from the notifications module directly and deliver inline, because
 * a person is watching a form and waiting for the link.
 *
 * Falls back to inline delivery when this process has no queue — the seed, a test, and any
 * deployment where the worker has not started yet. The row is written either way, so the
 * worker's sweep would eventually find it regardless; the fallback exists so a notification
 * is not merely eventually delivered in an environment that has no worker at all.
 */
export async function notifyThroughQueue(
  ctx: RequestContext,
  input: NotifyInput,
): Promise<{ id: string; queued: boolean }> {
  const districtId = input.districtId ?? ctx.districtId;

  if (!currentQueue()) {
    const result = await notify({ ...input, districtId });
    return { id: result.id, queued: false };
  }

  const { id } = await queueNotification({ ...input, districtId });

  try {
    await enqueue(notificationDeliveryJob, {
      districtId: ctx.districtId,
      rotaryYearId: ctx.rotaryYearId,
      notificationId: id,
    });
    return { id, queued: true };
  } catch (error) {
    // The row is already QUEUED, so the sweep will pick it up. Logged rather than raised:
    // a failure to enqueue must not fail the MFA reset that caused it.
    console.error('[jobs] failed to enqueue notification delivery', error);
    return { id, queued: false };
  }
}
