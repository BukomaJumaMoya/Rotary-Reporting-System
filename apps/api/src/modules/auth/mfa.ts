import { Secret, TOTP } from 'otpauth';

/**
 * TOTP (RFC 6238) with the parameters every authenticator app defaults to. They are not
 * configurable on purpose: a district officer scanning a QR code with Google
 * Authenticator, Aegis or 1Password must get a working token, and non-default parameters
 * are the usual reason that fails.
 */
const PERIOD_SECONDS = 30;
const DIGITS = 6;
const ALGORITHM = 'SHA1';

/**
 * Accept the previous and next step as well as the current one. Phone clocks drift, and
 * a member typing a code as it rolls over should not be told it is wrong. Wider than
 * ±1 would meaningfully extend the guessing window.
 */
const WINDOW = 1;

const ISSUER = 'Rotaract DIS';

function totpFor(secretBase32: string, label: string): TOTP {
  return new TOTP({
    issuer: ISSUER,
    label,
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD_SECONDS,
    secret: Secret.fromBase32(secretBase32),
  });
}

export interface Enrolment {
  secret: string;
  otpauthUri: string;
}

/** 160-bit secret, the RFC 4226 recommendation and what authenticator apps expect. */
export function createEnrolment(label: string): Enrolment {
  const secret = new Secret({ size: 20 });
  return {
    secret: secret.base32,
    otpauthUri: totpFor(secret.base32, label).toString(),
  };
}

export interface VerificationResult {
  valid: boolean;
  /** The TOTP step the code belongs to — persisted to stop it being replayed. */
  step: number;
}

/**
 * Verifies a code and reports which step it came from.
 *
 * The caller must reject a step that is not greater than the last one accepted for this
 * user. Without that, a code remains usable for its whole ±1 window — around 90 seconds
 * in which anyone who glimpsed it can use it again.
 */
export function verifyCode(
  secretBase32: string,
  label: string,
  code: string,
  now: Date = new Date(),
): VerificationResult {
  const timestamp = now.getTime();
  const delta = totpFor(secretBase32, label).validate({ token: code, window: WINDOW, timestamp });

  if (delta === null) return { valid: false, step: 0 };

  const currentStep = Math.floor(timestamp / 1000 / PERIOD_SECONDS);
  return { valid: true, step: currentStep + delta };
}
