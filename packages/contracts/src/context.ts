import { z } from 'zod';

/**
 * The request context (docs/02-Architecture.md §4.1, docs/05-API-Spec.md §1).
 *
 * Resolved once per request by middleware from the session, and required by the data
 * access layer, which injects `districtId` and `rotaryYearId` into every query on a
 * scoped table. Handlers never write those filters by hand and never read either value
 * from request input — a handler containing `where: { districtId: req.body.districtId }`
 * is a security bug, not a shortcut.
 *
 * Everything here derives from the caller's ACTIVE appointments for the district's
 * current Rotary Year. Nothing is cached in the cookie: an appointment revoked at noon
 * takes effect on the next request (ADR-003).
 */
export interface RequestContext {
  readonly userId: string;
  readonly personId: string;
  readonly districtId: string;
  readonly rotaryYearId: string;
  /** Permission codes, `resource:action:scope`. Union of the caller's positions. */
  readonly permissions: ReadonlySet<string>;
  readonly scopes: RequestScopes;
  /**
   * False when the context year may not be written to — because the district_year is
   * locked, or because the caller reached this year through a `?year=` override, which
   * is a read door (`year:read:historical`) and not a write one. The data access layer
   * rejects every write with `YEAR_LOCKED` while this is false.
   */
  readonly isYearWritable: boolean;
}

/**
 * Which records the caller may touch, as opposed to which actions they may perform.
 *
 * `clubIds` is already expanded: a cluster appointment contributes that cluster's clubs
 * and a region appointment contributes the clubs of every cluster in it, so a
 * record-level check is one array lookup rather than a graph walk per request.
 *
 * `isDistrictWide` is a flag rather than "every club id" deliberately — enumerating 140
 * clubs into every context, to answer a question that is a boolean, is work done 140
 * times to no purpose.
 */
export interface RequestScopes {
  readonly clubIds: readonly string[];
  readonly clusterIds: readonly string[];
  readonly isDistrictWide: boolean;
}

/** The org units an appointment — and therefore a scope check — can name. */
export const orgScopes = ['DISTRICT', 'REGION', 'CLUSTER', 'CLUB', 'COMMITTEE'] as const;
export type OrgScopeValue = (typeof orgScopes)[number];

/**
 * `?year=2027-28`. A Rotary Year LABEL, not an id: the label is what a member reads on
 * the page, and an id in a shareable URL is an internal identifier leaking into one.
 *
 * Reading any year other than the district's current one requires
 * `year:read:historical`; without it the override is refused rather than ignored,
 * because silently serving a different year than the one asked for is how a report gets
 * quoted against the wrong period.
 */
export const yearParamSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}$/, 'Year must look like 2027-28');

/** The permission that turns `?year=` into more than a no-op. */
export const PERMISSION_YEAR_READ_HISTORICAL = 'year:read:historical';
