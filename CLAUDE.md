# CLAUDE.md

Project context for Claude Code. Place at repository root.

---

## What this is

**Rotaract District Information System (DIS)** — the system of record for club activity, membership, finance and performance for Rotaract District 9218 (Uganda), and the engine that converts that record into scores, goals and feedback.

Launch: **1 July 2027**, the district's charter date. Built by one part-time developer between August 2026 and June 2027. **District property**, not a commercial product.

Full design documentation is in `docs/`. Read `docs/00-README.md` first. When a decision here conflicts with `docs/`, `docs/` wins and this file should be updated.

**`docs/10-Build-Log.md` records what has actually been built, the decisions taken during implementation, and what is deliberately unfinished. Read it before writing code** — the other documents describe the design, not the current state.

## Stack

PostgreSQL 16 · Node 20 · Express 5 (+ `compression`) · React 18 + Vite (+ `vite-plugin-pwa`, a hand-written service worker) · TypeScript strict · Prisma (CRUD + migrations) · raw SQL via `$queryRaw` (analytics only) · Zod (shared contracts) · pg-boss (jobs) · S3-compatible storage + `sharp` · `idb` for the offline outbox · session cookies in Postgres · Argon2id · TanStack Query · Tailwind.

Monorepo: `apps/api`, `apps/web`, `packages/contracts`.

---

## The six axioms

Every design decision derives from these. If a change conflicts with one, the change is wrong — stop and ask.

1. **The Rotary Year is a dimension, not a filter.** Every transactional row carries `rotary_year_id`. Year scoping is applied by the data access layer, never by individual queries.
2. **District affiliation is temporal.** Clubs move between districts (D9218 is being formed by splitting D9214). Affiliation lives in `club_district_affiliations(club_id, district_id, rotary_year_id)`. **Never add `district_id` to `clubs`.**
3. **Membership is an event log.** `membership_events` is append-only. The roster is a materialised view. Corrections are compensating events via `supersedes_event_id`, never edits.
4. **One activity model.** All club, cluster, committee and district activities are rows in `activities`, typed by `activity_types`. A new activity type is a configuration row, never a new table and never a deployment.
5. **The assessment rubric is data.** Parameters, criteria, weights and thresholds are rows the PIME Chair edits in the UI. Never hard-code scoring logic.
6. **Personal data is private by default.** No endpoint returns contact details to an unauthenticated caller. Ever. This system exists partly to correct exactly that failure in its predecessor.

---

## Non-negotiable rules

**Scoping.** Never read `districtId` or `rotaryYearId` from request input. Both come from `RequestContext`, resolved by middleware from the session. A handler containing `where: { districtId: req.body.districtId }` is a security bug.

Scoped tables are reachable **only** through `db(ctx)` (`platform/db.ts`), which injects district, year and `deletedAt: null`. They are absent from the type of the plain `prisma` export, so `prisma.activity` does not compile. Scoped delegates offer no `findUnique`, `update`, `delete` or `upsert` — a unique `where` cannot carry the filter; use `findFirst({ where: { id } })`, `updateMany`, `deleteMany`, and treat null or a zero count as the 404. Creates do not take `districtId`/`rotaryYearId`; the layer stamps them. `db(ctx).$transaction(cb)` is scoped too; only the callback form exists.

**Every** new table needs a row in `platform/scope.ts` — a scope rule, a `via` naming the parent that carries one (`assessment_scores` has no `district_id`; it inherits its `club_assessment`'s), or a reason in `UNSCOPED_BY_DESIGN`. `scope-registry.test.ts` fails the build otherwise. A table with no scope column is the easier mistake, not the safer one. A `via` write is checked against its parent, so creating a child under another district's row returns `404`.

`unscopedPrisma` is the escape hatch and ESLint confines it to `platform/`, `modules/governance/` and `src/test/`.

**Authorisation.** Enforced server-side, per record, on every endpoint. Client-side hiding of controls is presentation only. Permissions derive from active appointments — `(person, position, org_unit, rotary_year)` — never from a role column on a user. `requirePermission(code)` answers "may you do this at all"; `requireScope(ctx, target)` answers "may you do it to THIS record". An endpoint touching a specific club needs both.

**Out-of-scope records return `404`, not `403`.** `403` confirms existence and leaks the dataset shape. `requireScope` throws `notFound()` for this reason; `403 INSUFFICIENT_SCOPE` is for a missing permission, which describes the caller's own authority and reveals nothing.

**The Rotary Year is read-only unless it is the district's current, unlocked one.** Writes are refused with `YEAR_LOCKED` when `district_years.is_locked`, and also under a `?year=` override — that permission is `year:read:historical`, a read door, and must never become a backdating permission.

**Personal data.** Default every `person_visibility` contact field — `show_email`, `show_phone`, `show_city` — to `false`. `show_photo` and `show_occupation` default to `true` and are visible to **authenticated district users only**; no visibility flag ever affects an unauthenticated caller. A person row without a `person_visibility` row is treated as fully closed, and a database trigger creates one on insert so the case cannot arise. Strip EXIF from every uploaded image (phone photos carry GPS). No public directory endpoint exists — do not create one, even a reduced one, without an explicit design review.

**Membership events are immutable.** No `PUT`, no `DELETE`. Nothing writes to `club_rosters` directly.

**Audit.** Changes to a governed entity are captured automatically by an extension on `prisma` and `db(ctx)` — never call it by hand. `unscopedPrisma` is deliberately unaudited, which is what keeps the seed out of the log. Mount every router through the `mount()` helper in `createApp`, or the unauthenticated-PII harness will not walk it.

**Assessment.** No SQL in `assessment_criteria.rule` — rules name a resolver from the code registry and supply config. Resolvers are pure: input `(ctx, config)`, output `{ value, evidence }`, no writes, no side effects. Every score persists its evidence.

**Where an invariant lives (ADR-012).** Declarative constraints first — `CHECK`, `UNIQUE`, FK, partial index. **Derived state is a view, never a stored column maintained by a trigger.** Triggers only as guards, each raising a stable `SQLSTATE` mapped to a domain code in `platform/errors.ts`, listed in the ADR's registry, and exercised by `apps/api/prisma/checks/invariants.sql`. Adding a guard without a check there is incomplete work.

**Prisma owns anything Prisma can represent.** An index or table it *could* express but does not know about gets proposed for dropping on the next `migrate dev`. `prisma migrate diff --from-migrations --to-schema` must always report an empty migration.

**Money** is `NUMERIC`, never `FLOAT`. **Timestamps** are `TIMESTAMPTZ`, never `TIMESTAMP`.

**Secrets** that the database must hold but must not yield — currently TOTP secrets — are encrypted with `platform/crypto.ts` before they are stored (ADR-013). Keys live in the platform secret store, never beside the data.

**Scoped data access.** Context-bound models are removed from the `prisma` export's *type* — reach them through `db(ctx)`. `unscopedPrisma` is importable only from `platform/`, `modules/governance/` and `src/test/`, and ESLint enforces that. Two scopes inside one transaction need `scopedTransaction()`; a Prisma transaction client cannot be `$extends`-ed. Work with no request uses `systemContext({ districtId, rotaryYearId, reason })`, never `unscopedPrisma` — the reason is mandatory and reaches `audit_log`.

**Dates that decide authority** — appointment terms, year boundaries — compare against midnight in the DISTRICT's timezone via `platform/time.ts`, never UTC. In Kampala the difference is a three-hour window, and rollover happens on exactly that boundary.

**IDs** are UUIDs, generated client-side for offline-created records so retry is idempotent.

**Never copy production data to a development environment.** Use `prisma/seed.ts`.

---

## Layout

```
apps/api/src/
  modules/<name>/          routes.ts · service.ts · repository.ts · schemas.ts
  platform/                context · scope · auth · audit · errors · storage · db
  jobs/                    pg-boss workers
apps/web/src/
  features/<name>/         mirrors API modules
  components/ lib/
  lib/offline/             the outbox, the drain scheduler, connectivity, the PWA
  sw.ts                    the service worker — its own tsconfig (WebWorker, not DOM)
packages/contracts/        Zod schemas shared by both
```

Modules: `org · people · governance · membership · activity · finance · assessment · goals · documents · notifications · exports · audit`.

`governance` owns permission resolution and is the one module that reads the database without a context — it is what produces one.

**Dependency rule:** `assessment` may call `activity`, `membership`, `finance`, `org`. Those must never call `assessment`. Dependencies point one way. When a criterion needs a number no module exposes, add a service function to the owning module — do not reach across the boundary.

Modules talk through exported service functions. No module imports another's repository or queries another's tables.

---

## Conventions

- `snake_case` in the database, `camelCase` in TypeScript. Prisma maps between them.
- Zod schemas in `packages/contracts` are the single source of truth for request shapes. Server validates with them; client derives form types from them.
- One error shape: `{ error: { code, message, details } }`. Domain errors use stable codes (`YEAR_LOCKED`, `INSUFFICIENT_SCOPE`, `POSITION_IN_USE`, `PERIOD_CLOSED` …) declared in `platform/errors.ts`, which is the list that is actually true — `05-API-Spec.md §1` marks which are built.
- Permission codes match **exactly**. There is no `club:read:*` wildcard: a matcher turns a typo in a seeded row into a silent grant.
- Handlers take a **typed body**: `...withBody(schema, async ({ body, req, res }) => …)`. Express types `req.body` as `any`, so reading it directly is unchecked and a renamed contract field would compile.
- Tests read responses **through the contract schemas** (`errorBody`, `meBody` in `src/test/helpers.ts`) rather than casting, so every assertion also proves the envelope shape.
- Never leak stack traces, SQL or internal IDs to a client.
- Soft delete via `deleted_at` on governed entities. Every query filters it.
- Raw SQL lives **only** in `modules/assessment/resolvers/` and
  `modules/membership/analytics.ts`. Everywhere else uses Prisma. Raw SQL bypasses the scope
  extension completely, so those files bind `districtId`, `rotaryYearId` and `clubId` from
  the context by hand, in every query.
- List endpoints paginate by default (25, max 100) and accept `?format=xlsx`.

---

## Testing

Priority order:

1. **Assessment resolvers** — 80%+ coverage, unit tested with fixture data. A scoring bug is an award scandal.
2. **Permission resolution** — every position × every endpoint class.
3. **Year rollover** — integration tested, both dry-run and committed paths. Built in M1; `modules/org/rollover.test.ts`.
4. **Offline sync idempotency** — same UUID posted twice yields one row. Built in M3 s2; `apps/web/src/lib/offline/outbox.test.ts` (vitest + `fake-indexeddb`, node environment).
5. **No-PII-unauthenticated** — an automated test that walks every route and asserts unauthenticated requests never return contact fields. This one is mandatory; it guards the failure this project exists to correct.

CRUD does not need exhaustive coverage. Do not chase a coverage number.

**Run the suites one at a time.** Two concurrent vitest processes share the test database, and since the suite truncates every table between cases they hang rather than fail — which is indistinguishable from a slow run.

---

## When helping with this project

**Do:**
- Read `docs/` before proposing schema or architecture changes.
- Prefer configuration over code. If a district officer might plausibly want to change it, it is a row, not a constant.
- Write the migration and the seed update together.
- Keep the mobile payload budget in mind: users are on metered Android data. 250 KB initial JS, 400 px list images.
- Flag when something contradicts an axiom.

**Do not:**
- Add `district_id` to `clubs`, or otherwise flatten the temporal affiliation. This will look like an obvious simplification. It destroys redistricting history.
- Hard-code positions, activity types, finance categories, or assessment criteria.
- Add a public endpoint returning personal data.
- Introduce Redis, Kafka, microservices, GraphQL, or a meta-framework. One developer, one database, two processes. Scope discipline is the project's main risk control.
- Write raw SQL outside `modules/assessment/resolvers/`.
- Mutate `membership_events` or `club_rosters`.

**Context worth knowing:** the predecessor system published ~4,000 members' names, photos, phone numbers, emails, genders and residential areas on an unauthenticated page, alongside club meeting venues and times. Several rules above exist specifically because of that. When a change touches personal data exposure, treat it as high-stakes rather than routine.

---

## Commands

```bash
npm run dev              # api + web
npm run db:generate      # prisma generate — after ANY schema.prisma change
npm run db:migrate       # prisma migrate dev
npm run db:seed          # reset to realistic fixtures
npm run test             # vitest — needs PostgreSQL and TEST_DATABASE_URL
npm run typecheck
npm run lint
npm run test:report      # same suites, writes .tmp/vitest-report*.json for docs:check
npm run docs:check       # does the documentation still describe the system?
npm run bundle:check     # the payload budget — fails over 250 KB gzipped. Build first.
npm run worker           # pg-boss worker process
```

**PostgreSQL runs locally as the `dis-postgres` service on port 5433** (data directory
`C:\Users\HP\.dis-pgdata`), separate from the install on 5432. Databases:
`rotaract_dis_dev`, `rotaract_dis_dev_shadow`, `dis_test`, `dis_schema_check`.
See `docs/10-Build-Log.md` §2.

**Tests need a database.** `TEST_DATABASE_URL` must name a database containing "test"; the
suite truncates every table between cases and refuses to run otherwise.

**npm quirk worth knowing.** This npm does not persist *transitive* optional platform
binaries (`@esbuild/*`) in `package-lock.json`, so a workspace-scoped
`npm install -w <pkg> <dep>` prunes them and `tsx` — and therefore `npm run dev` —
stops working with "could not be found, and is needed by esbuild". The binaries are
therefore declared explicitly in the root `optionalDependencies`, and **their version must
be bumped together with esbuild's**, or esbuild rejects the mismatch. The same trap will
apply to `sharp` when image processing lands.

## How a milestone is built and closed

Each milestone is implemented in its own session, and **the next session starts with no
memory of this one**. `docs/10-Build-Log.md` is the entire handoff: §0 says where the build
is, §0a says what the last milestone changed about how you must write code, and §4a records
whether the axioms above still hold. Read those three before writing anything.

At the end of a milestone, run the **`/close-milestone`** skill. It verifies the build,
walks the axiom conformance review, updates every document, and proves the result with
`npm run docs:check --strict --with-db`. Do not hand-roll that update: the documents drift
in specific, boring ways — a permission count, an endpoint nobody wrote down, a schema
amendment that was never applied to `docs/schema.sql` — and the check exists because each of
those has already happened here at least once.

`npm run docs:check` is cheap and worth running any time you have added an endpoint, a
permission, an error code or a table.

---

## Current phase

**M0 — Foundations, M1 — Governance core and M2 — the reporting spine are all complete**
(August 2026). **M3 — offline and mobile — is code-complete**: sessions 1, 2 and 3 are done.
Session 4 is the manual device pass and has NOT been run, so M3 is not closed.
`docs/schema.sql` is at v2.1; 487 tests.

M0: monorepo and CI, schema translated and migrated, session authentication with lockout,
mail delivery, TOTP with encrypted secrets and recovery codes, the request context and
scoped data access layer, the audit log, the unauthenticated-PII harness, a one-command
synthetic seed, and a staging deployment.

M1: positions and their permission matrix, appointments with district-local terms,
committees with delegated sub-committees, invitations, admin MFA reset, the audit read, the
year rollover with a real dry run, and the web application with its governance screens.

M2: the pg-boss worker and its typed job registry; the SPA served from the API container;
clubs, affiliations and clusters; persons with ONE visibility serialiser, subject access and
reviewed erasure; the membership event log with its derived roster and statistics;
configurable activity types with a `field_config` builder; the media pipeline with magic-byte
sniffing and EXIF stripping; activities with reporting and verification; and a seed at the
real shape — 68 clubs, 3,000 members, a year of activity.

**Two items remain outside the code.**

The first is organisational: the repository and the hosting accounts are on a personal
account. ADR-011 and `docs/08-Incumbent-Assessment.md` both name that as the specific failure
this project exists to correct. Create the district-owned GitHub and Fly organisations with
two administrators, move the repository, then `fly launch` and add `FLY_API_TOKEN`.

The second is the **M2 exit test, which has not been run**: a real club secretary filing a
fellowship report with a photograph, on an Android phone, unassisted, in under three minutes
— and watched. Not a developer friend; they navigate around problems a real user walks
straight into. Every part of that path is built and tested. Whether it takes three minutes
for somebody who has never seen it is not a question the suite can answer.

**M3 sessions 1 and 2 are built.** The app is an installable PWA, and everything a club
officer creates — activities, persons, membership events — goes through **the outbox** in
`apps/web/src/lib/offline/`. The record is written to IndexedDB **before** any request is
attempted, always, online or not; a `409` from the server counts as SUCCESS, because that is
what a client-generated id is for. Do not add a second submission path: `submit()` is the
only way a club officer's write reaches the API.

**The payload budget is enforced, not aspirational.** `npm run bundle:check` fails the build
over 250 KB gzipped of initial JS (currently 90.6 KB) and runs in CI. Routes are split by
AUDIENCE: **a screen a club secretary uses on a phone is eager, everything else is lazy.**
Photographs are compressed on the device before they are queued — `lib/images.ts`.

**Next: M3 session 4 — the device pass.** Not a coding session: `docs/17-Device-Pass.md`,
on a mid-range Android over real mobile data. It has **not been run**, and two of the seven
M3 exit criteria cannot be closed without it. Do not run `/close-milestone` for M3 until it
has. After that, M4 — finance — in `docs/14-ClaudeCode-M3-M4-Sessions.md`. Read its preamble
first: ADR-012 made `dues_invoices.status` and `member_dues.amount_paid` into VIEWS, and the
earlier M4 document tells you to maintain them as columns.

See `docs/09-ClaudeCode-M0-Sessions.md`, `docs/12-ClaudeCode-M1-Sessions.md` and
`docs/13-ClaudeCode-M2-Sessions.md` for the session prompts already used,
`docs/10-Build-Log.md` for current state, and `docs/07-Roadmap.md` for milestones beyond M2.
