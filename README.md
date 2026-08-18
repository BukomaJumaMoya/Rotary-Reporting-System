# Rotaract District Information System

The system of record for club activity, membership, finance and performance for
**Rotaract District 9218 (Uganda)**, and the engine that turns that record into scores,
goals and feedback.

**Launch: 1 July 2027**, the district's charter date. **District property**, not a
commercial product — see [ADR-011](docs/02-Architecture.md) on where the accounts live and
why that is not a detail.

|                                               |                                                                        |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| **Design**                                    | [`docs/`](docs/) — start with [`docs/00-README.md`](docs/00-README.md) |
| **What is actually built**                    | [`docs/10-Build-Log.md`](docs/10-Build-Log.md)                         |
| **Working rules for contributors and agents** | [`CLAUDE.md`](CLAUDE.md)                                               |

---

## Requirements

- **Node 20+** (`^20.19` / `^22.13` / `>=24`)
- **PostgreSQL 16 or 17**, with the `pgcrypto`, `citext` and `pg_trgm` extensions
  available. The migrations create them.
- `psql` on `PATH` is useful but not required.

## Local setup

```bash
git clone <repo> && cd rotaract-dis
npm install

cp .env.example .env      # then edit: DATABASE_URL, SESSION_SECRET, ENCRYPTION_KEYS
```

Three values must be real before anything starts — the API validates its whole
environment at boot and exits rather than running half-configured:

```bash
openssl rand -base64 32   # SESSION_SECRET
openssl rand -base64 32   # the key half of ENCRYPTION_KEYS, as v1:<key>
```

Create the databases, apply the migrations, and load a dataset:

```bash
createdb rotaract_dis_dev
createdb rotaract_dis_dev_shadow    # Prisma replays migrations here to detect drift
createdb dis_test                   # the name must contain "test"

npm run db:migrate
npm run db:seed
npm run dev                         # API on :4000, web on :5173
```

`npm run db:seed` prints the accounts it created. Every one shares `SEED_PASSWORD`.

## Commands

| Command                                                       | What it does                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `npm run dev`                                                 | API and web together, with the contracts package rebuilding on change    |
| `npm run db:migrate`                                          | `prisma migrate dev` — creates and applies a migration                   |
| `npm run db:migrate:deploy`                                   | Applies pending migrations without generating one. What runs in staging. |
| `npm run db:generate`                                         | Regenerates the Prisma client. **After any `schema.prisma` change.**     |
| `npm run db:seed`                                             | Resets and reseeds a realistic dataset                                   |
| `npm run test`                                                | vitest — needs PostgreSQL and `TEST_DATABASE_URL`                        |
| `npm run typecheck` · `npm run lint` · `npm run format:check` | What CI runs                                                             |
| `npm run build`                                               | Production build of contracts, API and web                               |

## Migrations

The schema is authored in [`apps/api/prisma/schema.prisma`](apps/api/prisma/schema.prisma),
which is a translation of [`docs/schema.sql`](docs/schema.sql) — when the two disagree,
the SQL is right.

**Prisma owns anything Prisma can represent.** An index or table it _could_ express but
does not know about is proposed for dropping on the next `migrate dev`. Things it cannot
express — partial indexes, expression indexes, `CHECK` constraints, triggers, views —
live in raw SQL migrations and are invisible to its differ.

After any schema change, both of these must stay true:

```bash
# Must print "This is an empty migration."
cd apps/api && npx prisma migrate diff \
  --from-migrations ./prisma/migrations --to-schema prisma/schema.prisma --script

npm run test        # includes the 37 ADR-012 invariant checks
```

## Seeding

`npm run db:seed` truncates every table and rebuilds:

- Rotary Years 2026-27 and 2027-28, with 2027-28 current and 2026-27 locked
- District 9218 · 3 regions · 6 clusters · 20 clubs affiliated for 2027-28
- **300 synthetic members** with `JOIN` events, and the derived roster refreshed
- 36 permissions and 11 positions, with 120 `position_permissions` wired from the authorisation matrix
- 69 officer accounts — a president, secretary and treasurer per club, plus the DRR,
  DES, District Treasurer, PIME Chair, two assessors and three ADRRs

Appointment terms are clamped to today rather than dated from 1 July 2027. Dated from the
launch year the dataset produces a district nobody can sign in to until launch day.

**Synthetic data only, always.** The generator is in
[`apps/api/prisma/seed/synthetic.ts`](apps/api/prisma/seed/synthetic.ts) and it is
deterministic, so the same command produces the same database on every machine. Never put
real member data in a seed, in a fixture, or on a laptop — the predecessor system's
failure was exactly a copy of the membership register somewhere it should not have been.

The seed refuses to run with `NODE_ENV=production` unless `ALLOW_DESTRUCTIVE_SEED=true`.
It truncates every table; the guard exists because the realistic accident is one
`DATABASE_URL` left exported in a shell.

## Tests

vitest, against a **real PostgreSQL** — `TEST_DATABASE_URL` must name a database
containing `test`, because the suite truncates every table between cases and refuses to
run otherwise.

**282 tests.** Five suites are load-bearing rather than incidental:

| Suite                              | Guards                                                              |
| ---------------------------------- | ------------------------------------------------------------------- |
| `src/platform/no-pii.test.ts`      | Walks **every** registered route unauthenticated. Mandatory.        |
| `src/platform/invariants.test.ts`  | The 37 database guards of ADR-012                                   |
| `src/platform/scope*.test.ts`      | District and year scoping, and the registry that keeps it complete  |
| `src/modules/org/rollover.test.ts` | Year rollover, dry run and committed                                |
| `prisma/seed.test.ts`              | The seed, end to end, including signing in as the seeded PIME Chair |

The no-PII harness exists because the predecessor system published roughly four thousand
members' names, photographs, phone numbers, email addresses, genders and residential areas
on a page that required no login. It discovers routes from the Express app rather than
from a list, so a route added later is covered without anyone remembering.

## Deployment

Application on **Fly.io**, database on managed Postgres, object storage on R2 (ADR-011).
Everything under a **district-owned account with two administrators** — never a personal
one.

```bash
fly launch --no-deploy --config fly.toml --name rotaract-dis-staging
fly postgres create --name rotaract-dis-staging-db --region ams
fly postgres attach rotaract-dis-staging-db --app rotaract-dis-staging

fly secrets set --app rotaract-dis-staging \
  SESSION_SECRET="$(openssl rand -base64 32)" \
  ENCRYPTION_KEYS="v1:$(openssl rand -base64 32)" \
  APP_BASE_URL=https://staging.rotaract9218.org \
  SMTP_HOST=... SMTP_USER=... SMTP_PASSWORD=... \
  MAIL_FROM="Rotaract District 9218 <noreply@rotaract9218.org>"
```

Then add `FLY_API_TOKEN` to the repository's GitHub secrets. Pushes to `main` deploy to
staging automatically **after CI passes** — `.github/workflows/deploy-staging.yml` waits
on the CI workflow and refuses anything but a success, so a failing no-PII harness stops
the deployment rather than racing it.

Migrations run as a Fly **release command**, once, before the new version takes traffic.
Never from an app process: every instance would race the others.

**The web client is served by the API container, same origin** (M2 session 2). That is why
the content security policy is short — no CORS to open, no third-party script host — and why
`connect-src 'self'` covers every request the client makes. There is no separate static host
to point anything at.

One consequence worth knowing: the SPA's pre-paint script is admitted by a CSP **hash**, so
`apps/web/index.html` and `platform/security-headers.ts` are coupled. Editing that script
without updating the hash makes the browser refuse it silently. `security-headers.test.ts`
recomputes it and fails the build.

**Required in staging and production**, beyond the defaults in
[`.env.example`](.env.example):

| Variable                                    | Why                                                                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                              | Pooled connection for the app                                                                                                               |
| `DIRECT_DATABASE_URL`                       | Direct connection — a transaction pooler cannot run DDL                                                                                     |
| `SESSION_SECRET`                            | 32 bytes minimum                                                                                                                            |
| `ENCRYPTION_KEYS`                           | `id:base64key`, first is active. Holds second factors — platform secret store only, **never in the same backup as the database** (ADR-013). |
| `APP_BASE_URL`                              | Base of every emailed link. Never derived from a request header.                                                                            |
| `COOKIE_SECURE=true` · `TRUST_PROXY_HOPS=1` | Behind Fly's TLS termination                                                                                                                |
| `SMTP_*` · `MAIL_FROM`                      | Password reset and invitations are useless without delivery                                                                                 |

**The worker runs as a second process group from the same image** (M2 session 1). pg-boss is
pinned to the v10 line — v11 and later require Node 22, and this project's baseline is Node 20. Jobs get a `systemContext` with a mandatory reason rather than the raw ids, which is the
same discipline `withBody` enforces on the HTTP side.

## Repository layout

```
apps/api/          Express 5 · Prisma · the platform layer
  src/platform/    context · scope · audit · errors · db · session · crypto · mail
                   · time (district-local dates) · system-context (work with no request)
  src/modules/     admin · auth · governance · notifications · org
  prisma/          schema, migrations, invariant checks, seed
apps/web/          Vite · React 18 · Tailwind v4 · TanStack Query
  src/components/  ui (the whole design system) · Can · layout
  src/features/    auth · dashboard · governance — mirrors the API modules
packages/contracts/  Zod schemas shared by both — the single source of request shapes
docs/              The design baseline, and the build log
```

## Working on a milestone

Each milestone (M0…M10) is built in its own session and handed to the next one entirely
through `docs/`. [`docs/10-Build-Log.md`](docs/10-Build-Log.md) §0 and §0a are the handoff:
where the build is, and what the last milestone changed about how code must be written.

At the end of a milestone, run the **`/close-milestone`** skill
([`.claude/skills/close-milestone/`](.claude/skills/close-milestone/)). It verifies the
build, walks a conformance review over all six axioms, updates every document, and proves
the result:

```bash
npm run docs:check                          # cheap; run it any time
npm run docs:check -- --strict --with-db    # the milestone gate
npm run bundle:check                        # the 250 KB payload budget. Build first.
```

`bundle:check` reads Vite's manifest, walks the entry's static imports, and fails over
**250 KB gzipped of initial JS**. It runs in CI. Routes are split by AUDIENCE rather than by
size: a screen a club secretary opens on a phone is eager, everything else is lazy.

`docs:check` compares the documents against the code: every seeded permission appears in
the API spec and vice versa, every registered route is documented, every error code's
built/designed status is true, the Build Log's code map names every source file that
exists, the test and permission counts are measured rather than asserted, and
`docs/schema.sql` rebuilds to exactly the migrated database. It reports **skip** rather than
**ok** for anything it could not actually check — a green tick that means nothing is worse
than no tick, which this project learned the hard way from a route-walking harness that
passed vacuously for a whole session.

## Contributing

Read [`CLAUDE.md`](CLAUDE.md) first: it holds the six axioms, the non-negotiable rules and
the conventions, and it is short. Then read
[`docs/10-Build-Log.md`](docs/10-Build-Log.md), which describes the system that exists
rather than the one that was designed.

The two things most likely to be got wrong by someone moving fast:

1. **Never add `district_id` to `clubs`.** Affiliation is temporal, through
   `club_district_affiliations`. It will look like an obvious simplification. It destroys
   redistricting history, and D9218 is being formed by a redistricting.
2. **Never serve personal data to an unauthenticated caller.** There is no public
   directory endpoint and there must not be one. The harness will catch you; the point is
   to know why it exists.

## Licence

UNLICENSED. District property.
