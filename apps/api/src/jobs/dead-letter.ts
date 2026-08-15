import { AuditAction, withAuditActor } from '../platform/audit.js';
import { recordAction } from '../platform/db.js';

/**
 * What happens when a job gives up.
 *
 * pg-boss moves an exhausted job onto its queue's dead-letter partner, where it sits until
 * somebody looks. Nobody looks. So the worker also drains the dead-letter queues and writes
 * a `JOB_FAILED` row into `audit_log`, which an administrator already has a screen for
 * (`GET /audit`, `audit:read:district`).
 *
 * A silent dead job in a system that scores clubs is a club whose standing is wrong and
 * nobody knows. That is the failure this exists to make loud.
 *
 * **Job payloads must carry identifiers, never personal data.** This writes the payload
 * into the audit row so the job can be understood and re-run, and `audit_log` is read by
 * anyone holding `audit:read:district`.
 */

export interface DeadLetter {
  /** The queue the job died on — the original one, not the dead-letter partner. */
  queue: string;
  jobId: string;
  payload: unknown;
  error: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The district a dead job belonged to, if its payload names one credibly.
 *
 * Shape-checked, not merely typed: the commonest reason a job dead-letters is a payload
 * that failed validation, so this is precisely the case where `districtId` may be
 * rubbish — and `audit_log.district_id` is a UUID column. An unparseable value here would
 * make the INSERT fail, and `recordAction` swallows its own errors, so the record of the
 * failure would itself fail silently. Null is the honest answer.
 */
function districtIn(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const value = (payload as Record<string, unknown>)['districtId'];
  return typeof value === 'string' && UUID.test(value) ? value : null;
}

/**
 * Appends the failure to `audit_log`.
 *
 * `recordAction` never throws — a failure to record must not stop the worker draining the
 * rest of the dead letters — so this is safe to call in a loop.
 */
export async function recordDeadLetter(letter: DeadLetter): Promise<void> {
  const districtId = districtIn(letter.payload);

  console.error(`[jobs] DEAD LETTER ${letter.queue} ${letter.jobId}: ${letter.error}`);

  await withAuditActor({ districtId, userAgent: `system:job:${letter.queue}` }, () =>
    recordAction(AuditAction.JOB_FAILED, {
      entityType: 'jobs',
      // pg-boss job ids are UUIDs, which is what `audit_log.entity_id` is.
      entityId: letter.jobId,
      details: {
        queue: letter.queue,
        error: letter.error,
        payload: letter.payload,
      },
    }),
  );
}
