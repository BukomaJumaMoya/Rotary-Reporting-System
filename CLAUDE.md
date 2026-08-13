# CLAUDE.md

Project context for Claude Code. Place at repository root.

---

## What this is

**Rotaract District Information System (DIS)** — the system of record for club activity, membership, finance and performance for Rotaract District 9218 (Uganda), and the engine that converts that record into scores, goals and feedback.

Launch: **1 July 2027**, the district's charter date. Built by one part-time developer between August 2026 and June 2027. **District property**, not a commercial product.

Full design documentation is in `docs/`. Read `docs/00-README.md` first. When a decision here conflicts with `docs/`, `docs/` wins and this file should be updated.

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

**Authorisation.** Enforced server-side, per record, on every endpoint. Client-side hiding of controls is presentation only. Permissions derive from active appointments — `(person, position, org_unit, rotary_year)` — never from a role column on a user.

**Out-of-scope records return `404`, not `403`.** `403` confirms existence and leaks the dataset shape.

**Personal data.** Default every `person_visibility` contact field — `show_email`, `show_phone`, `show_city` — to `false`. `show_photo` and `show_occupation` default to `true` and are visible to **authenticated district users only**; no visibility flag ever affects an unauthenticated caller. A person row without a `person_visibility` row is treated as fully closed, and a database trigger creates one on insert so the case cannot arise. Strip EXIF from every uploaded image (phone photos carry GPS). No public directory endpoint exists — do not create one, even a reduced one, without an explicit design review.

**Membership events are immutable.** No `PUT`, no `DELETE`. Nothing writes to `club_rosters` directly.

**Assessment.** No SQL in `assessment_criteria.rule` — rules name a resolver from the code registry and supply config. Resolvers are pure: input `(ctx, config)`, output `{ value, evidence }`, no writes, no side effects. Every score persists its evidence.

**Money** is `NUMERIC`, never `FLOAT`. **Timestamps** are `TIMESTAMPTZ`, never `TIMESTAMP`.

**IDs** are UUIDs, generated client-side for offline-created records so retry is idempotent.

**Never copy production data to a development environment.** Use `prisma/seed.ts`.

---

## Layout

```
apps/api/src/
  modules/<name>/          routes.ts · service.ts · repository.ts · schemas.ts
  platform/                context · auth · audit · errors · storage · db
  jobs/                    pg-boss workers
apps/web/src/
  features/<name>/         mirrors API modules
  components/ lib/
packages/contracts/        Zod schemas shared by both
```

Modules: `org · people · governance · membership · activity · finance · assessment · goals · documents · notifications · exports · audit`.

**Dependency rule:** `assessment` may call `activity`, `membership`, `finance`, `org`. Those must never call `assessment`. Dependencies point one way. When a criterion needs a number no module exposes, add a service function to the owning module — do not reach across the boundary.

Modules talk through exported service functions. No module imports another's repository or queries another's tables.

---

## Conventions

- `snake_case` in the database, `camelCase` in TypeScript. Prisma maps between them.
- Zod schemas in `packages/contracts` are the single source of truth for request shapes. Server validates with them; client derives form types from them.
- One error shape: `{ error: { code, message, details } }`. Domain errors use stable codes (`PERIOD_CLOSED`, `YEAR_LOCKED`, `FRAMEWORK_LOCKED`, `TIER_NOT_APPLICABLE`).
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
npm run db:migrate       # prisma migrate dev
npm run db:seed          # reset to realistic fixtures
npm run test             # vitest
npm run typecheck
npm run lint
npm run worker           # pg-boss worker process
```

## Current phase

**M0 — Foundations.** Repo setup, schema migration, auth, request context, audit middleware, CI.

Next: M1 governance core (positions, appointments, permission resolution).

See `docs/07-Roadmap.md` for the full milestone plan and definitions of done.