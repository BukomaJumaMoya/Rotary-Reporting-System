import { systemContext, withSystemActor } from '../platform/system-context.js';
import type { JobContextPayload, JobDefinition } from './define.js';

/**
 * Running one job, independently of pg-boss.
 *
 * Separated from the worker on purpose: everything that decides *what a job is allowed to
 * do* — validate the payload, resolve a scope, name the reason the audit log will record —
 * lives here and is testable without a queue. The worker is then only a loop.
 */

/**
 * A payload that does not match its schema. Dead on arrival: retrying it three times
 * reaches the same conclusion three times more slowly, so the worker dead-letters it
 * immediately rather than spending the retry budget.
 */
export class InvalidJobPayloadError extends Error {
  readonly issues: { path: string; message: string }[];

  constructor(jobName: string, issues: { path: string; message: string }[]) {
    super(
      `Payload for job ${jobName} failed validation: ` +
        issues.map((issue) => `${issue.path || '(root)'} ${issue.message}`).join('; '),
    );
    this.name = 'InvalidJobPayloadError';
    this.issues = issues;
  }
}

/**
 * Validates a payload, builds the system context it names, and runs the handler inside it.
 *
 * The handler never sees `districtId` or `rotaryYearId` — it sees a context. That is the
 * same discipline the HTTP side has, where a handler may not read a district from the
 * request body, and it exists for the same reason: an identifier a caller can name is an
 * identifier a caller can get wrong.
 */
export async function runJob<P extends JobContextPayload>(
  definition: JobDefinition<P>,
  rawPayload: unknown,
): Promise<void> {
  const parsed = definition.schema.safeParse(rawPayload);

  if (!parsed.success) {
    throw new InvalidJobPayloadError(
      definition.name,
      parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }

  const payload = parsed.data;

  const ctx = await systemContext({
    districtId: payload.districtId,
    rotaryYearId: payload.rotaryYearId,
    // A sentence somebody reads in the audit log a year from now. `describe` is required
    // on every definition so this can never degrade to the job's name alone.
    reason: definition.describe(payload),
  });

  await withSystemActor(ctx, () => definition.handler({ payload, ctx }));
}
