# Claude Code — M5 Assessment Engine (revised for v1.6)

**Supersedes the earlier M5 document.** Assumes `Build-Conventions-v1.6.md`.

**The most complex milestone, and the one that justifies the project.** Eleven sessions.

Everything before this is competent record-keeping other systems also do. This is what
removes thousands of manual judgements a year and lets a club see its standing move the day
it reports.

**It is also the least forgiving.** A scoring bug that reaches production is an award
dispute in front of a room of club presidents, not a ticket. **Write the resolvers
test-first.** This is the one place in the codebase where that discipline pays for itself.

Paste the M1 preamble at the start of every session.

---

## Three schema facts that changed since the design package

Read these before session 1.

**`club_assessments.total_score`, `max_possible` and `rank_in_tier` do not exist.**
ADR-012 replaced them with `club_assessment_states`, a view. `06-Assessment-Engine.md` §5
still shows `recomputeTotal()` writing a column — it does not. Scores are stored; the total
is arithmetic over them.

**Published ranks are preserved separately.** A club published at rank 3 must not silently
become rank 4 when another club's dispute is upheld. Session 6 adds an immutable
`assessment_period_results` snapshot written at period finalisation. The live view serves
the current standings screen; the snapshot serves awards, history and anything a club was
told.

**Scoped delegates have no `upsert`.** `06-Assessment-Engine.md` §5 calls `upsertScore()`.
Use raw `INSERT … ON CONFLICT (club_assessment_id, criterion_id) DO UPDATE`, which the
resolvers directory is already permitted to write — but bind `district_id` and
`rotary_year_id` explicitly, because raw SQL bypasses the scope extension.

---

## Session 1 — Framework, parameters, criteria

```
Read CLAUDE.md axiom 5, docs/06-Assessment-Engine.md §1-3, docs/03-Data-Model.md §6.

Implement framework authoring in modules/assessment.

  GET/POST   /api/v1/assessment/frameworks
  POST       /api/v1/assessment/frameworks/:id/clone
  POST       /api/v1/assessment/frameworks/:id/publish
  GET/POST/PATCH/DELETE  /api/v1/assessment/parameters
  GET/POST/PATCH/DELETE  /api/v1/assessment/criteria
  GET/POST   /api/v1/assessment/periods
  POST       /api/v1/assessment/periods/:id/open | /close

State machine: DRAFT → PUBLISHED → LOCKED → ARCHIVED.
- Parameters and criteria editable ONLY in DRAFT.
- publish validates that the sum of parameter max_points equals
  framework.total_points; refuse otherwise, naming the shortfall. This catches
  the arithmetic error a spreadsheet cannot.
- Opening the first period against a framework moves it to LOCKED. A locked
  framework is immutable; a mid-year change requires a new version.
- clone copies the whole tree from a prior year as a fresh DRAFT.

Scoping note: AssessmentParameter and AssessmentCriterion have no district
column — they inherit through via chains ending at AssessmentFramework, two
hops for criteria. Register both, and confirm scope-registry.test.ts proves
the chain terminates.

Validate criteria.rule (JSONB) at write time against a Zod discriminated union
of the five rule kinds. Reject an AUTO criterion with no resolver_key.

Tests: publish refused on unbalanced totals; edits refused on LOCKED; clone is
independent; invalid rule shapes rejected; a criterion from another district's
framework returns 404 (the via write-check case).
```

**Commit:** `feat(assessment): framework authoring and lifecycle`

---

## Session 2 — Resolver registry and first resolvers

**Tests before implementations. Not negotiable.**

```
Read docs/06-Assessment-Engine.md §4 in full.

Build the resolver registry in modules/assessment/resolvers.

1. The Resolver type exactly as docs §4 specifies: key, label, description,
   returns, configSchema (Zod), resolve(ctx, config).
   Resolvers are PURE — they read, never write, no side effects. That is what
   makes them testable.

2. A registry with lookup by key, and GET /api/v1/assessment/resolvers
   returning key, label, description, return type and a JSON-schema rendering
   of configSchema so the UI can generate config forms.

3. SCOPING DISCIPLINE. This directory is the only place raw SQL is permitted,
   and raw SQL bypasses the scope extension entirely. Every resolver query
   MUST bind district_id, rotary_year_id and club_id from ResolverContext as
   parameters. Write a helper that produces that WHERE fragment once, and use
   it in every resolver, so the discipline is structural rather than
   remembered. Add a test that a resolver given a club in another district
   returns zero, not that club's data.

4. Implement these ten first, EACH WITH ITS TEST WRITTEN FIRST, against seed
   fixtures:

   activity.count
   activity.count_with_report
   activity.count_with_spc
   activity.count_with_partner
   activity.has_foreign_partner
   activity.sum_field
   activity.attendance_rate
   membership.net_growth
   membership.retention_rate
   membership.transitions_to_rotary

5. Every resolver returns { value, evidence }. Evidence must contain enough for
   a club president to understand the score without asking: counts, the window,
   filters applied, and contributing row ids where the count is small.

Show me the tests before the implementations.
```

**Commit:** `feat(assessment): resolver registry with core resolvers`

---

## Session 3 — Remaining resolvers

```
Same rules: tests first, pure, evidence on every return, scope fragment on
every query.

Implement the rest of the launch registry from docs/06-Assessment-Engine.md §4:

  activity.distinct_areas_of_focus     membership.growth_rate
  activity.theme_aligned_count          membership.new_clubs_sponsored
  finance.total_income                  membership.category_count
  finance.total_expenditure             dues.status
  finance.expenditure_ratio             dues.member_collection_rate
  finance.has_budget                    trf.contribution_usd
  finance.reported_fields_count         trf.contributing_member_rate
  club.has_document                     club.social_platform_count
  club.social_engagement                club.media_appearances
  club.district_activity_attendance_rate
  club.reporting_timeliness

Notes:
- dues.status reads the invoice status VIEW, not a column.
- trf.contribution_usd defaults to verified only, supports cumulative_from for
  year-to-date banding.
- club.reporting_timeliness compares activity created_at against the period's
  submission_deadline.
- club.district_activity_attendance_rate needs district-hosted activities in
  the period as denominator, club attendance as numerator.
```

**Commit:** `feat(assessment): complete resolver registry`

---

## Session 4 — Rule evaluation

```
Read docs/06-Assessment-Engine.md §3 and §5.

Implement applyRule(rule, value, maxPoints) → { points, explanation } in
modules/assessment/rules.

Five kinds:
- threshold: operator comparison, full or zero
- banded: evaluate HIGHEST FIRST, award the first match
- boolean: full or zero
- proportional: linear between floor and ceiling, configurable rounding and
  decimals; below floor zero, at or above ceiling full
- composite: mode all / any / weighted

Rules:
- Points arithmetic uses Decimal, never float. A score of 4.9999999 is
  indefensible in an award system.
- explanation is a human-readable string stored with the evidence: "3
  fellowships >= threshold 3 → full points", "USD 320 in band 300-499 → 15 of
  20". This is what a club sees when it questions a score.
- Unknown rule kind throws, naming the criterion.

Tests: every kind, plus boundaries — value exactly at a band edge, exactly at
threshold, at the proportional floor and ceiling, composite with one condition
failing under 'all' and under 'any', weighted composite summing correctly.

Boundary conditions are where scoring disputes come from. Test them hard.
```

**Commit:** `feat(assessment): rule evaluation engine`

---

## Session 5 — Scoring engine

```
Read docs/06-Assessment-Engine.md §5, and note the schema changes at the top of
this document.

Implement scoreClub(clubAssessmentId):

- Skip criteria whose applies_to_tiers excludes the club's tier.
- ASSESSOR mode: ensure a queue item exists, do not score.
- AUTO / HYBRID: resolve, apply the rule, write assessment_scores with source
  AUTO and full evidence including the rule and the computed value.
  Use raw INSERT … ON CONFLICT (club_assessment_id, criterion_id) DO UPDATE —
  scoped delegates have no upsert. Bind district_id and rotary_year_id.
- HYBRID also queues to the assessor carrying the auto points as a starting
  point.
- Clear is_stale.

DO NOT write total_score or max_possible. They are columns of
club_assessment_states, a view. max_possible in that view must be the sum of
points for criteria APPLICABLE TO THIS CLUB'S TIER — not the framework total.
A club is never penalised for criteria it was never eligible for, and standings
compare percentage of applicable points. Verify the view does this; if it does
not, fix the view (schema change + invariants check), not the engine.

Staleness: writes to activities, membership_events, trf_contributions,
dues_payments and documents call assessment.markStale(clubId, date) — the stub
wired in M2 session 9. Fill it in. Those modules must NOT import assessment
internals (CLAUDE.md dependency rule).

Scheduling: a pg-boss cron at 02:00 EAT drains stale assessments using
systemContext(districtId, yearId, 'assessment.recompute'). Plus
POST /api/v1/assessment/clubs/:clubId/recompute for on demand.

Full recomputation for all 68 clubs in a period must complete under 5 minutes
(NFR-1.6). Measure at seed scale and report the number.

Tests: tier exclusion; max_possible arithmetic from the view; staleness
propagating from an activity write; a locked framework's scores unchanged on
recompute; the ON CONFLICT path updating rather than duplicating.
```

**Commit:** `feat(assessment): scoring engine with incremental recomputation`

---

## Session 6 — Published standings snapshot

New session. This is the decision recorded in `Build-Conventions-v1.6.md` §6.

```
Add an immutable record of published standings.

MIGRATION — assessment_period_results:
  id, district_id, rotary_year_id, period_id, club_id, tier,
  total_score NUMERIC, max_possible NUMERIC, percentage NUMERIC,
  rank_in_tier INT, published_at TIMESTAMPTZ, published_by_user_id UUID
  UNIQUE (period_id, club_id)

- Written at period finalisation, never before, never updated. Add a database
  guard raising a stable SQLSTATE on UPDATE or DELETE, exactly as
  membership_events has, plus its check in invariants.sql and the count update
  in invariants.test.ts.
- Register it in platform/scope.ts.

Why it exists: club_assessment_states is a live view, so a club published at
rank 3 becomes rank 4 when another club's dispute is upheld in December, with
no record it was ever 3. Awards are adjudicated from published standings and
clubs act on what they were told. The view answers "where does this club stand
now"; the snapshot answers "what were they told in November", and both
questions are real.

Wiring:
- Period finalisation writes one row per club, computing rank within tier by
  percentage of applicable points, ties sharing a rank.
- An upheld dispute that changes a score does NOT rewrite the snapshot. It
  writes a NEW snapshot row set for a corrected publication, or — decide and
  document which — records the correction against the existing period with a
  supersedes reference. Propose both, recommend one, and tell me which you
  chose and why.
- GET /api/v1/assessment/standings reads the VIEW by default and the SNAPSHOT
  with ?published=true.

Tests: snapshot written once at finalisation; UPDATE refused by the guard;
the view and the snapshot diverge after a post-finalisation score change, and
both are readable.
```

**Commit:** `feat(assessment): immutable published standings snapshot`

---

## Session 7 — Framework authoring UI

```
Build authoring in apps/web/src/features/assessment.

1. /assessment/frameworks — list by year with status badges, clone action.
2. /assessment/frameworks/:id — the workspace:
   - parameters as collapsible sections with max points and a live running
     total against the framework total, showing shortfall or excess as you type
   - criteria within each: description, points, tier applicability
     (multi-select), evaluation mode
   - drag to reorder
3. The rule builder — the hardest UI in the system:
   - resolver picker grouped by domain, with descriptions
   - a config form generated from the resolver's configSchema
   - a rule-kind picker, then a shape-specific editor:
       threshold: operator + value
       banded: an editable band table, validated non-overlapping and descending
       proportional: floor, ceiling, rounding
       composite: conditions + mode
   - a plain-English preview of the rule as configured
4. Publish flow: validate totals, show what will lock, confirm.
5. /assessment/periods — create, open, close, with deadlines.

Make the rule builder forgiving. The PIME Chair is not a programmer, and this
screen is the difference between axiom 5 being real and being theoretical.
```

**Commit:** `feat(web): assessment framework authoring`

---

## Session 8 — Criterion preview

Small session, disproportionate value.

```
  POST /api/v1/assessment/criteria/:id/preview
  Body: { rotaryYearId, periodStart, periodEnd, sampleSize? }

Runs the criterion's resolver and rule against HISTORICAL data WITHOUT
persisting anything. Returns per club: name, tier, resolved value, points
awarded, explanation. Plus a distribution summary: how many scored full, zero,
partial; mean and median.

UI: a preview panel in the rule builder, run against last year, with a small
histogram and a per-club table.

This is how the PIME Chair discovers that a criterion scores every club full
marks (measuring nothing) or every club zero (unachievable) BEFORE publishing.
Both are common and both are invisible until you look.
```

**Commit:** `feat(assessment): criterion preview against historical data`

---

## Session 9 — Assessor workflow

```
Read docs/01-SRS.md UC-04.

  GET/POST  /api/v1/assessment/assessors    assign parameters, optionally by cluster
  GET       /api/v1/assessment/queue        the caller's outstanding items
  PUT       /api/v1/assessment/scores/:id   assessor scoring
  GET/POST  /api/v1/assessment/comments

- The queue returns only criteria assigned to this assessor, for clubs in their
  assignment scope, in open periods, unscored.
- Each item carries the EVIDENCE ALREADY ASSEMBLED: the club's relevant
  activities, counts, media and reports for that parameter. The assessor should
  not have to go looking. This is the single biggest time saving for your
  committee.
- Scoring writes source ASSESSOR with the user id and comment.
- Comments carry visibility INTERNAL or CLUB and an is_commendation flag.

UI /assessment/queue:
- work list grouped by club, with progress
- per item: criterion, guidance, points available, assembled evidence
  (activity cards, media thumbnails, report links), score input, comment box
- keyboard-driven: score, comment, next. An assessor working 68 clubs should
  never need the mouse.
- bulk action for obviously-zero cases

The comment box answers the district's own logged question — "where can PIME
leave comments for improvement or appreciation?"
```

**Commit:** `feat(assessment): assessor queue and scoring`

---

## Session 10 — Scorecards, standings, disputes

```
  GET   /api/v1/assessment/clubs               standings, filter tier/parameter
  GET   /api/v1/assessment/clubs/:clubId       full scorecard
  POST  /api/v1/assessment/clubs/:clubId/finalise
  GET   /api/v1/assessment/standings           ?published=true reads the snapshot
  GET/POST  /api/v1/assessment/disputes
  POST  /api/v1/assessment/disputes/:id/resolve

Scorecard shows, per criterion: points awarded of possible, the explanation,
the evidence, and any club-visible comment. A club must understand exactly why
it scored what it scored without asking anyone.

Finalisation: only when every applicable criterion is resolved. Freezes scores,
writes the assessment_period_results snapshot, publishes to the club, opens the
dispute window, notifies.

Disputes: raised against a criterion within the window; OPEN → UPHELD /
REJECTED / WITHDRAWN. Upholding permits a score override with source OVERRIDE,
fully audited, handled against the snapshot per session 6's decision.

UI:
1. /clubs/:id/scorecard — the club's own view. Parameter breakdown with a
   progress ring, criterion detail expanding to evidence and comments,
   comparison to tier average, and a "what would gain the most points" hint
   derived from unearned points ranked by size.
2. /assessment/standings — ranked by tier, filterable by parameter, with a
   toggle between live and as-published. Export to XLSX (M7 builds the export
   layer; stub the button).
3. Dispute raise and resolve flows.

The scorecard is the adoption hook — the reason a secretary logs in rather than
sending a WhatsApp message. Make it good.
```

**Commit:** `feat(assessment): scorecards, standings and disputes`

---

## Session 11 — Reconciliation against RY2025-26

**The most valuable test in the project, and your proof to the district.** Not really a
Claude Code session — a data exercise you drive.

```
1. Load the RY2025-26 rubric as a framework: 12 parameters, all criteria, real
   weights, real tier bands.
2. Load real RY2025-26 data for 10-15 clubs spanning all tiers and the full
   performance range.
3. Run the scoring engine against that period.
4. Compare engine output against the manual spreadsheet scores CRITERION BY
   CRITERION, not just totals. Totals can match while two criteria are wrong in
   opposite directions.
5. Investigate every discrepancy. Each is one of three things: an engine bug
   (fix it), a resolver misreading the criterion's intent (fix the rule config),
   or a spreadsheet error (document it — that is a finding worth reporting).
6. Produce a reconciliation report: per club, per parameter, engine vs manual,
   variance, explanation.
```

Three things come out of this. You find bugs unit tests cannot, because real data is
stranger than fixtures. You get an honest automation percentage rather than the estimated
80%. And you get a document that ends the debate about whether the engine works — a room of
experienced Rotaractors arguing with a criterion-by-criterion reconciliation against their
own numbers is a very different conversation from one about architecture.

**This is also your demo material and your M9 training material.** Worked examples the
incoming assessors already recognise beat any synthetic walkthrough.

**Commit:** `test(assessment): RY2025-26 reconciliation`

---

## M5 exit checklist

- [ ] Framework authoring works end to end; a non-programmer can build a rubric
- [ ] Every resolver's test written before its implementation
- [ ] Every resolver query binds district, year and club explicitly — raw SQL is unscoped
- [ ] Rule boundary conditions tested exhaustively
- [ ] `max_possible` reflects tier applicability, in the view
- [ ] No stored `total_score` or `rank_in_tier`
- [ ] `assessment_period_results` written at finalisation and guarded against update
- [ ] Staleness propagates from every relevant write
- [ ] Full recomputation under 5 minutes at 68-club scale
- [ ] Criterion preview runs against historical data
- [ ] Assessor queue carries pre-assembled evidence
- [ ] Club scorecard explains every score without human help
- [ ] Reconciliation complete, every variance explained

**Next:** M6 pilot — but see the ownership note in the M6–M9 document first. The pilot loads
real member data, and that has a prerequisite.