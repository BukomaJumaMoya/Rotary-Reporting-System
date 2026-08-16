/// <reference lib="webworker" />

import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { drainOutbox } from './lib/offline/outbox';
import { SYNC_TAG, send, sendFile } from './lib/offline/transport';

/**
 * The service worker.
 *
 * Written by hand rather than generated, for one reason: **Background Sync**. A generated
 * worker can cache, but it cannot be told what to do when the phone finds signal again while
 * the app is closed — and that is the case this milestone exists for. A secretary who files
 * three reports in a village with no coverage, locks the phone and gets on a bus should not
 * have to remember to open the app.
 *
 * The queue logic is NOT duplicated here. `drainOutbox` and the transport are the same
 * modules the page uses, so a background send posts exactly the body the member reviewed.
 */

declare const self: ServiceWorkerGlobalScope & {
  // Injected by `vite-plugin-pwa` in `injectManifest` mode. This exact expression is what
  // the plugin looks for; renaming it makes the build fail rather than silently precache
  // nothing, which is the right way round.
  __WB_MANIFEST: { url: string; revision: string | null }[];
};

// ─── The shell ───────────────────────────────────────────────────────────────

precacheAndRoute(self.__WB_MANIFEST);
// Drops precaches from previous Workbox versions. On a metered device an abandoned cache is
// storage the member paid for twice.
cleanupOutdatedCaches();

/**
 * Navigations fall back to the app shell — but NEVER for `/api`.
 *
 * Without the denylist a request for an endpoint that 404s would be answered with index.html
 * by the worker: the same failure the server-side catch-all was written to avoid in M2, and
 * harder to see because it only appears once the worker is installed.
 */
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/api\//],
  }),
);

// ─── Runtime caching ─────────────────────────────────────────────────────────

/**
 * The rules below are a data-protection requirement, not a performance one.
 *
 * A response carrying contact details must not outlive the session that fetched it. A shared
 * phone is the normal case in a Rotaract club, and a cache that survives a sign-out is the
 * predecessor's failure in a new form — so every API cache is either reference data with no
 * personal content, or short-lived, and `clearAllCaches()` empties the lot on sign-out.
 */

/**
 * Reference data: activity types, clubs, positions, clusters, regions.
 *
 * Stale-while-revalidate because it changes rarely and the reporting form is unusable
 * without it — a secretary opening `/report` with no signal should get the type list they saw
 * yesterday rather than an empty screen. None of it carries personal data.
 */
registerRoute(
  ({ url, request }) =>
    request.method === 'GET' &&
    /^\/api\/v1\/(activity-types|clubs|positions|clusters|regions)(\?|$)/.test(
      url.pathname + url.search,
    ),
  new StaleWhileRevalidate({
    cacheName: 'dis-reference',
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 7 }),
    ],
  }),
);

/**
 * Everything else the API serves, including responses that MAY carry contact details.
 *
 * Network-first with a short fallback: the cache exists so a page opened in a lift still
 * renders, not so the device keeps a copy of the district's members.
 */
registerRoute(
  ({ url, request }) => request.method === 'GET' && url.pathname.startsWith('/api/v1/'),
  new NetworkFirst({
    cacheName: 'dis-api',
    networkTimeoutSeconds: 4,
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 60 * 60 }),
    ],
  }),
);

/**
 * Photographs, fetched through short-lived signed URLs.
 *
 * Cache-first is safe: the key is immutable and the signature is part of the query, so a new
 * signature is a new entry rather than a stale image. Capped hard — a district's photo
 * library is not something a phone should end up holding.
 */
registerRoute(
  ({ url, request }) => request.method === 'GET' && /\/(activity-media|media)\//.test(url.pathname),
  new CacheFirst({
    cacheName: 'dis-media',
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 }),
    ],
  }),
);

// ─── Background Sync ─────────────────────────────────────────────────────────

/**
 * The browser fires this when it believes there is a usable connection, whether or not the
 * app is open. Chrome retries the event itself if the promise rejects, with its own backoff
 * — so the contract is: **reject if there is anything left to send**.
 *
 * Not `workbox-background-sync`. That plugin queues raw `Request` objects in its own store,
 * which cannot express the two things this queue needs: a `409` counted as success, and a
 * photograph that must follow the record it belongs to.
 */
self.addEventListener('sync', (event) => {
  const syncEvent = event as ExtendableEvent & { tag: string };
  if (syncEvent.tag !== SYNC_TAG) return;

  syncEvent.waitUntil(
    (async () => {
      const result = await drainOutbox({ send, sendFile });

      // Anything still SENDABLE means "try me again later". Permanently failed items are
      // excluded: they need the member, and retrying them would keep this event alive
      // forever over something no amount of signal will fix.
      if (result.pending > 0) throw new Error(`${result.pending} still queued`);

      // Tell any open tab, so the badge and the pending screen update without a poll.
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) client.postMessage({ type: 'outbox-drained' });
    })(),
  );
});

// ─── Update handling ─────────────────────────────────────────────────────────

/**
 * A new worker WAITS until the member asks for it (`registerType: 'prompt'`).
 *
 * Never `skipWaiting()` unprompted: taking over reloads the page, and a page reloaded under
 * somebody half way through a report is a report retyped from the beginning.
 */
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});
