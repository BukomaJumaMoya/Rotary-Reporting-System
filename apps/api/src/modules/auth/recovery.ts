import { createHash, randomInt } from 'node:crypto';

/**
 * Recovery codes: the way back in when the phone holding the authenticator is gone.
 *
 * Without them the only remedy is an administrator clearing MFA by hand, which for a
 * DRR mid-assessment means being locked out until someone with database access is free.
 *
 * Crockford base32 without I, L, O, U — the characters people misread when copying a
 * code off a printout, plus U to avoid accidental words. Ten codes of ten characters is
 * ~50 bits each, so guessing is not a threat; they are hashed anyway, because this table
 * is as sensitive as a password column.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 10;
export const RECOVERY_CODE_COUNT = 10;

function randomCode(): string {
  let code = '';
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    // randomInt is rejection-sampled, so the distribution stays uniform — modulo bias
    // would shrink the effective keyspace.
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  // Grouped for transcription: XXXXX-XXXXX.
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

export function generateRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, randomCode);
}

/**
 * Normalises before hashing, so a member who types lower case, omits the hyphen or
 * pastes surrounding spaces still gets in. Formatting is presentation; the code is the
 * characters.
 */
export function normaliseRecoveryCode(code: string): string {
  return code.trim().toUpperCase().replace(/[\s-]/g, '');
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normaliseRecoveryCode(code)).digest('hex');
}
