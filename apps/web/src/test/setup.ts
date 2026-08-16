import 'fake-indexeddb/auto';

/**
 * jsdom has no IndexedDB, so `fake-indexeddb/auto` installs a real in-memory implementation
 * of the API — the actual spec behaviour, transactions and all, not a stub. The outbox is
 * therefore tested through the same code path it uses in a browser.
 *
 * Each test file resets the database itself (`resetOutbox` in `outbox.test.ts`), because a
 * queue that leaks between cases is a queue whose tests pass in the wrong order.
 */
