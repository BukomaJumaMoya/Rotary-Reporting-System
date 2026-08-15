/**
 * Template codes the application sends by name. The ROWS are data — a district officer
 * edits subject and body in the UI without a deployment — but the code a caller passes
 * has to exist in both places, so the identifiers live here.
 */
export const NotificationTemplate = {
  AUTH_PASSWORD_RESET: 'AUTH_PASSWORD_RESET',
  AUTH_INVITE: 'AUTH_INVITE',
  AUTH_MFA_RESET: 'AUTH_MFA_RESET',
  /** Sent to the RECEIVING club when a transfer naming them is recorded (M2 s6). */
  MEMBERSHIP_TRANSFER_RECORDED: 'MEMBERSHIP_TRANSFER_RECORDED',
} as const;

export type NotificationTemplateCode =
  (typeof NotificationTemplate)[keyof typeof NotificationTemplate];

/**
 * Handlebars-style `{{key}}` substitution and nothing more: no conditionals, no loops,
 * no expressions. Templates are edited through the UI by district officers, so the
 * renderer is a place where a template author could otherwise reach into the process.
 * Substitution of known keys cannot.
 */
const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;

/**
 * OWN properties only.
 *
 * `payload[key]` and `key in payload` both walk the prototype chain, so a template
 * containing {{constructor}} would render "function Object() { [native code] }" and
 * {{toString}} would render a function body — into an email, from a template a district
 * officer edits in the UI. hasOwnProperty.call is what stops that.
 */
function ownValue(payload: Record<string, string>, key: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(payload, key) ? payload[key] : undefined;
}

export function render(template: string, payload: Record<string, string>): string {
  return template.replace(PLACEHOLDER, (_match, key: string) => ownValue(payload, key) ?? '');
}

/** Placeholders a template used but the caller did not supply. */
export function missingPlaceholders(template: string, payload: Record<string, string>): string[] {
  const used = [...template.matchAll(PLACEHOLDER)].map((match) => match[1] ?? '');
  return [...new Set(used)].filter((key) => ownValue(payload, key) === undefined);
}
