import { ApiError } from './api';

/**
 * DOMAIN CODES, WRITTEN OUT AS SENTENCES.
 *
 * The server's error messages are written for a developer reading a log. This turns them
 * into something a club secretary can act on, because "PERIOD_CLOSED" and even "the period
 * is closed" both fail the only test that matters: the reader still does not know what to do
 * next.
 *
 * Two rules, and they are the whole file:
 *
 *   1. Say what happened AND what to do. A sentence that only diagnoses leaves somebody
 *      staring at a screen.
 *   2. Never blame the reader. Most of these are the system enforcing a rule the reader was
 *      never told about — a locked year, a scope they do not hold — and the tone should
 *      reflect that it is the system's business to explain itself.
 *
 * Anything not listed falls back to the server's own message, which is written to be safe to
 * show: `platform/errors.ts` never puts SQL, a stack or an internal id in one.
 */

/** Which office to point somebody at. Kept here so the wording changes in one place. */
const ADRR = 'your ADRR';

const SENTENCES: Record<string, string> = {
  // ── Authentication ──────────────────────────────────────────────────────────────────
  UNAUTHENTICATED: 'Your session has ended. Sign in again to continue.',
  INVALID_CREDENTIALS: 'That email and password do not match. Check both and try again.',
  ACCOUNT_LOCKED:
    'This account is locked after several failed sign-in attempts. It unlocks automatically in a few minutes, or a district administrator can unlock it now.',
  ACCOUNT_NOT_ACTIVE:
    'This account is not active. Ask a district administrator to reactivate it before signing in.',
  RATE_LIMITED: 'Too many attempts in a short time. Wait a minute, then try again.',
  TOKEN_INVALID:
    'This link has expired or has already been used. Ask for a new one to be sent to you.',

  // ── Multi-factor ────────────────────────────────────────────────────────────────────
  MFA_REQUIRED: 'Enter the six-digit code from your authenticator app to finish signing in.',
  MFA_INVALID:
    'That code was not accepted. Codes change every 30 seconds — wait for the next one and enter it without spaces.',
  MFA_ALREADY_ENABLED:
    'Two-factor authentication is already switched on for this account. Turn it off first if you need to set it up again.',
  MFA_NOT_ENROLLED: 'This account has no authenticator set up yet. Set one up before continuing.',

  // ── Authority and scope ─────────────────────────────────────────────────────────────
  // Deliberately says nothing about whether the record exists. The server returns 404 rather
  // than 403 for out-of-scope records for the same reason, and a helpful-sounding message
  // here would hand back the bit the status code was chosen to withhold.
  NOT_FOUND: 'That record does not exist, or it is not one your position gives you access to.',
  INSUFFICIENT_SCOPE:
    'Your current position does not include this action. If you believe it should, ask ' +
    ADRR +
    ' to review your appointment.',
  UNKNOWN_PERMISSION:
    'That permission code is not one the system recognises. Check it against the permission list.',

  // ── The Rotary Year ─────────────────────────────────────────────────────────────────
  YEAR_LOCKED:
    'This Rotary Year is closed, so it can be read but not changed. Switch back to the current year to make an entry.',

  // ── Governance ──────────────────────────────────────────────────────────────────────
  POSITION_IN_USE:
    'This position is held by somebody in at least one Rotary Year, so it cannot be removed. End the appointments first, or hide the position instead.',
  POSITION_ALREADY_HELD:
    'Somebody already holds this position for that year and scope. End their appointment before starting a new one.',
  TEMPLATE_IMMUTABLE:
    'This template has already been used, so changing it would change records that are already filed. Make a new version instead.',
  DUPLICATE_CODE: 'That code is already in use. Codes must be unique — choose another.',
  INVALID_SCOPE_REFERENCE:
    'The club, cluster or committee this points at does not exist in the current year.',
  SCOPE_TYPE_MISMATCH:
    'This position is defined for a different kind of scope. A club position cannot be appointed at district level, or the other way round.',
  COMMITTEE_TOO_DEEP:
    'A committee may have sub-committees, but a sub-committee may not. Attach this to the parent committee instead.',
  ROLLOVER_NOT_CONFIRMED:
    'The rollover ran as a dry run and nothing was saved. Review the summary, then run it again with confirmation.',

  // ── Organisation ────────────────────────────────────────────────────────────────────
  RI_ID_ALREADY_CLAIMED:
    'Another club already uses that RI Club ID. Check the number on My Rotary — no two clubs share one.',
  CLUB_AFFILIATED_ELSEWHERE:
    'This club is affiliated to another district for this Rotary Year. Its affiliation has to be ended there before it can be added here.',

  // ── Membership ──────────────────────────────────────────────────────────────────────
  MEMBERSHIP_IMMUTABLE:
    'Membership records cannot be edited or deleted — the history has to stay intact. File a correcting entry instead, and the roster will update.',
  DUPLICATE_MEMBERSHIP_EVENT:
    'This membership entry has already been recorded. Nothing further is needed.',

  // ── Activity ────────────────────────────────────────────────────────────────────────
  MISSING_REQUIRED_FIELD_FOR_TYPE:
    'This activity type asks for a field that has been left blank. Fill in the highlighted fields and submit again.',
  PERIOD_CLOSED:
    'The period this belongs to has closed, so it can no longer be changed. Contact ' +
    ADRR +
    ' if you need an exception.',
  PERIOD_OPEN: 'This period is still open. Close it before doing this.',
  IDEMPOTENT_REPLAY: 'This was already submitted. It has been saved once, and once only.',

  // ── Media ───────────────────────────────────────────────────────────────────────────
  UNSUPPORTED_MEDIA_TYPE:
    'That file type is not accepted. Photographs should be JPEG, PNG or WebP; documents should be PDF.',
  FILE_TOO_LARGE:
    'That file is too large to upload. Photographs taken on a phone are usually fine — try again, and the app will shrink it for you.',

  // ── Finance ─────────────────────────────────────────────────────────────────────────
  BUDGET_EXISTS: 'This club already has a budget for this Rotary Year. Open that one to edit it.',
  BUDGET_APPROVED:
    'This budget has been approved, so its lines are fixed. Ask the treasurer to reopen it if a line has to change.',
  CATEGORY_DIRECTION_MISMATCH:
    'That category records the opposite direction of money to this entry — income against an expense line, or the reverse. Choose a matching category.',
  DUES_INVOICE_EXISTS: 'This club has already been invoiced for this Rotary Year.',
  MEMBER_DUES_EXISTS: 'This member has already been assessed for dues this Rotary Year.',

  // ── Audit ───────────────────────────────────────────────────────────────────────────
  AUDIT_IMMUTABLE:
    'The audit log cannot be changed. That is deliberate: a log that can be edited proves nothing.',

  // ── Infrastructure ──────────────────────────────────────────────────────────────────
  VALIDATION_ERROR: 'Some of the details need fixing. Check the highlighted fields.',
  NETWORK_ERROR:
    'Could not reach the server. Your work is saved on this device and will be sent when you are back on a connection.',
  INTERNAL_ERROR:
    'Something went wrong at our end, not yours. Try again in a moment — if it keeps happening, report it to the district secretary.',
};

/**
 * The sentence to put in front of somebody.
 *
 * Falls through to the server's message, then to a generic line. The generic line is the
 * last resort and should be rare: an unmapped code reaching a user is a gap in the table
 * above, not a reason to write vaguer copy.
 */
export function errorSentence(error: unknown): string {
  if (error instanceof ApiError) {
    const sentence = SENTENCES[error.code];
    if (sentence) return sentence;
    if (error.message) return error.message;
  }

  if (error instanceof Error && error.message) {
    // A thrown `Error` from our own code is written for a person; a raw network failure is
    // not, and reads as gibberish in a toast.
    if (error.name === 'TypeError') return SENTENCES.NETWORK_ERROR ?? '';
    return error.message;
  }

  return SENTENCES.INTERNAL_ERROR ?? 'Something went wrong. Please try again.';
}

/** Whether retrying could plausibly work — drives whether a retry button is offered. */
export function isRetryable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return ['NETWORK_ERROR', 'INTERNAL_ERROR', 'RATE_LIMITED'].includes(error.code);
}

/** Exported for the test that asserts every server code has a sentence here. */
export const ERROR_SENTENCES = SENTENCES;
