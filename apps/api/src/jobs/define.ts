import { z } from 'zod';
import type { SystemContext } from '../platform/system-context.js';

/**
 * A job definition: a name, a payload schema, and a handler that receives a context.
 *
 * Payloads are validated on RECEIPT, not merely on send. A queue is a boundary between
 * two processes and a database row in between — the row may have been written by an
 * older deployment, by a replay, or by hand during an incident — so a handler that
 * trusted `job.data` would be trusting whatever happened to be in a JSONB column. The
 * same reasoning as `withBody()` on the HTTP side, and deliberately the same shape.
 */

/**
 * What every payload must carry.
 *
 * A job has no session, so its district and year come from the payload and nowhere else;
 * `runJob` turns them into a `systemContext` before the handler is called. Requiring them
 * in the base schema is what makes "every job runs inside a scope" structural rather than
 * a convention each handler has to remember — a handler is handed a context, never the
 * ids, so there is nothing to forget and nothing to widen.
 */
export const jobContextSchema = z.object({
  districtId: z.uuid(),
  rotaryYearId: z.uuid(),
});

export type JobContextPayload = z.infer<typeof jobContextSchema>;

export interface JobHandlerInput<P> {
  readonly payload: P;
  /**
   * Scoped to the payload's district and year, with the job's reason attached. Handlers
   * reach the database through `db(ctx)` and never through `unscopedPrisma`: a job that
   * skips the scope is a job that will one day run against the wrong district.
   */
  readonly ctx: SystemContext;
}

export interface JobDefinition<P extends JobContextPayload = JobContextPayload> {
  /** The pg-boss queue name. Hyphenated: it becomes a partition name in `pgboss.job`. */
  readonly name: string;
  readonly schema: z.ZodType<P>;
  /**
   * The sentence that reaches `audit_log` for every write this job makes.
   *
   * Written from the payload so the log says *which* club was rescored, not merely that
   * something was. `systemContext` requires a reason for exactly this purpose.
   */
  readonly describe: (payload: P) => string;
  /** Attempts after the first before the job dead-letters. */
  readonly retryLimit?: number;
  /** Seconds before the first retry. Doubling per attempt when `retryBackoff`. */
  readonly retryDelaySeconds?: number;
  readonly retryBackoff?: boolean;
  /** How long a handler may run before pg-boss considers the attempt lost. */
  readonly expireInSeconds?: number;
  readonly handler: (input: JobHandlerInput<P>) => Promise<void>;
}

/**
 * Declares a job. The generic is inferred from the schema, so the handler's `payload` is
 * typed and a renamed field is a compile error at the handler rather than `undefined` at
 * three in the morning.
 */
export function defineJob<P extends JobContextPayload>(
  definition: JobDefinition<P>,
): JobDefinition<P> {
  return definition;
}

/** The queue a job's permanently-failed attempts land in. */
export function deadLetterQueueOf(name: string): string {
  return `${name}-dead`;
}
