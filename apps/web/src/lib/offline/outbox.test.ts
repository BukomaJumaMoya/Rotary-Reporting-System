import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteDB } from 'idb';
import {
  allItems,
  backoffFor,
  closeOutbox,
  drainOutbox,
  enqueue,
  requeue,
  type OutboxItem,
} from './outbox';

/**
 * The queue's five load-bearing behaviours.
 *
 * Every one of these is a way a club's report gets lost or duplicated, which is why they are
 * tested and the surrounding CRUD is not: a duplicated induction inflates a club's
 * membership figure, and a lost activity costs it a point in the assessment.
 */

async function resetOutbox(): Promise<void> {
  await closeOutbox();
  await deleteDB('dis-outbox');
}

function queued(overrides: Partial<OutboxItem> = {}) {
  return {
    id: overrides.id ?? '11111111-1111-4111-8111-111111111111',
    kind: 'Activity',
    label: 'Blood drive at Mulago',
    endpoint: '/activities',
    method: 'POST' as const,
    body: { title: 'Blood drive at Mulago' },
    files: [] as Blob[],
    ...overrides,
  };
}

function response(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(async () => {
  await resetOutbox();
});

describe('the outbox', () => {
  it('keeps a submission when there is no network at all', async () => {
    await enqueue(queued());

    const result = await drainOutbox({
      // What `fetch` does on a phone with no signal: it rejects, there is no response.
      send: () => Promise.reject(new Error('Failed to fetch')),
      sendFile: () => Promise.reject(new Error('Failed to fetch')),
    });

    expect(result.sent).toBe(0);
    const [item] = await allItems();
    // Still there, still sendable — NOT failed. A network that is absent says nothing about
    // whether the report is any good.
    expect(item?.status).toBe('queued');
    expect(item?.attempts).toBe(1);
    expect(item?.lastError).toBe('Failed to fetch');
  });

  it('removes a submission the server accepted', async () => {
    await enqueue(queued());

    const send = vi.fn(() => Promise.resolve(response(201, { data: { id: 'x' } })));
    const result = await drainOutbox({ send, sendFile: () => Promise.resolve(response(201)) });

    expect(result.sent).toBe(1);
    expect(await allItems()).toHaveLength(0);
  });

  it('treats 409 as stored and does not send it a second time', async () => {
    // The case this whole design exists for: the first attempt REACHED the server, the
    // response was lost, and the retry is being told the record already exists. Anything
    // other than "done" here leaves it retrying forever — or, worse, invites a second row.
    await enqueue(queued());

    const send = vi.fn(() =>
      Promise.resolve(response(409, { error: { code: 'IDEMPOTENT_REPLAY', message: 'Exists' } })),
    );
    const result = await drainOutbox({ send, sendFile: () => Promise.resolve(response(201)) });

    expect(result.sent).toBe(1);
    expect(await allItems()).toHaveLength(0);

    // And a second drain has nothing to do, so no duplicate is ever created.
    await drainOutbox({ send, sendFile: () => Promise.resolve(response(201)) });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('stops on a 422 and keeps the reason, rather than retrying a bad request', async () => {
    await enqueue(queued());

    const send = vi.fn(() =>
      Promise.resolve(
        response(422, {
          error: {
            code: 'FIELD_REQUIRED',
            message: 'A narrative report is required.',
            details: { key: 'narrativeReport' },
          },
        }),
      ),
    );

    const result = await drainOutbox({ send, sendFile: () => Promise.resolve(response(201)) });

    expect(result.failed).toBe(1);
    const [item] = await allItems();
    expect(item?.status).toBe('failed');
    expect(item?.lastError).toBe('A narrative report is required.');
    expect(item?.lastErrorDetails).toEqual({ key: 'narrativeReport' });

    // A further drain leaves it alone: sending it again would be wrong in the same way, and
    // ten identical rejections on metered data help nobody.
    await drainOutbox({ send, sendFile: () => Promise.resolve(response(201)) });
    expect(send).toHaveBeenCalledTimes(1);

    // Until the member asks for it explicitly.
    await requeue(item?.id ?? '');
    await drainOutbox({ send, sendFile: () => Promise.resolve(response(201)) });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('backs off between attempts and gives up after ten', async () => {
    await enqueue(queued());

    const send = vi.fn(() => Promise.resolve(response(503)));
    const sendFile = () => Promise.resolve(response(201));
    let clock = 1_000_000;

    // Attempt 1: sent, then held for the first backoff.
    await drainOutbox({ send, sendFile, now: () => clock });
    expect(send).toHaveBeenCalledTimes(1);
    expect((await allItems())[0]?.nextAttemptAt).toBe(clock + 5_000);

    // A drain arriving before the delay has elapsed does nothing. Without this the interval
    // scheduler would hammer a struggling server every thirty seconds.
    await drainOutbox({ send, sendFile, now: () => clock + 4_000 });
    expect(send).toHaveBeenCalledTimes(1);

    // Doubling: 5s, 10s, 20s …
    clock += 5_000;
    await drainOutbox({ send, sendFile, now: () => clock });
    expect(send).toHaveBeenCalledTimes(2);
    expect((await allItems())[0]?.nextAttemptAt).toBe(clock + 10_000);

    // Run the remaining attempts out.
    for (let attempt = 3; attempt <= 10; attempt += 1) {
      clock += backoffFor(attempt - 1);
      await drainOutbox({ send, sendFile, now: () => clock });
    }

    expect(send).toHaveBeenCalledTimes(10);
    const [item] = await allItems();
    // Ten attempts and roughly half an hour later it stops trying — but it is still HERE.
    // Nothing is ever discarded on the member's behalf.
    expect(item?.status).toBe('failed');
    expect(item?.attempts).toBe(10);
  });

  it('caps the backoff at ten minutes', () => {
    expect(backoffFor(1)).toBe(5_000);
    expect(backoffFor(2)).toBe(10_000);
    expect(backoffFor(8)).toBe(600_000);
    expect(backoffFor(20)).toBe(600_000);
  });

  it('uploads photographs only after the record they belong to exists', async () => {
    const order: string[] = [];
    await enqueue(queued({ files: [new Blob(['photo'], { type: 'image/jpeg' })] }));

    await drainOutbox({
      send: () => {
        order.push('record');
        return Promise.resolve(response(201));
      },
      sendFile: () => {
        order.push('file');
        return Promise.resolve(response(201));
      },
    });

    expect(order).toEqual(['record', 'file']);
    expect(await allItems()).toHaveLength(0);
  });

  it('files the record even when its photograph will not upload', async () => {
    // A failed image must not fail the activity. The report is what the club is assessed on;
    // a photograph can be added again from the detail screen.
    await enqueue(queued({ files: [new Blob(['photo'], { type: 'image/jpeg' })] }));

    const result = await drainOutbox({
      send: () => Promise.resolve(response(201)),
      sendFile: () => Promise.reject(new Error('Failed to fetch')),
    });

    expect(result.sent).toBe(1);
    expect(await allItems()).toHaveLength(0);
  });

  it('holds an item back until the record it depends on has been sent', async () => {
    // A secretary inducting somebody new, offline: the person and then the event naming
    // them. Sending the event first earns a 422 about a person who has simply not arrived.
    const personId = '22222222-2222-4222-8222-222222222222';
    await enqueue(queued({ id: personId, kind: 'Member', endpoint: '/persons' }));
    await enqueue(
      queued({
        id: '33333333-3333-4333-8333-333333333333',
        kind: 'Membership event',
        endpoint: '/membership/events',
        dependsOn: personId,
      }),
    );

    const sent: string[] = [];
    const sendFile = () => Promise.resolve(response(201));

    // The person cannot go yet; the event must not go ahead of it.
    await drainOutbox({
      send: (item) => {
        if (item.endpoint === '/persons') return Promise.reject(new Error('Failed to fetch'));
        sent.push(item.endpoint);
        return Promise.resolve(response(201));
      },
      sendFile,
    });
    expect(sent).toEqual([]);
    expect(await allItems()).toHaveLength(2);

    // Once the person is through, the event follows — in the SAME drain, not thirty seconds
    // later.
    await drainOutbox({
      send: (item) => {
        sent.push(item.endpoint);
        return Promise.resolve(response(201));
      },
      sendFile,
      now: () => Date.now() + 60_000,
    });

    expect(sent).toEqual(['/persons', '/membership/events']);
    expect(await allItems()).toHaveLength(0);
  });

  it('does not send the same item twice when two drains overlap', async () => {
    // The interval, a submission and the service worker can all ask at once. The server
    // would refuse the duplicate, but the member would have paid to send it.
    await enqueue(queued());

    let release = (): void => undefined;
    const started = new Promise<void>((resolve) => {
      release = resolve;
    });

    const send = vi.fn(async () => {
      await started;
      return response(201);
    });
    const sendFile = () => Promise.resolve(response(201));

    const first = drainOutbox({ send, sendFile });
    const second = drainOutbox({ send, sendFile });
    release();
    await Promise.all([first, second]);

    expect(send).toHaveBeenCalledTimes(1);
    expect(await allItems()).toHaveLength(0);
  });

  it('fails a blocked item once its prerequisite has failed for good', async () => {
    // Otherwise the member sees a queue entry that says "Waiting" forever and never explains
    // why — the person it names was refused, so the event can never be valid as it stands.
    const personId = '77777777-7777-4777-8777-777777777777';
    await enqueue(queued({ id: personId, kind: 'Member', endpoint: '/persons' }));
    await enqueue(
      queued({
        id: '88888888-8888-4888-8888-888888888888',
        kind: 'Membership event',
        endpoint: '/membership/events',
        dependsOn: personId,
      }),
    );

    const sendFile = () => Promise.resolve(response(201));
    const reject = () =>
      Promise.resolve(response(422, { error: { code: 'INVALID', message: 'Name too long.' } }));

    // First drain fails the person; the event is merely skipped, its parent not yet failed
    // at the moment it is considered.
    await drainOutbox({ send: reject, sendFile });
    // Second drain sees the failed parent and says so.
    await drainOutbox({ send: reject, sendFile });

    const items = await allItems();
    expect(items.map((item) => item.status)).toEqual(['failed', 'failed']);
    expect(items[1]?.lastError).toBe('Something it depends on could not be saved.');

    // Nothing left worth another attempt: the service worker's sync event must settle rather
    // than retry forever over two items that need the member.
    const third = await drainOutbox({ send: reject, sendFile });
    expect(third.pending).toBe(0);
    expect(third.remaining).toBe(2);

    // Retrying the parent brings the child back with it — it was waiting, not broken.
    await requeue(personId);
    const after = await allItems();
    expect(after.map((item) => item.status)).toEqual(['queued', 'queued']);
  });

  it('sends in the order the member saved things', async () => {
    // Three reports filed in a basement come out in the order they were written. The
    // district's log should read the way the evening actually went.
    await enqueue(queued({ id: '44444444-4444-4444-8444-444444444444', label: 'First' }));
    await enqueue(queued({ id: '55555555-5555-4555-8555-555555555555', label: 'Second' }));
    await enqueue(queued({ id: '66666666-6666-4666-8666-666666666666', label: 'Third' }));

    const order: string[] = [];
    await drainOutbox({
      send: (item) => {
        order.push(item.label);
        return Promise.resolve(response(201));
      },
      sendFile: () => Promise.resolve(response(201)),
    });

    expect(order).toEqual(['First', 'Second', 'Third']);
  });
});
