# 10 — Build Log and Current State

**Read this second, after `CLAUDE.md`, when starting any session.** The other documents
describe what the system *should* be; this one records what has actually been built, what
was decided along the way, and what is deliberately unfinished.

Last updated: 15 August 2026, after M1 session 7. **M0 and M1 are complete.**

<!-- dis:state milestone=M2 schema=v1.9 tests=414 -->

---

## 0. Start here

**A new session begins by reading this section and §0a.** Everything below is detail you
can reach for; these two are what you need before writing anything. `npm run docs:check`
verifies most of what follows against the code, so if it is green the claims here are not
merely assertions.

**Where the build is.** M0 (foundations) and M1 (governance core) are complete. **M2 (the
reporting spine) is IN PROGRESS** — its session prompts are in
`docs/13-ClaudeCode-M2-Sessions.md` and §1 records which of its ten sessions have landed.

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
| 7 — Governance administration screens | **done** | `c78de30` |

| M2 session | State | Commit |
|---|---|---|
| 1 — Background jobs (pg-boss) | **done** | `b11a348` |
| 2 — Web deployment | **done** | `ff9d5a6` |
| 3 — Clubs and affiliations | **done** | `4013cc7` |
| 4 — Clubs UI | **done** | `00429ec` |
| 5 — Persons and visibility | **done** | `8310ab0` |
| 6 — Membership events and roster | **done** | `29727b8` |
| 7 — Membership UI | **done** | `1fd0bad` |
| 8 — Activity types and media | **done** | `db0107a` |
| 9 — Activities API and reporting UI | **done** | `23f6134` |
| 10 — M2 hardening | **done** | this commit |

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
    images.ts    sharp: 400px thumb, 1200px display, WebP, ALL metadata stripped
    db.ts        prisma (scoped models removed from its TYPE) · db(ctx) · unscopedPrisma
                 · scopedTransaction() · recordAction()
    errors.ts    AppError, stable codes, error handler, SQLSTATE → domain code mapping
    mail.ts      smtp | log | capture transports
    scope.ts     the scope registry, the Prisma extensions, the locked-year check
    security-headers.ts  CSP and friends, for a same-origin SPA. No inline script.
    session.ts   express-session + connect-pg-simple, cookie policy
    storage.ts   object storage — KEYS never URLs; S3-compatible and local drivers
    upload.ts    multipart, MAGIC-BYTE sniffing, a 10MB cap enforced while reading
    web-client.ts  serves apps/web/dist; middleware, so it cannot shadow /api
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
    activity/    routes · service · types.service · media.service
                 one model, configurable types, and the photographs on them
    assessment/  service — markStale(), a deliberate no-op until M5
    membership/  routes · service — the event log, the roster, the statistics
                 analytics.ts  THE one raw-SQL file outside the assessment resolvers
    notifications/ service · templates — queue row, delivery, and the due-row read
    people/      routes · service · repository
                 serialiser.ts  THE person serialiser — one gate, used everywhere
    org/         routes — clubs, affiliations, clusters, regions, rollover
                 clubs.{repository,service}  THE affiliation join, written once
                 clusters.service            clusters, their clubs, and regions
                 rollover.service            the year rollover, dry run and committed
  jobs/
    boss.ts      the pg-boss client, lifecycle, queue provisioning, typed enqueue()
    define.ts    defineJob() · jobContextSchema — every payload names a district and year
    runner.ts    runJob(): validate → systemContext → withSystemActor → handler
    work.ts      attachHandlers() — the real wiring, shared by the worker and its tests
    registry.ts  JOBS — the one list of queues that exist
    dead-letter.ts  a permanently failed job becomes a JOB_FAILED row in audit_log
    erasure.job.ts  anonymises a person once the district has approved it
    media.job.ts    resizes an upload and strips its EXIF
    sweep.ts     the safety net over notifications left QUEUED
    notification.job.ts  the delivery job, and notifyThroughQueue() for callers with a ctx
    worker.ts    the worker process entry point (npm run worker)
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
    clubs/       ClubsPage (directory) · ClubProfilePage (tabs, one summary call)
                 ClubFormPage (charter and edit) · ClustersPage · types.ts
    activities/  ReportPage — THE screen: four steps, rendered from the type
                 ActivityPages — list, detail with verification, calendar
                 ActivityTypesPage — the field_config builder, with a live preview
    membership/  RecordEventPage — the screen a secretary uses most
                 MembershipPages — roster, history, statistics, transitions · types.ts
    dashboard/   DashboardPage — what this account may actually do
    governance/  PositionsPage (catalogue + permission matrix)
                 AppointmentsPage · CommitteesPage · AdminPages
                 (invitations, audit, rollover) · types.ts

Dockerfile · fly.toml · .github/workflows/deploy-staging.yml · README.md
```

**414 tests**, all integration-style against real PostgreSQL. The suites that are load
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

**`docs/schema.sql` is now v1.9** — v1.7 through M1, then M2 sessions 5 and 6. The translation surfaced real defects in the v1.0
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
`JOIN` events and the roster refreshed · 35 permissions · 10 positions with 114
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

**`user_tokens.created_at` was added** — migration `20260815010000`, an amendment to the
authoritative schema at the time — so the
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

### M2 — the reporting spine

#### Session 1 — background jobs

**pg-boss is pinned to the v10 line, not the current v12.** v11 and later declare
`engines.node >= 22`, and this project's baseline is Node 20 — `node:20-slim` in the
Dockerfile, `node-version: '20'` in both workflows. Taking v12 would have meant moving the
runtime baseline as a side effect of adding a queue, which is not a decision that belongs
in this session. Revisit when Node is bumped deliberately.

**Its schema is a GENERATED migration, and the registry entry the session prompt asked for
would have broken the build.** The prompt says to add every pg-boss table to
`UNSCOPED_BY_DESIGN`. That assumption does not hold: `scope-registry.test.ts` parses
`schema.prisma`, and its `phantom` check fails on any registry entry naming a model that is
not there. pg-boss's tables live in the `pgboss` SCHEMA, are absent from `schema.prisma`,
and Prisma has no `multiSchema` setting — so its differ never sees them, never proposes
dropping them, and no registry entry is needed or possible. `migrate diff` still reports an
empty migration; that was checked.

`20260816000000_pgboss_schema/migration.sql` is the output of
`PgBoss.getConstructionPlans('pgboss')` with pg-boss's own `BEGIN`/`COMMIT` stripped, since
Prisma already runs each migration inside a transaction and a nested `COMMIT` would end
Prisma's early. **Regenerate it the same way rather than editing it** — pg-boss checks
`pgboss.version` before it will start, and a schema that differs from what the library
expects is a worker that refuses to run. Upgrades come from `getMigrationPlans`.

**Both processes run with `migrate: false`.** The schema is applied by the release command,
once, before either takes traffic. Self-migration at start-up would race two machines, and
the loser is an API sending into a schema the worker had not created yet.

**Every job payload carries `districtId` and `rotaryYearId`, enforced by
`jobContextSchema`.** `runJob` turns them into a `systemContext` and hands the HANDLER a
context, never the ids — the same discipline as the HTTP side, where a handler may not read
a district from a request body. Payloads are validated on RECEIPT, not merely on send: a
queue row may have been written by an older deployment or by hand during an incident.

**A payload that fails validation dead-letters immediately** instead of retrying. It will
not parse on the fourth attempt either, and spending the retry budget to learn that only
delays the record somebody has to read.

**A dead letter becomes a `JOB_FAILED` row in `audit_log`**, not a new table. An
administrator already has a screen that reads that log, it is already append-only, and
`entity_id` is a UUID column — which is what a pg-boss job id is. **Job payloads must
therefore carry identifiers and never personal data**: the payload is written into the
audit row so the job can be understood and re-run.

**Notification delivery moved to the queue, in two halves.** `queueNotification` writes the
row; `deliverNotification` sends it and records the outcome. `deliverNotification` THROWS on
a transport failure — that is what makes pg-boss retry — and returns false for failures a
retry cannot fix (no template, no address, unfilled placeholders). `notify()` still does
both inline, and the unauthenticated flows still use it: a member watching a password-reset
form must not wait on a worker.

**The QUEUED-row sweep is a worker timer, not a queued job.** A job would need a district
and a year in its payload to build a context, and `notifications` is deliberately unscoped —
password reset writes a row before any session, and therefore any district, exists.

**`attachHandlers` lives in `work.ts`, not in `worker.ts`.** The queue tests drive the real
wiring — retry, dead letter, payload rejection — rather than a copy of it that agrees with
the worker only until somebody edits one of them.

**`scripts/doc-check.mjs` now walks `apps/api/src/jobs`.** It did not, so the entire
directory was invisible to the check whose purpose is to catch code that was written and
never written down.

#### Session 2 — the web client, served from the API

**The open decision in Build-Conventions §6 is closed.** The SPA is served from the
existing Fly app: one deploy, one account to hold under district identity, same origin and
therefore no CORS and no second cookie domain. A dedicated static host would buy a better
CDN and cost another account, and ADR-011 is about there being FEWER accounts each with two
administrators, not more.

**The client is MIDDLEWARE, not a catch-all route.** `app.get('*', …)` would appear in the
walker the unauthenticated-PII harness uses — which discovers routes precisely so nobody
maintains a list — and a catch-all in that list is a path the harness probes forever. An
`app.use` handler has no `.stack`, so it is invisible to both `discoverRoutes` and
`assertAllRoutersDiscovered`. There is a test asserting exactly that.

**An unmatched `/api/...` is still a JSON 404.** The one-line version of this feature
returns `index.html` for everything, answers 200 to a mistyped endpoint, and reaches the
client as "unexpected token <" — which sends whoever is debugging it to look at their JSON
parser instead of at the 404 the server meant to send. A missing `/assets/...` 404s for the
same reason, and a non-GET to an unknown path does too.

**`index.html` is `no-cache`; `/assets/*` is immutable for a year.** Vite hashes every
asset filename, so a cached entry point is the only thing that can make a deploy invisible.
On metered data this is a repeat visit costing nothing instead of 80 KB.

**The CSP allows NO inline script**, which is only possible because `modulePreload.polyfill`
is now off in `vite.config.ts`. Vite injects that polyfill as an inline script as soon as a
build has more than one chunk — so route-level code splitting in session 10 would otherwise
have broken the page in a way that looks like a bundler problem and is a header problem.
Inline STYLE is allowed: React sets `style` attributes at runtime, `style-src-attr` governs
them, and no nonce can cover that.

`CSP_MEDIA_ORIGINS` exists and is empty. Object storage arrives in session 8 and serves
photographs from another host; that host goes in the variable rather than into a policy
somebody quietly loosens.

**The Dockerfile builds the client in a stage of its own**, so Vite, Tailwind and esbuild
never reach the runtime image. What that does NOT do — and the comment that used to be
there claimed it did — is keep React out: `npm ci --workspace` scopes linking and lifecycle
scripts, not what gets installed, so @dis/web's runtime dependencies land in the root
`node_modules` regardless. Measured at ~15MB of a 393MB tree in an 815MB image whose Prisma
engines are ~215MB of it. Not worth contorting the build for; worth not lying about.

**The deploy workflow's `web` job is gone.** The artifact upload it existed for has no
purpose now, and the API job gained a check that fetches `/login` and greps for the root
element — which is what would notice a deploy where the API came up and the client did not.

#### Session 3 — clubs, affiliations and clusters

**The affiliation join is written ONCE**, in `modules/org/clubs.repository.ts`, and every
club read goes through it. Nine handlers each writing their own is nine chances to omit it,
and a handler that omitted it would return every club in the world while looking exactly
like a handler that had not. Everything reads FROM the affiliation side —
`db(ctx).clubDistrictAffiliation` is district- and year-scoped by the layer, so the scope is
applied rather than remembered.

**Nested filters are still yours to write.** The layer does not rewrite a relation reached by
`include` or by a nested `where`, so `deletedAt: null` on `club` and `rotaryYearId` on
`clusterAssignments` are written by hand here, each with a comment saying why. The cluster
placement is read in a SECOND query rather than joined, because `club_cluster_assignments`
carries a year and no district: a club that moved mid-year could be assigned to a cluster
elsewhere, and an unscoped `include` would put another district's cluster name on the page.

**PRISMA 7 DOES NOT POPULATE `meta.target` ON P2002.** With `@prisma/adapter-pg` the error
carries `code: 'P2002'` and `meta.modelName`, and the violated fields appear only in the
message. Code matching on `meta.target` — which is what every example on the internet does —
silently never fires, and the caller gets a 500 where a domain error was intended. Found by a
test that asserted the 409, not by one that asserted the write failed. This is the same class
of bug as the SQLSTATE nesting in M0 session 6.

**`CLUB_AFFILIATED_ELSEWHERE` does not name the other district.** There is deliberately no
query looking for the other row: reading across the district boundary to write a better
error message is exactly the read this system does not permit itself, and the unique on
`(club_id, rotary_year_id)` already knows the answer.

**`club:update:district` was added** (permission count now 35 after session 5). The API
spec always said `club:update:own` **or** `:district` and only the first existed, so a DRR
correcting a club's RI ID had no door — `club:update:own` is bounded by the caller's own
appointments, which is precisely what makes it safe to give a secretary. `requireAnyPermission`
in `platform/context.ts` is the "either of these" gate; WHICH clubs each one reaches is still
a scope question the service answers, and it answers 404.

**`recalculateTier` lives in `clubs.service` and rollover imports it.** Tier is on the
affiliation and frozen within the year: a club that recruits its fortieth member in March is
not re-tiered in March, because it is being scored against a framework published for its tier
at the start of the year. Rollover is the one caller.

**`modules/membership` and `modules/activity` exist as one function each.** The club summary
needs a roster count and an activity count, and the dependency rule says no module queries
another's tables — so each owning module exports a service function now rather than org
reaching into `club_rosters` and `activities` and being unpicked in sessions 6 and 9.

**Cluster membership is set WHOLE, never diffed** — the same reasoning as replacing a
position's permission set. Two officers redrawing clusters from two browsers with
client-computed diffs merge each other's work silently.

#### Session 4 — the club screens

**The five unbuilt tabs say which milestone fills them.** A club officer who cannot find a
Members tab concludes the system does not do membership; a tab that says "arriving with the
membership log" is the difference between an unfinished system and a broken one.

**The edit form is a child component mounted with its values as INITIAL state, keyed on the
club id.** Seeding form state from a fetched record in an effect is a cascading render — and
worse, it discards whatever the member had typed the moment TanStack Query refetches in the
background. `react-hooks/set-state-in-effect` caught it; the fix is structural rather than a
suppression.

**`useList` gained `enabled`.** The club form mounts before it knows whether it has an id, so
in create mode the fetch would fire against `/clubs/` and could only 404. A hook cannot be
called conditionally; the query can be held back.

**Bundle: 85 KB gzipped initial JS**, against a 250 KB budget. Room, but the budget is for
the whole of M2 — media and the reporting flow are still to come (session 10 re-measures).

#### Session 5 — persons, visibility and subject access

**The session prompt said to reuse the serialiser the M1 audit endpoint already uses. There
was not one.** The audit endpoint redacts contact fields UNCONDITIONALLY from a blanket
list, which is the right rule for a log — it answers "who changed what and when", and the
old phone number is not part of that answer — but it is not a visibility-aware serialiser
and could not become one without giving the same policy two homes. So the serialiser was
BUILT here, in `modules/people/serialiser.ts`, and the audit endpoint deliberately still
does not use it. Both rules are written down in both files.

**Withheld fields are ABSENT, not null.** A field that is always present and sometimes empty
is one a client renders as a blank line and a developer later assumes is nullable in the
database. `isRedacted` says something was withheld, so a screen can say so rather than look
broken.

**`rosterClubIds` defaults to EMPTY, and that is the safe direction.** A club-scoped caller
holding `person:read:contact` sees contact details for people on their own clubs' rosters.
For a person nested inside somebody else's response — an activity's attendees — the caller's
scope was never checked against that person's club, so the serialiser is told nothing and
falls back to the visibility flags. A serialiser that assumed its caller's scope covered
anybody it had not been told about would open every nested person to a club secretary.

**Two permissions added, 35 in total.** `person:read:contact` is the door past
`person_visibility`, and it is safe to give a club secretary precisely because it is bounded
by SCOPE. `person:erase:district` is the review.

**`GET /persons` MOVED from governance to people.** Two routers cannot both answer the same
path — Express matches in mount order, so the second simply never runs, and the one that
never ran would have been the one with the visibility rules in it. `modules/governance/persons.service.ts`
is deleted and the pickers read the new endpoint, getting names because contact fields are
absent unless the caller may see them.

**Erasure is a REVIEW plus a job.** Irreversible, and the request arrives from a session —
which is the thing an attacker takes. `person_erasure_requests` — the v1.8 amendment — holds the
review; approving enqueues `person-erasure`, which runs under a system context so the audit
log says an approved request caused it rather than attributing a whole record being blanked
to whoever pressed the button. It ANONYMISES: the person row survives under the same id, so
`membership_events` still points at something real and a club's retention rate for a past
year does not change retroactively.

#### Session 6 — the membership event log

**A SECOND DEFECT IN `club_rosters`, found by the hand-computed statistics fixture.** v1.0 had
the supersede predicate inverted; this is the other half of the same idea. `ranked` took the
latest LIVE event per (person, club) and kept the person if its type was a joining one — and a
`CORRECTION` is a live event that is not a joining type. So retracting anything left the
person OFF the roster: correct when what was retracted was a `JOIN` ("this member never
joined"), and exactly wrong when it was a `TERMINATE` recorded against the wrong person. The
club would correct the mistake and the member would stay deleted.

A CORRECTION is a RETRACTION, not a state. It still excludes its target through the `live`
predicate and is then itself excluded from the ranking, so state falls back to the previous
live event. Retract a JOIN and no joining event is left; retract a TERMINATE and the JOIN
underneath is the latest live event again. schema.sql v1.9, migration
`20260816010000_club_rosters_corrections`, and `analytics.ts` carries the same predicate
because two definitions of "who is a member" is one definition that will disagree with the
roster.

**A retraction no longer inherits its target's reason code** either — `RELOCATION` on a
retracted termination was reappearing in the statistics breakdown as though somebody had
left for it.

**Raw SQL is now permitted in ONE file outside the assessment resolvers**:
`modules/membership/analytics.ts`, exempted by name in `eslint.config.js`, `doc-check.mjs`
and CLAUDE.md. The as-at reconstruction needs `DISTINCT ON` over the supersede chain, which
Prisma cannot express, and the statistics are four aggregates over one filtered set — four
separately-filtered Prisma queries are four chances for the filters to disagree, in
arithmetic that decides awards. **Raw SQL bypasses the scope extension completely**, so every
query there binds `districtId`, `rotaryYearId` and `clubId` from the context by hand, and
there is a test asserting another district's events do not reach the totals.

**A replayed create answers 200, not 409.** The client generated the id precisely so a retry
would be safe; making it distinguish "created" from "already created" puts the burden back on
exactly the connection that caused the retry. `DUPLICATE_MEMBERSHIP_EVENT` is for the same
event posted twice with NO id.

#### Session 7 — the membership screens

**The record screen is built around ONE decision.** Event type first, largest, most common
first; the form then adapts — a termination asks for a reason, a transfer for a counterparty,
a transition for the Rotary club, and none of them asks for the others. The alternative is a
form with fourteen fields of which four apply, which is where a secretary at eleven at night
goes back to WhatsApp.

**The person picker creates inline.** Typing a full name that matches nobody offers "add
them", and the create happens as part of the submit. Forcing a separate "add member" journey
first is how the tenth induction of the evening stops being recorded.

**The client generates the event id**, so tapping Record twice on a bad connection produces
one row. The server answers 200 rather than 409 for the replay, which means the screen does
not have to distinguish them either.

**Corrections are offered in the two shapes the log supports** — "this never happened" and
"it happened, but differently" — named on the dialog rather than left to a type dropdown. The
note is required, because an unexplained correction to an append-only log is what a dispute
turns on eighteen months later.

**Superseded events stay visible, dimmed, linked to what corrected them.** A history that
hid them would be a history that had been edited, which is the thing the log exists not to be.

**Bundle: 90 KB gzipped.**

#### Session 8 — activity types and the media pipeline

**The sharp trap was handled in the same commit, as the prompt insists.**
`@img/sharp-linux-x64`, `@img/sharp-libvips-linux-x64` and `@img/sharp-win32-x64` are pinned
in the root `optionalDependencies` beside esbuild's, because npm does not persist transitive
optional platform binaries and the next workspace-scoped install would prune them — taking
`npm run dev` down with them. Verified after installing: `tsx` still runs and sharp still
resizes.

**THE GPS FIXTURE NEEDED `IFD3`, NOT A KEY CALLED `GPS`.** sharp passes `withExif` straight
to libvips, which numbers its EXIF directories — ifd0 the image, ifd1 the thumbnail, ifd2 the
EXIF sub-IFD, ifd3 the GPS one. A fixture written with a `GPS` key produces a JPEG with no
location in it at all, and the test that proves EXIF is stripped would have passed while
proving nothing. The test now asserts the fixture carries GPS BEFORE processing it, which is
what makes the assertion after it mean something.

**And the detector had to parse, not grep.** "Does this EXIF block have a GPS IFD" cannot be
answered by searching for the string `GPS`: EXIF is a binary TIFF structure and the word does
not appear. A substring check reports "no location" on every photograph ever taken — a
location test that always passes, which is the same vacuous-harness failure as M0's route
walker. It now walks IFD0 looking for tag `0x8825`.

**The processed DISPLAY variant replaces the original and the original is deleted.** Keeping
the original would keep its EXIF, which is the shape of a leak that looks fixed.

**Content type comes from MAGIC BYTES.** Not the extension, not the `Content-Type` header —
both are attacker-supplied strings, and an HTML document called `photo.jpg`, served back from
a domain that holds a session cookie, is stored XSS. The 10MB cap is enforced WHILE READING:
checking `Content-Length` trusts a header, and checking afterwards means the buffer exists.

**Storage holds KEYS, never URLs**, and keys are generated — `<prefix>/<yyyy>/<mm>/<uuid>.<ext>`
— never a user's filename. The incumbent kept spaces and apostrophes in stored names; a
user-supplied filename in a storage key is also a path traversal waiting for somebody to try
`../`. Reads are short-lived signed URLs, because a photograph of a member is not public and
a permanent URL is permanent for whoever ends up holding it.

**`storage()` refuses the local driver in production.** The application filesystem does not
survive a redeployment (ADR-007), and a deploy that quietly lost every photograph since the
last one is not a failure anybody notices in time.

**`field_config` is `{ fields: [...] }`, an object rather than a bare array**, so the format
can gain a sibling key later without every stored row needing a migration. Five field kinds
and no more: every addition is a thing the renderer, the validator and the builder must all
agree about. It is parsed on the way OUT as well as in — a row that no longer parses renders
as a type with no extra fields rather than taking the reporting screen down.

**The builder has a live preview** rendered with the same components the real form uses. A
preview built from a different renderer is a preview that lies.

#### Session 9 — activities and the reporting flow

**There is no per-type branch anywhere.** Not in the service, not in the reporting screen.
Requirements are read from the TYPE's row — `requires_*` and `field_config` — which is what
makes adding an activity type a row rather than a release. `MISSING_REQUIRED_FIELD_FOR_TYPE`
carries the field in `details.key`, so the message lands on the control.

**`assessment.markStale()` exists and does nothing, on purpose.** An activity write
invalidates whatever the club last scored, and M5 needs a body rather than a hunt through
this module for call sites. It is a NOTIFICATION — ids in, nothing out — so
`modules/activity` never learns anything about `club_assessments`, and the dependency rule
still points one way.

**A VERIFIED activity cannot be edited** (`PERIOD_CLOSED`): it has been counted, and editing
it silently would change a number somebody has already read. A QUERIED one that is edited
goes back to UNVERIFIED, because an edit after a query is a resubmission — that state is what
makes verification two-way rather than write-only.

**`extra` stores only the keys the type declared.** JSONB plus "store what was sent" is an
unversioned schema nobody agreed to, and a scoring resolver reading an undeclared key is
reading whatever one club decided to send.

**International service is derived, never declared** — `country_code <> 'UG'` on a partner
row, with the column NOT NULL and defaulted to UG so the derivation is total and
conservative. A club cannot tick a box to claim it.

**The reporting screen keeps its draft in `sessionStorage` and generates the activity id
itself.** A secretary who taps a notification mid-report should not start again, and
submitting twice on a bad connection must produce one activity. Photographs upload
sequentially after the activity exists — a phone on 3G uploading four at once finishes none
of them first.

**`apiRequest` gained `formData`**, sent with NO `Content-Type` header: the browser has to
set it itself so it can add the multipart boundary, and a hand-written `multipart/form-data`
produces a request the server cannot parse.

**Bundle: 96 KB gzipped**, against the 250 KB budget.

#### Session 10 — hardening

**The seed is at its real shape: 68 clubs, 3,000 members, 1,327 activities, 4,110 attendance
records and a year of membership churn.** The counts are ASSERTED in `run.ts` rather than
merely computed — M5's scoring and the load test both need a dataset of a known size, and a
seed that quietly produced 2,847 members would make every performance number an answer to a
different question. Roughly a third of the clubs cross the T1/T2 boundary at forty, so the
tier logic and the ranking are exercised by the data rather than only by a unit test.

**The churn matters as much as the scale.** 225 departures, 44 of them to Rotary, and 7
retracted — so every club's retention is a different number, and the supersede path that
schema v1.9 fixed is exercised by the DATASET. Without it M5 would be calibrated against a
district where nobody ever leaves.

**SCALING THE SEED FOUND A LIVE CONTRACT BUG.** `clubs.meeting_day` has been
`CHECK (meeting_day BETWEEN 0 AND 6)` since M0 with the convention recorded NOWHERE, and the
contract written in session 3 said `min(1).max(7)`. A club meeting on Sunday would have been
accepted by the contract and refused by the database as an opaque 500. The contract now says
0–6 and `schema.sql` states the convention: **0 = Sunday, matching Postgres `EXTRACT(DOW)`**,
because a scoring resolver asking "did this club meet on its meeting day" compares against
exactly that, and two conventions one join apart is a resolver that is wrong on Sundays. The
two UI day arrays were off by one and are fixed with it.

**EXPLAIN ANALYZE at that scale, and two indexes** (`20260816020000_m2_performance_indexes`).
Everything else was already fast enough, and the sequential scans that remain are on tables
of 68 and 3,239 rows where the planner is right to choose one:

| Query | Before | After |
|---|---|---|
| Activity list, district-wide | 2.2 ms | 1.6 ms |
| Activity list, one club | 0.09 ms | 0.08 ms |
| Roster, one club | 0.17 ms | 0.16 ms |
| As-at roster reconstruction | 8.0 ms | 6.4 ms |
| Club summary counts | 0.23 ms | 0.06 ms |
| **Person list through the roster** | **8.1 ms** | **0.20 ms** |

`club_rosters` had indexes on `(person_id, club_id)` and `club_id` but nothing on
`district_id` — and EVERY read of it filters by district, because that is what the scope
layer injects. That one index is the 40× on the last row. The other is a PARTIAL index on
`membership_events(supersedes_event_id)`: the supersede anti-join is the query whose plan
matters in 2032 rather than today, since the log is the one table here that grows without
bound. Both are invisible to Prisma's differ — one partial, one on a materialised view — so
they live in raw SQL and `migrate diff` still reports empty.

**The seed's assertions read the seed's own constants** rather than repeating literals, so
scaling the dataset again changes one place. The ADRR scope test counts Kampala Metro's clubs
from `CLUBS` for the same reason: it grew from five to fifteen, and a literal would have
failed for the right reason with the wrong message.

**The doc-check axiom-3 grep learned about `corroborated_at`.** It is the one column the
immutability guard lets through, so a `updateMany` naming only that column is legitimate and
anything else is not — the check now distinguishes them rather than being switched off.

**THE pg-BOSS MIGRATION WAS NOT REPLAYABLE, and this bit immediately.** Prisma resets its
shadow database by dropping the PUBLIC schema; it has no `multiSchema` setting, so it does
not know `pgboss` exists and leaves it behind. The next `migrate dev` then fails on
`CREATE TYPE pgboss.job_state` with SQLSTATE 42710, and every `migrate dev` and
`migrate diff` after it is broken for a reason that looks like nothing to do with pg-boss.
The migration now begins `DROP SCHEMA IF EXISTS pgboss CASCADE`, which is a no-op on any
database where the migration has not already run.

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
| ~~No worker process, no pg-boss~~ | **built in M2 session 1** | — |
| ~~The web bundle is uploaded as a CI artifact rather than published~~ | **decided and built in M2 session 2**: served from the API container, same origin, one deploy | — |
| ~~The worker process group in `fly.toml` is commented out~~ | **uncommented in M2 session 1**; two process groups from one image | — |
| A dead-lettered job is recorded but not retryable from the UI | `JOB_FAILED` in `audit_log` carries the queue, the error and the payload, which is enough to re-run it by hand; a button needs a screen that does not exist | M7, with the admin surface |
| `recordAction(EXPORT, …)` exists and is unused | there is no export module yet | M7 |
| A malformed or unauthorised `?year=` fails EVERY authenticated route, including `/auth/logout` | context resolution is global and eager; sending `?year=` to logout is a client bug | not planned |
| A nested create of a parent alongside its child is not scope-checked | there is no parent id to check; the parent's own write is stamped, so the child lands under a stamped row | not planned |
| Permission codes match exactly — no `club:read:*` wildcard | a matcher would turn a typo in a seeded row into a silent grant | not planned |
| ~~A person's contact details have no endpoint at all~~ | **built in M2 session 5**: one serialiser, three ways to see contact, absent-not-null | — |
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
