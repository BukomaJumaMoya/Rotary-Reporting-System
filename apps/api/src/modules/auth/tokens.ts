import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Reset, invite and verification tokens.
 *
 * 32 random bytes, base64url. The database stores only the SHA-256 hash, so a leaked
 * database backup does not hand over working password-reset links.
 *
 * SHA-256 and not Argon2, deliberately: Argon2's cost exists to make GUESSING feasible
 * inputs expensive, and these inputs are 256 bits of entropy. There is nothing to guess.
 * Paying Argon2's cost per token lookup would be pure latency.
 */
export interface IssuedToken {
  /** Returned to the caller exactly once — it is never stored and cannot be recovered. */
  plaintext: string;
  hash: string;
  expiresAt: Date;
}

export function issueToken(ttlMinutes: number): IssuedToken {
  const plaintext = randomBytes(32).toString('base64url');
  return {
    plaintext,
    hash: hashToken(plaintext),
    expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000),
  };
}

export function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

/** Constant-time comparison, for the rare paths that compare hashes in application code. */
export function tokenHashEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'hex');
  const bufferB = Buffer.from(b, 'hex');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export const TokenPurpose = {
  RESET: 'RESET',
  INVITE: 'INVITE',
  VERIFY: 'VERIFY',
} as const;

export type TokenPurposeValue = (typeof TokenPurpose)[keyof typeof TokenPurpose];
