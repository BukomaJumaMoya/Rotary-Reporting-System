import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestHandler } from 'express';

/**
 * The audit log (docs/02-Architecture.md §4.4).
 *
 * One table, written by a Prisma extension, capturing actor, entity, action and
 * before/after diffs on every governed entity. Append-only: no application path updates
 * or deletes it, and the `audit_log_no_mutate` guard makes that true of paths nobody has
 * written yet (ADR-012, SQLSTATE DIS02).
 *
 * Retention is indefinite. This is the record that makes a contested award
 * reconstructable eighteen months later, when the argument is about what the scorecard
 * said in March and everyone remembers it differently.
 */

/** Entities whose every change is recorded. */
export const GOVERNED_MODELS = {
  Club: 'clubs',
  Person: 'persons',
  Appointment: 'appointments',
  MembershipEvent: 'membership_events',
  Activity: 'activities',
  FinancialTransaction: 'financial_transactions',
  DuesPayment: 'dues_payments',
  TrfContribution: 'trf_contributions',
  AssessmentScore: 'assessment_scores',
  ClubAssessment: 'club_assessments',
  AssessmentFramework: 'assessment_frameworks',
  Document: 'documents',
} as const;

export type GovernedModelName = keyof typeof GOVERNED_MODELS;

/** The actions recorded. CREATE/UPDATE/DELETE come from the extension; the rest are explicit. */
export const AuditAction = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
  EXPORT: 'EXPORT',
  /**
   * A background job that exhausted its retries and dead-lettered.
   *
   * Recorded here rather than in a table of its own because an administrator already has
   * a screen that reads this log, and a dead job nobody is told about is the failure mode
   * that matters: in a system that scores clubs, a scoring job that quietly died is a club
   * whose standing is wrong and nobody knows.
   */
  JOB_FAILED: 'JOB_FAILED',
} as const;

export type AuditActionValue = (typeof AuditAction)[keyof typeof AuditAction];

/**
 * Who is acting, and from where.
 *
 * Mutable on purpose. `userId` is unknown when the store is created — a login request
 * arrives with no session and acquires one inside the handler — so the login path sets it
 * on the way through rather than the middleware guessing it up front.
 */
export interface AuditActor {
  userId: string | null;
  districtId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * Carried in AsyncLocalStorage rather than passed down.
 *
 * A Prisma extension sits below every service and repository and cannot be handed a
 * request. The alternative — threading an actor through every write signature — is the
 * kind of parameter that gets dropped in one function out of forty, and the one that is
 * dropped is the one somebody later needs.
 */
const storage = new AsyncLocalStorage<AuditActor>();

export function currentActor(): AuditActor | undefined {
  return storage.getStore();
}

/** Establishes the actor for a request. Mounted before any route. */
export const auditActorMiddleware: RequestHandler = (req, _res, next) => {
  const actor: AuditActor = {
    userId: req.session?.userId ?? null,
    districtId: null,
    ipAddress: req.ip ?? null,
    // Truncated: a user agent is attacker-controlled and unbounded, and this column is
    // written on every governed change for the life of the system.
    userAgent: req.get('user-agent')?.slice(0, 500) ?? null,
  };
  storage.run(actor, () => {
    next();
  });
};

/**
 * Names the actor once it is known — at login, and once the context middleware has
 * resolved a district.
 */
export function identifyActor(fields: { userId?: string; districtId?: string | null }): void {
  const actor = storage.getStore();
  if (!actor) return;
  if (fields.userId !== undefined) actor.userId = fields.userId;
  if (fields.districtId !== undefined) actor.districtId = fields.districtId;
}

/**
 * Runs `fn` with an explicit actor. For jobs and tests, which have no request.
 *
 * **`fn` must AWAIT its writes.** A Prisma promise is lazy — the query is not issued
 * until something awaits it — so returning one unawaited hands it back to a caller
 * outside this store, and the extension then sees no actor at all. Hence `Promise<T>`
 * rather than `T`: the signature makes the mistake harder to write.
 *
 * The request path has this for free, because the middleware wraps `next()` and every
 * await in the request happens inside.
 */
export async function withAuditActor<T>(
  actor: Partial<AuditActor>,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(
    { userId: null, districtId: null, ipAddress: null, userAgent: null, ...actor },
    async () => await fn(),
  );
}

/**
 * Makes a Prisma row safe to store as JSONB.
 *
 * `JSON.stringify` throws on a BigInt and silently mangles a Decimal, and both are all
 * over this schema — `ri_club_id` is a BigInt and every money column is a Decimal. A
 * diff that quietly recorded "{}" for an amount would be worse than no diff.
 */
export function toJsonSafe(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString('base64');
  if (Array.isArray(value)) return value.map(toJsonSafe);

  if (typeof value === 'object') {
    // Prisma.Decimal and anything else carrying its own toString — recognised
    // structurally rather than by importing the runtime's class, which is not part of
    // the generated client's public surface.
    const candidate = value as { toFixed?: unknown; toString(): string };
    if (typeof candidate.toFixed === 'function') return candidate.toString();

    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = toJsonSafe(item);
    }
    return out;
  }

  return value;
}

/**
 * The fields an UPDATE actually changed, on both sides.
 *
 * Storing whole rows twice would make `audit_log` the largest table in the database
 * within a year, and would bury the one column that changed under forty that did not.
 * A CREATE keeps its whole `after`; a DELETE keeps its whole `before`.
 */
export function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  const changedBefore: Record<string, unknown> = {};
  const changedAfter: Record<string, unknown> = {};
  let changed = false;

  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const from = toJsonSafe(before[key]);
    const to = toJsonSafe(after[key]);
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    // `updated_at` moves on every write and says nothing on its own. It is noise in
    // every diff and the reason a real change becomes hard to spot.
    if (key === 'updatedAt') continue;

    changedBefore[key] = from;
    changedAfter[key] = to;
    changed = true;
  }

  return changed ? { before: changedBefore, after: changedAfter } : null;
}

/** One row to append to `audit_log`. */
export interface AuditEntry {
  districtId: string | null;
  actorUserId: string | null;
  entityType: string;
  entityId: string | null;
  action: AuditActionValue;
  before: unknown;
  after: unknown;
  ipAddress: string | null;
  userAgent: string | null;
}

/** What the extension needs from the database, supplied by `db.ts`. */
export interface AuditPorts {
  /** Rows a write is about to touch, read with the write's own (already scoped) filter. */
  findAffected(delegateKey: string, where: unknown): Promise<Record<string, unknown>[]>;
  /** Appends rows. Never throws into the caller — see `append` below. */
  write(entries: AuditEntry[]): Promise<void>;
}

const CREATE_OPS = new Set(['create', 'createMany', 'createManyAndReturn']);
const UPDATE_OPS = new Set(['update', 'updateMany', 'updateManyAndReturn', 'upsert']);
const DELETE_OPS = new Set(['delete', 'deleteMany']);

interface AuditOperationInput {
  model: string;
  operation: string;
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
}

function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (result && typeof result === 'object' && !('count' in result)) {
    return [result as Record<string, unknown>];
  }
  return [];
}

function idOf(row: Record<string, unknown>): string | null {
  const id = row['id'];
  if (typeof id === 'string') return id;
  if (typeof id === 'bigint') return id.toString();
  return null;
}

function districtOf(row: Record<string, unknown> | undefined, actor: AuditActor | undefined) {
  const own = row?.['districtId'];
  if (typeof own === 'string') return own;
  return actor?.districtId ?? null;
}

/**
 * Captures every change to a governed entity.
 *
 * Applied LAST in the extension chain on purpose, so the arguments it sees are the ones
 * that reach the database — district-scoped, year-scoped and soft-delete-filtered. Read
 * before the scope layer, the "before" query would match rows in other districts that the
 * write itself never touched, which is both a wrong diff and a leak into the audit table.
 *
 * `unscopedPrisma` deliberately carries no audit extension: the seed writes thousands of
 * rows and none of them are anybody's action.
 */
export function createAuditExtension(ports: AuditPorts) {
  /**
   * Appending must never fail the operation that caused it.
   *
   * The alternative — a failed audit write rolling back a member's activity report — is a
   * system that stops working when its logging does. The failure is loud in the server
   * log instead, where it is a bug to fix rather than an outage.
   */
  async function append(entries: AuditEntry[]): Promise<void> {
    if (entries.length === 0) return;
    try {
      await ports.write(entries);
    } catch (error) {
      console.error('[audit] failed to append', error);
    }
  }

  return {
    name: 'audit-log',
    query: {
      $allModels: {
        $allOperations: async ({
          model,
          operation,
          args,
          query,
        }: AuditOperationInput): Promise<unknown> => {
          const entityType = GOVERNED_MODELS[model as GovernedModelName] as string | undefined;
          if (!entityType) return query(args);

          const actor = currentActor();
          const delegateKey = model.charAt(0).toLowerCase() + model.slice(1);
          const where = (args as { where?: unknown } | null)?.where;

          if (CREATE_OPS.has(operation)) {
            const result = await query(args);
            await append(
              rowsOf(result).map((row) => ({
                districtId: districtOf(row, actor),
                actorUserId: actor?.userId ?? null,
                entityType,
                entityId: idOf(row),
                action: AuditAction.CREATE,
                before: null,
                after: toJsonSafe(row),
                ipAddress: actor?.ipAddress ?? null,
                userAgent: actor?.userAgent ?? null,
              })),
            );
            return result;
          }

          if (UPDATE_OPS.has(operation)) {
            // Read first: there is no "returning the old row" in SQL, and after the
            // write the previous values are simply gone.
            const before = await ports.findAffected(delegateKey, where);
            const result = await query(args);
            const after = await ports.findAffected(delegateKey, where);
            const afterById = new Map(after.map((row) => [idOf(row), row]));

            await append(
              before.flatMap((previous) => {
                const id = idOf(previous);
                const current = afterById.get(id);
                // Absent afterwards means the update moved the row out of the filter —
                // a soft delete, or a scoped column changing. The change is still
                // recorded; there is simply nothing to compare it against.
                const changes = current ? diff(previous, current) : null;
                if (current && !changes) return [];

                return [
                  {
                    districtId: districtOf(current ?? previous, actor),
                    actorUserId: actor?.userId ?? null,
                    entityType,
                    entityId: id,
                    action: AuditAction.UPDATE,
                    before: changes ? changes.before : toJsonSafe(previous),
                    after: changes ? changes.after : null,
                    ipAddress: actor?.ipAddress ?? null,
                    userAgent: actor?.userAgent ?? null,
                  },
                ];
              }),
            );
            return result;
          }

          if (DELETE_OPS.has(operation)) {
            const before = await ports.findAffected(delegateKey, where);
            const result = await query(args);
            await append(
              before.map((row) => ({
                districtId: districtOf(row, actor),
                actorUserId: actor?.userId ?? null,
                entityType,
                entityId: idOf(row),
                action: AuditAction.DELETE,
                before: toJsonSafe(row),
                after: null,
                ipAddress: actor?.ipAddress ?? null,
                userAgent: actor?.userAgent ?? null,
              })),
            );
            return result;
          }

          return query(args);
        },
      },
    },
  };
}
