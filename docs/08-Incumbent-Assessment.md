# Rotary-O (rotaryo.org) — Technical & Information-Systems Assessment
**Prepared for:** Rotaract District 9218 PIME Office, RY 2027–2028
**Assessment date:** 6 August 2026
**Method:** Review of the public application surface (unauthenticated pages), the D9218 PIME 2025 workbook including the "Comments to System Developer" backlog and Assessment Criteria, the RY2027-28 secretariat slate, and the redistricting club lists.
**Scope limitation:** No authenticated areas, source code, database, or infrastructure were reviewed. Findings below are inferences from observable behaviour and from the district's own defect log. Nothing here involved probing, testing, or bypassing any control — everything cited is served publicly to anyone who visits the site.

---

## 1. Executive summary

Rotary-O is a competent **directory and event-listing website** that the district has been using as though it were a **management information system**. It is not one. That mismatch — not bad coding — is the source of most of the frustration.

Three headline conclusions:

1. **There is a critical data-protection exposure that must be fixed before anything else is discussed.** The member directory is fully public. This is a legal, reputational and member-safety issue, and it outranks every feature request in the backlog.

2. **The system is buggy because it has no domain model, not because the developer is careless.** Roughly sixty change requests in the district's own log resolve to five or six missing abstractions. Each request currently costs a hand-coded field, a hand-coded dashboard tile and a hand-coded permission check. That is a defect factory. Fix the abstractions and most of the backlog evaporates.

3. **A total rewrite inside a single one-year term is the wrong call.** The right call is a staged refactor with a hard security fix first, a schema rebuild second, and a scoring/analytics layer third — sequenced so that each phase leaves the district better off even if the next phase stalls.

---

## 2. What the system actually is today

**Observed architecture.** Server-rendered PHP application, almost certainly Yii2 (the CSRF meta-parameter naming convention `_csrf` is Yii's default). Classic monolith: controllers render full HTML pages, images served off the application filesystem, integer auto-increment primary keys exposed directly in query strings (`/search/club?id=14`, `/search/fellowship?id=4073`). Bootstrap-style responsive front end. No evidence of an API layer, no evidence of a mobile client.

That stack is fine. Yii2 is mature and perfectly capable of running a district. **The framework is not the problem.**

**Observed functional surface.**

| Layer | Present? | Notes |
|---|---|---|
| Public directory (clubs, members, fellowships, businesses, announcements) | Yes | The most polished part of the product |
| Transactional capture (club reporting by secretaries/treasurers) | Yes | Behind login; the district's backlog tells us most about it |
| Governance (roles, terms, delegated permissions, verification workflow) | Partial / hard-coded | Root cause of a large share of the backlog |
| Analytics and scoring | **Absent** | Assessment is done manually in Excel by seven named assessors |
| Decision support (alerts, early warning, shortlists) | **Absent** | |
| Integration (RI, payments, messaging) | **Absent** | |
| Export / reporting | **Absent** | The district's own note: *"Can I download a report for all clubs on something?"* — no |

An information system is *capture → validate → store → process → present → decide → feed back*. Rotary-O does capture, store and present. It does not process, decide, or feed back. That is precisely why the PIME office still maintains a 20-sheet Excel workbook by hand: **the workbook is the actual information system, and the website is its data-entry front end.**

---

## 3. Critical findings

### 3.1 Public exposure of member personal data — CRITICAL

`/search/members` serves, with **no authentication of any kind**, a paginated directory running to roughly 205 pages. Each record includes full name, photograph, club, occupation, email address, mobile telephone number, gender, and in many cases residential area. At approximately 20 records a page that is on the order of **four thousand individuals**.

`/search/clubs` additionally publishes, per club, the named club officer with their personal mobile and email, plus the club's regular meeting **venue, day and time**.

Why this is severe:

- **Legal.** Uganda's Data Protection and Privacy Act, 2019 requires a lawful basis and, in practice, informed consent for collecting and disclosing personal data, obliges controllers to secure it, and obliges registration with the Personal Data Protection Office. The district is a data controller here regardless of who wrote the software. There is no visible privacy notice — the footer links to `/privacy` and `/terms` sit alongside `/about` and `/how-it-works`, **both of which return 404**, which suggests the legal pages may be equally unfinished.
- **Rotary policy.** RI's data-protection framework does not contemplate open publication of member contact data. The district's exposure here is also an exposure for RI.
- **Member safety.** Name + photograph + gender + phone + residential area + a published weekly meeting venue and time is, functionally, a stalking kit. It is also a turnkey list for mobile-money fraud, SIM-swap attempts, and phishing that impersonates district leadership — and this membership skews young, professional and trusting of anything carrying Rotary branding.
- **Scrapability.** Sequential integer IDs plus unauthenticated read endpoints mean the entire dataset can be harvested by anyone in an afternoon. It may already have been.

**Recommended action, this month, not next term:**

1. Put `/search/members` behind authentication immediately. If a public directory is genuinely wanted, publish name and club only — no contact details, no gender, no location.
2. Reduce club listings to a club-owned contact channel (a role-based address such as `secretary@club…`, or a WhatsApp link the club controls), not an individual's personal number.
3. Add `noindex` headers and a `robots.txt` disallow on directory paths, then request removal of cached pages from search engines.
4. Publish a real privacy notice and terms of service; add explicit consent capture at the point of member registration, with a visibility toggle per member.
5. Notify the DRR and the incoming district leadership in writing. Log it. If personal data has been exposed at this scale, the district should be documenting its response.

This one item is worth more to D9218 than the entire rest of this document.

### 3.2 Single-person dependency and no institutional ownership

The system's stated contact is a personal Gmail address and a personal mobile number. The footer credits an individual developer. There is no evidence that the district controls the source repository, the domain registration, the hosting account, or the database backups.

The district's award decisions, membership records, dues reconciliation and TRF tracking all live in this system. If the developer becomes unavailable in April — DISCON and awards season — the district has no recovery path.

**Recommended action:** before RY2027-28 begins, execute a written agreement covering source-code escrow or repository transfer to a district-controlled organisation account, domain and hosting credentials held by the District IT Officer and DES, documented daily off-site backups with a tested restore, and a defined support SLA. This is governance, not engineering, and it costs nothing but a conversation.

---

## 4. Root-cause analysis: why the backlog never ends

The district's "Comments to System Developer" sheet contains roughly sixty requests. Read as an engineer rather than as a user, they cluster into six missing abstractions. Nearly every request is a symptom of one of these.

### 4.1 The Rotary Year is not a first-class dimension

*Evidence from the backlog:* "archive committee details for the previous year, let only this year be displayed"; "filter out data for the previous year and this year separately"; "allow data of the previous committees to be retained in club history"; "don't show flyers that are in 2037".

Records are being stored without a year context, so the application resorts to ad-hoc filtering and manual archiving. Every list view then needs its own bespoke year logic, and each one is a fresh bug.

**Fix:** a `rotary_year` entity (1 July – 30 June) referenced by every transactional table, with a single session-level "current year" context that every query respects by default. Historical years become read-only automatically at rollover. This alone retires perhaps a dozen backlog items and eliminates the annual manual archiving ritual.

### 4.2 Officers are attached to people, not to terms

*Evidence:* "let the active ADRR be displayed, the rest archived"; "add DISCON chair position"; "allow chairs to create their own sub-committee, enter position and select the person"; "allow ADRRs to automatically reflect under club details"; "list of all presidents from all clubs".

Positions appear to be hard-coded. Every new role — and D9218's RY2027-28 slate has more than thirty distinct positions, several of them new — requires a code change.

**Fix:** three tables. `position` (name, scope: club/cluster/district, permission set) — administrator-editable. `org_unit` (district, cluster, club). `appointment` (person, position, org_unit, rotary_year, start, end). Permissions derive from the current appointment, not from a hard-coded role column. Then the incoming PIME Chair can add "Deputy District Learning Facilitator" without phoning a developer, and dashboard access questions — "let PIME, DES, DRR and LDRRs view all committee reports" — become a permission-matrix configuration rather than six separate code changes.

### 4.3 There is no unified Activity model

*Evidence:* "separate community service from international service"; "add Club Assembly to activities"; "add Club In-House Trainings"; "add ADRR Visit as a category"; "break district activities into ROLI, REI, presidential forums"; "add a column for photo/report link"; "add photos_link and reports_link to ADRR activity"; "extra activities should not require a photo".

Each activity type appears to have been built as its own form and its own table. So each new type is new code, and cross-cutting fields (report link, photo link, attendance, partners, areas of focus) have to be added type by type — which is exactly what those requests are asking for, one at a time, forever.

**Fix:** one `activity` table with a `activity_type` lookup that administrators maintain, a shared core of fields (date, host org_unit, title, description, attendance, report URL, media URLs, partners, Rotary areas of focus, RI Service Project Centre reference), and a light attribute mechanism for the few genuinely type-specific fields. New activity types then become a data entry, not a release.

### 4.4 Membership is stored as state, not as events

*Evidence:* "a separate transitioned members report"; "add reason why the member left"; "a report for all members that have left across all clubs"; "show the percentage of members that have joined vs left"; "select whether it's corporate, honorary, newly inducted"; "ask if he is from another club and enter the from club"; "add RI Number for every member".

The system evidently holds a current roster. Every one of those requests is asking a question about *change over time*, which a current roster cannot answer.

**Fix:** a `membership_event` log — join, induct, transfer in, transfer out, terminate, transition to Rotary, reinstate — each with effective date, reason code, member type, and counterparty club. Current roster becomes a derived view. Then retention rate, net growth, transition count, churn by club, and reason-for-leaving analysis are all *queries*, not features. Given that the district's own goals include 98% retention, 1,000 net growth and 60 transitions to Rotary, this is not optional.

Add `ri_member_id` and `ri_club_id` as required fields. The redistricting workbook already carries RI club IDs (e.g. 8825240); the reporting system does not use them, which means every cross-reference between Rotary-O and RI data is currently done by matching club *names* — and the district has already logged the resulting failure: *"naming of clubs, system vs assessment criteria."*

### 4.5 There is no scoring engine — the assessment is entirely manual

This is the largest missed opportunity in the system.

The district operates a rigorous 100-point, 12-parameter assessment (membership, service projects, international service, youth programmes, public relations, PLD, fellowships, district activities, TRF, club stewardship, financial reporting, ADRR assessment). Roughly 140 clubs are assessed monthly and quarterly. Seven named assessors do this by hand, reading the system and typing into Excel.

Most of that scoring is mechanical and derivable from data already in the database. Fellowship count against a monthly minimum, average attendance against 50%, number of social platforms linked, service projects with shared reports, tree-planting component present, dues paid, expenditure proportional to income — these are arithmetic, not judgement.

**Fix:** a configurable rules engine. Each assessment criterion becomes a database row with a parameter, a weight, a data source and an evaluation rule. Automatable criteria compute nightly. Genuinely subjective criteria — quality of reporting, ADRR assessment, general attitude — are surfaced to the assigned assessor as a short queue with the supporting evidence already assembled. Critically, **the criteria must be editable by the PIME Chair through the interface**, because they change every year, and hard-coding this year's rubric simply relocates the problem.

Downstream benefits: live club leaderboards, real-time award shortlisting, clubs able to see their own score and act on it during the year rather than learning at DISCON, and the disappearance of an enormous manual workload from your committee.

The district's own note — *"where can PIME leave comments for improvement or appreciation?"* — is the other half of this. The system is currently write-only for clubs and read-only for the district. A closed loop needs assessor comments, a query-back mechanism, and a verification state on each submission (submitted → verified → scored → disputed).

### 4.6 No export layer, no analytics layer

*Evidence:* *"Can I download a report for all clubs on something — say projects, or international service, for that month?"*

Everything is a screen. Nothing is a file. That is the single reason the PIME workbook exists in its current form, and it is why the District Performance sheet — eighteen goal items tracked against targets, updated monthly by hand — is maintained manually when every one of those numbers is already in the database.

**Fix:** CSV and XLSX export on every list view, filtered by year and org unit. Then a district goals dashboard where each goal item is a row with target, current value from a defined query, and a trend. The monthly performance review stops being a data-collection exercise and becomes an actual review.

---

## 5. Secondary technical findings

**Data quality.** The public fellowship feed shows apparent duplicate submissions (identical title, identical uploaded image, adjacent record IDs). There appear to be no uniqueness constraints and no de-duplication. Club names are free text and inconsistent between the system, the assessment criteria, and RI records. *Note also that the redistricting workbook itself lists at least one club — Nakawa, RI ID 16277 — in both the 9217 and 9218 sheets. Resolve that before it becomes a system-of-record dispute.*

**Media handling.** Uploaded images are stored on the application filesystem with timestamp-prefixed original filenames retaining spaces and apostrophes — fragile, and a poor practice on principle. There is no evidence of server-side resizing: full-resolution phone photographs appear to be served directly into grid layouts. On Ugandan mobile data, that is slow and expensive for exactly the club secretaries you need to report every week. Move to object storage, generate thumbnails, serve via CDN, and enforce access control on media belonging to non-public records.

**Broken public surface.** `/about` and `/how-it-works` return 404 from the site's own footer. Social links in the footer point to `#`. The district log notes "social links not clickable" and "links are locked". These are small, but they are the first thing a prospective member or corporate partner sees.

**Validation.** "Project form field should not limit the words", "extra activities should not require a photo" — validation rules are hard-coded and mismatched to real reporting practice. Field-level requirements should be configurable per activity type.

**Branding.** The district has twice asked for the Rotary logo and copyright footer to be corrected to Rotaract. Rotaract has had its own brand mark since the 2019 identity refresh, and RI brand compliance is itself a scored criterion in your own rubric. It is embarrassing for the assessment system to fail the assessment.

**Auditability.** No visible audit trail. A system that determines awards, dues status and club standing needs immutable logging of who changed what and when, plus soft deletes. Expect disputes; you will need the record.

**No notification infrastructure.** The backlog asks for birthday emails, fellowship reminders, dues receipts. These are all instances of one missing capability: a queued notification service with templates, delivery over email and WhatsApp, and a log. Build the capability once rather than three one-off features.

---

## 6. Recommendation: refactor in place, do not rewrite

**The honest engineering call is: do not attempt a big-bang rewrite during your term.**

The reasons are practical rather than sentimental. Capacity appears to be roughly one developer. The system is live and load-bearing — a rewrite means running two systems and reconciling them, which in practice means neither is trusted. A twelve-month term is the worst possible window for a rewrite: you would inherit nothing, hand over a half-migrated system, and your successor would inherit a mess with none of the context. And the existing product's public directory and event listing genuinely work.

Equally, patching will not fix it, because the backlog is generated by missing abstractions rather than missing features. Adding the sixty requested items to the current structure produces a system with sixty more places to break.

The middle path is a **staged refactor** — replace the internals module by module behind a stable interface, in an order where each phase is independently valuable.

### Phase 0 — Security and compliance (now, before your term)
Member directory behind authentication. PII removed from public pages. Privacy notice and terms published. Consent captured. Footer 404s fixed. Backups verified and credentials transferred to district control. **Four to six weeks. No new features.**

### Phase 1 — Schema foundation (Jul–Oct 2027)
Rotary year dimension. Position and appointment model. Unified activity model. Membership event log. RI identifiers on clubs and members. Data migration and cleanup, including the redistricting split. Export on every view. **A feature freeze during this phase is essential** — and this is the hardest thing you will have to hold the line on politically, because clubs will keep asking for tiles.

### Phase 2 — The information system proper (Nov 2027–Feb 2028)
Configurable assessment rules engine. Assessor workflow with verification states and comments. District goals dashboard. Club self-service scorecards. Notification service. **This is the phase that changes what PIME does.**

### Phase 3 — Integration and handover (Mar–Jun 2028)
Dues payment integration. RI reference capture and reconciliation workflow. Audit trail. Documentation, admin training, and a written handover to RY2028-29. **Ending your term with the system documented and owned is as important as any feature.**

If a rewrite is genuinely wanted, the only responsible time to start it is at the beginning of a term with a two-year committed team and a funded budget — and even then, the phases above are the specification you would build from.

---

## 7. Immediate next steps for the PIME office

1. **Raise 3.1 with the DRR this week.** Written, dated, unemotional. Ask for a remediation deadline. This is a district liability, and it should not sit in a committee inbox.
2. **Convene the developer, the District IT Officer and the Deputy PIME Chair** for a working session on Section 4. Bring the six abstractions, not the sixty tickets. If the developer agrees with the diagnosis, you have a partner; if not, you know something important early.
3. **Get the governance agreement signed** — repository, domain, hosting, backups, SLA — before any development money is spent.
4. **Convert the assessment rubric into a formal specification** (parameter, weight, data source, evaluation rule, automatable yes/no) as the input document for Phase 2. Do this while it is still fresh from RY2025-26.
5. **Treat the redistricting as the migration event it is.** D9218 launches with roughly 900 clubs' worth of records to partition cleanly. Whether the system becomes properly multi-district or D9218 stands up its own instance is a decision worth making deliberately, on the record, in the next few months — not discovered in June 2027.

---

*Assessment prepared as an independent technical review. Findings in Section 3.1 were observable from ordinary public browsing and are shared here solely to enable remediation.*
