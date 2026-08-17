import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { config } from './config.js';
import { resetDatabase } from '../test/helpers.js';

/**
 * ADR-012 conformance, in CI rather than by hand.
 *
 * `prisma/checks/invariants.sql` attempts every database-side guard violation and asserts
 * it fails, reporting one `PASS`/`FAIL` notice per check. It was run manually until now,
 * which meant it was run when someone remembered — and a guard nobody has proven works is
 * a guard nobody should rely on.
 *
 * The SQL file stays the source of truth. Porting it by rewriting each check in
 * TypeScript would have produced a second, subtly different set of assertions, and the
 * one that drifted would be the one nobody was reading.
 */

const SQL = readFileSync(new URL('../../prisma/checks/invariants.sql', import.meta.url), 'utf8');

/**
 * The number of checks the file declares today.
 *
 * Asserted exactly, so deleting a check fails the build as loudly as breaking one. ADR-012
 * requires a conformance check for every guard; this is what makes "requires" mean
 * something.
 */
const EXPECTED_CHECKS = 44;

let client: pg.Client;
let notices: string[] = [];

beforeAll(async () => {
  client = new pg.Client({ connectionString: config.DATABASE_URL });
  // The file reports through RAISE NOTICE, which Prisma discards. A raw pg connection is
  // the only way to read what it says.
  client.on('notice', (notice) => {
    if (notice.message) notices.push(notice.message);
  });
  await client.connect();
});

beforeEach(async () => {
  // The script inserts fixed UUIDs and would collide with anything left behind.
  await resetDatabase();
  notices = [];
});

afterAll(async () => {
  await client.end();
});

describe('database invariants (ADR-012)', () => {
  it('declares a check for every guard, and every one passes', async () => {
    // The file opens its own transaction and rolls back, so it writes nothing.
    await client.query(SQL);

    const failures = notices.filter((line) => line.startsWith('FAIL'));
    expect(failures, failures.join('\n')).toEqual([]);

    const passes = notices.filter((line) => line.startsWith('PASS'));
    expect(passes).toHaveLength(EXPECTED_CHECKS);
  });

  it('leaves nothing behind', async () => {
    await client.query(SQL);

    const { rows } = await client.query<{ count: string }>('SELECT count(*)::text FROM districts');
    // If the ROLLBACK at the end of the file were ever lost, this suite would start
    // seeding the test database for whatever ran next.
    expect(rows[0]?.count).toBe('0');
  });

  it('would notice a guard that stopped firing', async () => {
    // Not a theoretical concern: a trigger dropped by a migration leaves a schema that
    // still looks right. Dropping one here proves the suite reports it rather than
    // passing quietly.
    await client.query('BEGIN');
    await client.query('DROP TRIGGER membership_events_no_mutate ON membership_events');
    notices = [];

    await client.query(SQL).catch(() => undefined);
    const failures = notices.filter((line) => line.startsWith('FAIL'));

    expect(failures.length).toBeGreaterThan(0);
    expect(failures.join(' ')).toMatch(/UPDATE of a fact was allowed|DELETE was allowed/);

    await client.query('ROLLBACK');
  });
});
