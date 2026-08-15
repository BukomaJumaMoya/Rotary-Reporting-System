import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { unscopedPrisma } from '../platform/db.js';
import { createOrg, resetDatabase, type OrgFixture } from '../test/helpers.js';
import { enqueue, startQueue, stopQueue } from './boss.js';
import { deadLetterQueueOf, defineJob, jobContextSchema } from './define.js';
import { attachHandlers } from './work.js';

/**
 * The queue itself, against a real pg-boss on the test database.
 *
 * The unit tests in `runner.test.ts` prove what a job is allowed to do. This one proves the
 * parts that only exist once there is a queue: that an enqueued job is actually picked up,
 * that a failing one retries and then dead-letters, and that the dead letter lands somewhere
 * an administrator can read. That last is the one worth the seconds it costs — a job that
 * dies quietly in a system that scores clubs is a club whose standing is wrong and nobody
 * knows.
 */

/** Attempts made per job name, so a handler can fail the first time and succeed later. */
const attempts = new Map<string, number>();

function countAttempt(name: string): number {
  const next = (attempts.get(name) ?? 0) + 1;
  attempts.set(name, next);
  return next;
}

const succeedingJob = defineJob({
  name: 'test-queue-ok',
  schema: jobContextSchema,
  describe: () => 'a job that succeeds',
  retryLimit: 1,
  retryDelaySeconds: 1,
  retryBackoff: false,
  handler: async () => {
    countAttempt('ok');
    await Promise.resolve();
  },
});

const failingJob = defineJob({
  name: 'test-queue-fail',
  schema: jobContextSchema,
  describe: () => 'a job that always fails',
  // One retry, so the whole retry-then-dead-letter cycle takes seconds rather than minutes.
  retryLimit: 1,
  retryDelaySeconds: 1,
  retryBackoff: false,
  handler: async () => {
    countAttempt('fail');
    await Promise.resolve();
    throw new Error('this job never works');
  },
});

const TEST_JOBS = [succeedingJob, failingJob];

async function waitFor(
  description: string,
  predicate: () => Promise<boolean>,
  timeoutMs = 25_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for: ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

describe('the job queue', () => {
  let org: OrgFixture;

  beforeAll(async () => {
    const boss = await startQueue('worker', TEST_JOBS);
    // Queue names are stable so the test does not create a new partition table per run.
    // Anything a previous, interrupted run left behind would otherwise be worked here.
    for (const job of TEST_JOBS) {
      await boss.purgeQueue(job.name);
      await boss.purgeQueue(deadLetterQueueOf(job.name));
    }
    await attachHandlers(boss, TEST_JOBS, { pollingIntervalSeconds: 1 });
  });

  afterAll(async () => {
    await stopQueue();
  });

  beforeEach(async () => {
    await resetDatabase();
    attempts.clear();
    org = await createOrg();
  });

  it('runs an enqueued job', async () => {
    const id = await enqueue(succeedingJob, {
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
    });

    expect(id).toBeTruthy();
    await waitFor('the job to run', () => Promise.resolve((attempts.get('ok') ?? 0) >= 1));
  });

  it('retries a failing job and then dead-letters it, visibly', async () => {
    await enqueue(failingJob, {
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
    });

    // Two attempts: the first, and the one retryLimit buys.
    await waitFor('the retry', () => Promise.resolve((attempts.get('fail') ?? 0) >= 2));

    await waitFor('the dead letter to be recorded', async () => {
      const count = await unscopedPrisma.auditLogEntry.count({
        where: { action: 'JOB_FAILED', entityType: 'jobs' },
      });
      return count >= 1;
    });

    const entry = await unscopedPrisma.auditLogEntry.findFirst({
      where: { action: 'JOB_FAILED', entityType: 'jobs' },
    });

    // The district comes from the payload, so the failure is readable by the district it
    // belongs to rather than filed under nobody.
    expect(entry?.districtId).toBe(org.districtId);
    const after = entry?.after as { queue?: string; error?: string } | null;
    expect(after?.queue).toBe(failingJob.name);
    expect(after?.error).toContain('this job never works');
  });

  it('dead-letters a malformed payload immediately, without spending its retries', async () => {
    // Sent past the typed `enqueue`, because the whole point is a payload the schema
    // rejects — which is what a replay from an older deployment looks like.
    const boss = await startQueue('worker', TEST_JOBS);
    await boss.send(failingJob.name, { districtId: 'not-a-uuid' });

    await waitFor('the dead letter', async () => {
      const count = await unscopedPrisma.auditLogEntry.count({
        where: { action: 'JOB_FAILED', entityType: 'jobs' },
      });
      return count >= 1;
    });

    // The handler was never called: a payload that cannot parse will not parse on a retry
    // either, so it does not get three chances to prove it.
    expect(attempts.get('fail') ?? 0).toBe(0);
  });
});
