import type PgBoss from 'pg-boss';
import type { AnyJobDefinition } from './boss.js';
import { recordDeadLetter } from './dead-letter.js';
import { deadLetterQueueOf } from './define.js';
import { InvalidJobPayloadError, runJob } from './runner.js';

/**
 * Attaching handlers to queues.
 *
 * Extracted from `worker.ts` so the tests can drive the REAL wiring — retry, dead letter,
 * payload validation — rather than a second copy of it that agrees with the worker only
 * until somebody edits one of them.
 */

/**
 * One job at a time. pg-boss fails the WHOLE batch when a handler rejects, so a batch of
 * ten would retry nine jobs that had already succeeded.
 */
export const WORK_OPTIONS = { batchSize: 1, pollingIntervalSeconds: 2 } as const;

export async function attachHandlers(
  boss: PgBoss,
  jobs: readonly AnyJobDefinition[],
  options: { pollingIntervalSeconds?: number } = {},
): Promise<void> {
  const workOptions = {
    ...WORK_OPTIONS,
    ...(options.pollingIntervalSeconds === undefined
      ? {}
      : { pollingIntervalSeconds: options.pollingIntervalSeconds }),
  };

  for (const job of jobs) {
    await boss.work(job.name, workOptions, async (received) => {
      for (const one of received) {
        try {
          await runJob(job, one.data);
        } catch (error) {
          if (error instanceof InvalidJobPayloadError) {
            // Dead on arrival. Retrying a payload that cannot parse reaches the same
            // conclusion four more times, so it goes straight to the record an
            // administrator reads and the job completes rather than burning its budget.
            await recordDeadLetter({
              queue: job.name,
              jobId: one.id,
              payload: one.data,
              error: error.message,
            });
            continue;
          }
          // Anything else is presumed transient. Rethrown so pg-boss retries with backoff
          // and, once the budget is exhausted, moves the job to its dead-letter queue.
          throw error;
        }
      }
    });

    // The dead-letter queue for the same job. pg-boss carries the original payload across
    // as `data` and the failure as `output`, so the record is enough to understand the job
    // and re-run it.
    await boss.work(
      deadLetterQueueOf(job.name),
      { ...workOptions, includeMetadata: true },
      async (received) => {
        for (const one of received) {
          await recordDeadLetter({
            queue: job.name,
            jobId: one.id,
            payload: one.data,
            error: describeFailure(one.output),
          });
        }
      },
    );
  }
}

/** pg-boss stores whatever the handler rejected with in `output`; usually a serialised Error. */
export function describeFailure(output: unknown): string {
  if (output === null || output === undefined) return 'Job failed with no recorded error';
  if (typeof output === 'string') return output;
  if (typeof output === 'object') {
    const candidate = output as { message?: unknown; value?: unknown };
    if (typeof candidate.message === 'string') return candidate.message;
    if (typeof candidate.value === 'string') return candidate.value;
  }
  return JSON.stringify(output).slice(0, 1000);
}
