# Claude Code — M0 Foundations Session Prompts

Six sessions that take you from an empty repository to a deployed staging environment with authentication, request scoping, audit logging and a verification harness. Everything after this builds on it.

**Paste each prompt as the first message of a fresh Claude Code session.** Do not continue one session into the next — a session carrying two hours of unrelated context will start ignoring your axioms.

---

## Progress

| Session | State | What actually happened |
|---|---|---|
| 1 | **done** | As specified. CI green. |
| 2 | **done** | Translation surfaced real defects in the v1.0 baseline; `schema.sql` is now **v1.6** and ADR-012 was written. See below. |
| 3 | **done** | Auth as specified, **plus** mail delivery, TOTP MFA, encrypted secrets and recovery codes. |
| 4 | **next** | — |
| 5 | pending | The test database harness already exists (session 3 built it). |
| 6 | pending | Seed must also populate `document_types` and `social_platforms`. |

`docs/10-Build-Log.md` is the current-state record: environment, decisions, what is
stubbed, and the traps. Read it before starting a session.

**Sessions 2 and 3 diverged from these prompts in ways worth knowing.** Session 2 found
that `club_rosters` had its superseded-event predicate inverted — every correction was
discarded while the row it corrected kept counting — and that scores could exceed the
criterion they were awarded against. Session 3 was extended beyond its six endpoints
because the password-reset flow stored tokens nobody could receive, and because MFA
without encryption or recovery codes is a liability rather than a feature.

---

**Before session 1:**
- GitHub organisation created for the district, repo inside it, second admin added
- `docs/` and `CLAUDE.md` committed at the root
- Node 20+, a local PostgreSQL 16 (Docker is fine), VS Code with the Claude Code extension
- **Do not run `/init`** — it will overwrite your `CLAUDE.md` with a generic one

**Working rules for every session:**
- Ask for a plan before code on anything non-trivial. Correcting a plan is far cheaper than correcting a diff.
- Commit after every working slice.
- Run the verification step at the end of each session before moving on. Do not batch verification.

---

## Session 1 — Monorepo scaffold and CI

```
Read CLAUDE.md and docs/02-Architecture.md §6 before starting.

Scaffold the monorepo. Do not write any application features yet — this session
is structure only.

Requirements:
- npm workspaces: apps/api, apps/web, packages/contracts
- TypeScript strict everywhere: strict true, noUncheckedIndexedAccess true,
  no implicit any. A shared tsconfig.base.json extended by each workspace.
- apps/api: Express 5, tsx for dev, vitest for tests. Entry src/server.ts with
  a single GET /api/v1/admin/health returning { status: 'ok' } and no data.
- apps/web: Vite + React 18 + TypeScript + Tailwind. Default page is a
  placeholder; no routing yet.
- packages/contracts: Zod, exports an empty index for now. Both apps import it.
- Root package.json scripts: dev (api + web concurrently), build, test,
  typecheck, lint.
- ESLint + Prettier, shared config.
- .github/workflows/ci.yml running install, typecheck, lint, test, npm audit
  on push and PR.
- .env.example listing every variable the project will need, with comments.
  Never commit a real .env — add it to .gitignore.
- .gitignore covering node_modules, dist, .env, coverage.

Give me the plan first. Then implement.
```

**Verify:** `npm run typecheck && npm run lint && npm run test` all pass. `npm run dev` serves the health endpoint and the web placeholder. Push and confirm CI is green.

**Commit:** `chore: scaffold monorepo with CI`

---

## Session 2 — Prisma schema translation

The most error-prone session in M0. A silent mistake here surfaces in month four.

```
Read docs/schema.sql and docs/03-Data-Model.md in full before starting.

Translate docs/schema.sql into apps/api/prisma/schema.prisma. Work in this
order and STOP after each domain for me to review before continuing:

  1. Organisation  (districts, rotary_years, district_years, regions,
                    clusters, clubs, club_district_affiliations,
                    club_cluster_assignments)
  2. People        (persons, users, person_visibility, consents, user_tokens)
  3. Governance    (permissions, positions, position_permissions,
                    appointments, committees, committee_members)
  4. Membership    (membership_events)
  5. Activity      (areas_of_focus, activity_types, activities,
                    activity_areas_of_focus, activity_partners,
                    activity_media, activity_attendees)
  6. Finance       (finance_categories, budgets, budget_lines,
                    financial_transactions, dues_invoices, dues_payments,
                    member_dues, trf_contributions)
  7. Assessment    (assessment_frameworks, assessment_parameters,
                    assessment_criteria, assessment_periods,
                    club_assessments, assessment_scores,
                    assessor_assignments, assessment_comments,
                    assessment_disputes)
  8. Goals, documents, public image, platform (goals, goal_snapshots,
     documents, social_accounts, social_snapshots, media_appearances,
     audit_log, notification_templates, notifications, export_jobs)

Rules:
- snake_case in the database via @map / @@map; camelCase in TypeScript.
- Preserve EVERY constraint, unique index, partial index and check from the
  SQL. Where Prisma cannot express something (partial indexes, check
  constraints, materialised views, RLS), note it and I will add it as a raw
  SQL migration afterwards — list these explicitly at the end.
- Do NOT add district_id to clubs. Affiliation is temporal via
  club_district_affiliations. This is axiom 2 and it is load-bearing.
- Do not "improve" the model. If something looks wrong, tell me rather than
  changing it.

After each domain, show me the Prisma models and the list of anything that
did not translate cleanly.
```

Then, in the same session:

```
Now generate the initial migration and add a second raw SQL migration for
everything Prisma could not express — in particular:

- CREATE EXTENSION pgcrypto, citext, pg_trgm
- The partial unique index district_years_one_current
- Trigram GIN indexes on clubs.name and person full name
- The club_rosters materialised view and its indexes
- Any CHECK constraints from schema.sql

Then run prisma migrate dev against a scratch database and show me the
generated SQL so I can diff it against docs/schema.sql.
```

**Verify — do this properly, it is the point of the session:**

```bash
pg_dump --schema-only $DATABASE_URL > /tmp/generated.sql
```

Diff against `docs/schema.sql`. Pay specific attention to:
- `club_district_affiliations` — the `UNIQUE (club_id, rotary_year_id)` key
- `district_years_one_current` — the partial unique index
- `NUMERIC` columns that must not have become `FLOAT` or `DECIMAL` with wrong precision
- Every `TIMESTAMPTZ` still being `timestamptz`, not `timestamp`
- `activity_types.allowed_host_scopes` and `assessment_criteria.applies_to_tiers` still arrays

**Commit:** `feat(db): initial schema migration`

---

## Session 3 — Authentication

```
Read CLAUDE.md and docs/05-API-Spec.md §2 before starting.

Implement authentication in apps/api. Sessions only — no JWT (see ADR-003).

- express-session + connect-pg-simple, session table in Postgres
- Cookies: HttpOnly, Secure in production, SameSite=Lax
- Argon2id password hashing (argon2 package), sensible memory/time cost
- Endpoints:
    POST /api/v1/auth/login
    POST /api/v1/auth/logout
    GET  /api/v1/auth/me         (stub context for now — session 4 fills it)
    POST /api/v1/auth/password/forgot
    POST /api/v1/auth/password/reset
    POST /api/v1/auth/invite/accept
- Zod request schemas live in packages/contracts, imported by the API.
- Rate limit login: 5 attempts per 15 min per IP+email. Account lockout with
  exponential backoff using users.failed_attempts and users.locked_until.
- POST /auth/password/forgot ALWAYS returns 204, whether or not the email
  exists. Do not leak account existence.
- Tokens stored hashed in user_tokens, single use, with expiry.
- invite/accept must write a consents row (type DATA_PROCESSING) with the
  policy version and source IP.
- Standard error envelope: { error: { code, message, details } }. Never leak
  stack traces or SQL.

Write vitest tests for: successful login, wrong password, lockout after 5
attempts, forgot-password returns 204 for an unknown email, reset token is
single-use, expired token rejected.

Plan first.
```

**Verify:** tests pass; hit `/auth/login` with a seeded user via curl or Thunder Client; confirm the session cookie is `HttpOnly`.

**Commit:** `feat(auth): session authentication with lockout`

---

## Session 4 — Request context and scoped data access

**The most important session in M0.** Every feature you build afterwards inherits this. Get it wrong and you will be retrofitting scoping into forty endpoints.

```
Read CLAUDE.md, docs/10-Build-Log.md, and docs/02-Architecture.md §4.1, §4.2
and ADR-012 before starting.

Build the request context and scoped data access layer.

Context that has changed since this prompt was written: authentication,
sessions and the error envelope already exist (apps/api/src/platform,
apps/api/src/modules/auth). GET /auth/me currently returns a STUB context —
nulls and empty arrays — and this session fills it. Handlers take a typed
body via withBody(); tests run against a real PostgreSQL (dis_test) with
helpers in src/test/. Derived state is a view, never a stored column
(ADR-012), so the data access layer must scope views as well as tables.

1. RequestContext type in packages/contracts:
     { userId, personId, districtId, rotaryYearId,
       permissions: Set<string>,
       scopes: { clubIds: string[], clusterIds: string[], isDistrictWide: boolean } }

2. Context middleware that, for every authenticated request:
   - loads the user's ACTIVE appointments for the current Rotary Year
   - derives districtId from those appointments
   - derives rotaryYearId from district_years where is_current, unless a
     ?year= override is supplied AND the user holds year:read:historical
   - unions position_permissions into the permission set
   - computes scopes from appointment scope_type/scope_id
   - attaches the result to req.ctx

3. A data access layer wrapping Prisma that REQUIRES a RequestContext and
   automatically injects districtId and rotaryYearId into every query on a
   tenant-scoped or year-scoped table, plus deletedAt: null on soft-deleted
   tables. Handlers must never write these filters by hand.
   Make it a type error to query a scoped table without a context.

4. requirePermission(code) middleware, and a requireScope helper that checks
   record-level access (a club secretary may only touch their own club).

5. Out-of-scope records return 404, never 403 — 403 confirms existence.

6. Writes to a locked district_year must be rejected with YEAR_LOCKED.

7. Complete GET /auth/me to return the real context and active appointments.

Tests:
- context resolves correctly for a club secretary, an ADRR, and the PIME Chair
- a club secretary querying another club's data gets 404
- year override is rejected without year:read:historical
- a write to a locked year is rejected with YEAR_LOCKED
- a query built without a context fails to compile or throws

Plan first. I want to review the data access layer design before you build it.
```

**Verify:** review the plan carefully before approving. Specifically check that scoping happens in the data access layer, not in a helper that handlers are expected to remember to call.

**Commit:** `feat(platform): request context and scoped data access`

---

## Session 5 — Audit log and the no-PII harness

```
Read CLAUDE.md and docs/02-Architecture.md §4.4 before starting.

Part 1 — Audit logging.
- Prisma middleware ($extends) capturing CREATE, UPDATE and DELETE on all
  governed entities into audit_log with actor, entity type, entity id,
  before/after JSONB diffs, IP and user agent.
- Append-only: no application code path may update or delete audit_log.
- Also log LOGIN, LOGOUT and EXPORT actions.
- Governed entities: clubs, persons, appointments, membership_events,
  activities, financial_transactions, dues_payments, trf_contributions,
  assessment_scores, club_assessments, assessment_frameworks, documents.

Part 2 — The no-PII test harness. This one is mandatory (CLAUDE.md, Testing §5).
- A vitest suite that enumerates every registered Express route, issues an
  UNAUTHENTICATED request to each, and asserts:
    * the response is 401, or
    * the response body contains none of: email, phone, altPhone,
      dateOfBirth, city, photoUrl, or any nested person contact object
- It must discover routes automatically from the Express router, so routes
  added later are covered without anyone remembering to update the test.
- The only permitted exception is GET /api/v1/admin/health, which returns no
  data. Encode that as an explicit allowlist of one.
- Fail the build if a new route returns personal data unauthenticated.

Part 3 — Wire both into CI.

The test harness already exists: vitest runs against a real PostgreSQL
(TEST_DATABASE_URL, dis_test), CI has a postgres:17 service, and
src/test/helpers.ts provides resetDatabase and factories. Do not rebuild it.

Also port apps/api/prisma/checks/invariants.sql — 37 checks that attempt each
database guard violation and assert it fails — into a vitest suite, so ADR-012
conformance runs in CI rather than by hand.

Note for the PII walker: GET /api/v1/admin/health is the only unauthenticated
route today. Everything under /auth returns 401 or 204 without a session,
except login and the token endpoints, which take credentials rather than
returning data.
```

This harness exists because the predecessor system published four thousand members' phone numbers, emails, genders and residential areas on an unauthenticated page. Writing it now, with three routes, means it protects you automatically for the next eleven months.

**Verify:** deliberately add a temporary route returning `persons` with contact fields. Confirm the test fails. Remove it.

**Commit:** `feat(platform): audit log and unauthenticated-PII guard`

---

## Session 6 — Seed script and staging deployment

```
Read CLAUDE.md and docs/07-Roadmap.md §M9 before starting.

Part 1 — apps/api/prisma/seed.ts, giving a one-command reset to a realistic
dataset:

- Rotary years 2026-27 and 2027-28; district 9218 with 2027-28 current
- Permissions: the full list implied by docs/05-API-Spec.md §10
- Positions: the D9218 RY2027-28 slate, with position_permissions wired from
  the authorisation matrix in that section
- 3 regions, 6 clusters
- 20 clubs with realistic Ugandan Rotaract names, RI club IDs, a mix of CBC /
  IBC / e-club and T1 / T2 tiers, affiliated to 9218 for 2027-28
- 300 persons with SYNTHETIC data only (faker) — never real member data.
  person_visibility defaults all false.
- Users for one secretary, one treasurer and one president per club, plus
  DRR, DES, PIME Chair, District Treasurer, 3 ADRRs, 2 assessors
- Appointments wiring those users to positions and scopes for 2027-28
- Activity types covering every category in docs/03-Data-Model.md §5
- Areas of focus, finance categories
- document_types and social_platforms — these are lookup tables added during
  implementation and are currently EMPTY; documents and social accounts
  reference them by foreign key, so nothing can be created without them
- notification_templates already has AUTH_PASSWORD_RESET and AUTH_INVITE from
  a data migration (authentication depends on them). Do not duplicate those;
  add any others the seed needs with ON CONFLICT DO NOTHING semantics.

Make it idempotent and rerunnable: npm run db:seed resets and reseeds.
Use issueInvite() from modules/auth/service.ts for the seeded officer
accounts rather than inventing a second invitation path.

Part 2 — Deploy to staging:
- Dockerfile for apps/api, static build for apps/web
- fly.toml (or railway.json) for api and worker as separate processes
- Managed Postgres connection via env var
- GitHub Actions workflow deploying main to staging on green CI
- Document required env vars in .env.example and the README

Part 3 — README covering local setup, migrations, seeding, tests, deployment.
```

Never put real member data in seeds or on your laptop. Generate it.

**Verify:** `npm run db:seed` from clean, log in as the seeded PIME Chair, confirm `/auth/me` returns the right context. Push to main, confirm staging deploys and the health endpoint responds.

**Commit:** `feat: seed data and staging deployment`

---

## M0 exit checklist

- [ ] CI green: typecheck, lint, tests, audit
- [ ] Schema migrated; generated SQL diffed against `docs/schema.sql`
- [ ] Login works on staging
- [ ] `GET /auth/me` returns a correct, appointment-derived context
- [ ] A club secretary receives 404 for another club's records
- [ ] Writes to a locked year rejected with `YEAR_LOCKED`
- [ ] Audit log capturing mutations with before/after diffs
- [ ] No-PII harness running in CI and demonstrably failing on a bad route
- [ ] `npm run db:seed` gives a realistic dataset in one command
- [ ] Staging deploying automatically from main
- [ ] Repository under the district organisation with two admins

**Done so far:** CI green including a PostgreSQL service; schema migrated and verified by
building it twice — from migrations and from `schema.sql` — and comparing catalogs;
`prisma migrate diff` reports no drift; 37 database invariants pass; login, lockout,
password reset by email, invitations, and two-factor sign-in all work end to end.

**Still open on this list:** the appointment-derived context (session 4), the club
secretary 404 and `YEAR_LOCKED` tests (session 4), the audit log and PII harness
(session 5), the seed and staging deployment (session 6), and moving the repository to a
district-owned organisation — it is currently on a personal account, which ADR-011 and
`docs/08-Incumbent-Assessment.md` both say is the specific failure this project exists to
correct.

**Next:** M1 governance core — positions and appointments CRUD, committees with sub-committees, and the year rollover job with dry-run. See `docs/07-Roadmap.md`.

---

## Notes on working with Claude Code on this project

**Anchor sessions explicitly.** `CLAUDE.md` loads automatically, but for anything touching the data model, name the document: *"Read docs/03-Data-Model.md §1 before proposing anything."* Long sessions drift, and the temporal affiliation model is exactly what a model will helpfully "simplify."

**Reject helpful simplifications.** If it proposes adding `district_id` to `clubs`, flattening `membership_events` into a roster table, or hard-coding activity types — say no and point at the axiom. These will look like obvious improvements. They are the specific failures this design exists to prevent.

**One module per session.** Start fresh between modules.

**Plan before code, always, for anything touching scoping, permissions or scoring.**

**Do not accelerate by skipping sessions 4 and 5.** They feel like infrastructure with nothing to show for them. They are the two sessions that determine whether M2 through M5 go quickly or become a retrofit.
