import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, EmptyState, PageHeader } from '../../components/ui';
import { cx } from '../../lib/cx';
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
            <p className="text-ink-500 mb-3 text-sm">
              No connection. These will go on their own as soon as there is one — you do not have to
              come back to this screen.
            </p>
          )}
          <ul className="divide-ink-100 divide-y">
            {queued.map((item) => (
              <Row key={item.id} item={item} />
            ))}
          </ul>
        </Card>
      )}

      {failed.length > 0 && (
        <Card title={`${failed.length} could not be sent`}>
          <p className="text-ink-600 mb-3 text-sm">
            The district refused these. They are still on this device — correct the problem and try
            again, or discard them if they were a mistake.
          </p>
          <ul className="divide-ink-100 divide-y">
            {failed.map((item) => (
              <Row key={item.id} item={item} />
            ))}
          </ul>
        </Card>
      )}
    </>
  );
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
        <p className="text-ink-900 truncate text-sm font-medium">{item.label}</p>
        <p className="text-ink-500 text-xs">
          {item.kind} · saved {new Date(item.createdAt).toLocaleString()}
          {item.files.length > 0 &&
            ` · ${item.files.length} photograph${item.files.length === 1 ? '' : 's'}`}
        </p>
        {item.lastError && (
          <p className={cx('mt-1 text-xs', isFailed ? 'text-danger-700' : 'text-ink-500')}>
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
