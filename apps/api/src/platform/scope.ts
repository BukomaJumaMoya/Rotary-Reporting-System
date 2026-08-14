import type { RequestContext } from '@dis/contracts';
import { yearLocked } from './errors.js';

/**
 * THE REGISTRY.
 *
 * The single statement of which tables are scoped and how. `db(ctx)` reads it and
 * rewrites every query; nothing else in the codebase decides this, and no handler is
 * asked to remember it (docs/02-Architecture.md §4.1, axiom 1).
 *
 * `scope-registry.test.ts` parses `prisma/schema.prisma` and fails the build if a model
 * carrying `district_id`, `rotary_year_id` or `deleted_at` appears in neither this file's
 * registries nor `UNSCOPED_BY_DESIGN`. Adding such a table therefore forces a decision
 * rather than allowing an omission — which is the whole failure mode this layer exists
 * to prevent, since an unscoped query looks exactly like a correct one.
 */

/** How a model's `district_id` relates to the caller's district. */
export type DistrictRule =
  /** Every row belongs to exactly one district. Filter strictly; inject on create. */
  | 'required'
  /**
   * NULL means "system-wide template, available to every district" — `positions`,
   * `activity_types`, `finance_categories`. Reads see the district's own rows AND the
   * templates; a create always produces a district row, never a template. Templates are
   * seeded and edited by migration, not by a request.
   */
  | 'sharedWhenNull';

export interface ScopeRule {
  readonly district?: DistrictRule;
  /** Filter and inject `rotary_year_id` from the context. */
  readonly year?: boolean;
  /** Filter out rows with a `deleted_at`. */
  readonly softDelete?: boolean;
}

/**
 * Models reachable ONLY through `db(ctx)`. Their delegates are removed from the type of
 * the context-free `prisma` export, so querying one without a context does not compile.
 */
export const CONTEXT_BOUND_MODELS = {
  // --- Organisation ---------------------------------------------------------
  // Deliberately NOT year-scoped: rotary_year_id is this table's dimension key, and
  // scoping it would reduce "which years does my district have" to a single row.
  DistrictYear: { district: 'required' },
  Region: { district: 'required' },
  Cluster: { district: 'required', year: true },
  ClubDistrictAffiliation: { district: 'required', year: true },
  // No district column — a club's district for a year is the affiliation, not a column
  // on the club (axiom 2). The year alone is the scope here.
  ClubClusterAssignment: { year: true },

  // --- Governance -----------------------------------------------------------
  Position: { district: 'sharedWhenNull' },
  Appointment: { district: 'required', year: true },
  Committee: { district: 'required', year: true },

  // --- Membership -----------------------------------------------------------
  MembershipEvent: { district: 'required', year: true },
  // A view, and scoped exactly like a table: derived state is still data (ADR-012).
  ClubRoster: { district: 'required' },

  // --- Activity -------------------------------------------------------------
  ActivityType: { district: 'sharedWhenNull' },
  Activity: { district: 'required', year: true, softDelete: true },

  // --- Finance --------------------------------------------------------------
  FinanceCategory: { district: 'sharedWhenNull' },
  Budget: { district: 'required', year: true },
  FinancialTransaction: { district: 'required', year: true, softDelete: true },
  DuesInvoice: { district: 'required', year: true },
  DuesInvoiceState: { district: 'required', year: true },
  MemberDues: { district: 'required', year: true },
  MemberDuesState: { district: 'required', year: true },
  TrfContribution: { district: 'required', year: true },

  // --- Assessment -----------------------------------------------------------
  AssessmentFramework: { district: 'required', year: true },
  // The year reaches these through the period's framework, not through a column.
  ClubAssessment: { district: 'required' },
  ClubAssessmentState: { district: 'required' },
  FrameworkPointTotal: { district: 'required', year: true },

  // --- Goals, documents, public image, platform -----------------------------
  Goal: { district: 'required', year: true },
  Document: { district: 'required', softDelete: true },
  SocialAccount: { district: 'required' },
  MediaAppearance: { district: 'required', year: true },
  ExportJob: { district: 'required' },
} as const satisfies Record<string, ScopeRule>;

/**
 * Models that carry a soft-delete filter and nothing else.
 *
 * Clubs and persons are GLOBAL entities — a club is not owned by a district, it is
 * affiliated to one for a year (axiom 2) — so they need no context and stay on the
 * plain `prisma` export. What they do need is that `deleted_at` is never forgotten,
 * which the same extension gives them.
 */
export const SOFT_DELETE_ONLY_MODELS = {
  Club: { softDelete: true },
  Person: { softDelete: true },
} as const satisfies Record<string, ScopeRule>;

/**
 * Tables that carry a `district_id` and are deliberately NOT scoped, with the reason.
 *
 * The registry test requires an entry here for anything it finds unregistered, so an
 * exemption is a sentence someone wrote on purpose rather than a gap nobody noticed.
 */
export const UNSCOPED_BY_DESIGN: Record<string, string> = {
  Notification:
    'Written during UNAUTHENTICATED flows — password reset and invitation both queue a ' +
    'message before any session exists, so there is no context to scope by. district_id ' +
    'is nullable and set explicitly by the caller when one is known.',
  AuditLogEntry:
    'Append-only, and written for LOGIN before a context is resolved. Session 5 owns its ' +
    'read path, which applies district scoping in the audit module. Deliberately has no ' +
    'foreign key either: an audit row outlives the rows it describes.',
};

export type ContextBoundModelName = keyof typeof CONTEXT_BOUND_MODELS;
export type SoftDeleteOnlyModelName = keyof typeof SOFT_DELETE_ONLY_MODELS;

/** Prisma names a delegate after its model with the first letter lowered. */
export type ContextBoundDelegateKey = Uncapitalize<ContextBoundModelName>;
export type SoftDeleteOnlyDelegateKey = Uncapitalize<SoftDeleteOnlyModelName>;

const ALL_RULES: Record<string, ScopeRule> = {
  ...CONTEXT_BOUND_MODELS,
  ...SOFT_DELETE_ONLY_MODELS,
};

/**
 * Operations whose `where` is a UNIQUE selector and therefore cannot carry an injected
 * district or year filter — Prisma rejects a non-unique field there outright.
 *
 * They are removed from the type of every scoped delegate (see `ScopedDelegate`), which
 * is not a limitation but the point: `findUnique({ where: { id } })` on a scoped table
 * would return another district's row, and `update({ where: { id } })` would write to
 * it. `findFirst({ where: { id } })` and `updateMany` accept the filter, so they get the
 * scope — and a record outside it comes back as null, which is exactly the 404-not-403
 * behaviour the API owes a probing caller (docs/05-API-Spec.md §1).
 */
export const UNSCOPABLE_OPERATIONS = [
  'findUnique',
  'findUniqueOrThrow',
  'update',
  'delete',
  'upsert',
] as const;

const UNSCOPABLE = new Set<string>(UNSCOPABLE_OPERATIONS);

/** Operations whose `where` the layer extends. */
const FILTERED_OPERATIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'updateManyAndReturn',
  'deleteMany',
]);

/** Operations whose `data` the layer stamps with the context. */
const CREATE_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn']);

/** Everything that changes a row, for the locked-year check. */
const WRITE_OPERATIONS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'upsert',
]);

/** The shape a Prisma query extension hands to `$allOperations`. */
interface OperationInput {
  model: string;
  operation: string;
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
}

type ArgsRecord = Record<string, unknown>;

function asRecord(value: unknown): ArgsRecord {
  return typeof value === 'object' && value !== null ? (value as ArgsRecord) : {};
}

/**
 * The clauses added to a query's `where`. Returned as an array so they can be AND-ed
 * with whatever the caller wrote rather than merged into it — a caller's top-level `OR`
 * merged naively would widen the scope instead of narrowing it.
 */
function scopeClauses(rule: ScopeRule, ctx: RequestContext | null): ArgsRecord[] {
  const clauses: ArgsRecord[] = [];

  if (rule.district && ctx) {
    clauses.push(
      rule.district === 'sharedWhenNull'
        ? { OR: [{ districtId: ctx.districtId }, { districtId: null }] }
        : { districtId: ctx.districtId },
    );
  }
  if (rule.year && ctx) clauses.push({ rotaryYearId: ctx.rotaryYearId });
  if (rule.softDelete) clauses.push({ deletedAt: null });

  return clauses;
}

function withScopedWhere(args: unknown, clauses: ArgsRecord[]): ArgsRecord {
  const next = { ...asRecord(args) };
  const existing = next['where'];
  next['where'] = existing === undefined ? { AND: clauses } : { AND: [...clauses, existing] };
  return next;
}

/** Values stamped onto every row created through a scoped delegate. */
function createStamp(rule: ScopeRule, ctx: RequestContext): ArgsRecord {
  const stamp: ArgsRecord = {};
  if (rule.district) stamp['districtId'] = ctx.districtId;
  if (rule.year) stamp['rotaryYearId'] = ctx.rotaryYearId;
  return stamp;
}

function withStampedData(args: unknown, stamp: ArgsRecord): ArgsRecord {
  const next = { ...asRecord(args) };
  const data = next['data'];

  // The stamp goes LAST: a caller supplying its own districtId does not get to choose
  // one, which is the difference between a scoped layer and a convention.
  next['data'] = Array.isArray(data)
    ? data.map((row) => ({ ...asRecord(row), ...stamp }))
    : { ...asRecord(data), ...stamp };

  return next;
}

/**
 * Filters `deleted_at` on every soft-deleted model, for BOTH the context-free `prisma`
 * export and every `db(ctx)` built on top of it. One definition, so "every query filters
 * it" is true of queries nobody has written yet.
 *
 * Relation filters are NOT rewritten — `user.findFirst({ where: { person: { … } } })`
 * reaches `persons` as a nested condition, which no extension sees. Code traversing a
 * relation into a soft-deleted table still writes `deletedAt: null` by hand, as
 * `modules/auth/repository.ts` does.
 */
export const softDeleteExtension = {
  name: 'soft-delete',
  query: {
    $allModels: {
      $allOperations: ({ model, operation, args, query }: OperationInput): Promise<unknown> => {
        const rule = ALL_RULES[model];
        if (!rule?.softDelete || !FILTERED_OPERATIONS.has(operation)) return query(args);
        return query(withScopedWhere(args, [{ deletedAt: null }]));
      },
    },
  },
};

/**
 * The district and year scoping extension, built per request context.
 *
 * Two things it deliberately does not do, both worth knowing before relying on it:
 *
 *  * **Nested writes are not stamped.** `create({ data: { activities: { create: [...] } } })`
 *    reaches `activities` through a nested writer the extension never sees. Create
 *    scoped rows at the top level.
 *  * **Relations are not scoped.** The filter applies to the model being queried, not to
 *    what an `include` traverses. The module boundary rule — no module reads another's
 *    tables — is what keeps that from mattering in practice.
 */
export function createScopeExtension(ctx: RequestContext) {
  return {
    name: 'district-year-scope',
    query: {
      $allModels: {
        $allOperations: ({ model, operation, args, query }: OperationInput): Promise<unknown> => {
          const rule = CONTEXT_BOUND_MODELS[model as ContextBoundModelName] as
            ScopeRule | undefined;
          if (!rule) return query(args);

          if (UNSCOPABLE.has(operation)) {
            // Unreachable through the exported types; reachable through a cast. A
            // programming error, so it surfaces as one rather than as a quiet 500 later.
            throw new Error(
              `${model}.${operation}() cannot be scoped — its where clause takes only ` +
                `unique fields. Use findFirst / updateMany / deleteMany instead.`,
            );
          }

          if (WRITE_OPERATIONS.has(operation) && !ctx.isYearWritable) {
            throw yearLocked('This Rotary Year is closed to changes');
          }

          if (CREATE_OPERATIONS.has(operation)) {
            return query(withStampedData(args, createStamp(rule, ctx)));
          }

          if (FILTERED_OPERATIONS.has(operation)) {
            return query(withScopedWhere(args, scopeClauses(rule, ctx)));
          }

          return query(args);
        },
      },
    },
  };
}
