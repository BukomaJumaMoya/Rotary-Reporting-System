import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, mfaContext } from './crypto.js';

describe('secret encryption', () => {
  it('round-trips a value', () => {
    const context = mfaContext('11111111-1111-1111-1111-111111111111');
    const encrypted = encryptSecret('JBSWY3DPEHPK3PXP', context);

    expect(encrypted).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(encrypted, context)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('names the key that produced it, so rotation is possible', () => {
    const encrypted = encryptSecret('secret', mfaContext('u'));
    const [keyId, iv, ciphertext, tag] = encrypted.split('.');

    expect(keyId).toBe('test');
    expect(iv).toBeTruthy();
    expect(ciphertext).toBeTruthy();
    expect(tag).toBeTruthy();
  });

  it('produces different ciphertext each time', () => {
    const context = mfaContext('u');
    // A fresh IV per encryption: identical secrets must not produce identical rows, or
    // the database reveals which accounts share a value.
    expect(encryptSecret('same', context)).not.toBe(encryptSecret('same', context));
  });

  it('refuses a value bound to a different account', () => {
    const encrypted = encryptSecret('secret', mfaContext('user-a'));

    // The AAD binding: a row copied onto another user's record fails to decrypt rather
    // than handing over a working second factor.
    expect(() => decryptSecret(encrypted, mfaContext('user-b'))).toThrow();
  });

  it('detects tampering', () => {
    const context = mfaContext('u');
    const [keyId, iv, ciphertext, tag] = encryptSecret('secret', context).split('.');
    const flipped = Buffer.from(ciphertext ?? '', 'base64url');
    flipped[0] = (flipped[0] ?? 0) ^ 0xff;

    const tampered = [keyId, iv, flipped.toString('base64url'), tag].join('.');

    // GCM is authenticated, so a modified value raises rather than decrypting into
    // something plausible.
    expect(() => decryptSecret(tampered, context)).toThrow();
  });

  it('rejects a value encrypted under a key that is no longer configured', () => {
    const unknownKey = ['retired', 'AAAAAAAAAAAAAAAA', 'AAAAAAAA', 'AAAAAAAAAAAAAAAA'].join('.');

    expect(() => decryptSecret(unknownKey, mfaContext('u'))).toThrow(/retired/);
  });

  it('rejects malformed input', () => {
    expect(() => decryptSecret('not-a-ciphertext', mfaContext('u'))).toThrow(/Malformed/);
  });
});
