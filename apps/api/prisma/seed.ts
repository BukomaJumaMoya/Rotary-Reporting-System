import { isProduction } from '../src/platform/config.js';
import { unscopedPrisma } from '../src/platform/db.js';
import { seedDatabase } from './seed/run.js';

/**
 * `npm run db:seed` — one command to a realistic dataset.
 *
 * A thin entry point. Everything it does lives in `seed/run.ts`, exported rather than run
 * on import so `seed.test.ts` can drive the same code against the test database. A seed
 * nobody checks is a seed that quietly stops matching the schema, and the first person to
 * notice would be whoever is demonstrating the system to the district.
 */
const started = Date.now();

seedDatabase()
  .then((summary) => {
    process.stdout.write(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s.\n\n`);

    if (isProduction) return;

    process.stdout.write(`Sign in with password: ${summary.password}\n\n`);
    for (const account of summary.signIns) {
      process.stdout.write(`  ${account.role.padEnd(34)} ${account.email}\n`);
    }
    process.stdout.write('\nEvery seeded account shares that password. Synthetic data only.\n\n');
  })
  .catch((error: unknown) => {
    console.error('\nSeed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void unscopedPrisma.$disconnect();
  });
