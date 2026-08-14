import { z } from 'zod';
import { orgScopes } from './context.js';

/**
 * Password policy, defined once. The client validates with this schema and so does
 * the server, which is the point of this package: the two cannot drift apart.
 *
 * Length over composition rules. NIST SP 800-63B advises against forcing character
 * classes — they push people towards Password1! and nothing else.
 */
export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(200, 'Password must be at most 200 characters');

export const emailSchema = z.string().trim().toLowerCase().email().max(320);

/** Six digits from an authenticator app. */
export const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app');

/** A recovery code: ten Crockford-base32 characters, usually written XXXXX-XXXXX. */
export const recoveryCodeSchema = z
  .string()
  .trim()
  .regex(/^[0-9A-Za-z-\s]{10,14}$/, 'Enter one of your recovery codes');

export const loginRequestSchema = z.object({
  email: emailSchema,
  // Not `passwordSchema`: an existing password set under older rules must still be
  // able to log in. Validating length here would lock those people out.
  password: z.string().min(1).max(200),
  /**
   * Required only for accounts with MFA enabled. The client learns it is needed from a
   * first attempt answered with MFA_REQUIRED, then resends with the code.
   *
   * One step rather than a half-authenticated session: a session that exists but is not
   * yet trusted is a state every downstream check must remember to consider, and one
   * that forgets is an authentication bypass.
   */
  totpCode: totpCodeSchema.optional(),
  /**
   * Accepted in place of `totpCode` when the authenticator is gone. Single use.
   * Formatting is presentation — case, spaces and the hyphen are all normalised away.
   */
  recoveryCode: recoveryCodeSchema.optional(),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** Response to POST /auth/mfa/enrol — shown once, as a QR code and as text. */
export const mfaEnrolResponseSchema = z.object({
  data: z.object({
    /** otpauth:// URI for the QR code. */
    otpauthUri: z.string(),
    /** The same secret in base32, for entering by hand when a camera will not cooperate. */
    secret: z.string(),
  }),
});
export type MfaEnrolResponse = z.infer<typeof mfaEnrolResponseSchema>;

export const mfaVerifyRequestSchema = z.object({
  code: totpCodeSchema,
});
export type MfaVerifyRequest = z.infer<typeof mfaVerifyRequestSchema>;

/**
 * Recovery codes, returned ONCE when enrolment is confirmed or the set is regenerated.
 * They are stored only as hashes, so this is the only moment they can be shown.
 */
export const mfaRecoveryCodesResponseSchema = z.object({
  data: z.object({
    recoveryCodes: z.array(z.string()),
  }),
});
export type MfaRecoveryCodesResponse = z.infer<typeof mfaRecoveryCodesResponseSchema>;

/**
 * A second factor: an authenticator code, or a recovery code when the phone is gone.
 * Exactly one is required — an empty object would let a hijacked session act alone.
 */
const secondFactorSchema = z
  .object({
    code: totpCodeSchema.optional(),
    recoveryCode: recoveryCodeSchema.optional(),
  })
  .refine((value) => Boolean(value.code) !== Boolean(value.recoveryCode), {
    message: 'Provide either an authenticator code or a recovery code',
  });

/** Turning MFA off requires the password AND a second factor — either alone is not enough. */
export const mfaDisableRequestSchema = z
  .object({ password: z.string().min(1).max(200) })
  .and(secondFactorSchema);
export type MfaDisableRequest = z.infer<typeof mfaDisableRequestSchema>;

/** Issuing a fresh set invalidates every previous code. */
export const mfaRegenerateRecoveryRequestSchema = z
  .object({ password: z.string().min(1).max(200) })
  .and(secondFactorSchema);
export type MfaRegenerateRecoveryRequest = z.infer<typeof mfaRegenerateRecoveryRequestSchema>;

export const forgotPasswordRequestSchema = z.object({
  email: emailSchema,
});
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;

export const resetPasswordRequestSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

export const inviteAcceptRequestSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
  /**
   * Accepting an invitation is where consent is recorded, so it must be given
   * explicitly rather than inferred from the act of setting a password.
   */
  acceptsDataProcessing: z.literal(true),
});
export type InviteAcceptRequest = z.infer<typeof inviteAcceptRequestSchema>;

/**
 * One active appointment, as the client needs to render it: "Secretary — Rotaract Club
 * of Kampala". The appointment is the unit of authorisation (docs/02-Architecture.md
 * §4.2), so showing a member what they hold is also showing them why they can do what
 * they can do.
 *
 * `scopeId` is polymorphic — a club, cluster, region or committee — which is why
 * `scopeName` is resolved server-side rather than left to the client to look up against
 * four different endpoints.
 */
export const appointmentSummarySchema = z.object({
  id: z.uuid(),
  positionCode: z.string(),
  positionName: z.string(),
  scopeType: z.enum(orgScopes),
  scopeId: z.uuid().nullable(),
  scopeName: z.string().nullable(),
  /** ISO dates, `YYYY-MM-DD`. */
  startsOn: z.string(),
  endsOn: z.string().nullable(),
});
export type AppointmentSummary = z.infer<typeof appointmentSummarySchema>;

/**
 * The shape of GET /auth/me — the client's source of truth for what to render.
 *
 * It must never be the security boundary. Every endpoint re-checks server-side; hiding
 * a button is presentation, and a client that hides nothing must still be refused by
 * the server (docs/05-API-Spec.md §2).
 *
 * Every field is null or empty for a member who holds no active appointment in the
 * district's current year. They are authenticated; they simply have no context, and
 * every scoped endpoint will refuse them.
 *
 * Note what is absent: no email, phone, photo or any other contact field. This is the
 * caller's own record, so returning them would not breach axiom 6 — but /auth/me is
 * called on every page load by every client, and the less personal data moves over a
 * metered mobile connection the better.
 */
export const meResponseSchema = z.object({
  data: z.object({
    userId: z.uuid(),
    personId: z.uuid(),
    firstName: z.string(),
    lastName: z.string(),
    status: z.enum(['INVITED', 'ACTIVE', 'SUSPENDED', 'DISABLED']),
    mfaEnabled: z.boolean(),
    /**
     * How many recovery codes are still unused. Surfaced so the client can warn a member
     * who is running low — discovering you have none left at the moment your phone dies
     * is the failure this whole mechanism exists to prevent.
     */
    mfaRecoveryCodesRemaining: z.number().int().nonnegative(),
    context: z.object({
      districtId: z.uuid().nullable(),
      districtName: z.string().nullable(),
      rotaryYearId: z.uuid().nullable(),
      /** e.g. `2027-28`. What the client puts in the year selector and in `?year=`. */
      rotaryYearLabel: z.string().nullable(),
      /** A locked year is read-only; the client should present it as such. */
      isYearLocked: z.boolean(),
      /**
       * False when this context may not be written to at all — a locked year, or a
       * historical year reached through `?year=`. The client uses it to put the whole
       * page in read-only mode rather than letting a member fill in a form that the
       * server will refuse.
       */
      isYearWritable: z.boolean(),
      permissions: z.array(z.string()),
      scopes: z.object({
        clubIds: z.array(z.uuid()),
        clusterIds: z.array(z.uuid()),
        isDistrictWide: z.boolean(),
      }),
    }),
    appointments: z.array(appointmentSummarySchema),
  }),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

/** One error shape for the whole API (docs/05-API-Spec.md §1). */
export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
