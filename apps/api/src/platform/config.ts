import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// Loads .env when one exists and is silent when it does not, which is the case in CI
// and in production, where the platform injects real environment variables.
loadDotenv({ quiet: true });

/**
 * Only variables the code actually reads today are parsed here. `.env.example`
 * documents the full set the project will need; each later milestone adds its
 * variables to this schema as it starts using them, so an unset variable fails at
 * startup rather than at the first request that needs it.
 */
const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(4000),
});

const parsed = environmentSchema.safeParse(process.env);

if (!parsed.success) {
  const problems = parsed.error.issues
    .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  // Startup only, never inside a request, so this cannot leak to a client.
  console.error(`Invalid environment configuration:\n${problems}`);
  process.exit(1);
}

export const config = parsed.data;

export type Config = typeof config;
