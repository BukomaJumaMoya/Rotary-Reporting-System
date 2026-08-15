# 10 — Build Log and Current State

**Read this second, after `CLAUDE.md`, when starting any session.** The other documents
describe what the system *should* be; this one records what has actually been built, what
was decided along the way, and what is deliberately unfinished.

Last updated: 15 August 2026, after M1 session 7. **M0 and M1 are complete.**

<!-- dis:state milestone=M1 schema=v1.7 tests=282 -->

---

## 0. Start here

**A new session begins by reading this section and §0a.** Everything below is detail you
can reach for; these two are what you need before writing anything. `npm run docs:check`
verifies most of what follows against the code, so if it is green the claims here are not
merely assertions.

**Where the build is.** M0 (foundations) and M1 (governance core) are complete. M2 (the
reporting spine — clubs, persons, membership events, activities with media) is next, and
its session prompts are in `docs/13-ClaudeCode-M2-Sessions.md`.

**Read in this order.** `CLAUDE.md` for the axioms and the non-negotiable rules → this
section → §0a for what the last milestone changed about how you must write code → the
session prompt for the milestone you are implementing. Reach into §4 when you hit something
surprising; it is written to answer "why is it like this".

**What is true about the system right now** — the four things most likely to trip you up:

1. Scoped models are absent from the `prisma` export's *type*. `prisma.activity` does not
   compile. Use `db(ctx)`, and `findFirst`/`updateMany`/`deleteMany` rather than
   `findUnique`/`update`/`delete`.
2. Every new table needs a row in `platform/scope.ts` — a scope rule, a `via`, or an
   `UNSCOPED_BY_DESIGN` reason. The build fails otherwise, but at `npm run test`, not at
   `migrate dev`.
3. Every new router must be mounted through the `mount()` helper in `createApp`, or the
   unauthenticated-PII harness will not walk it and will pass without proving anything.
4. Every new database guard needs a check in `apps/api/prisma/checks/invariants.sql`, and
   the suite asserts an exact count — adding a guard without a check fails the build.

**Open items that shape the next milestone** are in §5. Two are not code: the repository is
still on a personal account (ADR-011, M0's last unmet exit condition), and the web bundle
has nowhere to publish to.

---

## 0a. What the last milestone changed about the rules

**This section is rewritten at every milestone close and describes only the most recent
one.** Its purpose is that a fresh session does not rediscover a rule by breaking it. The
full history is in §4.

**After M1, when writing code:**

- **Two scopes in one transaction need `scopedTransaction()`.** A Prisma transaction client
  cannot be `$extends`-ed, so `db(a)` and `db(b)` can never share one. It does not audit —
  write the audit row yourself, as rollover does.
- **Work with no request uses `systemContext({ districtId, rotaryYearId, reason })`**, never
  `unscopedPrisma`. The reason is mandatory and reaches `audit_log`.
- **Any date that decides authority goes through `platform/time.ts`.** Comparing a term
  against UTC is wrong by a three-hour window in Kampala, and rollover lands on exactly that
  boundary.
- **`isCurrent` and `isActive` are different questions.** Active means not revoked; current
  means the term covers today where the district is.
- **Committee scope expands downwards**, so a chair covers their own subtree. Nothing
  expands upwards.
- **Permission codes match exactly.** There is no wildcard, and adding one would turn a typo
  in a seeded row into a silent grant.

**No axiom changed in M1.** The conformance review is in §4a.

---

## 1. Where the build is

| M0 session | State | Commit |
|---|---|---|
| 1 — Monorepo scaffold and CI | **done**, CI green | `b5149b5` |
| 2 — Prisma schema translation and migrations | **done** | `2a2f7e3`, `f799317` |
| 3 — Authentication | **done**, plus mail, MFA, encryption | `2de1dfb`, `e527b8d`, `d1f62aa`, `7525705` |
| 4 — Request context and scoped data access | **done** | `5b9076d`, `a4a62f7`, `d34f024` |
| 5 — Audit log and no-PII harness | **done** | `1f248ea` |
| 6 — Seed and staging deployment | **done** | this commit |

| M1 session | State | Commit |
|---|---|---|
| 1 — Positions and permissions CRUD | **done** | `fbef671` |
| 2 — Appointments, district-local terms | **done** | `8310ced` |
| 3 — Web application shell | **done** | `81010f3` |
| 4 — Committees, delegated sub-committees | **done** | `8a3c7df` |
| 5 — Invitations, MFA reset, audit read | **done** | `7dd1702` |
| 6 — System context and year rollover | **done** | `e04e786` |
| 7 — Governance administration screens | **done** | this commit |

CI runs typecheck → lint → format:check → test → build → `npm audit` against a
`postgres:17` service container, and is green on `main`.

---

## 1a. What M1 changed in the platform

**`platform/time.ts`** — every term comparison runs against midnight in the DISTRICT's
timezone, in context resolution and appointment validation alike, through one helper.

**`platform/system-context.ts`** — `systemContext(districtId, rotaryYearId, reason)` for
work with no request. Full permissions within one district, the locked-year check honoured
exactly as a user context, and a mandatory reason that reaches `audit_log`. Jobs use this,
never `unscopedPrisma`.

**`scopedTransaction()` in `platform/db.ts`** — one transaction, several scoped clients.
A Prisma transaction client cannot be `$extends`-ed (measured), so `db(a)` and `db(b)` can
never share a transaction; rollover needs exactly that. The scope is applied by hand
through `rewriteArgs`, the same function the extension uses. It refuses `via` models
loudly rather than scoping them halfway, and it does not audit — a caller needing an audit
row inside a transaction writes one, as rollover does.

**Committee scope expands downwards** in `resolveScopes`, like regions to clusters to
clubs. That is what lets a chair run their own subtree without district-wide permission.

**A scoped `create` now returns honest types.** `TypeMap`'s `create.result` is
`PayloadToResult` without its second type argument, so every field came back
`string | undefined`. It reads the payload's own `scalars` instead.

**`parseQuery()` and `pathParam()`** in `platform/validate.ts`: Express types query and
path values as `string | string[]`, so every filter read straight off them was unchecked.

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
  common.ts      pagination, the list envelope, shared primitives
  governance.ts  positions, permissions, appointments, committees, persons
  administration.ts  invitations, MFA reset, audit read, rollover
  health.ts      the one unauthenticated response shape

apps/api/src/
  platform/
    audit.ts     actor store (AsyncLocalStorage), governed models, JSON-safe diffs
    config.ts    every env var, validated with Zod at startup; process exits if invalid
    context.ts   context middleware, requireContext, requirePermission, requireScope
    crypto.ts    AES-256-GCM for secrets, with key rotation (ADR-013)
    db.ts        prisma (scoped models removed from its TYPE) · db(ctx) · unscopedPrisma
                 · scopedTransaction() · recordAction()
    errors.ts    AppError, stable codes, error handler, SQLSTATE → domain code mapping
    mail.ts      smtp | log | capture transports
    scope.ts     the scope registry, the Prisma extensions, the locked-year check
    session.ts   express-session + connect-pg-simple, cookie policy
    system-context.ts  systemContext() for work with no request; a MANDATORY reason
    time.ts      district-local midnight; isTermCurrent, isoDate, fromIsoDate
    validate.ts  validateBody, withBody (typed body), parseQuery, pathParam
  modules/
    admin/       GET /api/v1/admin/health — the only unauthenticated route
    auth/        routes · service · repository · passwords · tokens · mfa · recovery
    governance/  routes · repository · service       context resolution; one router
                 positions.{repository,service}      catalogue + the permission matrix
                 appointments.{repository,service}   terms, uniqueness, revocation
                 committees.service                  delegated subtrees, depth 3
                 administration.service              invitations, MFA reset, audit read
                 persons.service                     names only — no contact fields
    notifications/ service · templates — delivery log built on notification_templates
    org/         rollover.service · routes — the year rollover, dry run and committed
  test/
    global-setup.ts  applies migrations to TEST_DATABASE_URL
    helpers.ts       resetDatabase, org/position/appointment fixtures, signIn
    probe-routes.ts  routes mounted INTO the real app by the scoping tests only
    routes.ts        route discovery for the unauthenticated-PII harness

apps/api/prisma/
  seed.ts          the CLI entry — npm run db:seed
  seed/run.ts      seedDatabase(), exported so seed.test.ts drives the real thing
  seed/reference.ts   permissions, positions + the §10 matrix, lookups, templates
  seed/organisation.ts  district, regions, clusters, the 20 clubs
  seed/synthetic.ts   deterministic Ugandan member data. Never real data.
  tsconfig.json    so the seed is typechecked and linted like everything else

apps/web/src/
  lib/           api.ts (fetch wrapper + ApiError) · queries.ts (TanStack keys,
                 useList, useApiMutation) · cx.ts · toast.ts
  components/    ui/index.tsx — the whole design system in one file
                 Can.tsx — permission-gated rendering, presentation only
                 layout/AppShell.tsx — nav, year badge, district, sign-out
  features/
    auth/        LoginPage (password → TOTP → recovery), PasswordPages
                 (forgot, reset, accept invite), useAuth/useScope
    dashboard/   DashboardPage — what this account may actually do
    governance/  PositionsPage (catalogue + permission matrix)
                 AppointmentsPage · CommitteesPage · AdminPages
                 (invitations, audit, rollover) · types.ts

Dockerfile · fly.toml · .github/workflows/deploy-staging.yml · README.md
```

**282 tests**, all integration-style against real PostgreSQL. The suites that are load
bearing rather than incidental: `no-pii.test.ts` (walks every route unauthenticated),
`invariants.test.ts` (37 ADR-012 guards), `scope*.test.ts` (the data access layer),
`audit.test.ts`, `rollover.test.ts` (dry run and committed), and `prisma/seed.test.ts`,
which runs the real seed and signs in as the seeded PIME Chair.

---

## 4. Decisions taken during implementation

These are not in the original design package. They are binding.

**ADR-012 — where an invariant lives** (`02-Architecture.md`). Declarative constraints
first; derived state is a view, never a stored column maintained by a trigger; triggers
only as guards, each with a stable SQLSTATE and a conformance test. This removed
`dues_invoices.status`, `member_dues.amount_paid` and
`club_assessments.total_score/max_possible/rank_in_tier` in favour of views.

**ADR-013 — secret encryption and key management** (`02-Architecture.md`).

**`docs/schema.sql` is now v1.7.** The translation surfaced real defects in the v1.0
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

### M0 session 4 — the scoped data access layer

**Scoping is the client, not a helper.** `platform/db.ts` exports `prisma` with every
context-bound model **removed from its type**, so `prisma.activity` does not compile.
Scoped models are reachable only through `db(ctx)`, which wraps Prisma in a query
extension that injects `districtId`, `rotaryYearId` and `deletedAt: null`. There is no
`where: { rotaryYearId }` to forget because there is no way to write one that matters.

**`platform/scope.ts` holds the registry** — the one statement of which table is scoped
how. `scope-registry.test.ts` parses `schema.prisma` and fails the build if **any** model
or view is neither registered nor listed in `UNSCOPED_BY_DESIGN` with a reason. **Adding a
table therefore forces a decision.** Fifteen exemptions today: global entities, reference
data, identity tables keyed to a person rather than a district, and the two written before
a context can exist (`Notification` for password reset, `AuditLogEntry` for LOGIN).

**A child table with no scope column inherits one through `via`.** `assessment_scores` has
no `district_id`; it belongs to a `club_assessment` that does, so its rule is
`{ via: { relation: 'clubAssessment', model: 'ClubAssessment' } }` and the layer emits a
nested relation filter. Chains are followed to their end —
`AssessmentCriterion → AssessmentParameter → AssessmentFramework` is two hops — and the
registry test proves every chain terminates at a real column and that none of them cycles.

This is the half of the problem that does not announce itself. A table without a
`district_id` looks like it has nothing to scope; eighteen of them are the entire
assessment, activity-detail and finance-detail surface, and unscoped they return every
district's rows. `club_assessments` was the sharpest case: district-scoped alone, a
current-year scorecard read returned every year ever assessed, because its year lives
behind `period → framework` rather than in a column.

**`via` checks writes too.** A child has nothing on it to stamp — it names its parent by
id, and that id comes from the caller — so a create or an update naming a parent runs one
`COUNT` against that parent inside the scope, and answers `404` when it is not there.
`POST /assessments/:id/comments` with somebody else's assessment id is the shape of the
attack and it is an easy handler to write. The check reads both spellings, the scalar
foreign key and `connect: { id }`, and applies to updates as well, because re-pointing a
foreign key is how a row leaves a district without any scoped column changing. `via.fk`
carries the column name and the registry test checks it against
`@relation(fields: [...])` in the schema.

Not covered: a nested create of the parent alongside the child, where there is no id to
check. The parent write is scoped on its own, so the child lands under a parent that was
already stamped.

**`club_assessment_states` is scoped through a relation like any table.** Prisma views DO
support relation fields — `club_rosters` already uses them — so the view declares `period`
and reaches the Rotary Year the same way `club_assessments` does. No foreign key is
emitted for a view relation, and `prisma migrate diff` still reports an empty migration.

**Scoped delegates drop `findUnique`, `findUniqueOrThrow`, `update`, `delete` and
`upsert`.** Their `where` takes unique fields only and cannot carry the injected filter,
so offering them would be a silent way out of the scope. Repositories use
`findFirst({ where: { id } })`, `updateMany` and `deleteMany` — which also produce the
404-not-403 behaviour for free, since an out-of-scope row comes back as null or as a zero
count. `createManyAndReturn` and `updateManyAndReturn` are dropped too; both carry a
`select` whose result narrowing would have to be hand-rolled, and nothing needs them yet.

**`$transaction` is re-declared too**, so the transaction client is scoped in the types as
well as at runtime. Prisma's own transaction client type derives from the *unextended*
client, which meant `tx.activity.update()` compiled inside a transaction while failing to
compile outside one — never a data leak, since the runtime extension does apply inside a
transaction, but a hole in the compile-time guarantee exactly where repositories that need
one will land. Only the interactive (callback) form is offered; the array form takes
`PrismaPromise[]`, which the re-declared writes are not.

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

**Scope expansion happens once per request.** `RequestScopes` carries one array per org
unit an appointment can name — `clubIds`, `clusterIds`, `regionIds`, `committeeIds` —
because records are owned at every one of them: `documents.owner_scope_type`,
`activities.host_scope_type`, `budgets.owner_scope_type` and `goals.owner_scope_type` all
take a REGION or a COMMITTEE as readily as a CLUB. The arrays are expanded DOWNWARDS and
the unit itself is kept: a region appointment contributes the region, its clusters and
their clubs, so an LDRR passes a scope check on their own region as well as on the clubs
inside it. Nothing expands upwards — a club secretary covers one club.

This widened `RequestScopes` beyond the three fields in `docs/05-API-Spec.md §1`, which
has been updated to match. A district-wide caller still gets `isDistrictWide: true` and an
EMPTY `clubIds` — enumerating 140 clubs to answer a boolean is work done 140 times to no
purpose.

**Cost per authenticated request is three queries** for a club secretary, four for an
ADRR: the account, the active appointments, the district's current year, and the cluster
expansion where there is one. Naming the polymorphic appointment scopes costs up to four
more, so `ResolvedContext.listAppointments()` is a function and only `/auth/me` calls it.

**Login resolves its own context.** The middleware runs before the session exists on that
one request, so without this the login response carries nulls — the same shape a member
with no appointment gets, which would tell a real officer they have no authority. There is
a test asserting the login body and the next `/auth/me` agree.

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

### M0 session 5 — audit log and the unauthenticated-PII guard

**The audit extension is applied LAST, so it runs innermost.** Prisma nests query
extensions with the first-applied outermost — measured, not assumed — so an audit
extension added before the scope extension would issue its "before" read with the
caller's unscoped filter, matching rows in other districts that the write never touched.
That is a wrong diff and a leak into `audit_log` at once. Both clients therefore end their
chain with it: `prisma = base.$extends(audit)` and
`db(ctx) = base.$extends(scope).$extends(audit)`.

**`unscopedPrisma` carries no audit extension**, which is what keeps the seed's thousands
of rows out of the log. The test fixtures moved onto it for the same reason.

**The actor travels in `AsyncLocalStorage`,** not down the call stack. A Prisma extension
sits below every service and repository and cannot be handed a request; threading an actor
through every write signature is the kind of parameter that gets dropped in one function
out of forty, and that one is the function somebody later needs. The store is MUTABLE
because a login writes its audit row while the session it is creating does not yet exist —
`identifyActor()` names it on the way through.

**`withAuditActor` requires its callback to await.** A Prisma promise is lazy, so returning
one unawaited resolves it outside the store and the extension sees no actor. The signature
is `() => Promise<T>` to make the mistake harder to write; the request path gets this free
because the middleware wraps `next()`.

**Updates store a diff, not two whole rows.** `audit_log` would otherwise become the
largest table in the database within a year, with the one column that changed buried under
forty that did not. `updatedAt` is excluded — it moves on every write and says nothing on
its own. Creates keep the whole `after`, deletes the whole `before`.

**BigInt and Decimal are serialised explicitly.** `JSON.stringify` throws on the first and
mangles the second, and this schema is full of both — `ri_club_id` is a BigInt and every
money column is a Decimal.

**Appending never fails the operation that caused it.** A failed audit write is logged and
swallowed. The alternative is a system that stops accepting activity reports when its
logging breaks.

#### The no-PII harness

**Routes are discovered, not listed** — a list is a thing somebody has to remember to
update, and this harness is worth exactly its coverage on the day someone adds a careless
endpoint.

**Express 5 does not keep a mount path as a string.** `layer.path` holds the path that last
MATCHED a request, and the mount pattern survives only as a compiled matcher, so
`/api/v1/auth/login` is not recoverable from the router tree. The first version of the
walker silently produced `/login`, which 404s — every assertion passed and the harness was
decoration. `createApp` now records its mounts through a `mount()` helper and stores them
under `app.set('dis:mounts')`; `assertAllRoutersDiscovered` fails the build if a router
reaches the stack around that helper, so the registry cannot quietly go stale.

Three guard tests exist because of that near-miss: discovery must contain the routes that
exist, every discovered path must resolve to something other than 404, and the mount
registry must account for every router.

**Verified the way the session prompt asks:** a temporary `/api/v1/admin/directory`
returning names, emails, phones and cities was added, the harness failed naming the three
leaked fields, and the route was removed.

#### ADR-012 conformance in CI

`invariants.sql` is now driven by a vitest suite over a raw `pg` connection, because the
file reports through `RAISE NOTICE` and Prisma discards those. The SQL stays the source of
truth — rewriting 37 checks in TypeScript would have produced a second, subtly different
set, and the one that drifted would be the one nobody read. The suite asserts exactly 37
passes, so deleting a check fails as loudly as breaking one, and it drops a trigger to
prove it would notice a guard that stopped firing.

### M0 session 6 — seed and staging deployment

**No faker.** The prompt named it; the seed does not use it, for two project-specific
reasons. faker generates Western names, and a district demo populated with them is useless
for the conversation the demo exists to have — the curated Ugandan name lists in
`prisma/seed/synthetic.ts` were needed for the club names regardless, which faker could
never have produced. And it is one more dependency in a repository that is district
property with one part-time maintainer, on an npm that prunes platform binaries on a
workspace-scoped install (§6). The requirement was synthetic data, never real member data;
a deterministic generator meets it and reproduces exactly, so a bug seen on one laptop is
seen on another.

**The dataset:** two Rotary Years with 2027-28 current and 2026-27 locked · district 9218
· 3 regions · 6 clusters · 20 clubs affiliated for the year · 300 synthetic members with
`JOIN` events and the roster refreshed · 32 permissions · 10 positions with 107
`position_permissions` wired from the §10 matrix · 69 officer accounts. About six seconds.

**Appointment terms are clamped to today.** The seeded year is 2027-28, the launch year,
and an appointment counts only once its term has STARTED. Dated from 1 July 2027 the
dataset produces a district nobody can sign in to until launch day: every context resolves
empty and every scoped endpoint answers 403. `appointmentStart()` uses the Rotary Year, or
today if that is still ahead. Found by the seed test, which is the point of having one.

**`person_visibility` is left to the trigger.** The seed writes no visibility rows —
`persons_visibility_ins` creates them with contact fields closed. A seed that wrote its own
would be a second definition of the default, and the one that drifted would be the one
nobody read.

**Officers get a real invitation AND a development password.** `issueInvite()` is the only
onboarding path, and it runs for all 69, producing hashed single-use tokens and
notification rows. Outside production the seed then sets a shared password and marks the
accounts ACTIVE, because sixty-nine invitation links in a terminal is not a way to log in
and check a scorecard.

**The seed refuses to run with `NODE_ENV=production`** unless `ALLOW_DESTRUCTIVE_SEED=true`.
It truncates every table; the realistic accident is one `DATABASE_URL` left exported in a
shell.

**`prisma/` needed its own tsconfig, at `prisma/tsconfig.json`.** `apps/api/tsconfig.json`
sets `rootDir: src` for the emitting build and therefore cannot see the seed, which would
have left the only code in the repository that writes 300 members neither typechecked nor
linted. The name matters: typescript-eslint's project service resolves the NEAREST
`tsconfig.json` by walking up from each file, so `tsconfig.prisma.json` is found by
`tsc -p` and not by the linter, which reports "not found by the project service".

#### Deployment

**Debian slim, not alpine.** Prisma's engine is built against glibc and segfaults on musl
with no output at all — exit 139, no stack, no message.

**Scripts must run during `npm ci`.** `argon2` is a native module and `--ignore-scripts`
leaves it without a binding, which also segfaults on import with no message. It has no
prebuilt binary for this platform, so the build stage installs `python3 make g++`; the
runtime stage copies the compiled module and never sees a compiler.

**`npm prune --omit=dev`, not a second `npm ci --omit=dev`.** Reinstalling has to choose
between running scripts — and failing, because `prisma generate` needs a CLI that
`--omit=dev` just removed — and skipping them, which is what breaks argon2.

**`prisma` is a runtime dependency.** Migrations run as a Fly release command inside the
image, once, before the new version takes traffic. That costs ~215MB of a ~800MB image.
Migrating from CI instead does not work on Fly, whose managed Postgres is reachable only
over the private network, so a runner would need a proxy: a large image on a deploy nobody
watches beats a migration path that depends on a tunnel staying up.

**The worker process is configured but commented out.** pg-boss is not built; a second
machine running a script that does not exist would crash-loop, fail health checks and make
every deployment look broken.

**Deployment is gated on CI, not parallel to it.** `deploy-staging.yml` triggers on
`workflow_run` and refuses anything but a success on main, so a failing no-PII harness
stops the deployment rather than racing it.

#### A bug this session exposed

**Guard SQLSTATEs were never reaching the error mapper.** Prisma 7 with `@prisma/adapter-pg`
nests the driver error twice, so the code arrives at
`meta.driverAdapterError.cause.code` — and `sqlStateOf()` checked only `error.code` and
`error.meta.code`. Every guard violation had been surfacing as an opaque 500 instead of
`MEMBERSHIP_IMMUTABLE` or `AUDIT_IMMUTABLE` since session 3. The conformance suite proved
the guards fire; nothing proved the translation did. `domainErrorFor()` is now exported and
tested directly.

---

### M1 — governance

#### Session 1 — positions and permissions

**A position is a row and its permission set is a join table**, both editable in the UI, so
adding a district role is a form rather than a release (axiom 5's shape, applied to
governance). `POSITION_IN_USE` refuses deactivating a position somebody currently holds:
the alternative is an appointment pointing at a role that no longer exists, which every
later permission check has to have an opinion about.

**Shared template positions are readable by every district and editable by none.**
`is_template` marks the RI-defined slate. `TEMPLATE_IMMUTABLE` is a clearer answer than a
404 here, because the row is legitimately visible — the screen says "Shared" instead of
offering a button that always fails.

**`PUT /positions/:id/permissions` replaces the whole set, and takes the whole set.** A
client-computed diff lets two officers editing the same position silently merge each
other's work; sending the full set makes the last write obviously the last write.

**A code is immutable after creation.** The seed, the §10 authorisation matrix and whatever
an officer wrote on paper all refer to a position by code. `DUPLICATE_CODE` guards the
insert; the edit form disables the field.

#### Session 2 — district-local term boundaries

**The deferred item recorded in M0 is closed.** Appointment terms are compared against midnight
in the DISTRICT's timezone, not UTC, in `platform/time.ts` — and in both places that ask:
context resolution and appointment validation. They share one helper, because if they
disagreed an appointment could be creatable and not yet effective for reasons nobody
could see.

Compared against UTC the boundary in Kampala is three hours wide. Between 21:00 and
midnight EAT on 30 June an incoming officer is already authorised; on 1 July between
midnight and 03:00 EAT they are not. Rollover happens on exactly that boundary, once a
year. Three tests pin the clock to it.

**The term filter moved out of SQL.** `findActiveAppointments` can no longer express the
comparison in a `where` clause, because it needs each row's own district timezone and a
person may hold appointments in more than one district. `is_active` and the person narrow
it to a handful of rows first, and the date check runs in TypeScript.

**`isCurrent` is distinct from `isActive` on the appointment contract.** Active means not
revoked; current means the term covers today where the district is. An appointment created
in June for a term starting 1 July is the first and not the second, and a screen showing
one number for both would be lying for a month.

#### Session 3 — the web application

**`<Can>` is presentation, never a boundary.** Every screen it hides is refused by the
server independently, and the dashboard says so. The one place client-side logic does real
work is the committee tree, where "may I manage this node" needs SCOPE as well as
permission — `committee:manage:district` anywhere, or chairing this subtree — and that
answer comes from `RequestScopes`, computed server-side and merely read here.

**One design-system file.** `components/ui/index.tsx` holds every primitive. Tailwind v4
with tokens in CSS, no component library: the payload budget is 250 KB of initial JS on
metered Android data, and a component library is the easiest way to lose it.

**The 401 handler is registered from `App.tsx`, not imported into `lib/api.ts`.** The fetch
wrapper stays free of navigation, so tests and non-React callers can use it.

#### Session 4 — committees

**Committee scope expands downwards, which the session prompt assumed and the code did
not.** A chair holding a committee appointment now covers their committee and every
sub-committee beneath it, so they can create and staff their own subtree without holding
anything district-wide. That is the delegation the district asked for.

**Membership is by APPOINTMENT, not by person.** Serving on a committee is something you do
in a capacity, and it should expire with the appointment that justified it. The picker
therefore chooses an appointment.

**Depth is capped at three** (`COMMITTEE_TOO_DEEP`). Unbounded nesting makes scope expansion
a recursive query with no natural bound, and no district committee structure needs four.

#### Session 5 — invitations, MFA reset, audit read

**Closes two M0 deferrals.** `issueInvite()` had been exported and unused since M0 session
3 because *who may invite whom* is a permission question; it is now behind
`person:invite:club` / `:cluster` / `:district`, each checked against the caller's scope for
the club or cluster named. Admin MFA reset is behind `user:mfa:reset:district` and writes a
notification to the account holder — a reset nobody is told about is the attack.

**`user_tokens.created_at` was added** (migration `20260815010000`, schema.sql v1.7) so the
outstanding-invitations screen can say how long somebody has sat on an invitation without
inferring it from a TTL that may have changed since.

**`/persons` returns names only.** Governance screens need a person picker; a person picker
is not a directory. No contact field is selected at the repository level, so there is
nothing for a later change to accidentally widen. The no-PII harness covers the
unauthenticated case; this is the authenticated one, and it is a deliberate narrowing
rather than a visibility-flag decision.

**The audit read is district-scoped like everything else** and paginates. `AUDIT_IMMUTABLE`
already refused writes at the database; the read adds no way around it.

#### Session 6 — system context and rollover

**The step order in the session prompt cannot work.** It locks the outgoing year before
deactivating its appointments — but deactivating them is a write into that year, which the
lock refuses. Rollover deactivates first, then locks.

**A dry run is not a preview computed separately.** It runs the real transaction and rolls
it back, so what the officer approves is what actually happened in a transaction that then
did not commit. `dryRun` is required in the request, not defaulted: a defaulted destructive
flag is the wrong default whichever way it points, and `ROLLOVER_NOT_CONFIRMED` refuses the
committed path without an explicit confirmation string.

**Rollover is the reason `scopedTransaction()` exists.** It reads last year's appointments
and writes next year's affiliations atomically, and no single `db(ctx)` spans two years.

**ESLint caught rollover reaching for `unscopedPrisma`** — which was allowed, because the
rule permits `platform/` and `modules/governance/` and rollover briefly lived there. It
moved to `modules/org/` and now goes through `db(ctx)` and `scopedTransaction()` like
everything else. The lint rule found it, which is the argument for having the rule.

#### Session 7 — administration screens

**Every admin screen gates on `<Can>` inside itself as well as being routed behind auth.**
The route is convenience; the server refuses regardless.

**The deactivate warning reads the count already on the row** rather than guessing, so the
dialog tells the truth before the server has to.

---

## 4a. Axiom conformance

**Rewritten at every milestone close, one row per axiom, before the milestone is called
done.** A milestone is a few weeks of fixes and adjustments made under time pressure, and
the realistic way this system stops being the system designed is not a decision to abandon
an axiom — it is a Tuesday-afternoon workaround that nobody re-read. The question each row
answers is not "do we still believe this" but "did anything built this milestone weaken it,
including things built for good reasons".

`npm run docs:check` proves the mechanical half — no `districtId` on `Club`, no writes to
`membership_events` or `club_rosters`, no raw SQL outside the resolvers, no float money, no
naive timestamps. The rest is judgement and belongs here.

**A row may legitimately say an axiom was bent.** Recording that is the point; an axiom
nobody may ever qualify becomes an axiom people route around silently.

### As at M1 close

| # | Axiom | Holds? | What M1 did to it |
|---|---|---|---|
| 1 | The Rotary Year is a dimension, not a filter | **holds** | Rollover is the first thing to write across two years, and it does so through two scoped clients in one transaction rather than by dropping the year filter. `scopedTransaction()` exists precisely so that the escape hatch was not needed. |
| 2 | District affiliation is temporal | **holds** | Untouched. Rollover copies affiliations forward into the new year rather than mutating them, which is the axiom working as intended. |
| 3 | Membership is an event log | **holds** | Untouched by M1; the seed appends `JOIN` events and refreshes the derived roster, and nothing writes to `club_rosters`. M2 is where this gets tested for real. |
| 4 | One activity model | **not yet exercised** | No activity code exists. M2. |
| 5 | The assessment rubric is data | **not yet exercised** | No assessment code exists. M6. The *governance* analogue was honoured: positions and their permission sets are rows edited in the UI, not constants. |
| 6 | Personal data is private by default | **holds, and narrowed further** | `GET /persons` returns names only, selected at the repository so there is nothing for a later change to widen accidentally. The audit read redacts contact values out of every diff. No endpoint returns a contact field to anyone yet. |

**Bent, deliberately, and why.** Nothing this milestone. The one judgement call worth
recording is that `?year=` remains a read door: a context resolved under the override is
marked unwritable and every write through it is refused. That is what keeps a
historical-read permission from becoming a backdating permission, and it should be
re-checked whenever a new write path is added.

---

## 5. Deliberately unfinished

| Thing | Why | Lands in |
|---|---|---|
| The repository and hosting accounts are on a PERSONAL account | ADR-011 names this as the failure the project exists to correct; it needs district-owned GitHub and Fly organisations with two administrators | **M0's last open exit condition** — carried: it needs a district decision and two named administrators, not a commit |
| No worker process, no pg-boss | notifications deliver inline; the `notifications` row is already the queue | later |
| The web bundle is uploaded as a CI artifact rather than published | the district's static host does not exist yet, and choosing one in a workflow file is how it gets chosen by accident | **due before M2 session 2** |
| The worker process group in `fly.toml` is commented out | pg-boss is not built; a crash-looping machine would fail health checks and make every deploy look broken | with the jobs module |
| `recordAction(EXPORT, …)` exists and is unused | there is no export module yet | M7 |
| A malformed or unauthorised `?year=` fails EVERY authenticated route, including `/auth/logout` | context resolution is global and eager; sending `?year=` to logout is a client bug | not planned |
| A nested create of a parent alongside its child is not scope-checked | there is no parent id to check; the parent's own write is stamped, so the child lands under a stamped row | not planned |
| Permission codes match exactly — no `club:read:*` wildcard | a matcher would turn a typo in a seeded row into a silent grant | not planned |
| A person's contact details have no endpoint at all, not even an authenticated one | `person_visibility` is enforced nowhere yet because nothing reads the fields; the flags exist and default closed | M2 |
| Committee scope expands downwards but a sub-committee chair cannot see the parent | nothing expands upwards, deliberately | not planned |
| Rollover does not carry appointments forward | an appointment is a decision for the incoming DRR to make, not a default | not planned |


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

**Every new table needs a registry entry — not just the scoped ones.**
`scope-registry.test.ts` will fail the build if it does not get one, which is the intent —
but the failure arrives at `npm run test`, not at `migrate dev`, so it can surprise you a
commit later than you expect. Add the row in the same change as the model: a real scope
rule, a `via` pointing at the parent that carries one, or an `UNSCOPED_BY_DESIGN` reason.

**`prisma.<scopedModel>` does not exist and that is not a broken import.** If a delegate
you expect is missing from `prisma`, the model is context-bound: use `db(ctx)`. Likewise
`findUnique` and `update` are absent from scoped delegates — `findFirst` and `updateMany`
are the replacements, and the zero-row case is your 404.

**Annotating a Prisma transaction client breaks the build.** `prisma` carries the
soft-delete extension, so its transaction client is narrower than `Prisma.TransactionClient`.
Let `tx` infer; annotating it discards the extension and fails to typecheck.

**A test fixture must write through `unscopedPrisma`, not `prisma`.** `prisma` audits, so a
fixture built on it seeds `audit_log` and any test counting audit rows sees the fixture's
own writes. All fixtures in `src/test/helpers.ts` use the escape hatch.

**Mount routers through the `mount()` helper in `createApp`, never `app.use()`.** Express 5
keeps no mount-path string, so the unauthenticated-PII harness reads a registry instead.
`assertAllRoutersDiscovered` fails the build if a router bypasses the helper — but the
failure is in the PII suite, not where the router was added.

**A Prisma transaction client cannot be `$extends`-ed.** Measured, not assumed — which is
why `scopedTransaction()` applies the scope by hand rather than composing extensions. If you
need two scopes in one transaction, that is the only route; `db(a).$transaction` gives you
`a` and nothing else.

**`scopedTransaction()` does not audit.** The extension chain it bypasses is where auditing
lives. A caller needing an audit row inside a transaction writes one explicitly, as rollover
does.

**`docs/schema.sql` must be verified, not just edited.** Rebuild it into `dis_schema_check`
and diff `information_schema.columns` against the migrated development database. M1 did this
and found the `session` table had been live since M0 session 3 without ever being recorded
in the file that calls itself authoritative.

**Prisma 7 differences from most documentation:** configuration lives in
`prisma.config.ts`, the client generator is `prisma-client` emitting TypeScript into
`src/generated/prisma` (gitignored, rebuilt by `postinstall`), and `PrismaClient` requires
an explicit driver adapter.

---

## 7. Verification commands

```bash
npm run typecheck && npm run lint && npm run format:check && npm run test && npm run build

# Does the documentation still describe the system? --strict makes a warning or an
# unproven check a failure, and --with-db rebuilds docs/schema.sql and diffs the catalog.
npm run test:report                                # docs:check reads the test count from this
npm run docs:check
npm run docs:check -- --strict --with-db           # the milestone gate; see /close-milestone

# Schema drift — must print "This is an empty migration."
cd apps/api && npx prisma migrate diff --from-migrations ./prisma/migrations \
  --to-schema prisma/schema.prisma --script

# The seed, and the deployment image
npm run db:seed
docker build -f apps/api/Dockerfile -t dis-api .

# Database invariants — now a vitest suite, so `npm run test` covers them.
# Still runnable by hand against a development database:
psql "$DATABASE_URL" -f apps/api/prisma/checks/invariants.sql
```

`apps/api/prisma/checks/invariants.sql` attempts every guard violation and asserts it
fails. ADR-012 requires a check there for every database-side guard; adding a guard without
one is incomplete work. Since session 5 `src/platform/invariants.test.ts` runs the same
file in CI over a raw `pg` connection and asserts exactly 37 passes.
