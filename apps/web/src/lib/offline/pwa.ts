import { useEffect, useState, useSyncExternalStore } from 'react';
import { registerSW } from 'virtual:pwa-register';

/**
 * Registering the service worker, and the two prompts that come with it.
 *
 * Both are deliberately restrained. An update that reloads the page under a member is an
 * update that loses the report they were half way through typing; an install prompt on the
 * first visit is a prompt to somebody who does not yet know what the app is.
 */

// ─── Updates ─────────────────────────────────────────────────────────────────

/**
 * Registration is a PAGE-level fact, not a component's.
 *
 * There is one service worker per page whatever the tree does, so the registration lives in
 * module scope and components subscribe to it. Holding it in component state meant calling
 * `setState` inside an effect — a cascading render, and one that would run twice under
 * StrictMode and register twice.
 */
interface WorkerState {
  isUpdateReady: boolean;
  isOfflineReady: boolean;
}

let state: WorkerState = { isUpdateReady: false, isOfflineReady: false };
let applyUpdateFn: ((reload?: boolean) => Promise<void>) | null = null;
let registered = false;

const listeners = new Set<() => void>();

function publish(next: Partial<WorkerState>): void {
  // A NEW object each time: `useSyncExternalStore` compares snapshots by identity, and
  // mutating this one in place would leave every subscriber showing the old value.
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function ensureRegistered(): void {
  if (registered) return;
  registered = true;

  // `registerType: 'prompt'` in vite.config: the new worker installs and then WAITS. It does
  // not skip waiting, so the running page keeps the code it started with until the member
  // says otherwise.
  applyUpdateFn = registerSW({
    immediate: true,
    onNeedRefresh() {
      publish({ isUpdateReady: true });
    },
    onOfflineReady() {
      publish({ isOfflineReady: true });
    },
    onRegisterError(error) {
      // Registration fails on an insecure origin that is not localhost — which is exactly
      // how this gets tested from a phone on a LAN address. Not fatal: the app still works,
      // it simply has no offline shell, and the outbox does not depend on the worker.
      console.warn('[pwa] service worker not registered — the app will run online only', error);
    },
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface UpdateState {
  /** A new service worker is waiting. The member decides when it takes over. */
  isUpdateReady: boolean;
  /** True once the app has everything it needs to run with no network. */
  isOfflineReady: boolean;
  /** Activates the waiting worker and reloads. Called from a button, never on a timer. */
  applyUpdate: () => void;
}

export function useServiceWorker(): UpdateState {
  // Registering during render is safe here: it is idempotent, it touches no React state
  // synchronously, and the alternative was setState inside an effect.
  ensureRegistered();

  const snapshot = useSyncExternalStore(
    subscribe,
    () => state,
    // Server snapshot. There is no SSR in this app, but the argument is required and a
    // shared constant keeps identity stable.
    () => state,
  );

  return {
    isUpdateReady: snapshot.isUpdateReady,
    isOfflineReady: snapshot.isOfflineReady,
    applyUpdate: () => {
      // Tells the waiting worker to take over. The plugin's own registration code listens
      // for `controllerchange` and reloads once it has — so the page reloads with the new
      // build, and only because the member asked.
      void applyUpdateFn?.();
    },
  };
}

// ─── Install ─────────────────────────────────────────────────────────────────

/** Chrome's install event, which is not in the DOM types because it is not standardised. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const VISIT_KEY = 'dis:visits';
const DISMISSED_KEY = 'dis:install-dismissed';

/** How many times this browser has opened the app. Counted once per page load. */
function recordVisit(): number {
  try {
    const count = Number(localStorage.getItem(VISIT_KEY) ?? '0') + 1;
    localStorage.setItem(VISIT_KEY, String(count));
    return count;
  } catch {
    // Storage disabled. Never prompting is the safe direction.
    return 0;
  }
}

const visitCount = recordVisit();

export interface InstallState {
  canInstall: boolean;
  install: () => void;
  dismiss: () => void;
}

/**
 * Offers installation from the SECOND visit onwards.
 *
 * A prompt on the first visit asks somebody to commit to an app they have not used yet, and
 * a dismissed prompt does not come back — Chrome will not fire the event again for a while.
 * Spending it on a member who is still signing in is spending it badly.
 */
export function useInstallPrompt(): InstallState {
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED_KEY) === 'true';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    const onPrompt = (event: Event): void => {
      // Chrome shows its own bar unless this is prevented; the app decides when to ask.
      event.preventDefault();
      setDeferred(event as InstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  return {
    canInstall: deferred !== null && visitCount >= 2 && !dismissed,
    install: () => {
      const event = deferred;
      if (!event) return;
      setDeferred(null);
      void event.prompt();
    },
    dismiss: () => {
      setDismissed(true);
      try {
        localStorage.setItem(DISMISSED_KEY, 'true');
      } catch {
        // Nothing to do; the prompt simply reappears next time.
      }
    },
  };
}
