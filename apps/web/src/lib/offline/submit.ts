import { useSyncExternalStore } from 'react';
import { probeConnection } from './connectivity';
import {
  allItems,
  drainOutbox,
  enqueue,
  pendingCount,
  subscribeToOutbox,
  type OutboxItem,
} from './outbox';
import { SYNC_TAG, send, sendFile } from './transport';

/**
 * The one submission path for anything a club officer creates offline.
 *
 * **Write first, send second — always.** Not "send, and queue if it fails": the case that
 * loses a report is the request that left the device and whose response never came back,
 * and by then there is nothing to queue from. Writing to IndexedDB first costs a millisecond
 * and makes that case survivable.
 */

export interface SubmitInput {
  /** The client-generated UUID. Also the record's id on the server. */
  id: string;
  kind: string;
  label: string;
  endpoint: string;
  body: Record<string, unknown>;
  files?: Blob[];
  /** Another queued submission that has to reach the server first. */
  dependsOn?: string | null;
}

export interface SubmitResult {
  /** True when it reached the server on this attempt. False means queued, not failed. */
  delivered: boolean;
  id: string;
  /** Why it is still queued, when it is. `null` while there is simply no connection. */
  error: string | null;
  /**
   * Field-level messages from a rejection, keyed by field, so a queued submission that the
   * server refused can still put "narrative report is required" on the control.
   */
  fieldErrors: Record<string, string>;
}

/**
 * Queues a submission and, if there is a connection, sends it immediately.
 *
 * Returns `delivered: false` for a queued item. That is not a failure and the UI must not
 * present it as one — the member's work is safely on the device and will go when the signal
 * does.
 */
export async function submit(input: SubmitInput): Promise<SubmitResult> {
  const item: OutboxItem = {
    id: input.id,
    kind: input.kind,
    label: input.label,
    endpoint: input.endpoint,
    method: 'POST',
    body: input.body,
    files: input.files ?? [],
    dependsOn: input.dependsOn ?? null,
    createdAt: Date.now(),
    attempts: 0,
    lastError: null,
    lastErrorDetails: null,
    nextAttemptAt: 0,
    status: 'queued',
  };

  try {
    await enqueue(item);
  } catch (error) {
    // IndexedDB is unavailable — a locked-down browser, a private window in some versions of
    // Firefox, storage denied. Rare, but the consequence of doing nothing here is a member
    // who cannot file a report AT ALL, which is far worse than one who cannot file offline.
    // So: send it directly, and tell the truth about what happened.
    console.warn('[offline] the outbox is unavailable — sending directly', error);
    return sendWithoutQueue(item);
  }

  // Registered before the attempt, so a tab closed mid-request still has a drain scheduled.
  await registerBackgroundSync();

  await drainOutbox({ send, sendFile });

  // Whether OUR item got through, not whether the drain sent anything — a queue holding
  // three older reports could send two of them and still leave this one waiting.
  const stillQueued = await allItems();
  const mine = stillQueued.find((queued) => queued.id === input.id);

  return {
    delivered: mine === undefined,
    id: input.id,
    error: mine?.lastError ?? null,
    fieldErrors: fieldErrorsFrom(mine?.lastErrorDetails ?? null, mine?.lastError ?? null),
  };
}

/**
 * Turns the API's error `details` into a map a form can render.
 *
 * Two shapes, both from `platform/errors.ts`: `details.fields` is Zod's list from a 400, and
 * `details.key` names the single declared field a domain rule rejected.
 */
function fieldErrorsFrom(
  details: Record<string, unknown> | null,
  message: string | null,
): Record<string, string> {
  if (!details) return {};

  const fields = details['fields'];
  if (Array.isArray(fields)) {
    const result: Record<string, string> = {};
    for (const entry of fields) {
      const field = entry as { path?: unknown; message?: unknown };
      if (typeof field.path === 'string' && typeof field.message === 'string') {
        result[field.path] = field.message;
      }
    }
    return result;
  }

  const key = details['key'];
  if (typeof key === 'string') return { [key]: message ?? 'This is required.' };
  return {};
}

/**
 * The no-queue path, for a browser that will not give us IndexedDB.
 *
 * One attempt, no retry, no persistence — everything the outbox exists to provide is gone.
 * The member is told plainly rather than being shown "saved" for something that is not.
 */
async function sendWithoutQueue(item: OutboxItem): Promise<SubmitResult> {
  try {
    const response = await send(item);
    if (!response.ok && response.status !== 409) {
      const body: unknown = await response.json().catch(() => null);
      const error = (
        body as { error?: { message?: string; details?: Record<string, unknown> } } | null
      )?.error;
      const message = error?.message ?? `Request failed (${response.status})`;
      return {
        delivered: false,
        id: item.id,
        error: message,
        fieldErrors: fieldErrorsFrom(error?.details ?? null, message),
      };
    }

    for (const file of item.files) await sendFile(item, file).catch(() => undefined);
    return { delivered: true, id: item.id, error: null, fieldErrors: {} };
  } catch {
    return {
      delivered: false,
      id: item.id,
      // Named as what it is. Without an outbox there is nothing holding this, so "it will be
      // sent later" would be a lie.
      error: 'This device cannot save work offline, and there is no connection. Try again.',
      fieldErrors: {},
    };
  }
}

/** Drains everything due. Called by the scheduler, by the retry button, and after sign-in. */
export async function drain(): Promise<void> {
  await drainOutbox({ send, sendFile });
}

// ─── Scheduling ──────────────────────────────────────────────────────────────

/**
 * Background Sync where it exists, an interval everywhere else.
 *
 * The fallback is not only for iOS Safari, which has never shipped Background Sync. A
 * service worker requires a SECURE CONTEXT, so on any plain-http origin that is not
 * localhost — which is how this system gets tested from a phone on a LAN address — there is
 * no worker at all and therefore no Background Sync either. The interval is the path that
 * always works, and the queue is correct with nothing but it.
 */
async function registerBackgroundSync(): Promise<void> {
  try {
    if (!('serviceWorker' in navigator)) return;

    const registration = await navigator.serviceWorker.ready;
    const sync = (
      registration as ServiceWorkerRegistration & {
        sync?: { register(tag: string): Promise<void> };
      }
    ).sync;
    await sync?.register(SYNC_TAG);
  } catch {
    // Unsupported or unavailable. The interval below covers it.
  }
}

let timer: ReturnType<typeof setInterval> | undefined;

/** Every 30 seconds, plus whenever the browser thinks the network came back. */
const DRAIN_INTERVAL_MS = 30_000;

export function startOutboxScheduler(): () => void {
  const tick = (): void => {
    void (async () => {
      // No outbox on this device, so there is nothing to drain and no probe worth spending.
      const items = await allItems().catch(() => [] as OutboxItem[]);
      // Nothing sendable: do not spend a probe. Members pay per megabyte.
      if (items.every((item) => item.status === 'failed')) return;

      if (!(await probeConnection())) return;
      await drain();
    })();
  };

  timer ??= setInterval(tick, DRAIN_INTERVAL_MS);

  const onOnline = (): void => tick();
  window.addEventListener('online', onOnline);
  // Coming back to the tab is the commonest moment a member expects their queue to move.
  document.addEventListener('visibilitychange', onOnline);

  // The service worker drained the queue in the background while this tab sat idle. Without
  // this the badge would still be showing three until something else happened to refresh it.
  const onWorkerMessage = (event: MessageEvent): void => {
    if ((event.data as { type?: string } | null)?.type === 'outbox-drained') refreshSnapshot();
  };
  navigator.serviceWorker?.addEventListener('message', onWorkerMessage);

  tick();

  return () => {
    if (timer) clearInterval(timer);
    timer = undefined;
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onOnline);
    navigator.serviceWorker?.removeEventListener('message', onWorkerMessage);
  };
}

// ─── What the UI reads ───────────────────────────────────────────────────────

let snapshot: OutboxItem[] = [];
let snapshotVersion = 0;

const uiListeners = new Set<() => void>();

/** Re-reads the queue and tells every subscriber. */
function refreshSnapshot(): void {
  void allItems()
    // No IndexedDB: an empty queue is the truthful answer, and the badge simply never
    // appears. An unhandled rejection here would take the nav bar with it.
    .catch(() => [] as OutboxItem[])
    .then((items) => {
      snapshot = items;
      // A version NUMBER, not the array: `useSyncExternalStore` compares snapshots by
      // identity, and IndexedDB hands back a fresh array on every read — so returning the
      // array itself would re-render every subscriber on every poll, queue unchanged.
      snapshotVersion += 1;
      for (const listener of uiListeners) listener();
    });
}

// Module scope, subscribed once: the queue is a page-level fact, and one reader is enough
// however many components are showing it.
subscribeToOutbox(refreshSnapshot);

function subscribeUi(listener: () => void): () => void {
  uiListeners.add(listener);
  // Prime on first subscription, so a badge is right on the first render after a reload
  // rather than one tick later.
  refreshSnapshot();
  return () => uiListeners.delete(listener);
}

export function useOutbox(): { items: OutboxItem[]; count: number } {
  useSyncExternalStore(
    subscribeUi,
    () => snapshotVersion,
    () => 0,
  );
  return { items: snapshot, count: snapshot.length };
}

export { pendingCount };
