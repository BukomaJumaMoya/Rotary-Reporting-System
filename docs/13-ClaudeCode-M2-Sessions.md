# Claude Code — M2 Reporting Spine (revised for v1.6)

**Supersedes the earlier M2 document.** Assumes `Build-Conventions-v1.6.md`.

**The longest milestone — roughly a third of total build effort.** Ten sessions. Not
conceptually hard; a lot of surface area.

**Goal:** a real club could use the system.

**Exit test:** a real club secretary, unassisted, files a fellowship report with a photo on
an Android phone in under three minutes. Get an actual secretary to do this and watch them.
Not a developer friend — they will unconsciously navigate around problems a real user walks
straight into.

**Paste the M1 preamble at the start of every session** (see the M1 document), then the
session body.

---

## Session 1 — Background jobs (pg-boss)

Comes first because media processing in session 8 needs it, and because everything from
here — the scoring job, goal snapshots, the notification drain — inherits its shape.

```
Read Build-Conventions-v1.6.md §4 and the build log's session 6 deployment notes.

Build the worker process.

1. pg-boss against the existing database. No new infrastructure (ADR-001, ADR-008).
   Its tables live in their own schema; add them via a raw SQL migration, and
   add every one to UNSCOPED_BY_DESIGN in platform/scope.ts with the reason
   "pg-boss internal" — scope-registry.test.ts will otherwise fail the build.

2. apps/api/src/jobs/ with:
   - worker.ts, the process entry point
   - a registry mapping job name to handler
   - a defineJob helper taking a Zod payload schema, so job payloads are typed
     and validated on receipt exactly like request bodies

3. Every job handler receives a systemContext(districtId, rotaryYearId, reason)
   built from its payload. Job handlers must NEVER import unscopedPrisma.
   The reason string names the job, so audit_log records why a system write
   happened.

4. Retry with exponential backoff, a dead-letter queue, and a job that fails
   permanently writes a record an admin can read. A silent dead job in a system
   that scores clubs is a club that is wrong and nobody knows.

5. Move notification delivery from inline to the queue. The notifications row
   is already the queue conceptually (build log §5) — this makes it real.
   Keep an inline fallback for password reset, which must not wait on a worker.

6. Uncomment the worker process group in fly.toml. Confirm it starts, passes
   health checks, and that a deploy with a failing worker does not take down
   the API.

Tests: a job runs with a correct system context; a failing job retries then
dead-letters; a job cannot reach another district's rows.
```

**Verify:** `npm run worker` locally, enqueue a notification, watch it deliver.

**Commit:** `feat(jobs): pg-boss worker with typed job definitions`

---

## Session 2 — Web deployment

Small session, done now so every subsequent UI session ships somewhere.

```
The decision is made: the SPA is served from the existing Fly app alongside the
API. One deploy, one account, same origin, no CORS.

1. Build apps/web in the Docker build stage; copy the static output into the
   runtime image.
2. Serve it from Express with a catch-all AFTER all /api routes, returning
   index.html for unmatched non-API paths so client routing works on refresh.
   Assets get long cache headers with hashed filenames; index.html gets
   no-cache.
3. The catch-all must not shadow /api — an unmatched /api/... path must still
   return a JSON 404 in the standard envelope, not index.html. Add a test.
4. Confirm the unauthenticated-PII harness still discovers only real API
   routes and is not confused by the catch-all.
5. Remove the CI artifact upload of the static bundle; it is deployed now.
6. CSP headers appropriate to a same-origin SPA.
```

**Verify:** deploy to staging, sign in through the browser, refresh on a deep route.

**Commit:** `feat(web): serve SPA from the API container`

---

## Session 3 — Clubs and affiliations

```
Read CLAUDE.md axiom 2 and docs/03-Data-Model.md §1.

Implement the club surface in modules/org.

  GET    /api/v1/clubs          filter: tier, baseType, status, cluster, q
  GET    /api/v1/clubs/:id
  POST   /api/v1/clubs          club:create:district
  PATCH  /api/v1/clubs/:id      club:update:own or :district
  GET    /api/v1/clubs/:id/summary
  POST   /api/v1/clubs/:id/affiliations   club:affiliate:district
  GET/POST  /api/v1/clusters
  POST   /api/v1/clusters/:id/clubs

CRITICAL: clubs carry no district_id. A club list for the current district is a
join through club_district_affiliations on (districtId, rotaryYearId). Check
how platform/scope.ts registers Club today — it is a global entity, so the
affiliation join belongs in the org repository, written once, and every club
query goes through it. Do not let a handler write that join.

- ri_club_id unique and required for any club that will be assessed. Duplicate
  → RI_ID_ALREADY_CLAIMED.
- Tier lives on the affiliation, not the club, and is frozen within a year.
  Expose recalculateTier() as a service function called ONLY by rollover.
- /clubs/:id/summary returns profile, roster count, activity count this period,
  dues status and current score in ONE response — this exists to stop the
  mobile client making six round trips. Score and dues come from views; stub
  the fields until M4 and M5 fill them, but define the shape now.
- Search uses the pg_trgm index. Note clubs_name_trgm had to move into
  schema.prisma (build log §4) — do not re-add it as raw SQL.

Tests: club list scoped to the current district-year; a club affiliated
elsewhere is invisible; duplicate RI ID rejected; tier at the T1/T2 boundary
of 40.
```

**Commit:** `feat(org): clubs, affiliations and clusters`

---

## Session 4 — Clubs UI

```
Build club screens in apps/web/src/features/clubs.

1. /clubs — cards on mobile, table on desktop. Filters: tier, type, cluster,
   status. Search. Pagination.
2. /clubs/:id — tabs: Overview, Members, Activities, Finance, Documents,
   Scorecard. Only Overview has content this session; the rest get EmptyState
   with a note about which milestone fills them.
   Overview reads /clubs/:id/summary — one call, not six.
3. /clubs/:id/edit — gated on club:update:own or :district. A club officer
   edits their own club only; another club's edit route must 404, not 403.
4. /admin/clusters — cluster management with club assignment.
```

**Commit:** `feat(web): club directory and profiles`

---

## Session 5 — Persons and visibility

```
Read CLAUDE.md axiom 6 and docs/03-Data-Model.md §2.

Implement the people module.

  GET   /api/v1/persons              scope-filtered, q search
  GET   /api/v1/persons/:id
  POST  /api/v1/persons              person:create:club
  PATCH /api/v1/persons/:id          own record, or person:update:club
  PATCH /api/v1/persons/:id/visibility     OWN RECORD ONLY
  GET   /api/v1/persons/:id/export         own record — subject access
  POST  /api/v1/persons/:id/erasure        own record; queues for review

NON-NEGOTIABLE:
- No unauthenticated person endpoint. Do not create one.
- Contact fields (email, phone, altPhone, city, dateOfBirth) are returned only
  when person_visibility permits, OR the caller is the person, OR the caller
  holds person:read:contact within a scope containing that person.
  ONE serialiser, used by EVERY endpoint returning a person — including nested
  ones inside activities, rosters, attendees, appointments and audit diffs.
  The M1 audit endpoint already uses it; reuse, do not reimplement.
- person_visibility rows are created by the persons_visibility_ins trigger with
  contact fields closed. Do NOT write them from application code — a second
  definition of the default is the one that drifts (build log §4).
- Erasure anonymises rather than deletes: membership events must survive.
  Replace names with 'Former member', null contact fields, keep the person_id.
  Route it through the job queue with a review step.

Tests: THE IMPORTANT ONE is that a person nested inside an activity response is
serialised under the same rules. Contact data leaks through relations, not
through the endpoint you were thinking about. Also: visibility PATCH on another
person refused; export contains membership events and appointments; no-pii
harness green.
```

**Commit:** `feat(people): persons, visibility and subject access`

---

## Session 6 — Membership events and roster

```
Read CLAUDE.md axiom 3, docs/03-Data-Model.md §4, and note that schema v1.6
FIXED club_rosters — the v1.0 view filtered on supersedes_event_id IS NULL,
which discarded every correction while still counting the row it corrected.

Implement the membership module.

  GET  /api/v1/membership/events         filter: club, person, type, dates
  POST /api/v1/membership/events         idempotent on client-supplied id
  POST /api/v1/membership/events/:id/correct
  GET  /api/v1/membership/roster         ?clubId=&asOf=
  GET  /api/v1/membership/stats          ?clubId=&from=&to=
  GET  /api/v1/membership/transitions
  POST /api/v1/membership/transitions/:id/corroborate

Rules:
- No PUT, no DELETE. There is already a database guard raising
  MEMBERSHIP_IMMUTABLE — confirm it is in invariants.sql and that the domain
  code mapping works (it was broken until session 6 of M0; sqlStateOf now
  reads meta.driverAdapterError.cause.code).
- A correction is a new event with supersedes_event_id set and type CORRECTION.
- Nothing writes to club_rosters. It is a view. Refresh CONCURRENTLY after
  event writes and nightly via pg-boss.
- /roster with asOf reconstructs from the event log, not from the view.
- /stats returns opening roster, joiners, leavers, net change, retention rate,
  transitions to Rotary, and a breakdown by reason code — raw SQL, and note
  that raw SQL bypasses the scope extension, so every query must take
  districtId, rotaryYearId and clubId as bound parameters from ctx explicitly.
  Add a comment saying so; this is the one place the layer cannot protect you.
- Duplicate event (same person, club, type, effective_on) →
  DUPLICATE_MEMBERSHIP_EVENT unless an explicit correction.
- Transfers with a counterparty club inside the district enqueue a
  corroboration notification.

Tests: roster derives correctly through join → transfer out → reinstate;
a correction is reflected in the roster (the v1.0 bug); asOf reconstruction;
retention arithmetic against a fixture; idempotent replay yields one row.
```

**Verify:** build a fixture club with twelve months of events including a correction, and
check `/stats` against hand-computed numbers. This arithmetic feeds M5 — get it right now.

**Commit:** `feat(membership): event log, roster and statistics`

---

## Session 7 — Membership UI

```
Build membership screens in apps/web/src/features/membership.

1. Club profile Members tab: roster with category badges, tenure, search.
   Contact details only where visibility allows.
2. "Record membership event" — the most-used screen for secretaries. Optimise
   hard:
   - event type first, large touch targets, most common first (Induct,
     Transfer In, Transfer Out, Terminate, Transition to Rotary)
   - the form adapts: transfers ask counterparty club, terminations ask reason
     code, transitions ask the Rotary club
   - person is searchable-or-create inline. Do not force a separate "add
     person" journey first.
3. /clubs/:id/membership/history — the event log, with corrections shown linked
   to what they supersede.
4. Statistics panel: opening, joiners, leavers, net, retention, with a trend.
5. Transitions list with corroboration state and action.

Completable one-handed at 360px.
```

**Commit:** `feat(web): membership recording and history`

---

## Session 8 — Activity types and media pipeline

```
Read CLAUDE.md axiom 4 and docs/03-Data-Model.md §5.

PART 1 — activity types.

  GET   /api/v1/activity-types       grouped by category
  POST  /api/v1/activity-types       activitytype:manage:district
  PATCH /api/v1/activity-types/:id

field_config (JSONB) declares extra type-specific fields:
  [{ key, label, type: 'text'|'number'|'date'|'select'|'boolean',
     required, options?, helpText? }]
Validate it with a Zod schema. This is the contract between configuration and
UI — design it carefully now, because changing it later touches every type.

Plus /admin/activity-types UI: list by category, create/edit with a
field_config builder, and a live preview of the resulting form.

PART 2 — the media pipeline.

FIRST: adding sharp will remove @esbuild/* and break npm run dev. Pin sharp's
platform binaries in the root optionalDependencies in the SAME commit, exactly
as esbuild's are (build log §6). Verify npm run dev still works before going on.

- Multipart upload, content type validated by MAGIC BYTES not extension, size
  capped at 10MB, original stored in S3-compatible storage under a generated
  key. Never a user-supplied filename — the incumbent system kept spaces and
  apostrophes in stored names.
- A pg-boss job produces a 400px thumbnail and a 1200px display variant in
  WebP, and STRIPS ALL EXIF. Phone photos carry GPS; publishing member
  locations is the exact failure this project corrects. Test with a fixture
  image containing GPS.
- Store storage KEYS, never URLs, so the provider or CDN can change without a
  data migration.
- Private documents served via short-lived signed URLs.
```

**Commit:** `feat(activity): configurable types and media processing`

---

## Session 9 — Activities API and reporting UI

The single most important screen in the system. If it is slow or confusing, nothing else
matters — clubs go back to WhatsApp.

```
Read docs/01-SRS.md UC-01, FR-4 and NFR-6.2.

PART 1 — API.

  GET    /api/v1/activities      filter: type, category, host, status,
                                 verification, date range
  GET    /api/v1/activities/:id
  POST   /api/v1/activities      idempotent on client-supplied UUID
  PATCH  /api/v1/activities/:id  refused once the period is closed
  DELETE /api/v1/activities/:id  soft
  POST   /api/v1/activities/:id/media | /partners | /attendees
  POST   /api/v1/activities/:id/verify    activity:verify:district
  GET    /api/v1/activities/calendar

- Validate against the type's requires_* flags and field_config. Missing field
  → MISSING_REQUIRED_FIELD_FOR_TYPE with the key in details.
- host_scope_type must be in the type's allowed_host_scopes, and host_scope_id
  must fall within the caller's scopes — note ctx.scopes now carries region and
  committee arrays, so a committee-hosted activity is a containment check
  against committeeIds.
- description has NO length limit. The incumbent's limit was a logged complaint.
- An activity write marks affected club_assessments stale. That module does not
  exist yet — expose assessment.markStale() as a no-op stub in modules/
  assessment now and call it, so M5 fills in a function that is already wired.
  Do NOT have modules/activity import assessment internals later.

PART 2 — reporting UI, in apps/web/src/features/activities.

/report, optimised for a secretary on an Android phone at 11pm:
  - step 1: activity type, grouped by category, most-used first
  - step 2: a form rendered DYNAMICALLY from requires_* and field_config.
    Never hard-code fields per type.
  - step 3: photos from camera or gallery, compressed client-side, thumbnails,
    removal
  - step 4: review and submit
  - progress survives navigation away and back
  - idempotent on a client-generated UUID

Plus /activities list, /activities/:id detail with media gallery,
/activities/calendar, and verification actions (Verify, Query with a comment,
Reject). The Query state is what makes this two-way rather than write-only.

Target: under 3 minutes for a first-time user. Time yourself, then time
someone else.
```

**Commit:** `feat(activity): activities with reporting and verification`

---

## Session 10 — M2 hardening

```
Consolidation. No new features.

1. no-pii, scope-registry and invariants suites all green. Confirm every table
   added this milestone has a registry entry, and every via chain terminates.
2. Bundle analysis — still under 250KB gzipped initial JS? If not, route-level
   code splitting for admin screens. Keep the club-officer path in the main
   bundle.
3. Scale the seed to the real shape: 68 clubs (the confirmed D9218 list), 3000
   persons, a full year of activities and membership events. M5 and the load
   test both need this volume.
4. EXPLAIN ANALYZE at that scale: activity list, roster, membership stats,
   club summary. Add indexes where a sequential scan appears, in schema.prisma
   where Prisma can express them.
5. Every list has EmptyState and ErrorState. Every mutation shows a toast.
6. Review every M2 endpoint against docs/05-API-Spec.md §10 and write a test
   for any gap.
```

**Commit:** `chore: M2 hardening and performance pass`

---

## M2 exit checklist

- [ ] A club secretary files a fellowship report with a photo, on a phone, in under 3 minutes
- [ ] Worker process running; jobs use `systemContext`, never `unscopedPrisma`
- [ ] SPA served from the API container; deep-link refresh works; `/api` 404s stay JSON
- [ ] Activity types configurable with no deployment
- [ ] `sharp` platform binaries pinned; `npm run dev` still works
- [ ] EXIF stripped from all processed images
- [ ] Corrections reflected correctly in the roster
- [ ] Membership statistics reconcile against hand-computed fixtures
- [ ] Contact details respect visibility, including nested
- [ ] Seed at real scale: 68 clubs, 3000 persons, a year of data
- [ ] Bundle under 250KB gzipped

**Next:** M3 offline and mobile.