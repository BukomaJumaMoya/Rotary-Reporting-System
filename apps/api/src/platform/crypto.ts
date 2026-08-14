import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from './config.js';

/**
 * Application-level encryption for secrets that the database must hold but must not
 * yield if it leaks — today, TOTP shared secrets.
 *
 * THE KEY MANAGEMENT STORY, stated plainly because "encrypted at rest" means nothing
 * without one:
 *
 *   * Keys live in the hosting platform's secret store (Fly/Railway secrets), injected
 *     as ENCRYPTION_KEYS. They are NOT in the database, NOT in the repository, and NOT
 *     in the same backup as the ciphertext. That separation is the whole point: a
 *     leaked dump, a stolen backup or a read-only SQL injection yields nothing usable.
 *   * Keys are 32 random bytes, base64. Generate: openssl rand -base64 32
 *   * ENCRYPTION_KEYS holds one or more `id:key` pairs. The FIRST is active and used
 *     for new writes; the rest exist so old ciphertext still decrypts during rotation.
 *   * To rotate: prepend a new pair, deploy, re-encrypt at leisure, then drop the old
 *     pair. Because every ciphertext names the key that produced it, a value encrypted
 *     under a retired key fails loudly rather than silently returning rubbish.
 *   * Losing every copy of a key means the affected members re-enrol. That is a
 *     recoverable inconvenience, which is why this holds second factors and not, say,
 *     the only copy of member records.
 *
 * AES-256-GCM: authenticated, so tampering is detected rather than decrypted into
 * something plausible.
 */

const KEY_BYTES = 32;
const IV_BYTES = 12; // 96 bits, the GCM standard
const ALGORITHM = 'aes-256-gcm';

interface Key {
  id: string;
  material: Buffer;
}

let cachedKeys: Key[] | undefined;

function keys(): Key[] {
  if (cachedKeys) return cachedKeys;

  const parsed = config.ENCRYPTION_KEYS.split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry): Key => {
      const separator = entry.indexOf(':');
      if (separator < 1) {
        throw new Error('ENCRYPTION_KEYS entries must be "id:base64key"');
      }
      const id = entry.slice(0, separator);
      const material = Buffer.from(entry.slice(separator + 1), 'base64');

      if (material.length !== KEY_BYTES) {
        throw new Error(
          `ENCRYPTION_KEYS entry "${id}" must decode to ${KEY_BYTES} bytes (openssl rand -base64 32)`,
        );
      }
      if (/[.:]/.test(id)) throw new Error('ENCRYPTION_KEYS ids may not contain "." or ":"');
      return { id, material };
    });

  if (parsed.length === 0) throw new Error('ENCRYPTION_KEYS is empty');
  cachedKeys = parsed;
  return parsed;
}

/**
 * `keyId.iv.ciphertext.tag`, all base64url.
 *
 * Self-describing so rotation works: the reader does not have to guess which key made a
 * given value, and a value under a retired key produces a clear error.
 */
export function encryptSecret(plaintext: string, context: string): string {
  const key = keys()[0];
  if (!key) throw new Error('ENCRYPTION_KEYS is empty');

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key.material, iv);
  // Additional authenticated data binds the ciphertext to WHERE it belongs, so a row
  // copied onto another user's record fails to decrypt instead of granting their MFA.
  cipher.setAAD(Buffer.from(context, 'utf8'));

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    key.id,
    iv.toString('base64url'),
    ciphertext.toString('base64url'),
    tag.toString('base64url'),
  ].join('.');
}

export function decryptSecret(encoded: string, context: string): string {
  const [keyId, iv, ciphertext, tag] = encoded.split('.');

  if (!keyId || !iv || !ciphertext || !tag) {
    throw new Error('Malformed ciphertext');
  }

  const key = keys().find((candidate) => candidate.id === keyId);
  if (!key) {
    throw new Error(`No encryption key "${keyId}" — it may have been rotated out too early`);
  }

  const decipher = createDecipheriv(ALGORITHM, key.material, Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(context, 'utf8'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/** Context string binding an MFA secret to the account that owns it. */
export const mfaContext = (userId: string): string => `mfa:${userId}`;
