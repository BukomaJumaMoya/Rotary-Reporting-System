# 01 — Software Requirements Specification

## 1. Purpose and scope

### 1.1 Problem statement

Rotaract District 9218 will charter on 1 July 2027 with approximately 90 clubs and 3,000+ members. District performance management currently depends on a third-party listing website for capture and a manually maintained spreadsheet workbook for everything else — scoring, goal tracking, award adjudication and reporting. The consequences are:

- A 100-point, 12-parameter assessment applied to every club, monthly and quarterly, entirely by hand across seven assessors.
- Clubs discover their standing at the end of the year, when it is too late to act on it.
- District goal tracking (18 goal items) is a monthly manual data-collection exercise rather than a review.
- No feedback channel from district back to clubs, and no verification workflow on submitted data.
- No exports, so every analysis begins by re-typing data into a spreadsheet.

### 1.2 System purpose

DIS is the district's system of record for club activity, membership, finance and performance, and the engine that converts that record into scores, goals, feedback and decisions.

### 1.3 In scope (v1.0)

Club activity reporting · membership event tracking · club and district finance · dues management · configurable assessment engine · club scorecards · district goal dashboard · assessor workflow · document management · notifications · exports · role and term-based governance.

### 1.4 Out of scope (v1.0)

Business directory · public announcements · public marketing site · payment gateway integration (deferred to v1.2) · direct Rotary International API integration (RI provides no general-purpose public API; reference capture and reconciliation only) · mobile native apps (PWA instead).

### 1.5 Constraints

| Constraint | Implication |
|---|---|
| Single developer, part-time, ~11 months | Ruthless scope discipline; boring, well-documented technology only |
| Users on Android phones, metered mobile data | Mobile-first, aggressive payload budgets, offline-capable submission |
| Intermittent connectivity upcountry | Client-side queue with background sync; no assumption of connectivity at submit time |
| Volunteer users, annual leadership turnover | Self-explanatory UI; configuration over code; documentation as a deliverable |
| District property, no budget assumed | Infrastructure must run under ~USD 30/month at launch scale |
| Uganda Data Protection and Privacy Act 2019 | Consent capture, purpose limitation, access control, audit trail, breach procedure |

---

## 2. Actors

| Actor | Scope | Primary responsibilities in DIS |
|---|---|---|
| **Club Member** | Own record | View own profile, own club's activities and scorecard; confirm attendance; manage privacy settings |
| **Club Secretary** | One club | Report fellowships, projects and activities; maintain the member roster; record membership events; upload evidence |
| **Club Treasurer** | One club | Record income and expenditure; maintain club budget; record member dues; record TRF contributions |
| **Club President** | One club | Approve submissions; maintain club profile and documents; view club scorecard and standing |
| **ADRR** | One cluster | Report cluster activities and official visits; complete the ADRR assessment parameter; monitor clubs in cluster |
| **LDRR** | One region | Regional oversight; view all clubs and ADRRs in region |
| **Assessor** | Assigned parameters | Score assigned parameters for assigned clubs; leave improvement comments; resolve disputes |
| **Committee Chair** | One committee | Report committee activities; manage sub-committee membership |
| **PIME Chair / Deputy** | District | Author and publish assessment frameworks; open and close assessment periods; assign assessors; finalise scores; manage district goals |
| **DES / Deputy DES** | District | Manage clubs, positions and appointments; open/close the Rotary Year; district-wide read access |
| **District Treasurer** | District | District budget; dues invoicing and reconciliation; receipts |
| **DRR** | District | Full read access; approvals; final award sign-off |
| **System Administrator** | Global | User lifecycle, role configuration, data protection administration, audit review |

**Design note.** No permission is granted to a *person*. Permissions derive from an **appointment** — the tuple `(person, position, org_unit, rotary_year)`. On 1 July, last year's appointments expire and last year's access evaporates automatically. This is the mechanism that makes annual leadership turnover a non-event.

---

## 3. Functional requirements

Requirements are grouped by module. `MUST` = v1.0 launch blocker. `SHOULD` = v1.0 target, deferrable. `MAY` = v1.1+.

### FR-1 Identity, governance and access

| ID | Requirement | Priority |
|---|---|---|
| FR-1.1 | The system MUST authenticate users by email and password with session cookies, and support password reset by emailed token. | MUST |
| FR-1.2 | The system MUST model positions as administrator-editable configuration, not code. | MUST |
| FR-1.3 | The system MUST derive all authorisation from active appointments scoped to the current Rotary Year. | MUST |
| FR-1.4 | The system MUST support committees and sub-committees, with chairs able to appoint their own sub-committee members. | MUST |
| FR-1.5 | Appointments MUST expire automatically at year end without administrator action. | MUST |
| FR-1.6 | The system SHOULD support delegated impersonation for support purposes, fully audit-logged. | SHOULD |
| FR-1.7 | The system SHOULD support two-factor authentication for district-scope roles. | SHOULD |

### FR-2 Organisation

| ID | Requirement | Priority |
|---|---|---|
| FR-2.1 | The system MUST store clubs keyed on RI Club ID as the external identifier. | MUST |
| FR-2.2 | Club-to-district affiliation MUST be a dated relationship, supporting redistricting without data loss. | MUST |
| FR-2.3 | Club-to-cluster assignment MUST be scoped to a Rotary Year, as clusters are redrawn annually. | MUST |
| FR-2.4 | The system MUST classify clubs by type (community-based, institution-based, e-club) and tier (T1 <40 members, T2 ≥40 members, IBC), with tier recalculated from roster size. | MUST |
| FR-2.5 | The system MUST maintain club profile data including meeting schedule, venue, sponsor Rotary club, URSB registration number and bank account reference. | MUST |
| FR-2.6 | The system MUST support club document upload with type, issue date, expiry and verification state. | MUST |

### FR-3 Membership

| ID | Requirement | Priority |
|---|---|---|
| FR-3.1 | The system MUST record membership as an immutable event log: join, induct, transfer in, transfer out, terminate, transition to Rotary, reinstate, category change. | MUST |
| FR-3.2 | Every membership event MUST carry an effective date, a recording user and, where applicable, a reason code and counterparty club. | MUST |
| FR-3.3 | The current roster MUST be derived from the event log, never stored as the primary truth. | MUST |
| FR-3.4 | The system MUST support member categories: active, honorary, corporate. | MUST |
| FR-3.5 | The system MUST capture RI Member ID against each person where available. | MUST |
| FR-3.6 | The system MUST compute, for any club and any period: opening roster, joiners, leavers, net change, retention rate, and transitions to Rotary — without schema change. | MUST |
| FR-3.7 | Transition-to-Rotary events MUST capture the receiving Rotary club and permit corroboration from the Rotary side. | MUST |
| FR-3.8 | Persons MUST control the visibility of their contact details; the default MUST be private. | MUST |

### FR-4 Activity reporting

| ID | Requirement | Priority |
|---|---|---|
| FR-4.1 | The system MUST implement a single activity model; activity types MUST be administrator-configurable rows. | MUST |
| FR-4.2 | Activity types MUST carry their own field requirements (photo required, report required, attendance required), configurable per type. | MUST |
| FR-4.3 | Activities MUST support: host org unit, schedule, venue or virtual link, status, narrative report, external report URL, media, attendance counts, partners, Rotary areas of focus, and a Service Project Centre reference. | MUST |
| FR-4.4 | The system MUST distinguish community service from international service, with international service requiring a non-Uganda partner. | MUST |
| FR-4.5 | Activities MUST support a verification state set by an assessor or district officer. | MUST |
| FR-4.6 | Club members SHOULD be able to confirm their own attendance at a club activity. | SHOULD |
| FR-4.7 | The system MUST support submission while offline, queueing locally and syncing when connectivity returns. | MUST |
| FR-4.8 | Uploaded images MUST be resized and re-encoded server-side; originals MUST NOT be served to list views. | MUST |

### FR-5 Finance

| ID | Requirement | Priority |
|---|---|---|
| FR-5.1 | Clubs and the district MUST be able to author a budget of categorised line items for a Rotary Year. | MUST |
| FR-5.2 | The system MUST record income and expenditure transactions, optionally linked to a budget line. | MUST |
| FR-5.3 | The system MUST track district dues invoices per club per year, with partial payment, receipt generation and reconciliation. | MUST |
| FR-5.4 | Club treasurers MUST be able to record member dues including prepayment against future years. | MUST |
| FR-5.5 | Club secretaries MUST be able to view expenditure as well as collections. | MUST |
| FR-5.6 | The system MUST record TRF contributions at member and club level with an RI receipt reference and a verification state. | MUST |
| FR-5.7 | Payment gateway integration for dues (mobile money) MAY be added in v1.2. | MAY |

### FR-6 Assessment

| ID | Requirement | Priority |
|---|---|---|
| FR-6.1 | The PIME Chair MUST be able to author an assessment framework — parameters, criteria, weights, tier applicability — entirely through the interface. | MUST |
| FR-6.2 | Frameworks MUST be versioned and lockable; a locked framework MUST NOT change after scoring begins. | MUST |
| FR-6.3 | Each criterion MUST declare an evaluation mode: automatic, assessor-judged, or hybrid. | MUST |
| FR-6.4 | Automatic criteria MUST be evaluated by a rule definition referencing a named metric resolver, with no SQL stored in configuration. | MUST |
| FR-6.5 | Criteria MUST support banded scoring (thresholds awarding different points) and tier-specific bands. | MUST |
| FR-6.6 | The system MUST compute automatic scores on a schedule and on demand, and MUST record the evidence behind each score. | MUST |
| FR-6.7 | Assessors MUST receive a work queue of their assigned parameters with supporting evidence pre-assembled. | MUST |
| FR-6.8 | Assessors MUST be able to attach improvement or commendation comments visible to the club. | MUST |
| FR-6.9 | Clubs MUST be able to view their own live scorecard, per criterion, with evidence and comments. | MUST |
| FR-6.10 | Clubs MUST be able to raise a dispute against a criterion score, with a resolution workflow. | MUST |
| FR-6.11 | The system MUST produce ranked standings by tier and by parameter for award adjudication. | MUST |
| FR-6.12 | Assessment periods MUST have submission deadlines after which the period is closed to new evidence. | MUST |

### FR-7 Goals and analytics

| ID | Requirement | Priority |
|---|---|---|
| FR-7.1 | The district MUST be able to define goals with a target, a unit and a bound metric resolver. | MUST |
| FR-7.2 | Goal actuals MUST be computed automatically where a resolver exists, and enterable manually where not. | MUST |
| FR-7.3 | The system MUST snapshot goal actuals over time to support trend display. | MUST |
| FR-7.4 | Clubs SHOULD be able to author a club work plan with goals, and track against it. | SHOULD |
| FR-7.5 | The system MUST provide early-warning views: clubs with no activity in 30 days, clubs unpaid on dues, clubs below a score threshold. | MUST |

### FR-8 Cross-cutting

| ID | Requirement | Priority |
|---|---|---|
| FR-8.1 | Every list view MUST support export to CSV and XLSX, respecting the caller's authorisation scope. | MUST |
| FR-8.2 | The system MUST maintain an immutable audit log of create, update and delete on all governed entities. | MUST |
| FR-8.3 | Deletion of governed entities MUST be soft; hard deletion MUST be an administrative operation only. | MUST |
| FR-8.4 | The system MUST provide a queued notification service supporting email and WhatsApp, with templates and a delivery log. | MUST |
| FR-8.5 | The system MUST capture and version data-processing consent per person. | MUST |
| FR-8.6 | The system MUST support export and erasure of an individual's personal data on request. | MUST |
| FR-8.7 | Prior Rotary Years MUST remain readable indefinitely and MUST become read-only at rollover. | MUST |

---

## 4. Non-functional requirements

### NFR-1 Performance and payload

| ID | Requirement |
|---|---|
| NFR-1.1 | Initial page load on a 3G connection MUST complete under 5 seconds; subsequent navigations under 1 second. |
| NFR-1.2 | The initial JavaScript bundle MUST NOT exceed 250 KB gzipped. |
| NFR-1.3 | List images MUST be served at no more than 400 px on the longest edge, in WebP or AVIF. |
| NFR-1.4 | A complete activity report submission MUST cost under 500 KB of data including one photograph. |
| NFR-1.5 | API responses for list endpoints MUST be paginated, default page size 25, maximum 100. |
| NFR-1.6 | Full assessment recomputation for all clubs in a period MUST complete within 5 minutes. |

*Rationale for NFR-1: users pay per megabyte. A slow, heavy application will simply not be used, and adoption is the project's primary risk.*

### NFR-2 Availability and durability

| ID | Requirement |
|---|---|
| NFR-2.1 | Target availability 99% monthly, excluding announced maintenance. |
| NFR-2.2 | Automated daily database backups with 30-day retention, held off the application host. |
| NFR-2.3 | A restore from backup MUST be tested and documented quarterly. |
| NFR-2.4 | Point-in-time recovery to within 24 hours MUST be possible. |

### NFR-3 Security

| ID | Requirement |
|---|---|
| NFR-3.1 | All traffic over TLS; HSTS enabled. |
| NFR-3.2 | Passwords hashed with Argon2id. |
| NFR-3.3 | Primary keys exposed in URLs MUST be UUIDs, not sequential integers. |
| NFR-3.4 | Every endpoint returning personal data MUST require authentication and MUST enforce scope authorisation server-side. |
| NFR-3.5 | Rate limiting on authentication endpoints; account lockout with exponential backoff. |
| NFR-3.6 | Uploaded files MUST be validated by content type, size-capped, stripped of EXIF, and stored under generated names. |
| NFR-3.7 | Dependency vulnerability scanning MUST run in CI. |
| NFR-3.8 | Secrets MUST NOT appear in the repository; environment variables only. |

### NFR-4 Privacy and compliance

| ID | Requirement |
|---|---|
| NFR-4.1 | No endpoint MUST return personal contact data to an unauthenticated caller. |
| NFR-4.2 | Consent MUST be captured at registration against a versioned privacy policy. |
| NFR-4.3 | Personal data visibility MUST default to the narrowest setting. |
| NFR-4.4 | The system MUST support subject access export and erasure requests. |
| NFR-4.5 | A documented breach response procedure MUST exist before launch. |

### NFR-5 Maintainability

| ID | Requirement |
|---|---|
| NFR-5.1 | TypeScript in strict mode across client and server; no implicit `any`. |
| NFR-5.2 | Schema changes only via versioned, reversible migrations. |
| NFR-5.3 | Business rules in the assessment engine MUST have unit tests; target 80% coverage on scoring code specifically. |
| NFR-5.4 | Every module MUST have a README explaining its purpose and boundaries. |
| NFR-5.5 | Repository MUST be under a district-owned organisation account with at least two administrators. |

### NFR-6 Usability

| ID | Requirement |
|---|---|
| NFR-6.1 | Mobile-first; all primary workflows usable one-handed on a 360 px viewport. |
| NFR-6.2 | Submitting a fellowship report MUST take under 3 minutes for a first-time user. |
| NFR-6.3 | The application MUST be installable as a PWA. |
| NFR-6.4 | WCAG 2.1 AA for contrast, focus order and form labelling. |
| NFR-6.5 | Rotaract brand marks and colours only — not Rotary wheel marks. |

---

## 5. Use case inventory

Diagrams in `04-Diagrams.md`. Descriptions of the six most complex flows follow.

### UC-01 Submit activity report
**Actor:** Club Secretary · **Trigger:** Activity held · **Precondition:** Authenticated, active appointment, period open

1. Secretary selects activity type; the form renders fields required by that type's configuration.
2. Secretary enters schedule, venue, narrative, attendance, partners, areas of focus.
3. Secretary attaches media; client compresses before upload.
4. On submit: if online, POST to API; if offline, persist to local queue and show pending state.
5. Server validates against the type's field requirements and the period's deadline.
6. Activity is stored with status `HELD`, verification `UNVERIFIED`.
7. Affected assessment criteria are marked stale for recomputation.

**Alternate 5a:** Period closed → rejected with an explanatory message and the deadline that was missed.
**Alternate 4a:** Sync conflict on reconnect → last-write-wins on the client's copy, with a conflict notice.

### UC-02 Record membership event
**Actor:** Club Secretary · **Trigger:** Member joins, leaves or transitions

1. Secretary selects event type and the person (existing or new).
2. For transfer-in, secretary selects the originating club; for transition to Rotary, the receiving Rotary club.
3. Secretary supplies effective date, member category and, for departures, a reason code.
4. Server appends to the event log and invalidates the derived roster.
5. Where the counterparty is a club in the district, a corroboration notification is queued to that club.

*The event is never edited. A correction is a new compensating event, preserving the audit trail.*

### UC-03 Author assessment framework
**Actor:** PIME Chair · **Trigger:** Start of Rotary Year

1. Chair clones the prior year's framework or starts fresh.
2. Chair defines parameters with maximum points; system validates the total against the declared framework total.
3. For each criterion: description, points, tier applicability, evaluation mode.
4. For automatic criteria, chair selects a metric resolver from the registry and configures thresholds or bands. The UI shows a live preview against last year's data.
5. Chair publishes. Framework becomes read-only; periods may now be opened.

**Alternate 4a:** No resolver exists for the intended metric → criterion falls back to assessor mode and a development request is logged.

### UC-04 Compute and finalise club assessment
**Actors:** System, Assessor, PIME Chair · **Trigger:** Nightly job, or period close

1. Scheduler selects clubs with stale assessments in open periods.
2. For each automatic criterion, the engine invokes the resolver, applies thresholds or bands, and writes points plus an evidence payload.
3. Assessor-mode criteria are queued to the assigned assessor with evidence attached.
4. Assessor scores, comments, submits.
5. When all criteria are resolved, status moves to `UNDER_REVIEW`.
6. PIME Chair finalises. Scores are frozen and published to the club.
7. Club may raise a dispute within the dispute window.

### UC-05 Reconcile district dues
**Actor:** District Treasurer · **Trigger:** Club remits payment

1. Treasurer opens the club's invoice for the year.
2. Records payment: amount, date, method, reference, evidence.
3. System recalculates invoice status: unpaid, partial, paid.
4. Receipt is generated and notified to the club president and treasurer.
5. The dues criterion in the current assessment is marked stale.

### UC-06 Roll over the Rotary Year
**Actor:** DES · **Trigger:** 1 July

1. DES opens the new Rotary Year.
2. System locks the prior year: all transactional writes rejected, reads preserved.
3. Prior-year appointments expire; new appointments must exist for access to continue.
4. Club-district and club-cluster affiliations are carried forward as proposals for confirmation.
5. Club tiers are recalculated from closing roster sizes.
6. The prior year's assessment framework is offered for cloning.

*This is the highest-risk operation in the system. It must be reversible, dry-runnable, and covered by integration tests before it is ever run in production.*

---

## 6. Assumptions and open questions

| # | Item | Owner | Needed by |
|---|---|---|---|
| A-1 | Clubs onboard fresh into DIS at charter; no migration from the incumbent system is assumed. | PIME / DRR | Nov 2026 |
| A-2 | RI club and member IDs are obtainable from district RI reports. | DES | Jan 2027 |
| A-3 | TRF contribution data remains manual entry with receipt evidence; no RI feed exists. | PIME | — |
| A-4 | Service Project Centre entries are referenced by URL, not integrated. | PIME | — |
| A-5 | Cluster structure for RY2027-28 confirmed before launch. | DRR | May 2027 |
| Q-1 | Is DIS multi-district from launch, or D9218-only with 9217 as a later tenant? | *Resolved: multi-tenant schema from day one, single tenant in production.* | — |
| Q-2 | Who holds administrator access alongside the PIME Chair? | DRR | Mar 2027 |
| Q-3 | Which notification channel do clubs actually read — email or WhatsApp? | Pilot | Apr 2027 |