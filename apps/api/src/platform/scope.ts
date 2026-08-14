import type { RequestContext } from '@dis/contracts';
import { yearLocked } from './errors.js';

/**
 * THE REGISTRY.
 *
 * The single statement of which tables are scoped and how. `db(ctx)` reads it and
 * rewrites every query; nothing else in the codebase decides this, and no handler is
 * asked to remember it (docs/02-Architecture.md §4.1, axiom 1).
 *
 * `scope-registry.test.ts` parses `prisma/schema.prisma` and fails the build if ANY model
 * or view appears in neither this file's registries nor `UNSCOPED_BY_DESIGN`. Every table
 * therefore forces a decision — not just the ones with a `district_id`, because a table
 * without one is the easier mistake to make and not the safer one: `assessment_scores`
 * has no district column and holds every district's marks.
 *
 * Three answers are available. Scope it by its own columns; inherit a scope through a
 * relation with `via`; or write down why it has none.
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

/**
 * A table with no scope column of its own, inheriting one through a relation.
 *
 * `assessment_scores` has no `district_id`; it belongs to a `club_assessment` that does.
 * Without this the scope stops at the parent and every child table is readable across
 * districts — which is most of the assessment domain, and it is the domain where a leak
 * matters most.
 *
 * `model` is named as well as `relation` because a relation field name does not give the
 * model back: `invoice` is a `DuesInvoice` and `parameter` is an `AssessmentParameter`.
 * Chains are followed to their end, so a two-hop child scopes correctly.
 */
export interface ScopeVia {
  /** The relation field on THIS model that points at the parent. */
  readonly relation: string;
  /** The parent's model name, which must itself be registered. */
  readonly model: string;
}

export interface ScopeRule {
  readonly district?: DistrictRule;
  /** Filter and inject `rotary_year_id` from the context. */
  readonly year?: boolean;
  /** Filter out rows with a `deleted_at`. */
  readonly softDelete?: boolean;
  /** Inherit the parent's scope through a relation. */
  readonly via?: ScopeVia;
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
  PositionPermission: { via: { relation: 'position', model: 'Position' } },
  Appointment: { district: 'required', year: true },
  Committee: { district: 'required', year: true },
  CommitteeMember: { via: { relation: 'committee', model: 'Committee' } },

  // --- Membership -----------------------------------------------------------
  MembershipEvent: { district: 'required', year: true },
  // A view, and scoped exactly like a table: derived state is still data (ADR-012).
  ClubRoster: { district: 'required' },

  // --- Activity -------------------------------------------------------------
  ActivityType: { district: 'sharedWhenNull' },
  Activity: { district: 'required', year: true, softDelete: true },
  // Children of an activity inherit its district, its year AND its soft delete, so the
  // attendees of a deleted activity disappear with it rather than outliving it.
  ActivityAreaOfFocus: { via: { relation: 'activity', model: 'Activity' } },
  ActivityPartner: { via: { relation: 'activity', model: 'Activity' } },
  ActivityMedia: { via: { relation: 'activity', model: 'Activity' } },
  ActivityAttendee: { via: { relation: 'activity', model: 'Activity' } },

  // --- Finance --------------------------------------------------------------
  FinanceCategory: { district: 'sharedWhenNull' },
  Budget: { district: 'required', year: true },
  BudgetLine: { via: { relation: 'budget', model: 'Budget' } },
  FinancialTransaction: { district: 'required', year: true, softDelete: true },
  DuesInvoice: { district: 'required', year: true },
  DuesInvoiceState: { district: 'required', year: true },
  DuesPayment: { via: { relation: 'invoice', model: 'DuesInvoice' } },
  MemberDues: { district: 'required', year: true },
  MemberDuesState: { district: 'required', year: true },
  MemberDuesPayment: { via: { relation: 'memberDues', model: 'MemberDues' } },
  TrfContribution: { district: 'required', year: true },

  // --- Assessment -----------------------------------------------------------
  //
  // The whole domain hangs off one framework, and only the framework carries the year.
  // Every table below reaches it through a relation chain, which is what stops a
  // current-year scorecard read from returning last year's scores as well.
  AssessmentFramework: { district: 'required', year: true },
  AssessmentParameter: { via: { relation: 'framework', model: 'AssessmentFramework' } },
  AssessmentCriterion: { via: { relation: 'parameter', model: 'AssessmentParameter' } },
  AssessmentPeriod: { via: { relation: 'framework', model: 'AssessmentFramework' } },
  // districtId of its own AND the year through the period: club_assessments has no
  // rotary_year_id, and district scoping alone let a current-year context see every
  // year's assessments.
  ClubAssessment: {
    district: 'required',
    via: { relation: 'period', model: 'AssessmentPeriod' },
  },
  AssessmentScore: { via: { relation: 'clubAssessment', model: 'ClubAssessment' } },
  AssessorAssignment: { via: { relation: 'period', model: 'AssessmentPeriod' } },
  AssessmentComment: { via: { relation: 'clubAssessment', model: 'ClubAssessment' } },
  AssessmentDispute: { via: { relation: 'clubAssessment', model: 'ClubAssessment' } },
  // A VIEW, and Prisma views carry no relation fields, so `via` cannot reach the period
  // from here. District-scoped only: standings are always read for a named period, and
  // the assessment module supplies that periodId. Revisit if the view ever grows a
  // rotary_year_id.
  ClubAssessmentState: { district: 'required' },
  FrameworkPointTotal: { district: 'required', year: true },

  // --- Goals, documents, public image, platform -----------------------------
  Goal: { district: 'required', year: true },
  GoalSnapshot: { via: { relation: 'goal', model: 'Goal' } },
  Document: { district: 'required', softDelete: true },
  SocialAccount: { district: 'required' },
  SocialSnapshot: { via: { relation: 'socialAccount', model: 'SocialAccount' } },
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
 * Tables deliberately NOT scoped, each with the reason.
 *
 * The registry test requires EVERY model and view in `schema.prisma` to appear in one of
 * the three registries — not merely those carrying a `district_id`. A table with no scope
 * column looks innocent and is the easier mistake: `assessment_scores` has no district of
 * its own, and reading it unscoped returns every district's marks.
 *
 * So an exemption is a sentence someone wrote on purpose, and the absence of one fails
 * the build.
 */
export const UNSCOPED_BY_DESIGN: Record<string, string> = {
  // --- Genuinely global entities -------------------------------------------
  District:
    'The tenant itself. A caller reads their own district through the context; listing ' +
    'districts is an administrative act, not district data.',
  RotaryYear:
    'Global: 1 July to 30 June is the same everywhere. Lock state is per district and ' +
    'lives on district_years, which IS scoped.',

  // --- Reference data, identical for every district -------------------------
  Permission: 'The permission catalogue. Reference data, seeded, the same for everyone.',
  AreaOfFocus: "Rotary's seven areas of focus. Reference data, defined by RI, not by us.",
  DocumentType: 'Lookup table. Reference data, seeded, shared by every district.',
  SocialPlatform: 'Lookup table, and part of the social_accounts unique key. Reference data.',
  NotificationTemplate:
    'Message templates, inserted by migration because authentication depends on them ' +
    'existing before any district does.',

  // --- Identity: keyed to a person or a user, never to a district -----------
  User: 'An account belongs to a person, not to a district. Authority comes from appointments.',
  PersonVisibility:
    'One row per person, created by a database trigger on insert. A person is global ' +
    '(axiom 2 applies to clubs, and people move between them), so this is too.',
  Consent:
    'A lawful-basis record belonging to the person who gave it. It must survive every ' +
    'redistricting, so it is deliberately not scoped to one.',
  MfaRecoveryCode: 'Second-factor material for one account. Read only by that account.',
  UserToken:
    'Password reset and invitation tokens, looked up by HASH during unauthenticated ' +
    'flows where no context can exist.',
  Session: 'The express-session store, written and read by connect-pg-simple, not by us.',

  // --- Written before a context can exist -----------------------------------
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
function scopeClauses(model: string, ctx: RequestContext, depth = 0): ArgsRecord[] {
  const rule = CONTEXT_BOUND_MODELS[model as ContextBoundModelName] as ScopeRule | undefined;
  if (!rule) return [];

  // The registry test proves the chains are acyclic, so this only ever fires if someone
  // edits the registry and runs the server before running the suite.
  if (depth > MAX_VIA_DEPTH) {
    throw new Error(`Scope rule for ${model} exceeds ${MAX_VIA_DEPTH} relation hops — a cycle?`);
  }

  const clauses: ArgsRecord[] = [];

  if (rule.district) {
    clauses.push(
      rule.district === 'sharedWhenNull'
        ? { OR: [{ districtId: ctx.districtId }, { districtId: null }] }
        : { districtId: ctx.districtId },
    );
  }
  if (rule.year) clauses.push({ rotaryYearId: ctx.rotaryYearId });
  if (rule.softDelete) clauses.push({ deletedAt: null });

  if (rule.via) {
    const parent = scopeClauses(rule.via.model, ctx, depth + 1);
    // A parent with no clauses of its own contributes no filter, rather than an empty
    // relation predicate that would match every row with a parent and none without.
    if (parent.length > 0) clauses.push({ [rule.via.relation]: { AND: parent } });
  }

  return clauses;
}

const MAX_VIA_DEPTH = 5;

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
 *  * **Relations traversed by `include` are not scoped.** The filter applies to the model
 *    being queried. `via` scopes a child BY its parent, which is the opposite direction
 *    and is applied; an `include` reading down from a scoped parent is inherently within
 *    scope anyway.
 *  * **A `via` child's create is not checked.** There is nothing to stamp — the parent is
 *    named by a foreign key the caller supplies — so creating a child under another
 *    district's parent would succeed. Read the parent through `db(ctx)` first; a service
 *    that has done so has already proved the parent is in scope.
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
            return query(withScopedWhere(args, scopeClauses(model, ctx)));
          }

          return query(args);
        },
      },
    },
  };
}
