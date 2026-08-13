import { execFileSync } from 'node:child_process';

/**
 * Applies migrations to the test database once per run.
 *
 * `migrate deploy`, never `migrate dev`: deploy applies existing migrations and nothing
 * else. `dev` would happily generate a new migration from schema drift, so a mistake in
 * the schema would silently rewrite the migration history from a test run.
 */
export default function setup(): void {
  const url = process.env['TEST_DATABASE_URL'];

  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Integration tests run against a real PostgreSQL ' +
        'database — see apps/api/.env or .env.example.',
    );
  }

  if (!/test/i.test(url)) {
    // Cheap guard against the obvious catastrophe: pointing the suite, which truncates
    // every table between tests, at a development or production database.
    throw new Error(
      `TEST_DATABASE_URL must name a test database (got "${url.replace(/:[^:@]*@/, ':***@')}")`,
    );
  }

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url, DIRECT_DATABASE_URL: url },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}
