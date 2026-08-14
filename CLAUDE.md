# CLAUDE.md

Project context for Claude Code. Place at repository root.

---

## What this is

**Rotaract District Information System (DIS)** — the system of record for club activity, membership, finance and performance for Rotaract District 9218 (Uganda), and the engine that converts that record into scores, goals and feedback.

Launch: **1 July 2027**, the district's charter date. Built by one part-time developer between August 2026 and June 2027. **District property**, not a commercial product.

Full design documentation is in `docs/`. Read `docs/00-README.md` first. When a decision here conflicts with `docs/`, `docs/` wins and this file should be updated.

**`docs/10-Build-Log.md` records what has actually been built, the decisions taken during implementation, and what is deliberately unfinished. Read it before writing code** — the other documents describe the design, not the current state.

## Stack

PostgreSQL 16 · Node 20 · Express 5 · React 18 + Vite · TypeScript strict · Prisma (CRUD + migrations) · raw SQL via `$queryRaw` (analytics only) · Zod (shared contracts) · pg-boss (jobs) · S3-compatible storage + `sharp` · session cookies in Postgres · Argon2id · TanStack Query · Tailwind.

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

**Assessment.** No SQL in `assessment_criteria.rule` — rules name a resolver from the code registry and supply config. Resolvers are pure: input `(ctx, config)`, output `{ value, evidence }`, no writes, no side effects. Every score persists its evidence.

**Where an invariant lives (ADR-012).** Declarative constraints first — `CHECK`, `UNIQUE`, FK, partial index. **Derived state is a view, never a stored column maintained by a trigger.** Triggers only as guards, each raising a stable `SQLSTATE` mapped to a domain code in `platform/errors.ts`, listed in the ADR's registry, and exercised by `apps/api/prisma/checks/invariants.sql`. Adding a guard without a check there is incomplete work.

**Prisma owns anything Prisma can represent.** An index or table it *could* express but does not know about gets proposed for dropping on the next `migrate dev`. `prisma migrate diff --from-migrations --to-schema` must always report an empty migration.

**Money** is `NUMERIC`, never `FLOAT`. **Timestamps** are `TIMESTAMPTZ`, never `TIMESTAMP`.

**Secrets** that the database must hold but must not yield — currently TOTP secrets — are encrypted with `platform/crypto.ts` before they are stored (ADR-013). Keys live in the platform secret store, never beside the data.

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
- One error shape: `{ error: { code, message, details } }`. Domain errors use stable codes (`PERIOD_CLOSED`, `YEAR_LOCKED`, `FRAMEWORK_LOCKED`, `TIER_NOT_APPLICABLE`) declared in `platform/errors.ts`.
- Handlers take a **typed body**: `...withBody(schema, async ({ body, req, res }) => …)`. Express types `req.body` as `any`, so reading it directly is unchecked and a renamed contract field would compile.
- Tests read responses **through the contract schemas** (`errorBody`, `meBody` in `src/test/helpers.ts`) rather than casting, so every assertion also proves the envelope shape.
- Never leak stack traces, SQL or internal IDs to a client.
- Soft delete via `deleted_at` on governed entities. Every query filters it.
- Raw SQL lives **only** in `modules/assessment/resolvers/`. Everywhere else uses Prisma.
- List endpoints paginate by default (25, max 100) and accept `?format=xlsx`.

---

## Testing

Priority order:

1. **Assessment resolvers** — 80%+ coverage, unit tested with fixture data. A scoring bug is an award scandal.
2. **Permission resolution** — every position × every endpoint class.
3. **Year rollover** — integration tested, both dry-run and committed paths.
4. **Offline sync idempotency** — same UUID posted twice yields one row.
5. **No-PII-unauthenticated** — an automated test that walks every route and asserts unauthenticated requests never return contact fields. This one is mandatory; it guards the failure this project exists to correct.

CRUD does not need exhaustive coverage. Do not chase a coverage number.

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
npm run db:seed          # reset to realistic fixtures        (session 6)
npm run test             # vitest — needs PostgreSQL and TEST_DATABASE_URL
npm run typecheck
npm run lint
npm run worker           # pg-boss worker process             (not built yet)
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

## Current phase

**M0 — Foundations.** Sessions 1–4 are done: monorepo and CI, schema translated and
migrated (`docs/schema.sql` is at v1.6), session authentication with lockout, mail
delivery, TOTP two-factor with encrypted secrets and recovery codes, and the request
context and scoped data access layer. `GET /auth/me` returns a real, appointment-derived
context.

**Next: session 5 — audit log and the no-PII harness.** Then session 6 (seed, staging
deploy). The seed must now populate `permissions` and `position_permissions` as well —
context resolution reads them, so without them every account resolves to no authority.

See `docs/09-ClaudeCode-M0-Sessions.md` for the session prompts, `docs/10-Build-Log.md`
for current state, and `docs/07-Roadmap.md` for milestones beyond M0.