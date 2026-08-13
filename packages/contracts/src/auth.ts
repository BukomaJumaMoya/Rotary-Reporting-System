import { z } from 'zod';

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

/** Turning MFA off requires the password AND a current code — either alone is not enough. */
export const mfaDisableRequestSchema = z.object({
  password: z.string().min(1).max(200),
  code: totpCodeSchema,
});
export type MfaDisableRequest = z.infer<typeof mfaDisableRequestSchema>;

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
 * The shape of GET /auth/me.
 *
 * `context` is a STUB in M0 session 3 and is filled by the request-context work in
 * session 4. It is modelled here now so the client can be written against the final
 * shape rather than a temporary one.
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
    context: z.object({
      districtId: z.uuid().nullable(),
      rotaryYearId: z.uuid().nullable(),
      permissions: z.array(z.string()),
      scopes: z.object({
        clubIds: z.array(z.uuid()),
        clusterIds: z.array(z.uuid()),
        isDistrictWide: z.boolean(),
      }),
    }),
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
