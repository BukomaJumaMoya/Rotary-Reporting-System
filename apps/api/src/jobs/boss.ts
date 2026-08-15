import PgBoss from 'pg-boss';
import { config } from '../platform/config.js';
import { deadLetterQueueOf, type JobContextPayload, type JobDefinition } from './define.js';

/**
 * The queue client and its lifecycle.
 *
 * pg-boss against the SAME PostgreSQL database as everything else — no Redis, no broker,
 * no second thing to operate (ADR-001, ADR-008). Its tables live in the `pgboss` schema,
 * created by `20260816000000_pgboss_schema`, which is generated from pg-boss's own
 * construction plans rather than hand-written.
 *
 * `migrate: false` on both processes for that reason: the schema is applied by the release
 * command, once, before either process takes traffic. Letting two machines migrate at
 * start-up instead would race, and the loser would be an API sending into a schema that
 * did not exist yet.
 *
 * This file deliberately does NOT import the job registry. `modules/notifications` enqueues
 * work and the notification job calls back into that module, so a registry import here
 * would close a cycle through every handler. The job list is passed in instead.
 */

export type QueueRole = 'sender' | 'worker';

/** Anything the queue accepts. Definitions are invariant in their payload, so the list is `any`-free via this. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see below.
export type AnyJobDefinition = JobDefinition<any>;
//
// `JobDefinition<JobContextPayload>` would not do: a definition whose schema narrows the
// payload is not assignable to one whose schema is the base, because `handler` is
// contravariant in it. The registry only ever reads `name` and the queue options, so the
// payload type is genuinely irrelevant here — and `runJob` re-validates before any
// handler sees anything.

let instance: PgBoss | undefined;
let starting: Promise<PgBoss> | undefined;

function createInstance(role: QueueRole): PgBoss {
  return new PgBoss({
    connectionString: config.DATABASE_URL,
    schema: 'pgboss',
    migrate: false,
    // Maintenance and cron belong to the worker alone. Running them in the API would have
    // every web machine archiving and polling schedules in parallel — work done N times to
    // the same effect, and contention on the same rows.
    supervise: role === 'worker',
    schedule: role === 'worker',
    // The API only sends; it does not need a pool the size of the worker's. Both are
    // deliberately small: this is one district on managed Postgres, where the connection
    // ceiling is low and over-provisioning fails worse than a short queue.
    max: role === 'worker' ? 4 : 2,
  });
}

/**
 * Declares every queue and its dead-letter partner.
 *
 * Idempotent — `pgboss.create_queue` is `ON CONFLICT DO NOTHING` — and run by both roles,
 * so neither has to start before the other. The dead-letter queue is created FIRST,
 * because `pgboss.queue.dead_letter` is a foreign key to `pgboss.queue.name`.
 */
export async function ensureQueues(boss: PgBoss, jobs: readonly AnyJobDefinition[]): Promise<void> {
  for (const job of jobs) {
    const deadLetter = deadLetterQueueOf(job.name);

    await boss.createQueue(deadLetter);
    await boss.createQueue(job.name, {
      name: job.name,
      deadLetter,
      // Three attempts, doubling from ten seconds. A mail server that is down is usually
      // down for minutes, and a job that gives up after three seconds has not really tried.
      retryLimit: job.retryLimit ?? 3,
      retryDelay: job.retryDelaySeconds ?? 10,
      retryBackoff: job.retryBackoff ?? true,
      expireInSeconds: job.expireInSeconds ?? 120,
    });
  }
}

/**
 * Starts the queue for this process, or returns the one already running.
 *
 * The PROMISE is cached rather than the instance, so two concurrent callers during
 * start-up wait on one `start()` instead of racing to build two pools.
 */
export async function startQueue(
  role: QueueRole,
  jobs: readonly AnyJobDefinition[],
): Promise<PgBoss> {
  if (instance) return instance;
  if (starting) return starting;

  starting = (async () => {
    const boss = createInstance(role);

    // pg-boss emits `error` on the EventEmitter for background failures — a connection
    // lost during maintenance, say. Unhandled, an EventEmitter 'error' takes the process
    // down, which would turn a transient database blip into a restart loop.
    boss.on('error', (error) => {
      console.error('[jobs] pg-boss error', error);
    });

    await boss.start();
    await ensureQueues(boss, jobs);

    instance = boss;
    return boss;
  })();

  try {
    return await starting;
  } catch (error) {
    starting = undefined;
    throw error;
  }
}

/** The running queue, or undefined. Callers that must not fail use this to fall back. */
export function currentQueue(): PgBoss | undefined {
  return instance;
}

export async function stopQueue(): Promise<void> {
  const boss = instance;
  instance = undefined;
  starting = undefined;
  if (!boss) return;
  // `wait` lets in-flight handlers finish rather than being killed mid-write, which for a
  // job part-way through a scored change is the difference between a retry and a repair.
  await boss.stop({ wait: true, graceful: true });
}

/**
 * Enqueues a job. Typed against its definition, so the payload cannot drift from the
 * schema the handler validates it with.
 *
 * Returns the job id, or null when pg-boss declined the insert (a `singletonKey`
 * collision). Throws when no queue is running — a caller that must not fail checks
 * `currentQueue()` first and does the work inline, as notification delivery does for
 * password reset.
 */
export async function enqueue<P extends JobContextPayload>(
  definition: JobDefinition<P>,
  payload: P,
  options: { startAfterSeconds?: number; singletonKey?: string } = {},
): Promise<string | null> {
  const boss = instance;
  if (!boss) {
    throw new Error(
      `Cannot enqueue ${definition.name}: no queue is running in this process. ` +
        'Call startQueue() at boot, or check currentQueue() and do the work inline.',
    );
  }

  return boss.send(definition.name, payload, {
    ...(options.startAfterSeconds === undefined ? {} : { startAfter: options.startAfterSeconds }),
    ...(options.singletonKey === undefined ? {} : { singletonKey: options.singletonKey }),
  });
}
