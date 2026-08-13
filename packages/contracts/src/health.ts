import { z } from 'zod';

/**
 * Liveness only.
 *
 * `GET /api/v1/admin/health` is the sole endpoint reachable without a session, and the
 * sole entry on the allowlist of the unauthenticated-PII harness (CLAUDE.md, Testing §5).
 * It carries no data — no version, no uptime, no build SHA — so `.strict()` here is a
 * deliberate tripwire against anything being added to it later.
 */
export const healthResponseSchema = z.strictObject({
  status: z.literal('ok'),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
