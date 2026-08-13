# 06 — The Assessment Engine

This is the component that justifies the project. Everything else is competent record-keeping that other systems also do. This is the part that removes thousands of manual judgements a year and lets a club see its standing move the day it reports.

---

## 1. Design principles

1. **The rubric is data.** Parameters, criteria, weights and thresholds are rows the PIME Chair edits in the interface.
2. **No SQL in configuration.** A criterion names a **resolver** from a code registry and supplies parameters. Storing SQL in a database column is a SQL-injection vector authored by your own administrators, and it makes the engine untestable.
3. **Every score carries its evidence.** `assessment_scores.evidence` records what the resolver saw. A score you cannot explain to a club president in April is worse than no score.
4. **Resolvers are pure.** Input: club, period, config. Output: value plus evidence. No writes, no side effects. This is what makes them unit-testable, and the scoring engine is the one place in this codebase where test coverage is non-negotiable.
5. **Frameworks lock.** Once a period opens against a framework, the rubric is immutable. Mid-year rule changes require a new version and never retroactively rescore.
6. **Derive, don't declare.** Where a fact can be computed from structured data, never let a club self-report it. International service qualifies because a partner has a non-Uganda country code — not because someone ticked a box.

---

## 2. Structure

```
Framework  (RY2027-28, v1, 100 points, LOCKED)
└── Parameter  "Service Projects"  max 18
    ├── Criterion  "Report shared"                      2 pts   AUTO
    ├── Criterion  "Reported on RI Service Project Ctr" 4 pts   AUTO
    ├── Criterion  "Involved other partners"            1 pt    AUTO
    ├── Criterion  "Tree planting component"            2 pts   AUTO
    ├── Criterion  "Addresses a Rotary area of focus"   1 pt    AUTO
    └── Criterion  "Quality and depth of impact"        8 pts   ASSESSOR
```

Published frameworks validate that the sum of parameter maxima equals `total_points`. Refusing to publish an unbalanced rubric catches the arithmetic error the spreadsheet cannot.

---

## 3. The rule DSL

`assessment_criteria.rule` is JSONB. Four rule shapes cover essentially every criterion in the district's existing rubric.

### 3.1 Threshold — all-or-nothing

```json
{
  "kind": "threshold",
  "resolver": "activity.count",
  "config": { "category": "FELLOWSHIP", "status": "HELD" },
  "operator": ">=",
  "value": 3,
  "award": "full"
}
```
*"Minimum of 3 fellowships in a month" — 2 points.*

### 3.2 Banded — tiered thresholds

```json
{
  "kind": "banded",
  "resolver": "trf.contribution_usd",
  "config": { "cumulative_from": "2027-07-01" },
  "bands": [
    { "min": 500, "points": 20 },
    { "min": 300, "points": 15 },
    { "min": 200, "points": 10 },
    { "min": 100, "points": 5 },
    { "min": 0,   "points": 2 }
  ]
}
```
*TRF for T1 and IBC clubs. Bands evaluate highest-first. The T2 variant is a separate criterion with different band values and `applies_to_tiers: ["T2"]` — which is exactly how the existing rubric works, and now it is expressed rather than remembered.*

### 3.3 Boolean — a fact is true

```json
{
  "kind": "boolean",
  "resolver": "club.has_document",
  "config": { "doc_type": "URSB_CERT", "must_be_verified": true },
  "award": "full"
}
```

### 3.4 Proportional — score scales with achievement

```json
{
  "kind": "proportional",
  "resolver": "activity.attendance_rate",
  "config": { "category": "FELLOWSHIP" },
  "floor": 0.5,
  "ceiling": 1.0,
  "rounding": "half_up",
  "decimals": 1
}
```
*Below the floor scores zero; at or above the ceiling scores full; between them, linear.*

### 3.5 Composite — several conditions

```json
{
  "kind": "composite",
  "mode": "all",
  "conditions": [
    { "resolver": "activity.count",
      "config": { "category": "INTERNATIONAL" }, "operator": ">=", "value": 1 },
    { "resolver": "activity.has_foreign_partner",
      "config": {}, "operator": "==", "value": true }
  ],
  "award": "full"
}
```
`mode` is `all`, `any`, or `weighted` (each condition carries a fraction of the points).

---

## 4. The resolver registry

Resolvers are named TypeScript functions. The registry is the contract between configuration and code, and `GET /assessment/resolvers` exposes it so the UI can render a picker with per-resolver config forms.

```ts
export type ResolverContext = {
  clubId: string;
  districtId: string;
  rotaryYearId: string;
  periodStart: Date;
  periodEnd: Date;
  tier: 'T1' | 'T2' | 'IBC';
};

export type ResolverResult = {
  value: number | boolean;
  evidence: Record<string, unknown>;
};

export type Resolver = {
  key: string;
  label: string;
  description: string;
  returns: 'number' | 'boolean';
  configSchema: z.ZodTypeAny;
  resolve: (ctx: ResolverContext, config: unknown) => Promise<ResolverResult>;
};
```

### Launch registry

| Key | Returns | Purpose |
|---|---|---|
| `activity.count` | number | Activities by category/type, status HELD |
| `activity.count_with_report` | number | Activities carrying a narrative or report URL |
| `activity.count_with_spc` | number | Reported to RI Service Project Centre |
| `activity.count_with_partner` | number | Involving partners, optionally by partner type |
| `activity.has_foreign_partner` | boolean | Any partner with `country_code <> 'UG'` |
| `activity.sum_field` | number | Sum of `trees_planted`, `beneficiaries_count`, `funds_raised` |
| `activity.attendance_rate` | number | Mean attendance ÷ roster size |
| `activity.distinct_areas_of_focus` | number | Breadth of areas addressed |
| `activity.theme_aligned_count` | number | Aligned to the monthly Rotary theme |
| `membership.net_growth` | number | Net change over the period |
| `membership.growth_rate` | number | Net change ÷ opening roster |
| `membership.retention_rate` | number | 1 − (leavers ÷ opening roster) |
| `membership.transitions_to_rotary` | number | Corroborated transitions |
| `membership.new_clubs_sponsored` | number | Clubs chartered with this club as sponsor |
| `membership.category_count` | number | Honorary or corporate members added |
| `finance.total_income` / `total_expenditure` | number | |
| `finance.expenditure_ratio` | number | Expenditure ÷ income |
| `finance.has_budget` | boolean | Approved budget exists |
| `finance.reported_fields_count` | number | Completeness of financial reporting |
| `dues.status` | boolean | District dues paid or fully paid |
| `dues.member_collection_rate` | number | Members paid ÷ roster |
| `trf.contribution_usd` | number | Verified contributions, cumulative or period |
| `trf.contributing_member_rate` | number | Members who contributed ÷ roster |
| `club.has_document` | boolean | Verified document of a given type |
| `club.social_platform_count` | number | Active social accounts |
| `club.social_engagement` | number | Posts in the last 30 days |
| `club.media_appearances` | number | Mainstream media appearances |
| `club.district_activity_attendance_rate` | number | District activities attended ÷ held |
| `club.reporting_timeliness` | number | Reports filed before deadline ÷ total |

**Adding a resolver is the only reason the engine should ever need a code change.** Everything else is configuration. When the PIME Chair wants a metric that does not exist, the criterion falls back to `ASSESSOR` mode and a development request is logged — the rubric is never blocked on a deployment.

### Example implementation

```ts
export const trfContributionUsd: Resolver = {
  key: 'trf.contribution_usd',
  label: 'TRF contribution (USD)',
  description: 'Verified Rotary Foundation contributions attributed to the club.',
  returns: 'number',
  configSchema: z.object({
    fundTypes: z.array(z.string()).optional(),
    cumulativeFrom: z.string().date().optional(),
    verifiedOnly: z.boolean().default(true),
  }),
  async resolve(ctx, config) {
    const cfg = this.configSchema.parse(config);
    const from = cfg.cumulativeFrom ? new Date(cfg.cumulativeFrom) : ctx.periodStart;

    const rows = await sql<{ total: string; n: number }[]>`
      SELECT COALESCE(SUM(amount_usd), 0) AS total, COUNT(*)::int AS n
      FROM trf_contributions
      WHERE club_id        = ${ctx.clubId}
        AND rotary_year_id = ${ctx.rotaryYearId}
        AND contributed_on BETWEEN ${from} AND ${ctx.periodEnd}
        ${cfg.verifiedOnly ? sql`AND verification = 'VERIFIED'` : sql``}
    `;

    return {
      value: Number(rows[0].total),
      evidence: {
        totalUsd: Number(rows[0].total),
        contributionCount: rows[0].n,
        window: { from, to: ctx.periodEnd },
        verifiedOnly: cfg.verifiedOnly,
      },
    };
  },
};
```

The `evidence` object is the whole defence of the score. When a club argues, you show them the window, the count and the filter — and either they are wrong, or you have found a real bug. Both outcomes are good.

---

## 5. Execution

```ts
async function scoreClub(clubAssessmentId: string) {
  const ca       = await loadClubAssessment(clubAssessmentId);
  const criteria = await loadCriteria(ca.periodId);
  const ctx      = buildResolverContext(ca);

  for (const c of criteria) {
    if (!c.appliesToTiers.includes(ca.tier)) continue;      // TIER_NOT_APPLICABLE
    if (c.evaluationMode === 'ASSESSOR') { await ensureQueued(ca, c); continue; }

    const resolver = registry.get(c.resolverKey);
    const { value, evidence } = await resolver.resolve(ctx, c.rule.config);
    const points = applyRule(c.rule, value, c.points);

    await upsertScore({
      clubAssessmentId: ca.id, criterionId: c.id,
      pointsAwarded: points, pointsPossible: c.points,
      source: 'AUTO', evidence: { ...evidence, rule: c.rule, computed: value },
    });

    if (c.evaluationMode === 'HYBRID') await ensureQueued(ca, c, { autoPoints: points });
  }

  await recomputeTotal(ca.id);
  await clearStale(ca.id);
}
```

**Denominator rule.** `max_possible` is the sum of `points` for criteria that apply to the club's tier — not the framework total. A club is never penalised for criteria it was never eligible for. Standings compare percentage of applicable points, which is the only fair comparison across tiers.

**Triggering.** Writes to activities, membership events, TRF contributions, dues payments and documents set `is_stale` on affected assessments. A pg-boss cron drains stale assessments nightly at 02:00 EAT; `POST /assessment/clubs/:id/recompute` forces it immediately.

---

## 6. Automation coverage of the existing rubric

The district's RY2025-26 criteria, classified against the launch registry:

| Parameter | Automatable | Assessor | Note |
|---|---|---|---|
| Membership (10) | 8 | 2 | Growth, retention, transitions all derivable |
| Service Projects (10) | 10 | 0 | Fully mechanical |
| International Service (5) | 5 | 0 | Foreign partner is a data fact |
| Youth Programmes (5) | 3 | 2 | Partner involvement is judgement |
| Public Relations (10) | 6 | 4 | Brand compliance needs human eyes |
| PLD (10) | 5 | 5 | "Quality reporting" is inherently judged |
| Fellowships (5) | 5 | 0 | Count, theme alignment, attendance |
| District Activities (5) | 5 | 0 | Attendance-derived |
| TRF (20) | 20 | 0 | Banded, from verified contributions |
| Club Stewardship (10) | 8 | 2 | Documents and dues |
| Financial Reporting (5) | 5 | 0 | Field completeness |
| ADRR Assessment (5) | 0 | 5 | Judgement by design |
| **Total** | **80** | **20** | |

Roughly **80% of scoring automates**. Seven assessors currently produce those 100 points by hand for every club, every month. After launch they produce 20, with the supporting evidence already assembled.

This is the number to put in front of the DRR. Not the architecture.

---

## 7. Rubric design guidance for the PIME Chair

Some of these are engineering observations about the current rubric that are worth raising with the incoming team.

**Reporting discipline is currently a gateway disguised as a metric.** Under the existing criteria, a club that does excellent work but reports poorly scores badly on *every* parameter, because unreported work is invisible. That is defensible — but it is a structural property, not a criterion, and it should be stated openly rather than emerge as an accident of measurement.

**Beware criteria that reward volume over impact.** "Minimum three fellowships a month" is easy to measure and easy to game. Consider pairing volume criteria with an attendance-rate or quality criterion so that three empty fellowships do not outscore one good one.

**Tier fairness needs deliberate thought.** A 40-member T2 club and a 15-member IBC face genuinely different constraints on TRF, attendance and project scale. Tier-specific bands already exist in the current rubric for TRF; consider whether membership growth needs the same treatment, since a 25% growth target is far harder at 40 members than at 12.

**Use `POST /assessment/criteria/:id/preview` before publishing.** Run every new criterion against last year's data. If a criterion scores every club full marks, it measures nothing. If it scores every club zero, it is unachievable. Both are common and both are invisible until you look.

**Publish the rubric to clubs on day one of the year.** A rubric that clubs cannot see is not a performance management tool; it is a surprise at DISCON. The single largest behavioural gain from this system is clubs knowing, in August, what they need to do by April.