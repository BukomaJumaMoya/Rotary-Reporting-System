import { uuid } from '../../lib/uuid';

/**
 * The reporting form's draft — its shape, where it is kept, and how a refused submission is
 * turned back into one.
 *
 * Apart from `ReportPage` so the pending screen can import `restoreReportDraft` without
 * importing a component. (The lint rule that forces this is about fast refresh, but the
 * separation is right regardless: the draft is state with a lifetime longer than the screen
 * that edits it.)
 *
 * sessionStorage, not a server draft. A secretary who taps a notification mid-report and
 * comes back should not start again, and a draft on the server is a row somebody has to
 * clean up.
 */

export const DRAFT_KEY = 'dis:report-draft';

export interface Draft {
  step: number;
  activityId: string;
  activityTypeId: string;
  clubId: string;
  title: string;
  description: string;
  startsAt: string;
  venue: string;
  narrativeReport: string;
  attendanceMembers: string;
  attendanceGuests: string;
  beneficiariesCount: string;
  extra: Record<string, string>;
  areaOfFocusCodes: string[];
}

export function emptyDraft(): Draft {
  return {
    step: 1,
    // The activity id is generated HERE, so submitting twice on a bad connection produces
    // one activity (ADR-006) — through `uuid()`, never `crypto.randomUUID()`, which is
    // secure-context only and therefore undefined on any http:// origin but localhost.
    activityId: uuid(),
    activityTypeId: '',
    clubId: '',
    title: '',
    description: '',
    // Most reports are filed about something that has just happened, so "now" is right far
    // more often than an empty field.
    startsAt: new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16),
    venue: '',
    narrativeReport: '',
    attendanceMembers: '',
    attendanceGuests: '',
    beneficiariesCount: '',
    extra: {},
    areaOfFocusCodes: [],
  };
}

export function loadDraft(): Draft {
  try {
    const stored = sessionStorage.getItem(DRAFT_KEY);
    if (!stored) return emptyDraft();
    return { ...emptyDraft(), ...(JSON.parse(stored) as Partial<Draft>) };
  } catch {
    // A corrupt draft is not worth an error screen; it is worth a fresh form.
    return emptyDraft();
  }
}

export function saveDraft(draft: Draft): void {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Storage disabled. The form still works; it simply will not survive a navigation.
  }
}

export function clearDraft(): void {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing to clear, or nothing to clear it with.
  }
}

/**
 * Turns a queued submission back into a draft, so a report the district REFUSED can be
 * corrected rather than retyped.
 *
 * Called from the pending screen. The alternative — "Try again" on an unchanged body that
 * will be refused for the same reason — is a loop whose only exit is to discard the work and
 * start over. The id is carried across, so the correction REPLACES the failed item in the
 * outbox instead of becoming a second one.
 */
export function restoreReportDraft(body: Record<string, unknown>, files: Blob[] = []): void {
  const text = (key: string): string => {
    const value = body[key];
    return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  };

  const base = emptyDraft();

  saveDraft({
    ...base,
    // Straight to the details step: the type was already chosen, and sending somebody back
    // to step 1 to re-pick it is a step for nothing.
    step: 2,
    activityId: text('id') || base.activityId,
    activityTypeId: text('activityTypeId'),
    clubId: text('hostScopeId'),
    title: text('title'),
    description: text('description'),
    startsAt: text('startsAt').slice(0, 16) || base.startsAt,
    venue: text('venue'),
    narrativeReport: text('narrativeReport'),
    attendanceMembers: text('attendanceMembers'),
    attendanceGuests: text('attendanceGuests'),
    beneficiariesCount: text('beneficiariesCount'),
    extra: (body['extra'] as Record<string, string> | undefined) ?? {},
    areaOfFocusCodes: (body['areaOfFocusCodes'] as string[] | undefined) ?? [],
  });

  handoffFiles = files;
}

/**
 * Photographs cannot go in sessionStorage, so they are handed over in memory.
 *
 * Sound here and only here: this is a same-tab navigation to a screen that reads it on its
 * very next render. Losing them would mean a member who took four photographs at a project
 * being asked for them again because one text field was wrong.
 */
let handoffFiles: Blob[] | null = null;

/**
 * Reads the handover WITHOUT consuming it.
 *
 * The two halves are separate on purpose. `ReportPage` reads this from a `useState`
 * initialiser, and StrictMode invokes a component's body twice in development, discarding
 * the first result — so a reader that also cleared would hand the photographs to a render
 * React throws away and give the surviving one an empty list. Clearing belongs in an effect,
 * which runs after the render that kept.
 */
export function peekHandoffFiles(): Blob[] {
  return handoffFiles ?? [];
}

export function clearHandoffFiles(): void {
  handoffFiles = null;
}
