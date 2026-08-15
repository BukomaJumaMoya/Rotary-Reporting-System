# 05 — API Specification

## 1. Conventions

**Base:** `/api/v1` · **Format:** JSON · **Auth:** session cookie (`HttpOnly; Secure; SameSite=Lax`)

Every request resolves a **context** before reaching a handler:

```ts
type RequestContext = {
  userId: string;
  personId: string;
  districtId: string;      // from active appointment
  rotaryYearId: string;    // current year, or ?year= override if permitted
  permissions: Set<string>;
  scopes: {
    clubIds: string[];
    clusterIds: string[];
    regionIds: string[];
    committeeIds: string[];
    isDistrictWide: boolean;
  };
  isYearWritable: boolean; // false for a locked year, and under a ?year= override
};
```

One array per org unit an appointment can name, because records are owned at every one of them — `documents.owner_scope_type` and `activities.host_scope_type` take a REGION or a COMMITTEE as readily as a CLUB. They are expanded downwards and keep the unit itself: a region appointment yields the region, its clusters and their clubs. Nothing expands upwards.

`isYearWritable` is false when the district year is locked, and also under a `?year=` override — the permission that opens one is named `year:read:historical`, and a read door must not become a backdating door. Writes through the data access layer are refused with `YEAR_LOCKED`.

Handlers never read `districtId` or `rotaryYearId` from user input. Both come from the context, and the data access layer injects them. A handler that writes `where: { districtId: req.body.districtId }` is a bug, not a feature.

### Standard query parameters

| Param | Applies to | Notes |
|---|---|---|
| `page`, `pageSize` | lists | Default 25, max 100 |
| `sort` | lists | `field:asc` / `field:desc` |
| `q` | searchable lists | Trigram search |
| `year` | most | Rotary Year label; requires `year:read:historical` for past years |
| `clubId`, `clusterId` | scoped lists | Filtered further by caller's own scope |
| `format` | lists | `json` (default), `csv`, `xlsx` |

### Response envelopes

```jsonc
// List
{ "data": [ ... ], "meta": { "page": 1, "pageSize": 25, "total": 87 } }

// Single
{ "data": { ... } }

// Error
{ "error": { "code": "PERIOD_CLOSED", "message": "…", "details": { "deadline": "…" } } }
```

### Status codes

`200` ok · `201` created · `204` no content · `400` validation · `401` unauthenticated · `403` forbidden · `404` not found or out of scope · `409` conflict / idempotent replay · `422` domain rule violation · `429` rate limited · `500` server error

**`404`, not `403`, for out-of-scope records.** Returning `403` confirms a record exists, which leaks the shape of the dataset to anyone probing identifiers.

### Domain error codes

Declared in `apps/api/src/platform/errors.ts`, which is the list that is actually true.

**Built:** `INSUFFICIENT_SCOPE` · `YEAR_LOCKED` · `NOT_FOUND` · `VALIDATION_ERROR` ·
`POSITION_IN_USE` · `POSITION_ALREADY_HELD` · `TEMPLATE_IMMUTABLE` · `UNKNOWN_PERMISSION` ·
`DUPLICATE_CODE` · `INVALID_SCOPE_REFERENCE` · `SCOPE_TYPE_MISMATCH` · `COMMITTEE_TOO_DEEP` ·
`ROLLOVER_NOT_CONFIRMED` · `PERIOD_OPEN` · `RI_ID_ALREADY_CLAIMED` ·
`CLUB_AFFILIATED_ELSEWHERE` · `IDEMPOTENT_REPLAY` · `DUPLICATE_MEMBERSHIP_EVENT` ·
`UNSUPPORTED_MEDIA_TYPE` · `FILE_TOO_LARGE` · `MISSING_REQUIRED_FIELD_FOR_TYPE` ·
`MEMBERSHIP_IMMUTABLE` ·
`AUDIT_IMMUTABLE` · the auth codes in §2.

**Designed, not yet built:** `PERIOD_CLOSED` · `FRAMEWORK_LOCKED` · `TIER_NOT_APPLICABLE` ·
`ASSESSMENT_FINALISED` · `DISPUTE_WINDOW_CLOSED`.

`CLUB_AFFILIATED_ELSEWHERE` deliberately does NOT name the other district. Reading across
the district boundary to write a better error message is exactly the read this system does
not permit itself, and the unique on `(club_id, rotary_year_id)` already knows the answer.

`MEMBERSHIP_IMMUTABLE` and `AUDIT_IMMUTABLE` are mapped from database guard SQLSTATEs
(ADR-012). Prisma 7's driver adapter nests the code two levels deeper than the obvious
place, which is why `sqlStateOf()` reads three candidates.

### Idempotency

`POST` endpoints that create records accept a client-generated UUID in the body as `id`. Re-posting the same `id` returns `409` with the existing resource rather than creating a duplicate. This is what makes offline sync safe (ADR-006).

---

## 2. Authentication

| Method | Path | Notes |
|---|---|---|
| `POST` | `/auth/login` | Rate-limited; lockout with exponential backoff |
| `POST` | `/auth/logout` | Destroys session |
| `GET` | `/auth/me` | Context, permissions, active appointments |
| `POST` | `/auth/password/forgot` | Always `204`, regardless of whether the email exists |
| `POST` | `/auth/password/reset` | Consumes token |
| `POST` | `/auth/invite/accept` | Sets password, records consent |
| `POST` | `/auth/mfa/enrol` | Authenticated. Stages a secret, returns the `otpauth://` URI. Does **not** enable MFA. |
| `POST` | `/auth/mfa/verify` | Confirms enrolment with a code, enables MFA, returns the recovery codes **once** |
| `POST` | `/auth/mfa/disable` | Password + a second factor (code or recovery code) |
| `POST` | `/auth/mfa/recovery-codes` | Password + a second factor. Issues a fresh set, invalidating the old. |

`GET /auth/me` is the client's source of truth for what to render. It must never be the security boundary — every endpoint re-checks server-side.

### Sign-in with a second factor

Login is **one step, attempted twice** — not a half-authenticated session. A session that exists but is not yet trusted is a state every later check must remember to consider, and the one that forgets is an authentication bypass.

1. `POST /auth/login` with email and password.
2. If the account has MFA enabled, the response is `401` with code `MFA_REQUIRED`. **No cookie is issued.**
3. The client prompts for the code and posts the same credentials again with `totpCode`.

A correct password with no code is not a failed attempt — counting it would lock out every member on every sign-in. A *wrong* code is, because six digits is a million possibilities and that is only out of reach while guesses are counted.

Enrolment stores the secret but leaves MFA **off** until a code proves the authenticator works, so a member who loses the QR code mid-setup is not locked out of their own account. Disabling requires the password *and* a current code: a hijacked session alone must not be able to strip the second factor. A member who has lost their authenticator entirely needs an administrator — that path arrives with permissions in M1.

Codes are single use. A code is valid for its 30-second step plus one step either way for clock drift, and `users.mfa_last_used_step` stops it being replayed inside that window.

### Recovery codes

Ten single-use codes are issued when enrolment is confirmed, shown once, and stored only as hashes. One may be sent as `recoveryCode` instead of `totpCode` wherever a second factor is required — including `/auth/mfa/disable`, because requiring the authenticator in order to remove the authenticator is exactly the trap that leaves a member locked out.

`GET /auth/me` reports `mfaRecoveryCodesRemaining` so the client can warn a member who is running low. Disabling MFA deletes the remaining codes with it: a stale printout must not re-enter an account after the factor was deliberately removed.

A member who has lost both the authenticator *and* the codes needs an administrator to clear MFA on their behalf. That endpoint requires permissions and arrives in M1.

**Auth error codes:** `INVALID_CREDENTIALS` · `ACCOUNT_LOCKED` (423, with `retryAfterSeconds`) · `ACCOUNT_NOT_ACTIVE` · `RATE_LIMITED` (429) · `TOKEN_INVALID` · `MFA_REQUIRED` · `MFA_INVALID` · `MFA_ALREADY_ENABLED` · `MFA_NOT_ENROLLED`

---

## 3. Organisation

**Built in M2 session 3**, except the two rows marked otherwise.

| Method | Path | Permission |
|---|---|---|
| `GET` | `/clubs` | `club:read:district` — `?tier=`, `?baseType=`, `?status=`, `?clusterId=`, `?q=` |
| `GET` | `/clubs/:id` | `club:read:district` |
| `POST` | `/clubs` | `club:create:district` — idempotent on a client-supplied `id` |
| `PATCH` | `/clubs/:id` | `club:update:own` **or** `club:update:district` |
| `GET` | `/clubs/:id/summary` | `club:read:district` — activity, roster, dues, score in one call |
| `POST` | `/clubs/:id/affiliations` | `club:affiliate:district` |
| `GET` | `/clusters` · `GET` `/clusters/:id` | `club:read:district` |
| `POST` | `/clusters` · `PATCH` `/clusters/:id` | `cluster:manage:district` |
| `POST` | `/clusters/:id/clubs` | `cluster:manage:district` — replaces the WHOLE membership |
| `GET` | `/regions` | `club:read:district` |
| `GET` | `/years` · `GET` `/years/current` | authenticated — **not built** |
| `POST` | `/admin/rollover` | `year:rollover:district` — **built in M1**; `dryRun` is required, not defaulted |

**A club has no `district_id`.** Every read above reaches clubs through a join on
`club_district_affiliations (district_id, rotary_year_id)`, written once in
`modules/org/clubs.repository.ts`. A club affiliated elsewhere answers `404`, exactly as one
that does not exist — and `tier`, `isConfirmed` and the cluster placement are all fields of
the AFFILIATION rather than of the club.

Cluster READS sit behind `club:read:district` rather than behind a cluster-read permission of
their own. The club directory filters by cluster, so everyone who can read clubs needs the
cluster list, and a permission held by exactly the same people as another only adds a row to
the matrix. Writes need `cluster:manage:district`.

`GET /clubs/:id/summary` exists specifically to avoid the mobile client making six round trips to render a club page. Design for the network, not for REST purity. `dues` and `score` are `null` until M4 and M5 fill them; their shape is fixed now so the client is not rewritten.

---

## 4. People and governance

**Built in M2 session 5** — the people surface, with one serialiser behind all of it:

| Method | Path | Permission |
|---|---|---|
| `GET` | `/persons` | `person:read:club` — scoped through `club_rosters`; `?q=`, `?clubId=` |
| `GET` | `/persons/:id` | `person:read:club` — 404 outside the caller's scope |
| `POST` | `/persons` | `person:create:club` |
| `PATCH` | `/persons/:id` | own record, or `person:update:club` within scope |
| `GET` `PATCH` | `/persons/:id/visibility` | **OWN RECORD ONLY.** No permission overrides it. |
| `GET` | `/persons/me/visibility` | the caller's own, without knowing their person id |
| `GET` | `/persons/:id/export` | own record only — subject access. No administrative version. |
| `POST` | `/persons/:id/erasure` | own record; queues for review |
| `GET` | `/erasure-requests` | `person:erase:district` |
| `POST` | `/erasure-requests/:id/review` | `person:erase:district` — approving QUEUES the job |

**Contact fields are ABSENT, not null**, when the caller may not see them. A field that is
always present and sometimes empty is one a client renders as a blank line and a developer
later assumes is nullable in the database; absence says "not for you" and cannot be mistaken
for "not set". `isRedacted` tells the client something was withheld, so it can say so.

Three ways to see contact details and only three: you are the person; you hold
`person:read:contact` and are district-wide; or you hold it and one of that person's clubs
is in your scope. That last is what makes the permission safe to give a club secretary.

**One serialiser, used by every endpoint that returns a person — including the nested ones**
inside activities, rosters, attendees and appointments. Contact data leaks through relations,
not through the endpoint anybody reviews. The audit endpoint deliberately does NOT use it: it
redacts contact values unconditionally, because the log answers "who changed what and when"
and the old phone number is not part of that answer.

**Erasure ANONYMISES rather than deletes.** `membership_events` is append-only and a club's
retention rate for a past year must not change retroactively because a member left.

**Built in M1** — the governance surface, as it exists:

| Method | Path | Permission |
|---|---|---|
| `GET` | `/persons` | `person:read:club` — **NAMES ONLY**, for pickers. Scoped through `club_rosters`. |
| `GET` | `/permissions` | `position:manage:district` — reference list, read-only |
| `GET` | `/positions` · `/positions/:id` | `appointment:read:district` — `?scope=`, `?isActive=`, `?includeTemplates=` |
| `POST` `PATCH` `DELETE` | `/positions` · `/positions/:id` | `position:manage:district`. DELETE is soft. |
| `PUT` | `/positions/:id/permissions` | `position:manage:district` — replaces the WHOLE set, atomically |
| `GET` | `/appointments` · `/appointments/:id` | `appointment:read:district` |
| `POST` `PATCH` `DELETE` | `/appointments` · `/appointments/:id` | `appointment:manage:district`. DELETE is soft. |
| `GET` | `/persons/:id/appointments` | own record, or `appointment:read:district` |
| `GET` | `/committees` · `/committees/:id` | any signed-in member — `?tree=true`, `?parentId=` |
| `POST` `PATCH` | `/committees` · `/committees/:id` | `committee:manage:district` **or chairing that subtree** |
| `GET` `POST` `DELETE` | `/committees/:id/members[/:appointmentId]` | as above. Adds an APPOINTMENT, not a person. |
| `GET` `POST` | `/invitations` · `/invitations/:id/resend` | `person:invite:district`, or `person:invite:club` for your own roster |
| `POST` | `/users/:id/mfa/reset` | `user:manage:district` — audited, and the member is notified |
| `GET` | `/audit` | `audit:read:district` — contact values redacted from every diff |
| `POST` | `/admin/rollover` | `year:rollover:district` — `dryRun` is REQUIRED |

`GET /persons` used to live in the governance router, returning names only. It moved to
`modules/people` in M2 session 5 — two routers cannot both answer `/persons`, Express matches
in mount order, and the one that never ran would have been the one with the visibility rules
in it. The pickers now read the same endpoint as everything else and simply get names,
because contact fields are absent unless the caller may see them.

**There is no unauthenticated person endpoint.** Not a reduced one, not a name-only one. If a public directory is ever wanted, it becomes a separate, explicitly-designed, opt-in surface with its own review — not a permission relaxation on this route.

---

## 5. Membership

**Built in M2 session 6.**

| Method | Path | Permission |
|---|---|---|
| `GET` | `/membership/events` | `membership:read:club` — `?clubId=`, `?personId=`, `?eventType=`, `?from=`, `?to=` |
| `POST` | `/membership/events` | `membership:write:club` — append-only; idempotent on a client UUID |
| `POST` | `/membership/events/:id/correct` | `membership:write:club` — appends an event superseding the original |
| `GET` | `/membership/roster` | `membership:read:club` — `?clubId=&asOf=`; `asOf` reconstructs from the log |
| `GET` | `/membership/stats` | `membership:read:club` — opening, joiners, leavers, net, retention, transitions |
| `GET` | `/membership/transitions` | `membership:read:club` — `?corroborated=true|false` |
| `POST` | `/membership/transitions/:id/corroborate` | `membership:write:club` — receiving-side confirmation |

**There is no `PUT` and no `DELETE`, and the absence is the design.** The database enforces
it: `membership_events_no_mutate` raises SQLSTATE DIS01 → `MEMBERSHIP_IMMUTABLE`, so a route
added later that tried to update one is refused rather than silently rewriting a club's
history. `corroborated_at` is the single column the guard lets through, because corroborating
a transition necessarily happens after the event was recorded.

**Corrections come in two shapes.** To fix a FACT, append the corrected event with its real
type — a mistyped join date is a second `JOIN` carrying the right one. To RETRACT a fact,
append an event of type `CORRECTION`. Either way the original row stays.

**A replayed create answers `200`, not `409`.** The client generated the id precisely so a
retry would be safe; making it distinguish "created" from "already created" puts the burden
back on exactly the connection that caused the retry. Two events with the same person, club,
type and date and NO id are a double-tap: `DUPLICATE_MEMBERSHIP_EVENT`.

**`?asOf=` reconstructs from the event log, not from `club_rosters`.** The view is today.
"Who were we in March" is the question a disputed scorecard turns on.

## 6. Activities

| Method | Path | Notes |
|---|---|---|
| `GET` | `/activity-types` | `activity:read:club` — grouped by category. Drives dynamic form rendering. **Built M2 s8** |
| `GET` | `/activity-types/flat` · `/activity-types/:id` | `activity:read:club` — the flat list, for the admin screen |
| `POST` `PATCH` | `/activity-types` · `/activity-types/:id` | `activitytype:manage:district`. **Built M2 s8** |
| `GET` | `/activities` | Filter: type, category, host, status, verification, date range |
| `POST` | `/activities` | Validated against type config; idempotent |
| `PATCH` | `/activities/:id` | Blocked once period closed |
| `DELETE` | `/activities/:id` | Soft delete |
| `POST` | `/activities/:id/media` | Multipart; server resizes, strips EXIF |
| `POST` | `/activities/:id/partners` | |
| `POST` | `/activities/:id/attendees` | Bulk |
| `POST` | `/activities/:id/verify` | `activity:verify:district` — sets VERIFIED / QUERIED / REJECTED |
| `GET` | `/activities/calendar` | Month view for planning |

`GET /activity-types` is the contract between configuration and UI: the client renders whatever fields the type declares. Adding an activity type never requires a client release.

`field_config` is `{ fields: [{ key, label, type, required, options?, helpText? }] }` — an
OBJECT rather than a bare array, so the format can gain a sibling key later without every
stored row needing a migration. Five field kinds and no more: every addition is a thing the
renderer, the validator and the builder UI must all agree about, and "just one more field
kind" is how a configuration format becomes a programming language. `code` is immutable
after creation, and a shared template answers `TEMPLATE_IMMUTABLE` on any write.

**Media.** Uploads are multipart, capped at 10MB while reading, and their content type is
decided by MAGIC BYTES — never the extension, never the `Content-Type` header, both of which
are attacker-supplied strings. The database stores storage KEYS, never URLs, so the provider
or CDN can change without a data migration; reads are short-lived signed URLs. A pg-boss job
produces a 400px thumbnail and a 1200px display variant in WebP and **strips every piece of
metadata**, because phone photographs carry GPS and this system exists partly to correct a
predecessor that published members' locations.

---

## 7. Finance

| Method | Path |
|---|---|
| `GET` `POST` `PATCH` | `/budgets`, `/budgets/:id/lines` |
| `GET` `POST` | `/transactions` |
| `GET` | `/finance/summary` — income, expenditure, variance vs budget |
| `GET` `POST` | `/dues/invoices` |
| `POST` | `/dues/invoices/:id/payments` |
| `GET` | `/dues/status` — district-wide: unpaid / partial / paid by club |
| `GET` `POST` | `/member-dues` — includes prepayment |
| `GET` `POST` | `/trf/contributions` |
| `POST` | `/trf/contributions/:id/verify` |
| `GET` | `/trf/summary` — by club, by fund type, cumulative |

---

## 8. Assessment

| Method | Path | Permission |
|---|---|---|
| `GET` `POST` | `/assessment/frameworks` | `framework:manage:district` |
| `POST` | `/assessment/frameworks/:id/clone` | Clone last year as a starting point |
| `POST` | `/assessment/frameworks/:id/publish` | Validates parameter totals |
| `GET` `POST` `PATCH` `DELETE` | `/assessment/parameters`, `/assessment/criteria` | DRAFT only |
| `POST` | `/assessment/criteria/:id/preview` | **Dry-run a rule against historical data** |
| `GET` | `/assessment/resolvers` | Registry: keys, descriptions, required config |
| `GET` `POST` | `/assessment/periods` | |
| `POST` | `/assessment/periods/:id/open` · `/close` | |
| `GET` `POST` | `/assessment/assessors` | Assign parameters to assessors |
| `GET` | `/assessment/clubs` | Standings, filterable by tier and parameter |
| `GET` | `/assessment/clubs/:clubId` | Full scorecard with per-criterion evidence |
| `POST` | `/assessment/clubs/:clubId/recompute` | On-demand |
| `PUT` | `/assessment/scores/:id` | Assessor scoring |
| `POST` | `/assessment/clubs/:clubId/finalise` | `assessment:finalise:district` |
| `GET` `POST` | `/assessment/comments` | Improvement or commendation |
| `GET` `POST` | `/assessment/disputes` · `POST /:id/resolve` | |
| `GET` | `/assessment/standings` | `?tier=&parameter=` — award adjudication |

`POST /assessment/criteria/:id/preview` deserves emphasis. It lets the PIME Chair see what a rule would have scored last year *before* publishing it. Without it, a badly calibrated criterion is discovered in month four, when it is too late to change without unfairness.

---

## 9. Goals, exports, admin

| Method | Path |
|---|---|
| `GET` `POST` `PATCH` | `/goals` |
| `GET` | `/goals/progress` — actual vs target vs trend |
| `POST` | `/goals/:id/snapshot` — manual entry where no resolver exists |
| `GET` | `/dashboard/district` — goals, standings, alerts |
| `GET` | `/dashboard/club/:id` |
| `GET` | `/alerts` — no activity 30d, dues unpaid, score below threshold, docs expiring |
| `POST` | `/exports` — queues a job |
| `GET` | `/exports/:id` — status and signed download URL |
| `GET` | `/audit` — `audit:read:district` |
| `GET` `POST` | `/notifications/templates` |
| `GET` | `/admin/health` — public liveness only, no data |

Every list endpoint accepts `?format=xlsx`, which queues an export job for large result sets rather than blocking the request. The district's own complaint — *"can I download a report for all clubs on something?"* — is satisfied globally by one convention rather than by twenty bespoke report screens.

---

## 10. Authorisation matrix (abbreviated)

| Permission | Club Sec | Club Treas | President | ADRR | Assessor | PIME | DES | DRR |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `activity:create:club` | ✓ | ✓ | ✓ | — | — | — | — | — |
| `activity:verify:district` | — | — | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `membership:write:club` | ✓ | — | ✓ | — | — | — | — | — |
| `finance:write:club` | — | ✓ | — | — | — | — | — | — |
| `finance:read:club` | ✓ | ✓ | ✓ | — | — | — | ✓ | ✓ |
| `dues:manage:district` | — | — | — | — | — | — | — | ✓ |
| `assessment:score:assigned` | — | — | — | ✓ | ✓ | ✓ | — | — |
| `assessment:finalise:district` | — | — | — | — | — | ✓ | — | ✓ |
| `framework:manage:district` | — | — | — | — | — | ✓ | — | — |
| `appointment:manage:district` | — | — | — | — | — | — | ✓ | ✓ |
| `year:rollover:district` | — | — | — | — | — | — | ✓ | — |
| `export:data:scope` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `audit:read:district` | — | — | — | — | — | ✓ | ✓ | ✓ |

`finance:read:club` for the secretary is deliberate — it fixes the district's logged complaint that secretaries could see collections but not expenditure.

**Permissions added in M1**, all seeded and wired onto the slate:

| Permission | Held by | Why it exists |
|---|---|---|
| `person:invite:district` | DES, DRR | Invite anyone in the district |
| `person:invite:club` | Club Secretary | Invite **only people on your own club's roster** — which is what makes it safe to give a secretary |
| `user:manage:district` | DES | Reset a member's second factor when they have lost both the authenticator and the codes |
| `appointment:read:district` | most district roles | Read appointments and the positions catalogue |
| `club:read:district` · `person:read:club` · `membership:read:club` · `activity:read:club` · `assessment:read:club` | broadly | The read half of each resource, separated from its write half |

**Permissions added in M2:**

| Permission | Held by | Why it exists |
|---|---|---|
| `club:update:district` | DRR, DES | The other half of `club:update:own`. A district officer correcting a club's RI ID needs a door that is not "be a member of that club" — and `club:update:own` is bounded by the caller's own appointments, which is precisely what makes it safe to give a secretary. |

**This matrix is a starting position, not a definition.** It is seeded as
`position_permissions` rows by `prisma/seed/reference.ts`, and the DES edits it through
`/admin/positions` without a deployment — which is the whole reason positions are data.

Codes are matched EXACTLY at authorisation time. There is no wildcard: `club:read:*` above
is shorthand for this document, and a matcher that expanded it would turn a typo in a
seeded row into a silent grant.