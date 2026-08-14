# 10 — Build Log and Current State

**Read this second, after `CLAUDE.md`, when starting any session.** The other documents
describe what the system *should* be; this one records what has actually been built, what
was decided along the way, and what is deliberately unfinished.

Last updated: 14 August 2026, after M0 session 4.

---

## 1. Where the build is

| M0 session | State | Commit |
|---|---|---|
| 1 — Monorepo scaffold and CI | **done**, CI green | `b5149b5` |
| 2 — Prisma schema translation and migrations | **done** | `2a2f7e3`, `f799317` |
| 3 — Authentication | **done**, plus mail, MFA, encryption | `2de1dfb`, `e527b8d`, `d1f62aa`, `7525705` |
| 4 — Request context and scoped data access | **done** | this commit |
| 5 — Audit log and no-PII harness | **next** | — |
| 6 — Seed and staging deployment | pending | — |

CI runs typecheck → lint → format:check → test → build → `npm audit` against a
`postgres:17` service container, and is green on `main`.

---

## 2. Local environment

PostgreSQL **17.5** runs as a Windows service named **`dis-postgres`** (Automatic start),
data directory `C:\Users\HP\.dis-pgdata`, listening on **port 5433**. This is a
project-local instance, deliberately separate from the PostgreSQL install on 5432, which
is untouched and whose password is not known.

| Database | Purpose |
|---|---|
| `rotaract_dis_dev` | Development. Migrations applied. |
| `rotaract_dis_dev_shadow` | Prisma replays migration history here for drift detection. |
| `dis_test` | Integration tests. **Truncated between every test.** |
| `dis_schema_check` | Scratch, for executing `docs/schema.sql` directly and comparing. |

Service control (needs elevation): `Start-Service dis-postgres` / `Stop-Service dis-postgres`.

`apps/api/.env` is gitignored and holds the local connection strings, `SESSION_SECRET` and
`ENCRYPTION_KEYS`. `.env.example` documents every variable the project will need; the ones
marked `[M0]` are read today.

**Tests require a database.** `TEST_DATABASE_URL` must name a database containing "test" —
the vitest global setup refuses to run otherwise, because it truncates every table.

---

## 3. What exists in code

```
packages/contracts/src/
  auth.ts        login, password reset, invite, MFA, /auth/me, error envelope
  context.ts     RequestContext, RequestScopes, the ?year= param, org scopes
  health.ts      the one unauthenticated response shape

apps/api/src/
  platform/
    config.ts    every env var, validated with Zod at startup; process exits if invalid
    context.ts   context middleware, requireContext, requirePermission, requireScope
    db.ts        prisma (scoped models removed from its TYPE) · db(ctx) · unscopedPrisma
    scope.ts     the scope registry, the Prisma extensions, the locked-year check
    errors.ts    AppError, stable codes, error handler, SQLSTATE → domain code mapping
    session.ts   express-session + connect-pg-simple, cookie policy
    validate.ts  validateBody, withBody (typed body), asyncHandler
    crypto.ts    AES-256-GCM for secrets, with key rotation (ADR-013)
    mail.ts      smtp | log | capture transports
  modules/
    admin/       GET /api/v1/admin/health — the only unauthenticated route
    auth/        routes · service · repository · passwords · tokens · mfa · recovery
    governance/  repository · service — appointment-derived context resolution
    notifications/ service · templates — delivery log built on notification_templates
  test/
    global-setup.ts  applies migrations to TEST_DATABASE_URL
    helpers.ts       resetDatabase, org/position/appointment fixtures, signIn
    probe-routes.ts  routes mounted INTO the real app by the scoping tests only
```

`apps/web` is still the session-1 placeholder page. Nothing has been built on it.

**103 tests**, all integration-style against real PostgreSQL.

---

## 4. Decisions taken during implementation

These are not in the original design package. They are binding.

**ADR-012 — where an invariant lives** (`02-Architecture.md`). Declarative constraints
first; derived state is a view, never a stored column maintained by a trigger; triggers
only as guards, each with a stable SQLSTATE and a conformance test. This removed
`dues_invoices.status`, `member_dues.amount_paid` and
`club_assessments.total_score/max_possible/rank_in_tier` in favour of views.

**ADR-013 — secret encryption and key management** (`02-Architecture.md`).

**`docs/schema.sql` is now v1.6.** The translation surfaced real defects in the v1.0
baseline; every amendment is logged in the file's own header. The substantive one:
`club_rosters` filtered on `supersedes_event_id IS NULL`, which discarded every correction
while continuing to count the row it corrected.

**Prisma owns anything Prisma can represent.** An index or table that Prisma *could*
express but does not know about is proposed for dropping on the next `migrate dev`. Partial
indexes, expression indexes, CHECK constraints, triggers, views and array `NOT NULL` are
invisible to its differ and live safely in raw SQL; `clubs_name_trgm` had to move into
`schema.prisma`. `prisma migrate diff --from-migrations --to-schema` must always report an
empty migration — treat any output as a bug.

**Migration order matters.** `0_extensions` must precede the tables migration, because
`persons.email` is `CITEXT`.

**Contracts are typed end to end.** Handlers use `withBody(schema, handler)` so the request
body arrives typed; a contract change becomes a compile error at the call site. Tests read
responses through the contract schemas rather than casting, so every assertion also checks
the envelope shape.

**Errors.** One envelope, stable codes in `platform/errors.ts`. Guard SQLSTATEs map to
domain codes. Never serialise a stack trace, SQL or an internal id.

### Session 4 — the scoped data access layer

**Scoping is the client, not a helper.** `platform/db.ts` exports `prisma` with every
context-bound model **removed from its type**, so `prisma.activity` does not compile.
Scoped models are reachable only through `db(ctx)`, which wraps Prisma in a query
extension that injects `districtId`, `rotaryYearId` and `deletedAt: null`. There is no
`where: { rotaryYearId }` to forget because there is no way to write one that matters.

**`platform/scope.ts` holds the registry** — the one statement of which table is scoped
how. `scope-registry.test.ts` parses `schema.prisma` and fails the build if a model
carrying `district_id`, `rotary_year_id` or `deleted_at` is neither registered nor listed
in `UNSCOPED_BY_DESIGN` with a reason. **Adding a scoped table therefore forces a
decision.** Two exemptions exist today, both because they are written before any context
can exist: `Notification` (password reset and invitations are unauthenticated) and
`AuditLogEntry` (LOGIN).

**Scoped delegates drop `findUnique`, `findUniqueOrThrow`, `update`, `delete` and
`upsert`.** Their `where` takes unique fields only and cannot carry the injected filter,
so offering them would be a silent way out of the scope. Repositories use
`findFirst({ where: { id } })`, `updateMany` and `deleteMany` — which also produce the
404-not-403 behaviour for free, since an out-of-scope row comes back as null or as a zero
count. `createManyAndReturn` and `updateManyAndReturn` are dropped too; both carry a
`select` whose result narrowing would have to be hand-rolled, and nothing needs them yet.

**Create and update signatures are re-declared** with the stamped columns removed, so a
handler cannot name them — being forced to name them is being forced to source them.
Removal is per model from the registry, because `district_years.rotary_year_id` is half of
that table's key and must stay settable. Note the limit: TypeScript's excess-property
check fires on object *literals*, so `data` assembled in a variable can still carry a
forged district. That is why the runtime override exists as well as the type, and there is
a test for exactly that case.

**Two things the layer deliberately does not do.** Nested writes are not stamped
(`create: { children: { create: [...] } }` bypasses it — create scoped rows at the top
level), and relations traversed by `include` are not scoped. The module boundary rule is
what keeps the second from mattering.

**`unscopedPrisma` is the escape hatch, and ESLint enforces its narrowness** — importable
only from `platform/`, `modules/governance/` and `src/test/`. Reaching for it in a module
is how axiom 1 stops being true, and it does not look like a mistake in review.

**Context resolution lives in `modules/governance`,** not in `platform/`, because
permissions *are* governance: they derive from `(person, position, org_unit, rotary_year)`
and from nothing else. It is the one module that reads the database without a context,
for the obvious reason. The middleware is mounted globally in `app.ts`, so every module
built from here inherits it without anyone wiring it up.

**Scope expansion happens once per request.** A cluster appointment contributes that
cluster's clubs and a region appointment contributes the clubs of every cluster in it, so
a record-level check is an array lookup rather than a graph walk. A district-wide caller
gets `isDistrictWide: true` and an EMPTY `clubIds` — enumerating 140 clubs to answer a
boolean is work done 140 times to no purpose.

**Two judgement calls worth knowing, neither of them in the session prompt:**

* **`?year=` is a read door.** The permission is named `year:read:historical`, so the
  context resolved under an override is marked unwritable and every write through it is
  refused with `YEAR_LOCKED`. Without this a historical-read permission would also be a
  backdating permission.
* **One district per session.** A member holding office in two districts at once resolves
  to the lowest district id, deterministically, rather than to whichever row the planner
  returned first. D9218 has no such case and a district switcher is a feature, not a
  default (ADR-010).

**`createApp()` takes an optional `mountExtra` hook,** used by nothing in production. It
lets the scoping tests mount probe routes INSIDE the real middleware stack — a test that
assembled its own app would prove the stack the test built, not the one that ships.
`tsconfig.build.json` excludes `src/test`, so none of it reaches `dist`.

---

## 5. Deliberately unfinished

| Thing | Why | Lands in |
|---|---|---|
| No endpoint issues invitations (`issueInvite()` is exported, unused) | who may invite whom is a permission question | M1 |
| Admin reset of a member's MFA | needs permissions | M1 |
| No worker process, no pg-boss | notifications deliver inline; the `notifications` row is already the queue | later |
| No seed | — | session 6 |
| Web app is a placeholder | — | M2 onwards |
| Audit log table exists and is append-only, but nothing writes to it | — | session 5 |
| Positions, permissions and appointments have no CRUD — they are fixtures and, from session 6, seed rows | context resolution READS them; editing them is a governance feature | M1 |
| `requireScope` answers DISTRICT, CLUSTER and CLUB; REGION and COMMITTEE return false | nothing owns records at those scopes yet | M1 |
| Appointment term dates compare against UTC, not district-local, midnight | the boundary is three hours wide in Kampala and matters on 1 July | M1, with governance |
| Permission codes match exactly — no `club:read:*` wildcard | a matcher would turn a typo in a seeded row into a silent grant | not planned |

**Seeding note for session 6:** `notification_templates` rows are inserted by a *migration*
(auth depends on them), but `document_types` and `social_platforms` are lookup tables with
**no rows yet** — the seed must populate them, alongside areas of focus, permissions,
positions, activity types and finance categories.

---

## 6. Traps worth knowing

**npm prunes transitive optional platform binaries.** Any `npm install -w <pkg> <dep>`
removes `@esbuild/*`, breaking `tsx` and therefore `npm run dev`. They are pinned in the
root `optionalDependencies` and **must be version-bumped together with esbuild**. `sharp`
will hit the same trap in M2.

**`resetDatabase()` preserves `notification_templates`** (and `_prisma_migrations`). Any
future reference data inserted by a migration must be added to that list, or tests will
delete rows nothing recreates.

**TOTP tests must align to the step boundary.** A code generated "+30 seconds" is flaky and
"+60 seconds" is two steps out and correctly rejected. See `nextStepCode()` in `mfa.test.ts`.

**`prisma migrate dev` prompts interactively** when it detects drift, which hangs a
non-interactive shell. Use `migrate deploy` where a prompt would be wrong, and note that
`migrate reset` requires explicit human consent.

**A new scoped table needs a registry entry.** `scope-registry.test.ts` will fail the
build if it does not get one, which is the intent — but the failure arrives at
`npm run test`, not at `migrate dev`, so it can surprise you a commit later than you
expect. Add the `CONTEXT_BOUND_MODELS` row in the same change as the model.

**`prisma.<scopedModel>` does not exist and that is not a broken import.** If a delegate
you expect is missing from `prisma`, the model is context-bound: use `db(ctx)`. Likewise
`findUnique` and `update` are absent from scoped delegates — `findFirst` and `updateMany`
are the replacements, and the zero-row case is your 404.

**Annotating a Prisma transaction client breaks the build.** `prisma` carries the
soft-delete extension, so its transaction client is narrower than `Prisma.TransactionClient`.
Let `tx` infer; annotating it discards the extension and fails to typecheck.

**Prisma 7 differences from most documentation:** configuration lives in
`prisma.config.ts`, the client generator is `prisma-client` emitting TypeScript into
`src/generated/prisma` (gitignored, rebuilt by `postinstall`), and `PrismaClient` requires
an explicit driver adapter.

---

## 7. Verification commands

```bash
npm run typecheck && npm run lint && npm run format:check && npm run test && npm run build

# Schema drift — must print "This is an empty migration."
cd apps/api && npx prisma migrate diff --from-migrations ./prisma/migrations \
  --to-schema prisma/schema.prisma --script

# Database invariants — 37 checks, every line must read PASS
psql "$DATABASE_URL" -f apps/api/prisma/checks/invariants.sql
```

`apps/api/prisma/checks/invariants.sql` attempts every guard violation and asserts it
fails. ADR-012 requires a check there for every database-side guard; adding a guard without
one is incomplete work. It becomes a vitest suite in session 5.
