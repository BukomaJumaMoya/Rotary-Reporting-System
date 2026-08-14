# 02 — System Architecture

## 1. Architectural style

**A modular monolith on PERN, deployed as two processes and one database.**

This is a deliberate choice, not a default. With one part-time developer, every additional deployable unit is a tax paid daily — separate logs, separate deploys, separate failure modes, distributed debugging. Microservices would be self-harm at this scale. What matters instead is *internal* modularity: strict boundaries between modules inside one codebase, so that if the system ever does need splitting, the seams already exist.

```
┌───────────────────────────────────────────────────────────────┐
│  CLIENT — React 18 + Vite + TypeScript, PWA                   │
│  IndexedDB offline queue · Service Worker · TanStack Query    │
└──────────────────────────┬────────────────────────────────────┘
                           │ HTTPS / JSON · session cookie
┌──────────────────────────▼────────────────────────────────────┐
│  API — Node 20 + Express 5 + TypeScript                       │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ HTTP layer: routing · validation (Zod) · error mapping   │  │
│  ├─────────────────────────────────────────────────────────┤  │
│  │ Authorisation: appointment-derived permission middleware │  │
│  ├─────────────────────────────────────────────────────────┤  │
│  │ Modules (strict boundaries, service-to-service only):    │  │
│  │  org · people · membership · activity · finance          │  │
│  │  assessment · goals · documents · notifications          │  │
│  │  exports · audit · admin                                 │  │
│  ├─────────────────────────────────────────────────────────┤  │
│  │ Data access: Prisma (CRUD) + raw SQL (analytics)         │  │
│  │ Year scoping + district scoping enforced HERE            │  │
│  └─────────────────────────────────────────────────────────┘  │
└────────┬───────────────────────┬──────────────────┬───────────┘
         │                       │                  │
┌────────▼────────┐   ┌──────────▼────────┐  ┌──────▼──────────┐
│  PostgreSQL 16  │   │  Object storage   │  │ Worker process  │
│  app data       │   │  S3-compatible    │  │ pg-boss queue   │
│  sessions       │   │  media + docs     │  │ scoring · mail  │
│  pg-boss queue  │   │  + CDN            │  │ snapshots       │
└─────────────────┘   └───────────────────┘  └─────────────────┘
```

Two processes: `api` (HTTP) and `worker` (jobs). One database. One bucket.

---

## 2. Technology decisions

Each decision is recorded with its reasoning, because in eighteen months you will not remember why, and neither will your successor.

### ADR-001 — PostgreSQL 16 as the only datastore
**Decision.** Postgres holds application data, sessions, and the job queue. No Redis, no separate search service.
**Why.** One managed service to pay for, monitor and back up. Postgres does JSONB (rule definitions, evidence payloads, audit diffs), full-text search (adequate for member and club lookup at this scale), materialised views (derived rosters, standings), and via `pg-boss` a perfectly good job queue. Introducing Redis buys queue throughput this system will never need, at the cost of a second stateful service.
**Reconsider when.** Sustained job throughput exceeds a few hundred per second, or search quality becomes a real complaint.

### ADR-002 — Prisma for CRUD, raw SQL for analytics
**Decision.** Prisma is the ORM and owns migrations. The assessment engine's metric resolvers and all reporting aggregations are hand-written SQL executed through `$queryRaw` with parameter binding.
**Why.** Prisma's type generation and migration tooling are a large productivity gain for a solo developer, and its generated types are the single best thing you can give Claude Code — the model becomes the contract. But ORMs are poor at the multi-table, windowed, date-bounded aggregation the scoring engine is made of, and fighting a query builder for those is a waste of your evenings. Write the SQL. Test it.
**Consequence.** Two data access idioms in one codebase. Acceptable, but the boundary must be explicit: resolvers live only in `modules/assessment/resolvers/`, nothing else uses raw SQL.

### ADR-003 — Session cookies, not JWT
**Decision.** Server-side sessions in Postgres via `express-session` + `connect-pg-simple`. HttpOnly, Secure, SameSite=Lax.
**Why.** Permissions in this system change mid-year — appointments are created and revoked, roles are reassigned after resignations. A stateless JWT cannot be revoked, so a removed officer keeps access until expiry. That is unacceptable for a system holding member data and deciding awards. Sessions are revocable instantly, simpler to reason about, and immune to the token-storage-in-the-browser class of mistakes.
**Consequence.** Horizontal scaling requires shared session state — which Postgres already provides.

### ADR-004 — UUID primary keys on externally addressable entities
**Decision.** `uuid` primary keys generated with `gen_random_uuid()` for every entity whose identifier appears in a URL. Pure join tables may use composite keys.
**Why.** Directly remediates the enumeration weakness identified in the incumbent system, where sequential integer IDs plus unauthenticated reads made the full dataset trivially harvestable. Also makes offline-created records safe: the client generates the ID, so sync is idempotent and there is no server round-trip for identity.
**Consequence.** Slightly larger indexes. Irrelevant at this scale.

### ADR-005 — React + Vite, no meta-framework
**Decision.** Plain React SPA on Vite. Not Next.js, not Remix.
**Why.** The application is entirely behind authentication — there is no SEO surface and nothing to server-render. A meta-framework would add a rendering model, a server runtime and a deployment target for zero benefit here. Vite gives the fastest possible feedback loop, which for a solo developer working evenings is the resource that actually matters. It also keeps the PWA and offline story simple, because there is exactly one place state lives.
**Consequence.** No SSR. Accepted deliberately.

### ADR-006 — Offline-first submission via IndexedDB queue
**Decision.** Report submissions are written to an IndexedDB outbox and drained by a service worker background sync. The UI treats a queued submission as successful.
**Why.** Upcountry clubs report from places with unreliable connectivity, and a submission lost to a dropped connection is a club that stops using the system. Client-generated UUIDs (ADR-004) make retry idempotent.
**Scope discipline.** Offline *writes* only, for activities and membership events. Not full offline read replication — that is a large project on its own and is not what users need.

### ADR-007 — S3-compatible object storage with a CDN, never the app filesystem
**Decision.** Media and documents in Cloudflare R2 (or Backblaze B2). Server-side processing with `sharp`: resize to a 400 px thumbnail and a 1200 px display variant, convert to WebP, strip EXIF. Private documents served via short-lived signed URLs.
**Why.** Application filesystems do not survive redeployment, cannot be backed up coherently with the database, and cannot serve media efficiently. EXIF stripping matters specifically because phone photographs carry GPS coordinates, and publishing members' locations is exactly the failure being corrected. R2 has no egress fees, which matters when serving images to thousands of mobile users.

### ADR-008 — pg-boss for background jobs
**Decision.** Postgres-backed queue, run in a separate `worker` process.
**Why.** Nightly assessment recomputation, goal snapshots, notification delivery and export generation must not block HTTP requests. pg-boss provides scheduling, retries, dead-letter handling and cron — with no new infrastructure. A separate process means a runaway scoring job cannot take down the API.

### ADR-009 — Zod for validation, shared client and server
**Decision.** Zod schemas in a shared `packages/contracts` workspace, imported by both.
**Why.** One definition of every request shape, used for server validation, client form validation and TypeScript types. Eliminates the drift between client and server expectations that produces most of the bugs in a form-heavy application. Also the highest-leverage thing you can do for Claude Code: the contract is machine-readable and unambiguous.

### ADR-010 — Multi-tenant schema, single tenant in production
**Decision.** `district_id` on every tenant-scoped table from the first migration, enforced by a data access layer that requires an explicit district context. Postgres Row-Level Security as a defence-in-depth backstop.
**Why.** This is the decision that cannot be cheaply reversed. Retrofitting tenancy means touching every table, every query and every test. Adding it now costs one column and one middleware. **But tenant *features* — per-district branding, tenant admin consoles, configurable everything — are explicitly deferred until a second district actually signs.** Isolation now; features never, until paid for.

### ADR-013 — Application-level encryption for secrets, keys in the platform store
**Decision.** Values that the database must hold but must not yield if it leaks are encrypted by the application before they are stored, with AES-256-GCM (`apps/api/src/platform/crypto.ts`). Today that is TOTP shared secrets; document storage keys and any future API credentials belong here too. Keys are supplied as `ENCRYPTION_KEYS`, a comma-separated list of `id:base64key` pairs of which the first is active.

**Why.** "Encrypted at rest" means nothing without saying where the key is. Disk encryption on a managed database protects against a stolen disk and nothing else — a leaked dump, a stolen backup, or read-only SQL injection all hand over plaintext. The key therefore lives in the hosting platform's secret store: not in the database, not in the repository, and **not in the same backup as the ciphertext**. That separation is the entire control.

A second factor stored in clear beside the password hash defeats the purpose of having one — an attacker with the dump has the account the moment the password is guessed or reused.

**How rotation works.** Every ciphertext names the key that produced it (`keyId.iv.ciphertext.tag`). To rotate: prepend a new pair, deploy, re-encrypt at leisure, then drop the old pair. A value encrypted under a key that has been retired too early fails loudly rather than returning rubbish.

**Additional authenticated data** binds each ciphertext to where it belongs — an MFA secret to its user id — so a row copied onto another account fails to decrypt instead of granting that member's second factor.

**Consequence.** Losing every copy of a key means the affected members re-enrol. That is acceptable precisely because this mechanism holds second factors and recoverable credentials, never the only copy of member records. Anything whose loss would be unrecoverable must not be encrypted this way without a key escrow decision first.

### ADR-012 — Where an invariant lives
**Decision.** Every rule the data must obey is placed by a three-tier test, applied in order:

1. **Declarative constraint** — `NOT NULL`, `CHECK`, `UNIQUE`, foreign keys, partial indexes, generated columns. If the rule can be expressed this way, it is, always.
2. **Derived state is a view, never a stored column.** No trigger maintains a denormalised value. If a number can be computed from other rows, it is computed — `dues_invoice_states`, `member_dues_states`, `club_rosters`.
3. **A trigger only as a guard.** Reserved for invariants that no writer may violate and that tiers 1 and 2 cannot express. Each guard raises a stable `SQLSTATE`, appears in the guard registry below, and has a conformance test that attempts the violation and asserts the failure.

Everything else — workflow, authorisation, orchestration, anything needing to know *who* or *why* — is application code, in the owning module's service.

**Why.** A trigger that maintains a column creates two failures at once. The ORM presents a writable field that the database silently overwrites, so `prisma.duesInvoice.update({ status })` appears to work and does nothing. And the rule is invisible: someone reading `schema.prisma` sees a column, not a mechanism. Derived state as a view has neither problem — the column does not exist, so it cannot be written, and the derivation is one definition instead of a trigger plus a backfill plus a nightly reconciliation job to catch the drift.

Guards are a different kind of thing and the distinction is worth holding. A guard protects against *the application being wrong*, which is precisely what cannot be done from inside the application. Append-only means append-only even when a future developer, a migration script, or an operator at 2am has a good reason.

There is a third benefit specific to this system. A stored status answers "is this club paid up *now*". A view answers "was this club paid up *at the close of the March period*", which is the question the assessment engine actually asks. Stored derived state cannot be asked about the past.

**Guard registry.** Every database-side guard, its SQLSTATE, and its domain error code:

| Guard | Table | SQLSTATE | Domain code |
|---|---|---|---|
| `membership_events_no_mutate` | `membership_events` | `DIS01` | `MEMBERSHIP_IMMUTABLE` |
| `audit_log_no_mutate` | `audit_log` | `DIS02` | `AUDIT_IMMUTABLE` |
| `persons_visibility_ins` | `persons` | — (inserts, never raises) | — |

`platform/errors` maps SQLSTATE to the domain code so a guard violation arrives at the client as `{ error: { code: "MEMBERSHIP_IMMUTABLE", … } }` rather than a driver exception.

**Consequence.** Reads of derived state join. At 140 clubs and a few thousand members this is not measurable; if a view ever becomes hot, it can be materialised behind the same name without changing a caller. Adding a guard requires amending this ADR and writing its conformance test — deliberately more friction than adding a service function.

### ADR-011 — Deployment
**Decision.** Application on Fly.io or Railway; database on Neon or Supabase; storage on R2. Europe or nearest available region to East Africa.
**Why.** Managed Postgres with point-in-time recovery and automated backups is worth far more than the saving from self-hosting, and a solo maintainer must not also be a DBA. Target cost at launch scale is under USD 30/month, which the district can absorb or a corporate partner can sponsor.
**Non-negotiable.** All accounts under a district-owned identity with two administrators. Not your personal account. This is the specific failure the project exists to correct — do not reproduce it.

---

## 3. Module boundaries

Modules communicate through exported service functions only. No module imports another's repository, and no module reaches into another's tables directly.

| Module | Owns | Exposes |
|---|---|---|
| `org` | districts, clubs, clusters, affiliations, rotary years | club lookup, year context, tier calculation |
| `people` | persons, users, consent, visibility | person lookup, authentication |
| `governance` | positions, permissions, appointments, committees | permission resolution for a user in a year |
| `membership` | membership events, derived rosters | roster at date, joiners/leavers, retention, transitions |
| `activity` | activity types, activities, media, partners, attendance | activity counts and aggregates by club/type/period |
| `finance` | budgets, transactions, dues, TRF | financial aggregates, dues status |
| `assessment` | frameworks, criteria, periods, scores, comments, disputes | scorecards, standings |
| `goals` | district and club goals, snapshots | goal progress |
| `documents` | uploads, verification | document status by club |
| `notifications` | templates, queue, delivery log | enqueue |
| `exports` | CSV/XLSX generation | export job |
| `audit` | audit log | record, query |

**The dependency rule.** `assessment` may call `activity`, `membership`, `finance` and `org`. Those modules must never call `assessment`. Dependencies point one way — downstream toward the scoring engine, never back. When a criterion needs a number no module exposes, the answer is to add a service function to the owning module, not to reach across the boundary.

---

## 4. Cross-cutting design

### 4.1 Year and district scoping

The single highest-value piece of infrastructure in the codebase.

Every request establishes a **context** — `{ districtId, rotaryYearId, userId, permissions }` — resolved once by middleware from the session and an optional year override. The data access layer requires this context and injects both scopes into every query. Individual route handlers never write `where: { rotaryYearId }` by hand.

This is what makes axiom 1 real rather than aspirational. Left to individual queries, year scoping will be forgotten in roughly one handler in eight — which is precisely how the incumbent system arrived at "don't show flyers that are in 2037."

### 4.2 Authorisation

```
request → session → user → active appointments (current year)
       → positions → permission set → policy check → allow/deny
```

Permissions are `resource:action:scope` — for example `activity:create:club`, `assessment:finalise:district`. Scope determines *which* records, not merely whether the action is allowed: a club secretary holding `activity:create:club` may create activities only for the club of their own appointment.

Authorisation is enforced **server-side, per record**. Client-side hiding of controls is presentation only and is never the security boundary. Every endpoint returning personal data is checked. There are no exceptions to this and no "internal" endpoints.

### 4.3 Year rollover

The riskiest operation in the system, so it is designed defensively: a job that runs in dry-run mode by default, produces a diff report for review, and only executes on explicit confirmation. Locking a year sets `is_locked`, after which the data access layer rejects writes to that year's rows. Reads are never restricted.

### 4.4 Audit

A single `audit_log` table, written by a Prisma middleware that captures actor, entity, action, and before/after JSONB diffs on all governed entities. Append-only; no update or delete path exists in application code. Retention indefinite.

### 4.5 Error model

One error shape everywhere:

```json
{ "error": { "code": "PERIOD_CLOSED", "message": "…", "details": {} } }
```

Domain errors carry stable machine-readable codes; the client maps codes to messages. Never leak stack traces, SQL, or internal identifiers to a client.

---

## 5. Environments

| Environment | Purpose | Data |
|---|---|---|
| `local` | Development | Seeded synthetic data — **never a production dump** |
| `staging` | Pilot and pre-release verification | Anonymised or synthetic |
| `production` | Live | Real |

Production data must never be copied to a developer machine. If you need realistic volume, generate it. This rule exists because the alternative is a laptop containing the personal data of three thousand people.

---

## 6. Repository layout

```
rotaract-dis/
├── CLAUDE.md
├── docs/                       ← this package
├── packages/
│   └── contracts/              ← Zod schemas + shared types
├── apps/
│   ├── api/
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── migrations/
│   │   │   └── seed.ts
│   │   └── src/
│   │       ├── modules/        ← one directory per module
│   │       ├── platform/       ← context, auth, audit, errors, storage
│   │       ├── jobs/           ← pg-boss workers
│   │       └── server.ts
│   └── web/
│       └── src/
│           ├── features/       ← mirrors API modules
│           ├── components/
│           ├── lib/            ← api client, offline queue, auth
│           └── main.tsx
└── .github/workflows/
```

Client `features/` mirror server `modules/` deliberately. When you change activity reporting, both halves are in the place you expect.