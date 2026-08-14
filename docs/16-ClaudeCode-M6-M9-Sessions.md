# Claude Code — M6 Demo & Pilot · M7 Goals & Exports · M8 Hardening · M9 Transfer and Launch

**Supersedes the earlier M6–M9 document.** Assumes `Build-Conventions-v1.6.md`.

M6 and M9 are mostly not development work. Resist treating them as such — they are where
the project succeeds or fails with actual humans.

---

# Ownership sequencing — read before M6

The repository, hosting, database and storage accounts are personally owned through build
and demo, transferring to the district on acceptance.

**Two conditions on that, and the second is a hard gate.**

**Declare and recuse.** You will hold a district seat while the district decides whether to
accept a system you own. Declare the interest in writing before the demo, and take no part
in the acceptance decision. Handled that way it is unremarkable; discovered afterwards it
becomes the story instead of the software.

**Transfer before real member data enters the system.** While the database holds only
synthetic seed data, personal ownership carries no exposure. The moment real D9218 members
are loaded, whoever owns the infrastructure is the data controller under Uganda's Data
Protection and Privacy Act 2019, with registration obligations and personal liability
attached. So the order is:

```
M5 complete → demo on SYNTHETIC data → acceptance → TRANSFER → pilot loads real clubs
```

Not: pilot → demo → acceptance → transfer. If the pilot runs before transfer, you
personally hold three thousand people's records on accounts in your own name — precisely
the exposure this project exists to correct.

The M5 reconciliation gives you a demo that needs no live member data: real historical
scores, reproduced by the engine, shown against the manual spreadsheets. That is a stronger
demo than a walkthrough of empty screens, and it keeps the sequence clean.

---

# M6 — Demo and pilot

**The demo comes first, on synthetic data plus the reconciliation.** Then transfer. Then the
pilot.

**Pilot: ten to fifteen clubs, in parallel with the incumbent system.** Recruit from clubs
that already report well — those topping current award lists, whose secretaries are diligent
and will give you real feedback rather than polite silence. A club that does not report will
not report on your system either, and tells you nothing.

**Run it weekly:** what broke, what confused you, what took too long. Fix in the same week.
Publish a visible changelog so pilot clubs see their feedback landing. That is what turns
them into advocates, and advocacy is your entire go-to-market — when those clubs stand up at
the July district assembly and say it is better, you do not have to sell anything.

One development task belongs here:

```
Build a feedback channel into the app.

- A persistent "Report a problem" action in the app shell
- Captures: free text, current route, user agent, viewport, online status, the
  last API error if any, and the pending outbox depth
- Posts to a feedback endpoint, stored in a table, readable by admins
- Confirms receipt

Do NOT use a third-party widget — it costs bundle size and sends user data to a
processor you have no consent for.
```

**Exit test:** pilot clubs prefer DIS. If they do not, do not launch. Extend the pilot and
find out why.

---

# M7 — Goals, Exports and Alerts (four sessions)

Paste the M1 preamble at the start of every session.

## Session 1 — Goals

```
Read docs/01-SRS.md FR-7 and docs/03-Data-Model.md §8.

Implement modules/goals.

  GET/POST/PATCH  /api/v1/goals
  GET   /api/v1/goals/progress
  POST  /api/v1/goals/:id/snapshot      manual entry where no resolver exists

- Goals bind to a resolver_key where one exists and fall back to manual entry
  where none does. REUSE the assessment resolver registry — do not build a
  second one. Note the module dependency rule: goals may call assessment;
  assessment must not call goals.
- Goals may be district-scoped or club-scoped (club work plans, FR-7.4).
- A nightly pg-boss job writes goal_snapshots for every resolver-backed goal,
  using systemContext(districtId, yearId, 'goals.snapshot'). That gives trend
  data for free.
- /goals/progress returns target, current actual, percentage, trend over the
  last six snapshots, and projected year-end at the current rate.

Seed the D9218 RY2027-28 district goals from the PIME working file: the 18 goal
items with their targets.
```

The district's monthly performance review stops being a data-collection exercise and becomes
an actual review.

**Commit:** `feat(goals): goal tracking with automatic actuals`

---

## Session 2 — Dashboards and alerts

```
  GET /api/v1/dashboard/district
  GET /api/v1/dashboard/club/:id
  GET /api/v1/alerts

Alerts (FR-7.5), each returning affected clubs with context:
- no activity reported in 30 days
- dues unpaid past the due date (read the invoice status view)
- assessment score below a configurable threshold
- club documents expiring within 60 days
- net negative membership growth this quarter
- assessments stale over 48 hours — an engine health check

UI:
1. /dashboard (district): goal cards with sparklines, top and bottom clubs by
   tier, alert summary, activity volume trend, dues collection rate. This is
   the DRR's and PIME Chair's daily view — fast, and readable on a phone.
2. Club dashboard: own goals, own score trend, outstanding items, deadlines.
3. /alerts: grouped, actionable, each linking to the club.

Recharts, in the lazy-loaded bundle.
```

**Commit:** `feat(web): dashboards and alerts`

---

## Session 3 — Exports

```
Read docs/05-API-Spec.md §9.

  POST /api/v1/exports      queues a job
  GET  /api/v1/exports/:id  status and a signed download URL

- Under 1000 rows may stream synchronously; larger queues a pg-boss job and
  notifies on completion.
- Proper XLSX: headers, column widths, frozen header row, formatted dates and
  currency. Not a renamed CSV.
- EXPORTS RESPECT THE CALLER'S SCOPE. A club secretary exporting activities
  gets their club only. Test this explicitly — an export ignoring scope is a
  bulk data leak, and it is the single highest-consequence bug in this module.
- Person exports apply the same visibility serialiser as every other endpoint.
- Every export writes an audit entry with resource, filters and row count.
  recordAction(EXPORT, …) already exists and has been unused since M0 — wire
  it here.
- Signed URLs expire in 24 hours; files deleted after 7 days.
- Exportable: clubs, persons, membership events and stats, activities,
  transactions, dues status, TRF, scorecards, standings (live and published),
  goal progress.

UI: an export button on every list, showing which filters will apply, with
progress and a downloads panel.
```

This satisfies the district's own logged complaint — *"can I download a report for all clubs
on something?"* — through one convention rather than twenty bespoke report screens.

**Commit:** `feat(exports): scoped XLSX export across all lists`

---

## Session 4 — Notifications

```
Read docs/01-SRS.md FR-8.4. The queue exists from M2; this completes it.

- Templates in notification_templates with handlebars-style interpolation.
  Remember resetDatabase() preserves this table (build log §6) — any template
  added by a migration must stay in that preserve list.
- Channels: EMAIL and IN_APP at launch. WhatsApp via Business API behind the
  same adapter interface, addable without touching callers.
- Per-person channel preferences, defaulting to email plus in-app.
- Templates needed: dues receipt, dues reminder, assessment finalised, score
  updated, assessor queue assigned, dispute raised, dispute resolved,
  membership corroboration, deadline approaching, invite, password reset,
  MFA reset.
- Unsubscribe for non-transactional messages.

Do NOT build birthday emails or social features — out of scope (00-README).

UI: /admin/notifications for templates and the delivery log.
```

Pilot feedback answers open question Q-3 — whether clubs actually read email or WhatsApp.
Build the adapter, let the data decide.

**Commit:** `feat(notifications): templates, preferences and delivery log`

---

# M8 — Hardening (four sessions)

No new features. This is where you earn the right to hold three thousand people's data.

## Session 1 — Security review

```
Conduct a review against the OWASP Top 10. REPORT FINDINGS BEFORE FIXING.

1. Every endpoint enforces authorisation server-side, per record. Enumerate
   every route and confirm. Report any relying on client-side gating.
2. no-pii covers every route, including nested serialisation and audit diffs.
3. IDOR: attempt to reach another district's and another club's records by
   UUID at every endpoint. All must 404, never 403. Pay particular attention to
   child tables scoped via a parent — that is where a missing via rule shows up.
4. Session fixation, rotation on login, cookie flags.
5. Rate limiting on auth, export and expensive analytics endpoints.
6. Upload: magic-byte validation, size caps, EXIF confirmed stripped, no path
   traversal in storage keys.
7. SQL injection in the resolvers — confirm every query uses parameter binding
   and none uses string interpolation.
8. Dependency audit; upgrade anything with a known vulnerability.
9. Secrets: confirm none in repository history. Rotate anything found.
10. CORS, CSP, HSTS, X-Frame-Options — note the SPA is same-origin now.

Produce a findings report with severities. Then fix, highest first.
```

**Commit:** `fix(security): remediate review findings`

---

## Session 2 — Backup, restore and operations

```
1. Verify daily backups, 30-day retention, held off the application host, with
   point-in-time recovery.
2. PERFORM A FULL RESTORE into a clean environment and run the application
   against it. Document the procedure with timings. An untested backup is not
   a backup, and this is the step everyone skips.
3. Object storage: versioning or backup for uploaded media.
4. Structured logging with request ids. No PII in logs — check that error paths
   do not serialise request bodies containing personal data.
5. Uptime monitoring on /admin/health with alerting.
6. Error tracking, self-hosted or under a data processing agreement.
7. A runbook: deploy, rollback, restore, rotate secrets, run rollover, respond
   to an incident.
```

**Commit:** `chore(ops): backup verification and runbook`

---

## Session 3 — Load and performance

```
Load test at 3x launch scale: 200 clubs, 9000 persons, a full year of data.

1. Generate the volume in the seed.
2. Measure: club list, activity list, membership stats, scorecard, standings
   (live view and snapshot), district dashboard, full recomputation.
3. Targets: lists under 300ms p95; dashboard under 1s; full recomputation
   under 5 minutes.
4. EXPLAIN ANALYZE anything slower. Index in schema.prisma where Prisma can
   express it, raw SQL where it cannot. Consider materialising standings if
   the view is the bottleneck.
5. 50 concurrent report submissions.
6. Re-verify mobile budgets: under 250KB gzipped, one report under 500KB.

Report before and after numbers for everything changed.
```

**Commit:** `perf: load testing and query optimisation`

---

## Session 4 — Compliance

```
Mostly documentation, and it must be done before real data arrives.

1. Publish the privacy notice and terms as real pages. The incumbent's
   equivalents return 404 — precisely the impression to avoid.
2. Confirm consent capture at registration writes a versioned consents row.
3. Test subject access export end to end.
4. Test erasure: anonymises the person, preserves membership events,
   verifiably removes contact data everywhere including nested responses and
   audit diffs.
5. Write the breach response procedure: detection, assessment, notification to
   the Personal Data Protection Office and affected members, remediation,
   record-keeping. Have the DRR sign it.
6. Data retention policy: what is kept, how long, why.
7. Confirm the audit log captures every governed mutation with actor and diff.
8. Confirm no production data exists on any developer machine.

Produce a compliance summary the district can hold on file.
```

**Commit:** `docs(compliance): privacy, retention and breach procedures`

---

# M9 — Transfer, onboarding and launch

## The transfer checklist — before any real member data

- [ ] Written declaration of interest lodged with the DRR, dated before the demo
- [ ] Written acceptance of the system by the district
- [ ] GitHub repository transferred to a district-owned organisation, two admins
- [ ] Fly (or equivalent) account under district identity, two admins
- [ ] Database and object storage accounts under district identity
- [ ] Domain registration under district identity
- [ ] Written statement that DIS is district property
- [ ] Written authorisation to process D9218 member data for assessment purposes
- [ ] Licence chosen and applied — AGPL-3.0 if you want derivative districts to contribute back; MIT for widest adoption
- [ ] Named successor maintainer identified
- [ ] Your own personal copies of any real data destroyed and confirmed

**Only then** does session 1 below run.

---

## Session 1 — Club and officer onboarding

```
1. Seed all D9218 clubs from the confirmed redistricting list with RI club IDs,
   charter dates, base types and cluster assignments.

   RESOLVE FIRST, IN WRITING WITH THE DRR: the redistricting workbook lists at
   least one club (Nakawa, RI ID 16277) in both the 9217 and 9218 sheets, and
   at least one entry (Ntinda VTI) with no club ID. Clean the source data
   before it becomes the system of record. A data dispute in month one destroys
   trust that takes a year to rebuild.

2. Bulk officer onboarding, building on the M1 invitations endpoint:
   - import from a spreadsheet (person, club, position, email)
   - validate, preview, then send
   - track acceptance, resend to non-responders
   - an admin view of progress by club

3. First-run experience: a short guided tour of the three things a new user
   needs — report an activity, record a member, see the scorecard. Dismissible,
   never blocking.

4. A club setup checklist on the club dashboard: profile complete, officers
   appointed, roster imported, documents uploaded, budget entered. Visible
   progress, so clubs self-serve rather than asking you.
```

**Commit:** `feat: club onboarding and bulk invitation`

---

## Session 2 — Documentation and handover

```
Short and visual. Nobody reads a PDF on a phone.

1. Role-based quick guides as in-app help, one page each: Club Secretary,
   Club Treasurer, Club President, ADRR, Assessor, PIME Chair, DES.
2. A context-sensitive in-app help panel keyed by route.
3. An administrator handbook in docs/: rollover procedure, framework
   authoring, troubleshooting, plus the M8 runbook.
4. HANDOVER.md for your successor: architecture summary, the six axioms and
   why each exists, the ADRs including 012 and 013, where the bodies are
   buried, known limitations, the v1.1 backlog, and every account location.
   The build log is already most of this — fold it in rather than rewriting it.
```

Record two-minute screen captures rather than writing four pages. That is what a secretary
on a phone will actually use.

**Commit:** `docs: user guides and handover`

---

## Fieldwork — not a Claude Code session

**Two training sessions.** One for club secretaries and treasurers, one for district
officers. Hands-on, on their own phones, using the M5 reconciliation data so the examples
are numbers they already recognise.

**A named support human** — you initially, with a second identified before July.

**A pilot-club advocate at the district assembly.** Someone who has used it for three months
saying so publicly is worth more than any presentation you can give.

---

## Launch checklist — 1 July 2027

- [ ] Transfer checklist complete
- [ ] All D9218 clubs seeded with verified RI IDs; redistricting conflicts resolved in writing
- [ ] Officers invited; acceptance above 80%
- [ ] RY2027-28 framework authored, previewed, published
- [ ] Assessment periods scheduled
- [ ] District goals loaded with targets
- [ ] Dues invoices issued
- [ ] Security findings closed
- [ ] Backup restore tested and documented
- [ ] Privacy notice and terms published; breach procedure signed
- [ ] Two administrators on every account
- [ ] Successor maintainer briefed
- [ ] Support channel live with a named human
- [ ] Rollover dry run rehearsed against production data

---

## After launch

The first assessment period in August is the real test. Watch three things: how many clubs
report without prompting, how long a submission actually takes, and how many scores are
disputed. Each tells you something different — adoption, friction, and whether the rubric is
calibrated.

Keep a visible v1.1 backlog. Requests will arrive constantly, and being able to say "yes,
that is on the list for January" without either agreeing or refusing is what protects the
system from becoming the thing it replaced.