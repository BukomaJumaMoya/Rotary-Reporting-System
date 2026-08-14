import { PrismaPg } from '@prisma/adapter-pg';
import type { RequestContext } from '@dis/contracts';
import { PrismaClient, type Prisma } from '../generated/prisma/client.js';
import { config, isTest } from './config.js';
import {
  createScopeExtension,
  softDeleteExtension,
  CONTEXT_BOUND_MODELS,
  type ContextBoundDelegateKey,
  type ContextBoundModelName,
  type SoftDeleteOnlyDelegateKey,
  type UNSCOPABLE_OPERATIONS,
} from './scope.js';

/**
 * One PrismaClient for the process. Creating them per request exhausts the connection
 * pool, which shows up as intermittent timeouts under load rather than as an obvious
 * error.
 *
 * Prisma 7 requires an explicit driver adapter — the query engine no longer ships its
 * own connection handling. The pool sizing is deliberate: this is a small district
 * system on managed Postgres, where the connection ceiling is low and the failure mode
 * of over-provisioning is worse than a short queue.
 */
const adapter = new PrismaPg({
  connectionString: config.DATABASE_URL,
  max: 10,
});

/**
 * The unextended client. **Escape hatch — three legitimate callers and no others:**
 *
 *  * `modules/governance`, which resolves the context itself and therefore cannot have
 *    one yet;
 *  * `src/test/helpers.ts`, building fixtures across districts and years on purpose;
 *  * `prisma/seed.ts` (session 6).
 *
 * ESLint refuses the import anywhere else. Reaching for it in a module is how axiom 1
 * stops being true, and it will not look like a mistake in review — which is exactly why
 * the rule exists rather than a comment.
 */
export const unscopedPrisma = new PrismaClient({
  adapter,
  log: isTest ? [] : ['warn', 'error'],
});

/** Everything below is built on the soft-delete filter, so nothing has to remember it. */
const baseClient = unscopedPrisma.$extends(softDeleteExtension);

type BaseClient = typeof baseClient;

type UnscopableOperation = (typeof UNSCOPABLE_OPERATIONS)[number];

/**
 * A delegate with the unique-selector operations removed. See `UNSCOPABLE_OPERATIONS`
 * in `scope.ts` for why: their `where` cannot carry an injected filter, so leaving them
 * available would be a silent way out of the scope.
 *
 * Used for the soft-delete-only models, which need nothing rewritten beyond that.
 */
export type ScopedDelegate<D> = Omit<D, UnscopableOperation>;

// ---------------------------------------------------------------------------
// Write signatures for context-bound models
//
// The runtime stamps districtId and rotaryYearId onto every row created through
// `db(ctx)`. Prisma's generated input types still declare them REQUIRED, which would
// force every handler to name them — and a handler naming them is a handler sourcing
// them, which is the failure §4.1 exists to prevent. So the create and update
// signatures are re-declared here with exactly the columns the layer stamps removed.
//
// Removed per model, not globally: `district_years.rotary_year_id` is half of that
// table's primary key and must stay settable, and the registry already knows the
// difference between a column the layer owns and one that merely exists.
// ---------------------------------------------------------------------------

type ModelOperations<M extends ContextBoundModelName> = Prisma.TypeMap['model'][M]['operations'];

/**
 * The args and result of one operation, or `never` when the model does not have it —
 * views have no `create`, and indexing them for one would be an error rather than an
 * empty answer.
 */
type OpArgs<M extends ContextBoundModelName, Op extends string> =
  ModelOperations<M> extends Record<Op, { args: infer A }> ? A : never;

type OpResult<M extends ContextBoundModelName, Op extends string> =
  ModelOperations<M> extends Record<Op, { result: infer R }> ? R : never;

/** The columns `db(ctx)` fills in, for one model, as key names in Prisma's input types. */
type StampedKeys<M extends ContextBoundModelName> =
  | ((typeof CONTEXT_BOUND_MODELS)[M] extends { district: string }
      ? 'districtId' | 'district'
      : never)
  | ((typeof CONTEXT_BOUND_MODELS)[M] extends { year: true }
      ? 'rotaryYearId' | 'rotaryYear'
      : never);

/** Prisma's create inputs are XOR unions, so the omit has to distribute across them. */
type WithoutStamp<T, K extends PropertyKey> = T extends readonly (infer E)[]
  ? (E extends unknown ? Omit<E, K> : never)[]
  : T extends unknown
    ? Omit<T, K>
    : never;

/** The `data` of one operation with the stamped columns removed. */
type ScopedData<M extends ContextBoundModelName, Op extends string> = WithoutStamp<
  OpArgs<M, Op> extends { data: infer D } ? D : never,
  StampedKeys<M>
>;

type ScopedCreateArgs<M extends ContextBoundModelName> = {
  data: ScopedData<M, 'create'>;
};

type ScopedCreateManyArgs<M extends ContextBoundModelName> = Omit<
  OpArgs<M, 'createMany'>,
  'data'
> & {
  data: ScopedData<M, 'createMany'>;
};

type ScopedUpdateManyArgs<M extends ContextBoundModelName> = Omit<
  OpArgs<M, 'updateMany'>,
  'data'
> & {
  // Stripped on update as well as create: a handler must not be able to move a row into
  // another district or another year, which is what setting these on an update would do.
  data: ScopedData<M, 'updateMany'>;
};

/**
 * Mutations, re-declared. Views resolve to `object` — they have no write operations, and
 * a projection is not something to write to (ADR-012).
 *
 * `select` and `include` are absent from these signatures on purpose, so a create
 * returns the whole row. Preserving Prisma's generic narrowing here would mean
 * hand-rolling the payload machinery, and the alternative — declaring a narrowed result
 * the runtime does not return — would be a type that lies.
 *
 * `createManyAndReturn` and `updateManyAndReturn` are dropped for the same reason: both
 * carry `select`, neither is needed yet, and adding one later with honest types is a
 * smaller job than unpicking a wrong one.
 */
type ScopedWriteOperations<D, M extends ContextBoundModelName> = D extends {
  create: unknown;
}
  ? {
      create(args: ScopedCreateArgs<M>): Promise<OpResult<M, 'create'>>;
      createMany(args: ScopedCreateManyArgs<M>): Promise<OpResult<M, 'createMany'>>;
      updateMany(args: ScopedUpdateManyArgs<M>): Promise<OpResult<M, 'updateMany'>>;
    }
  : object;

/** Operations re-declared above, or dropped, and therefore removed from the base type. */
type ReplacedOperation =
  'create' | 'createMany' | 'createManyAndReturn' | 'updateMany' | 'updateManyAndReturn';

/**
 * A context-bound delegate: unique-selector operations gone, writes re-declared, reads
 * untouched — `select`, `include` and their result narrowing all work exactly as Prisma
 * generated them, which is where that precision actually earns its keep.
 */
export type ContextBoundDelegate<D, M extends ContextBoundModelName> = Omit<
  D,
  UnscopableOperation | ReplacedOperation
> &
  ScopedWriteOperations<D, M>;

/**
 * The context-free client. Scoped models are absent FROM ITS TYPE, so
 *
 *     prisma.activity.findMany()
 *
 * is a compile error — "Property 'activity' does not exist" — rather than a query that
 * quietly returns every district's activities for every year. That is the whole design:
 * the scope is not a helper a handler is trusted to call, it is the only door.
 *
 * What remains here is what genuinely has no district or year: users, tokens, consents,
 * sessions, reference data, and the two global entities (clubs and persons), which keep
 * their soft-delete filter.
 */
export type UnscopedClient = Omit<BaseClient, ContextBoundDelegateKey> & {
  readonly [K in SoftDeleteOnlyDelegateKey]: ScopedDelegate<BaseClient[K]>;
};

export const prisma: UnscopedClient = baseClient;

type ScopedModels = {
  readonly [K in ContextBoundDelegateKey]: ContextBoundDelegate<
    BaseClient[K],
    Capitalize<K> & ContextBoundModelName
  >;
};

type ScopedBase = Omit<BaseClient, ContextBoundDelegateKey | '$transaction'> & ScopedModels;

/**
 * The client inside `db(ctx).$transaction(...)`.
 *
 * Declared, rather than inherited, because Prisma's own transaction client type comes
 * from the UNextended client and would hand back full delegates — `tx.activity.update()`
 * would compile inside a transaction while failing to compile outside one. The runtime
 * extension does apply inside a transaction (there is a test), so this was never a data
 * leak; it was a hole in the compile-time guarantee, and repositories that need a
 * transaction are exactly where that guarantee is worth most.
 */
export type ScopedTransactionClient = Omit<
  ScopedBase,
  '$connect' | '$disconnect' | '$on' | '$extends' | '$use'
>;

/**
 * The scoped client: every context-bound model, with district, year and soft-delete
 * filters already applied and every create already stamped.
 *
 * Only the interactive (callback) form of `$transaction` is offered. The array form takes
 * `PrismaPromise[]`, and the re-declared write operations return plain promises, so a
 * batch mixing reads and writes would not compile anyway — better to have one form that
 * works than two where one silently does not.
 */
export type ScopedClient = ScopedBase & {
  $transaction<R>(
    fn: (tx: ScopedTransactionClient) => Promise<R>,
    options?: {
      maxWait?: number;
      timeout?: number;
      isolationLevel?: Prisma.TransactionIsolationLevel;
    },
  ): Promise<R>;
};

/**
 * One extended client per context, not per call. `$extends` is cheap but not free, and a
 * request that touches six tables should pay for it once.
 *
 * Keyed weakly on the context object, which lives exactly as long as the request that
 * owns it, so nothing accumulates.
 */
const clientsByContext = new WeakMap<RequestContext, ScopedClient>();

/**
 * Scoped data access. Requires a context and injects `districtId`, `rotaryYearId` and
 * `deletedAt: null` into every query it can reach (docs/02-Architecture.md §4.1).
 *
 *     const activities = await db(ctx).activity.findMany({ where: { status: 'HELD' } });
 *
 * There is no `where: { rotaryYearId }` to forget, because there is no way to write one
 * that matters. Left to individual queries, year scoping is forgotten in roughly one
 * handler in eight — which is how the incumbent system arrived at flyers dated 2037.
 */
export function db(ctx: RequestContext): ScopedClient {
  // The type says this cannot happen. It can still arrive from a cast, a stale session
  // shape, or a test that built a context by hand — and an empty districtId would
  // silently match nothing rather than fail, which is the worse outcome.
  if (!ctx.districtId || !ctx.rotaryYearId) {
    throw new Error('Scoped data access requires a resolved RequestContext');
  }

  const cached = clientsByContext.get(ctx);
  if (cached) return cached;

  // The one cast in this layer. A `query` extension changes behaviour, never result
  // types, so the extended client is structurally the base client — narrowed here to
  // the delegate surface that can actually honour the scope.
  const scoped = baseClient.$extends(createScopeExtension(ctx)) as unknown as ScopedClient;
  clientsByContext.set(ctx, scoped);
  return scoped;
}

export async function disconnect(): Promise<void> {
  await unscopedPrisma.$disconnect();
}
