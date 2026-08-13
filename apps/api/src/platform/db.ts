import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { config, isTest } from './config.js';

/**
 * One PrismaClient for the process. Creating them per request exhausts the connection
 * pool, which shows up as intermittent timeouts under load rather than as an obvious
 * error.
 *
 * Prisma 7 requires an explicit driver adapter — the query engine no longer ships its
 * own connection handling. The pool sizing is deliberate: this is a small district
 * system on managed Postgres, where the connection ceiling is low and the failure mode
 * of over-provisioning is worse than a short queue.
 *
 * From session 4 this client is wrapped by the scoped data access layer, which requires
 * a RequestContext and injects districtId and rotaryYearId. Handlers reach for that
 * wrapper, not for this client.
 */
const adapter = new PrismaPg({
  connectionString: config.DATABASE_URL,
  max: 10,
});

export const prisma = new PrismaClient({
  adapter,
  log: isTest ? [] : ['warn', 'error'],
});

export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}
