/**
 * A client-generated UUID v4.
 *
 * **`crypto.randomUUID()` is SECURE-CONTEXT ONLY**, and that is not a detail this project
 * can wave away: client-generated ids are what make a create idempotent (ADR-004, ADR-006),
 * and the whole offline story in M3 rests on them. A secure context means `https:` or
 * `localhost` — so the function exists on a developer's machine and is `undefined` the
 * moment the same build is opened from a phone at `http://192.168.x.x`, which is exactly how
 * this system gets tested. It took down the reporting screen with a blank page, because the
 * call sat in a `useState` initialiser and threw during render.
 *
 * `crypto.getRandomValues()` is NOT gated the same way — it is available in insecure
 * contexts — so the fallback is still cryptographically random, not `Math.random()`. An id
 * generated from `Math.random()` would collide often enough to matter across 68 clubs
 * filing reports on the same evening, and a collision here means one club's activity
 * silently answering another club's replay.
 */
export function uuid(): string {
  // Present in production (HTTPS) and on localhost. Preferred: it is the browser's own
  // implementation and needs no bit-twiddling from us.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // RFC 4122 §4.4: version 4 in the high nibble of byte 6, variant 10 in the top bits of
  // byte 8. Without these the string is random but is not a valid v4 UUID — and the server
  // validates it with `z.uuid()`, which would refuse it.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}
