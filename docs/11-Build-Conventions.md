# Build Conventions — as built, v1.6

**Read this after `CLAUDE.md` and the build log, before any session from M1 onward.**

The design package (documents 01–07) describes the system as designed in August 2026. M0
changed several things. Where this document and the design package disagree, **this
document wins** — and the design package should be amended rather than worked around.

Every session prompt in the revised milestone documents assumes what is written here.

---

## 1. What changed in M0

**`docs/schema.sql` is v1.7, not v1.0.** Amendments are logged in that file's header.
The one that matters most: `club_rosters` filtered on `supersedes_event_id IS NULL`, which
discarded every correction while still counting the row it corrected. Any code written
against the v1.0 baseline needs re-reading.

**Verify it after every amendment.** Build the schema twice — once from `docs/schema.sql`
into a scratch database, once from the migrations — and diff the catalogs. M1 did this and
found the `session` table had been in the database since M0 session 3 without ever being
recorded in the file that calls itself authoritative.

**ADR-012 removed stored derived columns.** `dues_invoices.status`,
`member_dues.amount_paid` and `club_assessments.total_score / max_possible / rank_in_tier`
are gone. They are views now. Design documents 01, 03, 05 and 06 still describe them as
columns in places; treat the view as the truth.

The rule: declarative constraints first, derived state as a view, triggers only as guards
— each with a stable SQLSTATE and a conformance check in
`apps/api/prisma/checks/invariants.sql`. A guard without a check is incomplete work.

**ADR-013 added secret encryption with key rotation.** `platform/crypto.ts`.

**The data access layer is stricter than the API spec describes.** See §2.

**`docs/05-API-Spec.md §1` was amended.** `RequestScopes` now carries `clubIds`,
`clusterIds`, `regionIds` and `committeeIds`, because records are owned at every org unit:
`documents.owner_scope_type`, `activities.host_scope_type`, `budgets.owner_scope_type` and
`goals.owner_scope_type` all accept a REGION or a COMMITTEE as readily as a CLUB.

---

## 2. How to write data access now

**There is no `prisma.activity`.** Context-bound models are removed from the exported
`prisma` client's *type*, so reaching for one is a compile error rather than a leak. If a
delegate you expect is missing, the model is scoped: use `db(ctx)`.

```ts
import { db } from '../../platform/db';

const rows = await db(ctx).activity.findMany({ where: { status: 'HELD' } });
// districtId, rotaryYearId and deletedAt: null are injected. Do not write them.
```

**Scoped delegates do not expose `findUnique`, `findUniqueOrThrow`, `update`, `delete`,
`upsert`, `createManyAndReturn` or `updateManyAndReturn`.** Their `where` takes unique
fields only and cannot carry the injected filter, so offering them would be a silent way
out of the scope.

| Instead of | Write |
|---|---|
| `findUnique({ where: { id } })` | `findFirst({ where: { id } })` — null is your 404 |
| `update({ where: { id }, data })` | `updateMany({ where: { id }, data })` — count 0 is your 404 |
| `delete({ where: { id } })` | `deleteMany({ where: { id } })` |
| `upsert(...)` | `findFirst` then branch, or raw `INSERT … ON CONFLICT` |

This is also where 404-not-403 comes from for free.

**Create and update signatures have the stamped columns removed**, so a handler cannot
name them. Note the limit: TypeScript's excess-property check fires on object *literals*,
so a `data` object assembled in a variable can still carry a forged `districtId`. The
runtime override exists for exactly that case, and there is a test for it.

**Every new table needs a scope registry entry in `platform/scope.ts`.**
`scope-registry.test.ts` parses `schema.prisma` and fails the build if any model or view is
neither registered nor listed in `UNSCOPED_BY_DESIGN` with a reason. Add the entry in the
same change as the model — the failure arrives at `npm run test`, not at `migrate dev`, so
it can surprise you a commit later than you expect.

**A child table with no scope column inherits one through `via`.** `assessment_scores` has
no `district_id`; it belongs to a `club_assessment` that does:

```ts
{ via: { relation: 'clubAssessment', model: 'ClubAssessment', fk: 'clubAssessmentId' } }
```

Chains are followed to their end. `AssessmentCriterion → AssessmentParameter →
AssessmentFramework` is two hops. The registry test proves every chain terminates at a real
column and that none cycles.

**`via` checks writes as well as reads.** A create or update naming a parent runs one
`COUNT` against that parent inside the scope and answers 404 when it is absent. This is
what stops `POST /assessments/:id/comments` with another district's assessment id. It
reads both the scalar foreign key and `connect: { id }`, and applies to updates, because
re-pointing a foreign key is how a row leaves a district without any scoped column
changing.

**Not covered, by design:** nested creates (`create: { children: { create: [...] } }`) are
not stamped — create scoped rows at the top level. Relations traversed by `include` are not
scoped; the module boundary rule is what keeps that from mattering.

**`unscopedPrisma` is importable only from `platform/`, `modules/governance/` and
`src/test/`,** enforced by ESLint. Reaching for it inside a module is how axiom 1 stops
being true, and it does not look like a mistake in review.

**Do not annotate a Prisma transaction client.** `prisma` carries the soft-delete
extension, so its transaction client is narrower than `Prisma.TransactionClient`. Let `tx`
infer. Only the interactive callback form of `$transaction` is available.

---

## 3. What every new module must do

A checklist. All of it is already true of the M0 modules; copy their shape.

- [ ] Routes mounted through the `mount()` helper in `createApp`, **never `app.use()`**.
      Express 5 keeps no mount-path string, so the unauthenticated-PII harness reads a
      registry instead. `assertAllRoutersDiscovered` fails the build if a router bypasses
      the helper — but the failure appears in the PII suite, not where the router was added.
- [ ] Request bodies typed with `withBody(schema, handler)` from `platform/validate.ts`,
      with the Zod schema living in `packages/contracts`. A contract change should be a
      compile error at the call site.
- [ ] Errors raised as `AppError` with a stable code from `platform/errors.ts`. New domain
      codes go in that file. Never serialise a stack trace, SQL or an internal id.
- [ ] Every new table registered in `platform/scope.ts`.
- [ ] Every database-side guard paired with a check in `invariants.sql`, and the expected
      count in `invariants.test.ts` updated.
- [ ] Tests read responses **through the contract schemas**, not by casting — that way
      every assertion also checks the envelope.
- [ ] Test fixtures write through `unscopedPrisma`, never `prisma`, so they do not seed
      `audit_log`.
- [ ] Module talks to other modules through exported service functions only. Never import
      another module's repository; never query another module's tables.
- [ ] `npm run test` green, including `no-pii.test.ts`, `scope-registry.test.ts` and
      `invariants.test.ts`.

---

## 4. Background jobs

**There is no worker process yet.** `fly.toml` has the process group commented out and
pg-boss is not built. Notifications deliver inline; the `notifications` row is already the
queue.

**pg-boss lands in M2**, immediately before media processing, which is the first real need.
Everything after inherits it: the scoring job (M5), goal snapshots (M7), the notification
drain, export generation.

**Jobs have no request, so they need a system context. BUILT** in M1 session 6, with
rollover — the first thing that iterates every club without a session.
`apps/api/src/platform/system-context.ts`:

```ts
systemContext({ districtId, rotaryYearId, reason }): Promise<SystemContext>
```

Full permissions within the named district, the locked-year check honoured exactly as a
user context honours it, and a MANDATORY reason that `identifyActor()` puts on every audit
row — so the log records *why* a system write happened, not merely that one did. Jobs must
never use `unscopedPrisma`: a job that skips the scope is a job that will one day run
against the wrong district.

**A transaction spanning two contexts needs `scopedTransaction()`.** A Prisma transaction
client cannot be `$extends`-ed — measured, not assumed — so `db(a)` and `db(b)` can never
share one. Rollover needs exactly that: last year's appointments and next year's
affiliations, atomically, with the dry run rolling both back.

```ts
await scopedTransaction(async (scopedFor) => {
  const prior = scopedFor(priorYearCtx);
  const next = scopedFor(targetYearCtx);
  // …one transaction, two scopes
});
```

It applies the scope through `rewriteArgs` — the same function the extension uses, not a
second copy — and refuses `via` models loudly, because their parent check needs a query of
its own. It does not audit either; a caller needing an audit row inside a transaction
writes one explicitly.

---

## 5. Traps carried forward

**npm prunes transitive optional platform binaries.** Any `npm install -w <pkg> <dep>`
removes `@esbuild/*` and breaks `npm run dev`. They are pinned in the root
`optionalDependencies` and must be version-bumped together with esbuild. **`sharp` will hit
this in M2** — pin its platform binaries the same way, in the same commit that adds it.

**`resetDatabase()` preserves `notification_templates`** and `_prisma_migrations`. Any
reference data a migration inserts must be added to that list, or tests will delete rows
nothing recreates.

**Prisma owns anything Prisma can represent.** An index or table Prisma *could* express but
does not know about is proposed for dropping on the next `migrate dev`. Partial indexes,
expression indexes, CHECK constraints, triggers, views and array `NOT NULL` live safely in
raw SQL. `prisma migrate diff --from-migrations --to-schema` must always report an empty
migration — treat any output as a bug.

**Prisma views support relation fields.** `club_rosters` and `club_assessment_states` both
use them, and no foreign key is emitted. A view can therefore be scoped through a relation
like any table.

**`prisma migrate dev` prompts interactively on drift**, which hangs a non-interactive
shell. Use `migrate deploy` where a prompt would be wrong.

**Prisma 7 differs from most documentation:** configuration in `prisma.config.ts`, the
client generator is `prisma-client` emitting TypeScript into `src/generated/prisma`
(gitignored, rebuilt by `postinstall`), and `PrismaClient` requires an explicit driver
adapter. Driver errors nest twice — `meta.driverAdapterError.cause.code` — which is where
`sqlStateOf()` reads guard SQLSTATEs from.

**Debian slim, not alpine**, in any Dockerfile. Prisma's engine is glibc-built and
segfaults on musl with no output. `argon2` needs install scripts to run; use
`npm prune --omit=dev`, never a second `npm ci --omit=dev`.

---

## 6. Two decisions still open

Both are recorded here so a session does not silently pick one.

**Published ranks.** ADR-012 made rank a view. A club published at rank 3 becomes rank 4
when another club's dispute is upheld, with no record it was ever 3. Recommendation: an
immutable `assessment_period_results` snapshot written at period finalisation, keeping the
live view for current standings. **Decide before M5 session 5.**

**Where the web app is served.** Options: from the existing Fly app alongside the API (one
deploy, one account, no CORS) or a dedicated static host (better CDN, another account to
hold under district identity). **Decide before M2 session 2.**

---

## 7. Where the design package is now wrong

Amend these as you reach them rather than working around them.

| Document | Issue |
|---|---|
| `01-SRS.md` FR-5.3, FR-6 | Describes invoice status and assessment totals as stored state |
| `03-Data-Model.md` §6 | ERD shows `total_score`, `max_possible`, `rank_in_tier` as columns |
| `06-Assessment-Engine.md` §5 | `upsertScore` cannot use Prisma `upsert` on a scoped delegate |

**Amended in M1** and now current — do not work around these:

| Document | What changed |
|---|---|
| `05-API-Spec.md` §1 | Widened `RequestScopes` (four arrays), `isYearWritable`, and the real domain-code list |
| `05-API-Spec.md` §4 | The governance surface as built, with the M2 rows marked as not built |
| `05-API-Spec.md` §10 | The M1 permissions, and the note that codes match exactly with no wildcard |
| `07-Roadmap.md` M0, M1 | Both marked complete, with what actually landed |
| `schema.sql` | v1.7 — `user_tokens.created_at`, and the `session` table that was always missing |
