# 07 — Build Roadmap

**Available:** August 2026 → June 2027 (11 months) for build, then RY2027-28 for operation.
**Capacity:** one part-time developer. Assume 10–12 productive hours a week, and assume some weeks are zero.
**Hard date:** 1 July 2027. It does not move.

The plan is built backwards from a pilot in March, not forwards from August. That is deliberate: a system that is technically finished in June and first used in July will fail in August, in public, during the first assessment period.

---

## 1. Milestones

| # | Milestone | Target | Definition of done |
|---|---|---|---|
| M0 | Foundations | Sep 2026 | Repo under district org, CI green, schema migrated, auth working, one seeded district |
| M1 | Governance core | Oct 2026 | Positions, appointments, permissions, year context. A user's access derives entirely from appointments. |
| M2 | Reporting spine | Dec 2026 | Clubs, roster, membership events, activities with media. **A club could use it for real.** |
| M3 | Offline + mobile polish | Jan 2027 | PWA installable, offline submission queue drains reliably, payload budgets met |
| M4 | Finance | Feb 2027 | Budgets, transactions, dues, TRF |
| M5 | Assessment engine | Mar 2027 | Framework authoring, 20+ resolvers, auto-scoring, assessor queue, club scorecard |
| M6 | **Pilot launch** | **Mar 2027** | 10–15 clubs running in parallel with the incumbent system |
| M7 | Goals, exports, alerts | Apr 2027 | District dashboard, XLSX export everywhere, early-warning views |
| M8 | Hardening | May 2027 | Security review, backup restore tested, load tested, audit verified |
| M9 | Onboarding | Jun 2027 | All D9218 clubs seeded, officers invited and trained, documentation published |
| M10 | **Go live** | **1 Jul 2027** | Charter day |

M2 is the real milestone. If December arrives and a club cannot submit a fellowship report end to end on a phone, the plan is behind and scope must be cut — from M4 and M7 first, never from M5.

---

## 2. Phase detail

### M0 — Foundations (Aug–Sep 2026)

Monorepo with `apps/api`, `apps/web`, `packages/contracts`. TypeScript strict everywhere. Prisma schema translated from `schema.sql`, first migration applied. Session auth, Argon2id, login and password reset. Request context middleware with district and year scoping wired in **before any feature is written** — retrofitting it is the mistake this whole architecture exists to avoid. Audit middleware. CI running lint, typecheck, tests, and `npm audit`. Deployed to staging on day one, not month six.

*Exit test:* a user logs in on staging and `GET /auth/me` returns a correct context.

### M1 — Governance core (Oct 2026)

Positions and permissions seeded from the D9218 RY2027-28 slate — that document is your fixture data, use it. Appointments with scope. Permission resolution middleware. Committees with sub-committees. Rotary Year open/lock, and the rollover job with dry-run.

*Exit test:* create a club secretary appointment; that user can write to their own club and receives `404` for any other club.

### M2 — Reporting spine (Nov–Dec 2026)

Clubs CRUD with RI IDs, affiliations, clusters, tier calculation. Persons with visibility defaults. Membership events, derived roster, membership stats. Activity types as configuration, dynamic form rendering from type config, activities with media upload, `sharp` processing, EXIF stripping, S3 storage. Verification workflow.

*Exit test:* a real club secretary, unassisted, submits a fellowship report with a photo on an Android phone in under three minutes.

Get an actual secretary to do this. Watch them. Do not ask a fellow developer.

### M3 — Offline and mobile (Jan 2027)

Service worker, PWA manifest, install prompt. IndexedDB outbox with background sync. Idempotent replay on the server. Image compression client-side before upload. Bundle analysis against the 250 KB budget. Test on a real mid-range Android on a throttled connection, not on a laptop.

*Exit test:* submit three reports in aeroplane mode, reconnect, all three appear exactly once.

### M4 — Finance (Feb 2027)

Budgets and lines, transactions, club finance summary. Dues invoices, payments, receipts, reconciliation view. Member dues with prepayment. TRF contributions with verification.

*Exit test:* the District Treasurer reconciles a partial payment and the club sees an accurate balance and receipt.

### M5 — Assessment engine (Feb–Mar 2027)

Framework authoring UI. Parameters and criteria. Rule builder for the four rule kinds. Resolver registry with 20+ resolvers. Criterion preview against historical data. Periods. Auto-scoring job. Assessor queue with evidence. Comments. Club scorecard. Disputes. Standings.

Build the resolvers with tests first — this is the one place where test-first genuinely pays for itself, because a scoring bug discovered in April is an award scandal, not a ticket.

*Exit test:* load the RY2025-26 rubric, score a sample of clubs against real 2025-26 data, and reconcile against the manual spreadsheet scores. Discrepancies are either engine bugs or spreadsheet errors — investigate every one.

That reconciliation is the single highest-value test in the project. It is also your proof to the district that the engine works.

### M6 — Pilot (Mar–Jun 2027)

Ten to fifteen clubs, running in parallel with the incumbent system. Recruit from clubs that already report well — those topping the current award lists, whose secretaries are diligent and will give you real feedback rather than silence.

Run weekly: what broke, what confused you, what took too long. Fix in the same week. Publish a visible changelog so pilot clubs see their feedback landing — that is what converts them into advocates, and advocacy is your entire go-to-market.

*Exit test:* pilot clubs prefer DIS. If they do not, do not launch. Extend the pilot and find out why.

### M7 — Goals, exports, alerts (Apr 2027)

Goals with resolvers and manual entry. Snapshot job. District dashboard. Export jobs to XLSX. Alerts: no activity in 30 days, dues unpaid, score below threshold, documents expiring.

### M8 — Hardening (May 2027)

Security review against the OWASP top ten. Verify no unauthenticated endpoint returns personal data — automate this as a test, since it is the specific failure being corrected. Rate limits. Backup restore tested end to end and documented. Load test at 3× expected concurrency. Verify the audit log captures every governed mutation. Publish the privacy policy, terms, and breach response procedure.

*Exit test:* restore last night's backup into a clean environment and confirm the application runs against it.

### M9 — Onboarding (Jun 2027)

Seed all D9218 clubs from the RI redistricting list, with RI club IDs. Invite officers. Two training sessions — one for secretaries and treasurers, one for district officers. Publish user guides as short videos, not PDFs; nobody reads PDFs on a phone. Support channel with a named human.

*Resolve before this milestone:* the redistricting list contains at least one club appearing in both the 9217 and 9218 sheets, and one entry with no club ID. Clean the source data before it becomes the system of record — a data dispute in month one destroys trust that takes a year to rebuild.

---

## 3. Working practices for a solo build

**Ship to staging from week one.** A branch that lives three weeks is a branch that no longer merges.

**Migrations are always reversible.** You will need to roll one back at an inconvenient hour.

**Write the seed script as you go.** A one-command reset to a realistic dataset is worth several hours a month, and it is what lets you test rollover and scoring repeatedly.

**Never copy production data to your laptop.** Generate volume instead. The alternative is a personal device holding three thousand people's personal data — the exact failure this project is correcting.

**Test coverage where it matters.** 80% on the scoring engine and permission resolution. Do not chase coverage on CRUD.

**Document as you build.** A decision recorded in an ADR the day you make it takes five minutes; reconstructed a year later it takes an afternoon and is usually wrong.

**Two administrators on every account** — repository, hosting, database, storage, domain — from the day each is created. Not after launch.

---

## 4. Risks

| Risk | Likelihood | Impact | Response |
|---|---|---|---|
| Developer unavailable (illness, work, life) | Medium | Critical | Ship to staging continuously; document as you go; recruit a second contributor by M4 |
| Scope creep from district requests | **High** | High | Publish a written v1 scope. Everything else goes to a v1.1 list, visibly, without argument |
| Clubs do not adopt | Medium | Critical | Pilot from March; measure time-to-submit; scorecard visibility as the hook |
| M2 slips past December | Medium | High | Cut M4 and M7 first. Never cut M5 — it is the differentiator |
| Political resistance | Medium | High | Frame as new-district infrastructure; involve the incumbent developer early and genuinely |
| RI data unavailable | Low | Medium | Design already assumes manual reference capture |
| Data protection incident | Low | Critical | Private by default in the schema; automated test that no unauthenticated route returns PII; documented breach procedure |
| Redistricting data disputes | **High** | Medium | Resolve duplicates and missing IDs before M9, in writing, with the DRR |

The two marked *High* are the ones that actually happen. Scope creep and dirty source data have ended more district systems than any technical failure.

---

## 5. Governance checklist — complete before writing production code

- [ ] Repository under a district-owned GitHub organisation, two admins
- [ ] Written statement that DIS is district property, signed by DRR and DES
- [ ] Written authorisation to process D9218 member data for assessment purposes
- [ ] Hosting, database, storage and domain accounts under district identity
- [ ] Named successor maintainer identified
- [ ] Licence chosen and applied — AGPL-3.0 if you want derivative districts to contribute back; MIT if you want the widest adoption
- [ ] Privacy policy, terms of service and breach response procedure drafted
- [ ] Written notification to the incumbent developer, from you, before anyone else raises it

The last item is not a formality. Handled well it costs you a conversation; handled badly it costs you the project.