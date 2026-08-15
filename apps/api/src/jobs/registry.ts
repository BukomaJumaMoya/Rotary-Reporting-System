import type { AnyJobDefinition } from './boss.js';
import { erasureJob } from './erasure.job.js';
import { mediaProcessingJob } from './media.job.js';
import { notificationDeliveryJob } from './notification.job.js';

/**
 * Every job the system knows how to run.
 *
 * One list, read by `ensureQueues` to provision the queues and by the worker to attach a
 * handler to each. A job that is defined and not listed here has a handler nobody calls
 * and a queue nobody created — which looks exactly like a job that is merely slow.
 *
 * The scoring job (M5), goal snapshots (M7) and export generation (M7) join this list.
 */
export const JOBS: readonly AnyJobDefinition[] = [
  notificationDeliveryJob,
  erasureJob,
  mediaProcessingJob,
];

export function jobByName(name: string): AnyJobDefinition | undefined {
  return JOBS.find((job) => job.name === name);
}
