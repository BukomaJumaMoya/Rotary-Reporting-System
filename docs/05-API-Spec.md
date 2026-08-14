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

`PERIOD_CLOSED` · `YEAR_LOCKED` · `FRAMEWORK_LOCKED` · `TIER_NOT_APPLICABLE` · `DUPLICATE_MEMBERSHIP_EVENT` · `MISSING_REQUIRED_FIELD_FOR_TYPE` · `ASSESSMENT_FINALISED` · `DISPUTE_WINDOW_CLOSED` · `RI_ID_ALREADY_CLAIMED` · `INSUFFICIENT_SCOPE`

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

| Method | Path | Permission |
|---|---|---|
| `GET` | `/clubs` | `club:read:*` |
| `GET` | `/clubs/:id` | `club:read:*` |
| `POST` | `/clubs` | `club:create:district` |
| `PATCH` | `/clubs/:id` | `club:update:own` or `:district` |
| `GET` | `/clubs/:id/summary` | `club:read:*` — activity, roster, dues, score in one call |
| `POST` | `/clubs/:id/affiliations` | `club:affiliate:district` |
| `GET` | `/clusters` · `POST` `/clusters` | `cluster:read/manage:district` |
| `POST` | `/clusters/:id/clubs` | `cluster:manage:district` |
| `GET` | `/years` · `GET` `/years/current` | authenticated |
| `POST` | `/admin/rollover` | `year:rollover:district` — supports `{ dryRun }` |

`GET /clubs/:id/summary` exists specifically to avoid the mobile client making six round trips to render a club page. Design for the network, not for REST purity.

---

## 4. People and governance

| Method | Path | Permission |
|---|---|---|
| `GET` | `/persons` | `person:read:club` or wider — **returns contact fields only where visibility allows** |
| `GET` | `/persons/:id` | scope-checked |
| `POST` | `/persons` | `person:create:club` |
| `PATCH` | `/persons/:id` | own record, or `person:update:club` |
| `PATCH` | `/persons/:id/visibility` | own record only |
| `GET` | `/persons/:id/export` | own record only — subject access request |
| `POST` | `/persons/:id/erasure` | own record; queues review |
| `GET` | `/positions` · `POST` · `PATCH` | `position:manage:district` |
| `GET` | `/appointments` | `appointment:read:*` |
| `POST` | `/appointments` · `DELETE` | `appointment:manage:district` or committee chair for own sub-committee |
| `GET` | `/committees` · `POST` · `POST /committees/:id/members` | `committee:manage:district` / chair |

**There is no unauthenticated person endpoint.** Not a reduced one, not a name-only one. If a public directory is ever wanted, it becomes a separate, explicitly-designed, opt-in surface with its own review — not a permission relaxation on this route.

---

## 5. Membership

| Method | Path | Notes |
|---|---|---|
| `GET` | `/membership/events` | Filter by club, person, type, date range |
| `POST` | `/membership/events` | Append-only; idempotent on client UUID |
| `POST` | `/membership/events/:id/correct` | Creates a `CORRECTION` superseding the original |
| `GET` | `/membership/roster` | `?clubId=&asOf=` — derived, supports historical dates |
| `GET` | `/membership/stats` | Opening, joiners, leavers, net, retention %, transitions |
| `GET` | `/membership/transitions` | Transitions to Rotary with corroboration state |
| `POST` | `/membership/transitions/:id/corroborate` | Receiving-side confirmation |

There is no `PUT` or `DELETE` on events. The absence is the design.

---

## 6. Activities

| Method | Path | Notes |
|---|---|---|
| `GET` | `/activity-types` | Drives dynamic form rendering |
| `POST` | `/activity-types` · `PATCH` | `activitytype:manage:district` |
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

Seed this matrix as `position_permissions` rows in `prisma/seed.ts`. It is configuration, and the DES can change it without a deployment.