import type { OutboxItem } from './outbox';

/**
 * How a queued item actually goes over the wire.
 *
 * Split out from `submit.ts` because the SERVICE WORKER needs it too — Background Sync fires
 * in a worker with no DOM, no React and no page, and it has to send exactly what the page
 * would have sent. Two copies of this would be two chances for the worker to post a subtly
 * different body than the one the member reviewed.
 *
 * Nothing here touches the DOM, so it type-checks against both `lib.dom` and
 * `lib.webworker`.
 */

const BASE = '/api/v1';

/**
 * The Background Sync tag.
 *
 * Lives here rather than in `submit.ts` so both halves import the same constant: the page
 * registers this tag, the worker listens for it, and a typo in either would produce a queue
 * that silently never drains in the background.
 */
export const SYNC_TAG = 'dis-outbox';

export async function send(item: OutboxItem): Promise<Response> {
  return fetch(`${BASE}${item.endpoint}`, {
    method: item.method,
    // The session lives in an HttpOnly cookie (ADR-003). A service worker's fetch carries it
    // only with `credentials: 'include'`; without this every background send 401s.
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item.body),
  });
}

export async function sendFile(item: OutboxItem, file: Blob): Promise<Response> {
  const form = new FormData();
  form.append('file', file);
  // No Content-Type header: the browser has to set it so it can add the multipart boundary.
  // Addressed by the parent's id, which is why files go up only after it exists.
  return fetch(`${BASE}${item.endpoint}/${item.id}/media`, {
    method: 'POST',
    credentials: 'include',
    body: form,
  });
}
