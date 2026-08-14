import type { RequestContext } from '@dis/contracts';
import { identifyActor, withAuditActor } from './audit.js';
// The escape hatch, used for the same reason modules/governance uses it: this function
// BUILDS a context, so it cannot already hold one to read district_years through.
import { unscopedPrisma } from './db.js';

/**
 * A context for work that has no request.
 *
 * Jobs have no session, so they have no context — but they must not use `unscopedPrisma`
 * either: a job that skips the scope is a job that will one day run against the wrong
 * district. This is what they use instead, and everything after it inherits the shape —
 * the scoring job (M5), goal snapshots (M7), the notification drain.
 *
 * Three things make it safe:
 *
 *  * It is bound to ONE district and ONE Rotary Year, like any other context, so the data
 *    access layer scopes it identically.
 *  * It respects the LOCKED-YEAR check exactly as a user context does. Rollover locks the
 *    prior year and must then be unable to write to it, which is a useful self-test.
 *  * The `reason` is MANDATORY, and `identifyActor` puts it on every audit row the job
 *    writes — so the log records why a system write happened, not merely that one did.
 */

export interface SystemContext extends RequestContext {
  readonly isSystem: true;
  readonly reason: string;
}

export function isSystemContext(ctx: RequestContext): ctx is SystemContext {
  return (ctx as SystemContext).isSystem === true;
}

/**
 * Builds a system context, reading the year's lock state so the layer can refuse writes
 * to a closed year without the job having to remember to check.
 *
 * `reason` is a sentence a human will read in the audit log a year from now — "rollover
 * to 2028-29", not "job". It is required rather than optional because an optional one is
 * an empty one.
 */
export async function systemContext(input: {
  districtId: string;
  rotaryYearId: string;
  reason: string;
}): Promise<SystemContext> {
  if (!input.reason.trim()) {
    throw new Error('systemContext() requires a reason — it is what the audit log records');
  }

  const [districtYear, permissions] = await Promise.all([
    unscopedPrisma.districtYear.findFirst({
      where: { districtId: input.districtId, rotaryYearId: input.rotaryYearId },
      select: { isLocked: true },
    }),
    // The whole catalogue: "full permissions within the named district" means every
    // permission that EXISTS, so a job cannot do something no permission covers.
    unscopedPrisma.permission.findMany({ select: { code: true } }),
  ]);

  if (!districtYear) {
    throw new Error(
      `systemContext(): district ${input.districtId} has no Rotary Year ${input.rotaryYearId}`,
    );
  }

  return {
    // A synthetic actor. Null rather than a fabricated user id: no person did this, and
    // audit_log.actor_user_id is a foreign key to a real account.
    userId: '',
    personId: '',
    districtId: input.districtId,
    rotaryYearId: input.rotaryYearId,
    permissions: new Set(permissions.map((row: { code: string }) => row.code)),
    scopes: {
      clubIds: [],
      clusterIds: [],
      regionIds: [],
      committeeIds: [],
      // District-wide, so record-level checks pass without enumerating 140 clubs.
      isDistrictWide: true,
    },
    isYearWritable: !districtYear.isLocked,
    isSystem: true,
    reason: input.reason,
  };
}

/**
 * Runs `fn` with the audit actor naming the system and its reason.
 *
 * Every governed write inside lands in `audit_log` attributed to the reason rather than
 * to nobody. The callback must AWAIT its writes — a Prisma promise is lazy, and one
 * returned unawaited resolves outside the store.
 */
export async function withSystemActor<T>(ctx: SystemContext, fn: () => Promise<T>): Promise<T> {
  return withAuditActor({ districtId: ctx.districtId, userAgent: `system:${ctx.reason}` }, fn);
}

/** Names the current audit actor as this system job. For use inside an existing store. */
export function identifySystemActor(ctx: SystemContext): void {
  identifyActor({ districtId: ctx.districtId });
}
