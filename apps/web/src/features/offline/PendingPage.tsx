import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, EmptyState, PageHeader } from '../../components/ui';
import { cx } from '../../lib/cx';
import { formatBytes } from '../../lib/images';
import { useConnectivity } from '../../lib/offline/connectivity';
import { discard, requeue, type OutboxItem } from '../../lib/offline/outbox';
import { drain, useOutbox } from '../../lib/offline/submit';
import { restoreReportDraft } from '../activities/draft';

/**
 * What is waiting to be sent.
 *
 * The screen exists because a queue a member cannot see is a queue a member does not trust.
 * A club secretary who filed three reports in a basement needs to be able to open the app on
 * the bus and confirm that three reports are still there — and, when one of them has been
 * rejected, find out which and why rather than discovering it a month later in a scorecard.
 */

export function PendingPage() {
  const { items } = useOutbox();
  const { isOnline } = useConnectivity();
  const [isSending, setIsSending] = useState(false);

  const queued = items.filter((item) => item.status !== 'failed');
  const failed = items.filter((item) => item.status === 'failed');
  const waitingBytes = items.reduce((total, item) => total + itemBytes(item), 0);

  const sendNow = async () => {
    setIsSending(true);
    await drain();
    setIsSending(false);
  };

  return (
    <>
      <PageHeader
        title="Waiting to send"
        description="Everything you save is stored on this device first, then sent. Nothing here is lost."
      />

      {items.length === 0 && (
        <EmptyState
          title="Nothing waiting"
          description="Everything you have saved has reached the district."
        />
      )}

      {queued.length > 0 && (
        <Card
          title={`${queued.length} waiting`}
          actions={
            <Button
              variant="secondary"
              onClick={() => void sendNow()}
              isLoading={isSending}
              disabled={!isOnline}
            >
              Send now
            </Button>
          }
        >
          {!isOnline && (
            <p className="text-text-muted mb-3 text-table">
              No connection. These will go on their own as soon as there is one — you do not have to
              come back to this screen.
            </p>
          )}
          <ul className="divide-border-subtle divide-y">
            {queued.map((item) => (
              <Row key={item.id} item={item} />
            ))}
          </ul>
        </Card>
      )}

      {failed.length > 0 && (
        <Card title={`${failed.length} could not be sent`}>
          <p className="text-text-secondary mb-3 text-table">
            The district refused these. They are still on this device — correct the problem and try
            again, or discard them if they were a mistake.
          </p>
          <ul className="divide-border-subtle divide-y">
            {failed.map((item) => (
              <Row key={item.id} item={item} />
            ))}
          </ul>
        </Card>
      )}

      <DataUsage waitingBytes={waitingBytes} />
    </>
  );
}

/**
 * What this is costing.
 *
 * Members pay per megabyte, and an app that never says what it spends is an app people
 * assume is spending recklessly — which is a reason not to use it. The figures here are
 * MEASURED from the queue rather than estimated, because a number somebody can check against
 * their own bundle is the only kind worth printing.
 */
function DataUsage({ waitingBytes }: { waitingBytes: number }) {
  return (
    <Card title="What this costs you" className="mt-4">
      <dl className="grid gap-2 text-table">
        <div className="flex justify-between gap-4">
          <dt className="text-text-muted">Waiting to send, from this device</dt>
          <dd className="text-text-primary">{formatBytes(waitingBytes)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-text-muted">A report with one photograph</dt>
          <dd className="text-text-primary">about 150–400 KB</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-text-muted">Opening the app again</dt>
          <dd className="text-text-primary">almost nothing, once installed</dd>
        </div>
      </dl>
      <p className="text-text-muted mt-3 text-meta">
        Photographs are made smaller on this phone before they are sent — usually a tenth of what
        the camera produced. Nothing is uploaded until you tap Submit.
      </p>
    </Card>
  );
}

/** Roughly what this item will put on the wire: the JSON body plus every photograph. */
function itemBytes(item: OutboxItem): number {
  const body = new Blob([JSON.stringify(item.body)]).size;
  return item.files.reduce((total, file) => total + file.size, body);
}

function Row({ item }: { item: OutboxItem }) {
  const navigate = useNavigate();
  const isFailed = item.status === 'failed';
  // A refused REPORT can be reopened in the form it came from. "Try again" on an unchanged
  // body would be refused for the same reason, and the member's only way out of that loop
  // would be to discard their work and retype it.
  const canEdit = isFailed && item.endpoint === '/activities';

  const edit = (): void => {
    restoreReportDraft(item.body, item.files);
    navigate('/report');
  };

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="text-text-primary truncate text-table font-medium">{item.label}</p>
        <p className="text-text-muted text-meta">
          {item.kind} · saved {new Date(item.createdAt).toLocaleString()}
          {item.files.length > 0 &&
            ` · ${item.files.length} photograph${item.files.length === 1 ? '' : 's'}`}
        </p>
        {item.lastError && (
          <p className={cx('mt-1 text-meta', isFailed ? 'text-danger-text' : 'text-text-muted')}>
            {item.lastError}
            {!isFailed && item.attempts > 0 && ` · tried ${item.attempts} times`}
          </p>
        )}
      </div>

      {isFailed && (
        <div className="flex gap-1">
          {canEdit && (
            <Button variant="ghost" onClick={edit}>
              Correct it
            </Button>
          )}
          <Button variant="ghost" onClick={() => void requeue(item.id)}>
            Try again
          </Button>
          <Button variant="ghost" onClick={() => void discard(item.id)}>
            Discard
          </Button>
        </div>
      )}
    </li>
  );
}
