import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// Loads .env when one exists and is silent when it does not, which is the case in CI
// and in production, where the platform injects real environment variables.
loadDotenv({ quiet: true });

/**
 * Only variables the code actually reads are parsed here. `.env.example` documents the
 * full set the project will need; each milestone adds its variables to this schema as
 * it starts using them, so an unset variable fails at startup rather than at the first
 * request that needs it.
 */
const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(4000),

  DATABASE_URL: z.string().min(1),

  /**
   * Number of reverse proxies in front of the API. Deployment platforms differ, so this
   * is configuration rather than a guess: too low and every request appears to come from
   * the load balancer, which makes the login rate limiter throttle all members as one
   * client; too high and a caller can spoof its address by forging X-Forwarded-For.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),

  // Sessions (ADR-003)
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_COOKIE_NAME: z.string().default('dis.sid'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),

  // Argon2id — OWASP baseline
  ARGON2_MEMORY_KIB: z.coerce.number().int().positive().default(19456),
  ARGON2_TIME_COST: z.coerce.number().int().positive().default(2),
  ARGON2_PARALLELISM: z.coerce.number().int().positive().default(1),

  // Login throttling and lockout
  LOGIN_RATE_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_RATE_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  LOCKOUT_BASE_MINUTES: z.coerce.number().int().positive().default(5),
  LOCKOUT_MAX_MINUTES: z.coerce.number().int().positive().default(1440),

  TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(60),
  PRIVACY_POLICY_VERSION: z.string().default('2027-07-01'),
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

export const isProduction = config.NODE_ENV === 'production';
export const isTest = config.NODE_ENV === 'test';
