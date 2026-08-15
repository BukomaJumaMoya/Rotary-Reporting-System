import { deliverNotification, findDueNotifications } from '../modules/notifications/service.js';

/**
 * The safety net under the queue.
 *
 * `notifications` rows are written first and enqueued second (see `notifyThroughQueue`), so
 * a process that dies between the two leaves a QUEUED row with no job. The sweep is what
 * makes that recoverable rather than merely unlikely — and it is also the whole delivery
 * path in any deployment where a notification was written by a process with no queue at
 * all, which includes the seed.
 *
 * It runs on the worker's own timer rather than as a queued job. A job would need a
 * district and a Rotary Year in its payload to build a system context, and this table is
 * deliberately unscoped: password reset writes a notification before any session, and
 * therefore any district, exists.
 */

/** Delivers up to `limit` due notifications. Never throws. */
export async function sweepNotifications(limit = 50): Promise<{ attempted: number }> {
  const due = await findDueNotifications(limit);

  for (const notification of due) {
    try {
      await deliverNotification(notification.id);
    } catch {
      // Recorded on the row by deliverNotification, with the attempt count. The sweep
      // will find it again on the next pass; a row that keeps failing is visible as a
      // FAILED status with a rising `attempts`, which is what the delivery log is for.
    }
  }

  return { attempted: due.length };
}
