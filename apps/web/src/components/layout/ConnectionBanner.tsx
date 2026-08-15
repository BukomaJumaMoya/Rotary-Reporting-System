import { Button } from '../ui';
import { cx } from '../../lib/cx';
import { useConnectivity } from '../../lib/offline/connectivity';
import { useInstallPrompt, useServiceWorker } from '../../lib/offline/pwa';

/**
 * The three things the app has to tell a member about its own state.
 *
 * All at the top, all dismissible or actionable, none of them modal. A member half way
 * through a report should never be interrupted by the application talking about itself.
 */

export function ConnectionBanner() {
  const { isOnline, isChecking, recheck } = useConnectivity();
  const { isUpdateReady, applyUpdate } = useServiceWorker();
  const install = useInstallPrompt();

  // Offline first, because it is the one that changes what the member should expect to
  // happen when they press Save.
  if (!isOnline) {
    return (
      <Bar tone="warning">
        <span>
          <strong>No connection.</strong> You can keep working — anything you save is queued and
          sent when the signal returns.
        </span>
        <Button variant="ghost" onClick={recheck} isLoading={isChecking}>
          Check again
        </Button>
      </Bar>
    );
  }

  if (isUpdateReady) {
    return (
      <Bar tone="info">
        <span>A new version is ready.</span>
        {/* Never applied automatically: reloading under somebody mid-form loses their work. */}
        <Button variant="ghost" onClick={applyUpdate}>
          Reload
        </Button>
      </Bar>
    );
  }

  if (install.canInstall) {
    return (
      <Bar tone="info">
        <span>Install this on your phone to use it without a browser.</span>
        <span className="flex gap-1">
          <Button variant="ghost" onClick={install.install}>
            Install
          </Button>
          <Button variant="ghost" onClick={install.dismiss}>
            Not now
          </Button>
        </span>
      </Bar>
    );
  }

  return null;
}

function Bar({ tone, children }: { tone: 'warning' | 'info'; children: React.ReactNode }) {
  return (
    <div
      role="status"
      className={cx(
        'flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm',
        tone === 'warning' ? 'bg-warning-100 text-warning-700' : 'bg-azure-100 text-azure-700',
      )}
    >
      {children}
    </div>
  );
}
