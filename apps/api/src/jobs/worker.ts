import { config } from '../platform/config.js';
import { disconnect } from '../platform/db.js';
import { startQueue, stopQueue } from './boss.js';
import { JOBS } from './registry.js';
import { sweepNotifications } from './sweep.js';
import { attachHandlers } from './work.js';

/**
 * The worker process. `npm run worker`, and the `worker` process group in fly.toml.
 *
 * Deliberately separate from the API. A long job must not compete with a request for the
 * event loop, and a worker that crashes must not take the API down with it — which is why
 * they are two Fly process groups rather than one process doing both. The API's health
 * check covers the API alone.
 */

/** How often the queued-notification safety net runs. */
const SWEEP_INTERVAL_MS = 60_000;

async function main(): Promise<void> {
  console.log(`[worker] starting (${config.NODE_ENV})`);

  const boss = await startQueue('worker', JOBS);
  await attachHandlers(boss, JOBS);

  const sweep = setInterval(() => {
    void sweepNotifications().catch((error: unknown) => {
      console.error('[worker] notification sweep failed', error);
    });
  }, SWEEP_INTERVAL_MS);
  // The queue's own connections hold the process open; nothing should be kept alive by
  // this timer alone.
  sweep.unref();

  console.log(
    `[worker] draining ${JOBS.length} queue(s): ${JOBS.map((job) => job.name).join(', ')}`,
  );

  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    console.log(`[worker] ${signal} — finishing in-flight jobs`);
    clearInterval(sweep);

    void (async () => {
      try {
        await stopQueue();
        await disconnect();
      } catch (error) {
        console.error('[worker] shutdown failed', error);
      } finally {
        process.exit(0);
      }
    })();
  };

  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
}

main().catch((error: unknown) => {
  console.error('[worker] failed to start', error);
  process.exit(1);
});
