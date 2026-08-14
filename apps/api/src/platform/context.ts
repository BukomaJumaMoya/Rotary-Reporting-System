import {
  yearParamSchema,
  type OrgScopeValue,
  type RequestContext,
  type RequestScopes,
} from '@dis/contracts';
import type { Request, RequestHandler } from 'express';
import { identifyActor } from './audit.js';
import { AppError, ErrorCode, insufficientScope, notFound, unauthenticated } from './errors.js';
import * as governance from '../modules/governance/service.js';
import type { ResolvedContext } from '../modules/governance/service.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- the shape Express's own types use.
  namespace Express {
    interface Request {
      /**
       * Resolved for every authenticated request, absent for the rest. Handlers reach it
       * through `requireContext(req)` rather than directly, so the undefined case is
       * answered once instead of at forty call sites.
       */
      ctx?: RequestContext;
      /** The presentation half — district and year names, for `/auth/me`. */
      contextDetail?: ResolvedContext;
    }
  }
}

/**
 * Resolves the request context from the session, once, before any handler runs.
 *
 * Mounted globally rather than per router. Every module added between now and launch
 * inherits it without anyone remembering to wire it up, which is the difference between
 * infrastructure and a convention.
 *
 * An unauthenticated request passes straight through with no context and no query: the
 * health endpoint and the login form must stay reachable, and `requireContext` is what
 * refuses the rest.
 */
export const resolveRequestContext: RequestHandler = (req, res, next) => {
  const userId = req.session.userId;
  if (!userId) {
    next();
    return;
  }

  void (async () => {
    const user = await governance.findContextUser(userId);
    // The account was deleted, suspended or disabled while the session lived. Sessions
    // are revocable precisely so that ends authority immediately (ADR-003); the route
    // decides whether that is a 401 or merely an empty context.
    if (!user || user.status !== 'ACTIVE') {
      next();
      return;
    }

    const yearLabel = readYearParam(req);
    const detail = await governance.resolveContext({
      userId: user.id,
      personId: user.personId,
      yearLabel,
    });

    req.contextDetail = detail;
    if (detail.context) req.ctx = detail.context;
    // Now that the district is known, audit rows written by this request can carry it.
    identifyActor({ userId: user.id, districtId: detail.districtId });
    next();
  })().catch(next);
};

/**
 * `?year=2027-28`. Rejected on shape here so a malformed value cannot reach a query, and
 * on authority in the resolver, which knows whether the caller holds
 * `year:read:historical`.
 */
function readYearParam(req: Request): string | undefined {
  const raw = req.query['year'];
  if (raw === undefined) return undefined;

  const parsed = yearParamSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Request validation failed', {
      fields: [{ path: 'year', message: 'Year must look like 2027-28' }],
    });
  }
  return parsed.data;
}

/**
 * The context, or a refusal. The single accessor, so every handler gets the same answer
 * to "what if there isn't one".
 */
export function requireContext(req: Request): RequestContext {
  if (req.ctx) return req.ctx;
  if (!req.session.userId) throw unauthenticated();

  // Authenticated, but holding no active appointment in the district's current year —
  // which is most members. Nothing here says whether any record exists, so 403 leaks
  // nothing: it describes the caller's own authority.
  throw insufficientScope('You hold no active appointment for the current Rotary Year');
}

/**
 * Refuses a request whose caller does not hold the permission.
 *
 *     router.post('/activities', requirePermission('activity:create:club'), …)
 *
 * Codes are matched exactly. There is no wildcard: `club:read:*` in the authorisation
 * matrix is documentation shorthand, and a matcher that expanded it would turn a typo in
 * a seeded permission row into a silent grant.
 *
 * This answers "may you do this at all". It does NOT answer "may you do it to THIS
 * record" — that is `requireScope`, and an endpoint touching a specific club needs both.
 */
export function requirePermission(code: string): RequestHandler {
  return (req, _res, next) => {
    try {
      const ctx = requireContext(req);
      if (!ctx.permissions.has(code)) {
        throw insufficientScope('You do not hold the permission this action requires', {
          required: code,
        });
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * True when the caller's scope covers this org unit.
 *
 * Every one of the five is answered, because records are owned at every one of them —
 * `documents.owner_scope_type` and `activities.host_scope_type` take a REGION or a
 * COMMITTEE as readily as a CLUB.
 *
 * Downward only. A cluster appointment covers that cluster's clubs; a club appointment
 * covers nothing above it. That asymmetry is the whole point of a scope: a club
 * secretary holding `activity:create:club` may create activities for one club.
 */
export function hasScope(
  ctx: RequestContext,
  target: { scopeType: OrgScopeValue; scopeId: string | null },
): boolean {
  if (ctx.scopes.isDistrictWide) return true;
  if (target.scopeType === 'DISTRICT') return false; // only a district-wide caller, above
  if (target.scopeId === null) return false;

  switch (target.scopeType) {
    case 'CLUB':
      return ctx.scopes.clubIds.includes(target.scopeId);
    case 'CLUSTER':
      return ctx.scopes.clusterIds.includes(target.scopeId);
    case 'REGION':
      return ctx.scopes.regionIds.includes(target.scopeId);
    case 'COMMITTEE':
      // Committees are orthogonal to the geography: serving on one grants that
      // committee's records and nothing under it.
      return ctx.scopes.committeeIds.includes(target.scopeId);
  }
}

/**
 * Record-level access. A club secretary holding `activity:create:club` may create
 * activities for their own club and no other, which is a question about the record and
 * cannot be answered by the permission set alone (docs/02-Architecture.md §4.2).
 *
 * Throws **404, never 403**. The caller has already established that the record exists —
 * they are holding its id — and confirming it would hand them the shape of the dataset
 * one identifier at a time. A record you may not see and a record that is not there give
 * the same answer.
 */
export function requireScope(
  ctx: RequestContext,
  target: { scopeType: OrgScopeValue; scopeId: string | null },
): void {
  if (!hasScope(ctx, target)) throw notFound();
}

/** `requireScope` for the common case. */
export function requireClubScope(ctx: RequestContext, clubId: string): void {
  requireScope(ctx, { scopeType: 'CLUB', scopeId: clubId });
}

/**
 * A `where` fragment narrowing a list to the clubs the caller may see — empty for a
 * district-wide caller, who may see all of them.
 *
 * For LISTS. A list must not 404 because one row in it is out of scope, so the rows are
 * filtered instead; a single-record read still goes through `requireScope`.
 */
export function clubScopeWhere<C extends string>(
  ctx: RequestContext,
  column: C,
): Partial<Record<C, { in: string[] }>> {
  if (ctx.scopes.isDistrictWide) return {};
  // The column is named rather than assumed: activities carry the club as `hostScopeId`,
  // documents as `ownerScopeId`, and dues as `clubId`.
  return { [column]: { in: [...ctx.scopes.clubIds] } } as Partial<Record<C, { in: string[] }>>;
}

/** The scopes as `/auth/me` serialises them. */
export function serialiseScopes(scopes: RequestScopes): {
  clubIds: string[];
  clusterIds: string[];
  regionIds: string[];
  committeeIds: string[];
  isDistrictWide: boolean;
} {
  return {
    clubIds: [...scopes.clubIds],
    clusterIds: [...scopes.clusterIds],
    regionIds: [...scopes.regionIds],
    committeeIds: [...scopes.committeeIds],
    isDistrictWide: scopes.isDistrictWide,
  };
}
