import { createApp } from './app.js';
import { startQueue } from './jobs/boss.js';
import { JOBS } from './jobs/registry.js';
import { config } from './platform/config.js';

const app = createApp();

app.listen(config.PORT, () => {
  console.log(`[api] listening on http://localhost:${config.PORT} (${config.NODE_ENV})`);
});

/**
 * The API's queue client SENDS and never works.
 *
 * Started after `listen` and deliberately not awaited before it: the API must serve
 * requests whether or not the queue is reachable. Every caller that enqueues checks
 * `currentQueue()` first and falls back to doing the work inline, so a queue that is down
 * degrades notification latency rather than refusing sign-ins.
 */
startQueue('sender', JOBS).catch((error: unknown) => {
  console.error('[api] job queue unavailable — notifications will deliver inline', error);
});
