import { useEffect, useState } from 'react';

/**
 * Whether the device can actually reach the API.
 *
 * **`navigator.onLine` is not that question.** It answers "is there a network interface
 * attached", which on a captive portal — a hotel, a campus, a conference centre, exactly the
 * places a district officer opens this — is `true` while every request is being redirected
 * to a login page the app cannot see. A member told they are online while nothing saves is a
 * member who assumes the app is broken.
 *
 * So: `navigator.onLine` as the fast signal, and a heartbeat against the one endpoint that
 * needs no session and returns no data as the truthful one. `onLine` going false is trusted
 * immediately (interfaces do not lie about being gone); `onLine` going true only schedules a
 * heartbeat, because that is the direction it is wrong in.
 */

/** The one route that needs no session and returns nothing but `{ status: 'ok' }`. */
const HEARTBEAT_URL = '/api/v1/admin/health';

/**
 * Every 30 seconds while offline, every 2 minutes while online.
 *
 * Asymmetric on purpose. While offline the app is waiting to drain a queue and should notice
 * quickly; while online the heartbeat is only guarding against a silent captive portal, and
 * a request every 30 seconds on metered data is a cost the member pays for nothing.
 */
const POLL_OFFLINE_MS = 30_000;
const POLL_ONLINE_MS = 120_000;

/** A single probe. `no-store` so a cached 200 cannot report a network that is gone. */
export async function probeConnection(signal?: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(HEARTBEAT_URL, {
      method: 'GET',
      cache: 'no-store',
      // A captive portal answers 200 with its own HTML, so the STATUS is not enough — the
      // body has to be the shape this API returns.
      headers: { accept: 'application/json' },
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) return false;

    const body: unknown = await response.json().catch(() => null);
    return (body as { status?: string } | null)?.status === 'ok';
  } catch {
    return false;
  }
}

export interface Connectivity {
  /** True when the API answered a heartbeat, not merely when an interface exists. */
  isOnline: boolean;
  /** True while a probe is in flight, so the indicator can say "checking" rather than lie. */
  isChecking: boolean;
  recheck: () => void;
}

export function useConnectivity(): Connectivity {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const [isChecking, setIsChecking] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const check = async (): Promise<void> => {
      // No interface at all: believe it without spending a request. This is the one
      // direction navigator.onLine is reliable in.
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        if (!cancelled) setIsOnline(false);
        schedule(false);
        return;
      }

      if (!cancelled) setIsChecking(true);
      const reachable = await probeConnection(controller.signal);
      if (cancelled) return;

      setIsChecking(false);
      setIsOnline(reachable);
      schedule(reachable);
    };

    const schedule = (online: boolean): void => {
      timer = setTimeout(() => void check(), online ? POLL_ONLINE_MS : POLL_OFFLINE_MS);
    };

    void check();

    // The browser's own events, as a prompt to re-probe rather than as the answer.
    const onOnline = (): void => void check();
    const onOffline = (): void => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [nonce]);

  return { isOnline, isChecking, recheck: () => setNonce((value) => value + 1) };
}
