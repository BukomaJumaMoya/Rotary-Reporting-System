import argon2 from 'argon2';
import { config } from '../../platform/config.js';

const options = {
  type: argon2.argon2id,
  memoryCost: config.ARGON2_MEMORY_KIB,
  timeCost: config.ARGON2_TIME_COST,
  parallelism: config.ARGON2_PARALLELISM,
} as const;

export function hashPassword(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, options);
}

/**
 * Verifies a password, returning false rather than throwing on a malformed stored hash
 * — a corrupt row should deny access, not 500 the login endpoint.
 */
export async function verifyPassword(hash: string, plaintext: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plaintext);
  } catch {
    return false;
  }
}

/**
 * A real Argon2id hash of a value nobody knows, used to spend the same CPU time when
 * the email does not exist as when it does.
 *
 * Without this, "no such user" returns in microseconds and "wrong password" takes ~50ms,
 * and anyone can enumerate which of four thousand members hold accounts by timing the
 * login endpoint. Generated once at startup so the cost is paid once.
 */
let decoyHash: Promise<string> | undefined;

export function consumeTimingBudget(plaintext: string): Promise<boolean> {
  decoyHash ??= argon2.hash(`decoy:${Math.random()}:${Date.now()}`, options);
  return decoyHash.then((hash) => verifyPassword(hash, plaintext));
}
