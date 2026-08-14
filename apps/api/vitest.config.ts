// Loads apps/api/.env into this process. Vitest's own `env` block below applies to the
// test workers, but globalSetup runs before it — without this, TEST_DATABASE_URL is
// invisible to the migration step.
import 'dotenv/config';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // `prisma` as well as `src`: the seed lives outside src (docs put it at
    // prisma/seed.ts) and is exercised end to end by prisma/seed.test.ts.
    include: ['src/**/*.test.ts', 'prisma/**/*.test.ts'],
    restoreMocks: true,
    globalSetup: ['src/test/global-setup.ts'],
    // Tests share one database and truncate between cases, so they must not run in
    // parallel — concurrent files would delete each other's fixtures mid-assertion.
    // Worth revisiting with a schema-per-worker scheme if the suite gets slow.
    fileParallelism: false,
    // Argon2 at OWASP cost is ~50ms per hash and the lockout test spends six of them.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env['TEST_DATABASE_URL'] ?? '',
      SESSION_SECRET: 'test-session-secret-at-least-32-characters-long',
      // Cheapest Argon2 parameters the library accepts. Production cost is set by
      // .env; paying it in tests buys nothing but slower feedback.
      ARGON2_MEMORY_KIB: '8',
      ARGON2_TIME_COST: '1',
      ARGON2_PARALLELISM: '1',
      // Lets tests vary the client address via X-Forwarded-For, which is the only way
      // to exercise per-IP behaviour over loopback.
      TRUST_PROXY_HOPS: '1',
      // Mail is captured in memory so tests can assert on what would have been sent.
      MAIL_TRANSPORT: 'capture',
      // Fixed test key. Real keys live in the platform secret store; this one exists
      // only so the suite can encrypt and decrypt deterministically.
      ENCRYPTION_KEYS: 'test:MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
      APP_BASE_URL: 'https://dis.example.org',
    },
  },
});
