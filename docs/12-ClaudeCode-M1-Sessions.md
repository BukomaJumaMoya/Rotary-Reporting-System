# Claude Code — M1 Governance Core (revised for v1.6)

**Supersedes the earlier M1 document.** Revised against the M0 build log and
`Build-Conventions-v1.6.md`. Every prompt below assumes the conventions in that file.

**Goal:** access derives entirely from appointments, the district can be administered
through a browser, and the year can roll over safely.

**Seven sessions.** Session 3 is the app shell — placed mid-milestone so you have something
visible early, and so every module after it lands somewhere real instead of being tested
with curl.

**Start every session by pasting this preamble**, then the session body:

```
Read, in this order: CLAUDE.md, docs/10-Build-Log.md, and
docs/Build-Conventions-v1.6.md. Then the documents the session names.

Constraints that apply to everything you write:
- Scoped models are reachable only through db(ctx). prisma.<scopedModel> does
  not exist. No findUnique / update / delete / upsert on scoped delegates —
  use findFirst, updateMany, deleteMany.
- Every new table needs a scope registry entry in platform/scope.ts, or an
  UNSCOPED_BY_DESIGN entry with a reason.
- Mount routers through the mount() helper in createApp, never app.use().
- Bodies typed with withBody(schema, handler); schemas in packages/contracts.
- Errors are AppError with a stable code from platform/errors.ts.
- Test fixtures write through unscopedPrisma.
- Any database guard needs a matching check in invariants.sql and the count in
  invariants.test.ts updated.
- Do not import unscopedPrisma inside a module. ESLint will refuse it.

Give me a plan before code.
```

---

## Session 1 — Positions and permissions CRUD

Positions, permissions and `position_permissions` already exist as seed rows and are read
by context resolution. This session makes them editable.

```
Read docs/05-API-Spec.md §4 and §10.

Implement the positions surface in apps/api/src/modules/governance.

  GET    /api/v1/positions          filter: scope, isActive
  POST   /api/v1/positions          position:manage:district
  PATCH  /api/v1/positions/:id
  DELETE /api/v1/positions/:id      soft — set isActive false
  GET    /api/v1/permissions        reference list, read-only
  PUT    /api/v1/positions/:id/permissions   replace the whole set, atomically

Rules:
- Permissions are reference data seeded by prisma/seed/reference.ts. There is
  no endpoint that creates or edits one — a permission code without a matching
  check in code is a lie, and codes match exactly with no wildcard (build log
  §5), so a typo in a created row would be a silent non-grant.
- Positions with district_id NULL are system-wide templates: readable by every
  district, editable by no one through the API. Return 403 on any write to one.
- Deactivating a position that has ACTIVE appointments is refused with a count
  in details. Code: POSITION_IN_USE.
- is_unique_per_scope is enforced at appointment time, not here (session 2).
- Replacing a position's permissions must invalidate any cached context. Check
  how modules/governance resolves context today and whether anything caches;
  if nothing does, say so rather than adding invalidation for its own sake.

Tests: create, update, deactivate; POSITION_IN_USE with active appointments;
writes to a template position refused; permission replacement is atomic (a
failure part-way leaves the prior set intact).
```

**Verify:** `GET /positions` returns the seeded D9218 slate. Deactivating a position held by
a seeded officer is refused.

**Commit:** `feat(governance): positions and permissions CRUD`

---

## Session 2 — Appointments

```
Read docs/03-Data-Model.md §3 and the build log's session 4 notes on scope
expansion.

Implement appointments in modules/governance.

  GET    /api/v1/appointments       filter: person, position, scope, year
  POST   /api/v1/appointments       appointment:manage:district
  PATCH  /api/v1/appointments/:id   end date, deactivate
  DELETE /api/v1/appointments/:id   soft
  GET    /api/v1/persons/:id/appointments

Domain rules, enforced in the service layer:
- scope_id is a bare UUID by design — it may name a club, cluster, region or
  committee. Validate it resolves to a real record of the type scope_type
  implies. 422 with a clear code if not.
- position.scope must equal appointment.scope_type.
- If position.is_unique_per_scope, refuse a second ACTIVE appointment for the
  same (position, scope_id, rotary_year). Code: POSITION_ALREADY_HELD.
- rotary_year_id comes from context, never from the body.
- A person may hold several appointments at once. This is normal in Rotaract.

ALSO IN THIS SESSION — fix the deferred item from the build log §5:

  Appointment term dates currently compare against UTC midnight, not
  district-local midnight. In Kampala (UTC+3) the boundary is three hours wide
  and it matters on 1 July, when an incoming officer's authority begins and an
  outgoing officer's ends.

  Districts carry a timezone column. Compare starts_on and ends_on against
  midnight in the district's timezone. Fix it in context resolution as well as
  here — they must agree, or an appointment can be creatable but not yet
  effective for reasons nobody can see.

  Add a test that pins the clock to 30 June 22:00 UTC (= 1 July 01:00 EAT) and
  asserts a term starting 1 July is ACTIVE.

Tests: union of permissions across two appointments; scope accumulation across
a club and a cluster appointment; POSITION_ALREADY_HELD; scope_id naming a
non-existent club rejected; a prior-year appointment grants nothing in the
current year; the timezone boundary case above.
```

**Verify:** give a seeded person a second appointment and confirm `/auth/me` shows the union
of both permission sets and both scope arrays.

**Commit:** `feat(governance): appointments with district-local term boundaries`

---

## Session 3 — Web application shell

**This is where the system becomes visible.** `apps/web` is still the M0 placeholder.

```
Read /mnt/skills/public/frontend-design/SKILL.md if present, docs/01-SRS.md
NFR-6, and packages/contracts/src/auth.ts and context.ts — the client must be
typed against the contracts, not against hand-written interfaces.

Build the application shell in apps/web. Auth screens only beyond the frame.

1. Routing with react-router. Public: /login, /forgot, /reset/:token,
   /invite/:token. Everything else behind a guard that redirects to /login.

2. API client (src/lib/api.ts):
   - fetch wrapper, credentials: 'include'
   - maps the { error: { code, message, details } } envelope to a typed
     ApiError carrying the code, so screens can branch on YEAR_LOCKED or
     POSITION_ALREADY_HELD rather than matching strings
   - 401 clears state and redirects to /login
   - request and response types come from packages/contracts

3. TanStack Query. A useAuth hook over GET /auth/me exposing person,
   permissions and the four scope arrays. A <Can permission="..."> component
   and usePermission hook — presentation only, NEVER the security boundary.

4. App layout: sidebar on desktop collapsing to bottom navigation on mobile.
   Header shows the signed-in person, their active position, and the current
   Rotary Year. Navigation items filter by permission.

5. Auth screens: login (including the MFA step — M0 built MFA with recovery
   codes, so the flow needs a second factor prompt), forgot, reset, and
   accept-invite with the consent checkbox that writes the consents row.

6. Design system in src/components/ui: Button, Input, Select, Card, Table,
   Badge, Dialog, Toast, Skeleton, EmptyState, ErrorState. Tailwind.
   Rotaract brand marks and palette only — never the Rotary wheel.

7. Mobile-first. Every screen usable one-handed at 360px, 44px touch targets.

8. A dashboard at / showing the signed-in person, their appointments and the
   current year. Placeholder content is fine; the frame is the deliverable.

Budget: initial JS under 250KB gzipped. Report the measured number.

Plan the design direction first — typography, colour, density — and show me
before building.
```

**Verify:** `npm run dev`, sign in as a seeded officer (the seed sets a shared development
password), reach the dashboard. Resize to 360px. Check the bundle size.

**Commit:** `feat(web): application shell and authentication`

---

## Session 4 — Committees

```
Read docs/03-Data-Model.md §3.

Implement committees in modules/governance.

  GET    /api/v1/committees              ?parentId= , tree or flat
  POST   /api/v1/committees
  PATCH  /api/v1/committees/:id
  POST   /api/v1/committees/:id/members
  DELETE /api/v1/committees/:id/members/:appointmentId
  GET    /api/v1/committees/:id/members

- Year-scoped, self-referencing via parent_committee_id.
- committee_members links an APPOINTMENT, not a person, so membership carries
  the person's position context.
- KEY REQUIREMENT: a committee chair may create sub-committees under their own
  committee and appoint members, WITHOUT holding committee:manage:district.
  Implement as a scope check — the caller holds an active appointment whose
  position is a chair role scoped to that committee or an ancestor of it.
  ctx.scopes.committeeIds already expands downwards, so the ancestor case is
  a containment check against that array.
- Guard against cycles in the parent chain. Cap nesting depth at 3.

Tests: a chair creates a sub-committee under their own; the same chair is
refused (404) on another committee's subtree; cycle creation rejected; depth
cap enforced.
```

This satisfies the district's own request that the incumbent system could not — *"allow
chairs to create their own sub-committee, enter position and select the person."*

**Commit:** `feat(governance): committees with delegated sub-committee creation`

---

## Session 5 — Onboarding and administration surface

Three deferred M0 items, all of which were deferred for the same reason: they are permission
questions.

```
Read the build log §5. Three things land here.

1. INVITATIONS. issueInvite() exists in modules/auth and is exported but has
   no endpoint.

   POST /api/v1/invitations         { personId }  or { personIds: [] }
   POST /api/v1/invitations/:id/resend
   GET  /api/v1/invitations         outstanding, with issued and expiry dates

   Who may invite whom is the question this endpoint answers. Rules:
   - person:invite:district invites anyone in the district
   - person:invite:club invites only persons on the caller's own club roster
   - refuse if the person already has an ACTIVE user account
   - resend consumes the prior token (single-use is already enforced) and
     issues a new one
   - bulk invite is capped and processed one at a time, reporting per-person
     success or failure rather than failing the batch

2. MFA ADMINISTRATIVE RESET.

   POST /api/v1/users/:id/mfa/reset    permission: user:manage:district

   Clears mfa_secret, disables MFA, invalidates recovery codes, writes an
   audit entry, and notifies the person on their registered email that their
   second factor was reset and by whom. The notification is not optional —
   an admin-triggered MFA reset that the account holder never hears about is
   an account takeover path.

3. AUDIT LOG READ.

   GET /api/v1/audit    permission: audit:read:district

   Filters: entityType, entityId, actor, action, date range. Paginated,
   newest first, capped page size.

   The log holds before/after diffs of governed entities, which means it holds
   personal data. Apply the same person serialiser used everywhere else to any
   diff containing person fields, and add a case to no-pii.test.ts. An audit
   endpoint that leaks what the rest of the system protects is the obvious
   hole and an easy one to miss.

Tests for all three, including: club-scoped invite refused for a person on
another club's roster; MFA reset writes an audit row and queues a
notification; audit diffs redact contact fields the caller may not see.
```

**Commit:** `feat(governance): invitations, MFA reset and audit read`

---

## Session 6 — System context and year rollover

Rollover runs once a year, touches every club and appointment, and is therefore the least
exercised code in the system on the day it matters most.

```
Read docs/01-SRS.md UC-06, docs/04-Diagrams.md §3.3, and
Build-Conventions-v1.6.md §4.

PART 1 — the system context. Jobs have no request and therefore no session,
but they must not use unscopedPrisma (a job that skips the scope is a job that
will one day run against the wrong district).

  systemContext(districtId, rotaryYearId, reason: string): RequestContext

- Full permissions within the named district, marked as a system actor.
- identifyActor() names it so audit_log records WHY a system write happened,
  not merely that one did. The reason string is mandatory.
- It must respect the locked-year check exactly as a user context does —
  rollover locks the prior year and must then be unable to write to it, which
  is also a useful self-test.
- Everything from here inherits this: the scoring job (M5), goal snapshots
  (M7), the notification drain.

PART 2 — rollover.

  POST /api/v1/admin/rollover     permission: year:rollover:district
  Body: { targetYearLabel, dryRun, confirmToken? }

- dryRun defaults to true. REJECT a request that omits it.
- dryRun true: run everything inside a transaction, collect a diff report,
  ROLL BACK. Return the report with nothing committed.
- dryRun false: require a confirmToken issued by the most recent dry run for
  the same target year, expiring after 30 minutes.

Steps, in order, in one transaction:
  1. Verify the target year exists and is not already open for this district.
  2. Compute closing rosters per club from membership_events — through the
     club_rosters view, which since schema v1.6 handles corrections correctly.
  3. Lock the prior district_year.
  4. Deactivate prior-year appointments.
  5. Recalculate tier per club from closing roster size (T1 <40, T2 >=40, IBC
     by base_type) and write club_district_affiliations for the new year with
     is_confirmed false.
  6. Carry club_cluster_assignments forward as proposals.
  7. Insert district_years for the new year, is_current true; unset is_current
     on the prior.
  8. Audit entry recording the full diff.

Refuse to run while any assessment period for the prior year is OPEN.

The diff report: clubs carried forward, tier changes from → to, appointments
expiring by position, clubs with zero roster flagged, and any club whose
affiliation could not be carried.

NOTE ON THE SEED: prisma/seed/run.ts clamps appointment terms to today so the
2027-28 dataset is signable-in before launch. After rollover exists, a seeded
database plus a rollover run must still produce a coherent state. Add a test
that seeds, rolls over to a further year, and asserts prior-year writes fail
with YEAR_LOCKED while reads still work.

Tests (integration, real database): dry run commits nothing — assert row
counts unchanged; committed run produces the expected end state; a
confirmToken from a different target year rejected; expired token rejected;
refused while a period is OPEN; prior-year writes fail with YEAR_LOCKED
afterwards.
```

**Verify:** dry run against seed data, read the diff, then commit it and confirm prior-year
writes are refused. `npm run db:seed` to reset.

**Commit:** `feat(org): system context and rotary year rollover`

---

## Session 7 — Governance administration UI

```
Build governance screens in apps/web/src/features/governance.

1. /admin/positions — list with scope filter; create and edit in a dialog; a
   permission matrix editor (permissions × position checkbox grid, grouped by
   resource); deactivate showing how many appointments would be affected.

2. /admin/appointments — filterable by position, scope and person. Create
   flow: searchable person picker, position, then a scope picker that switches
   between club / cluster / region / committee based on the position's scope.
   End an appointment with a date.

3. /admin/committees — tree view, inline sub-committee creation, add members
   by selecting an existing appointment. Visible to committee chairs for their
   own subtree, which is the <Can> case that needs scope as well as permission.

4. /admin/invitations — outstanding invitations, bulk invite from the club
   roster, resend, per-person status.

5. /admin/audit — filterable log with readable diffs. Render a diff as
   field / before / after rows, not raw JSON.

6. /admin/rollover — dry run, then the diff report in a readable table (tier
   changes, expiring appointments, flagged clubs), then a confirm step
   requiring the target year label to be typed before committing.

All screens gate on permission via <Can>. Empty states, loading skeletons,
search and pagination on every list. Every mutation shows a toast; no silent
failures.
```

**Verify:** create an appointment through the UI, sign in as that person, confirm navigation
reflects their permissions and scope.

**Commit:** `feat(web): governance administration screens`

---

## M1 exit checklist

- [ ] Positions, permissions and appointments manageable through the browser
- [ ] Permission and scope unions correct across multiple appointments
- [ ] Appointment terms compare against district-local midnight, in both context resolution and appointment validation
- [ ] A committee chair creates sub-committees without district-wide permission
- [ ] Invitations issuable, with club-scoped inviters limited to their own roster
- [ ] Admin MFA reset audited and notified
- [ ] Audit log readable, with person diffs redacted per visibility
- [ ] `systemContext()` exists, respects locked years, and names its reason in the audit log
- [ ] Rollover dry run commits nothing; committed run locks the prior year
- [ ] Seed + rollover produces a coherent state
- [ ] App shell running, mobile-usable at 360px, under 250KB gzipped
- [ ] `no-pii`, `scope-registry` and `invariants` suites all green

**Next:** M2 reporting spine — the longest milestone, and the one whose exit test is a real
club secretary filing a report on a phone in under three minutes.