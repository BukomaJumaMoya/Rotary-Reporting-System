/**
 * Joins class names, dropping anything falsy.
 *
 * Lives outside the component files so `react-refresh/only-export-components` stays
 * satisfied: a module that exports both a component and a plain function loses fast
 * refresh, and losing it in the design system means losing it everywhere.
 */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
