# Claude Code — M3 Offline & Mobile · M4 Finance (revised for v1.6)

**Supersedes the earlier M3/M4 document.** Assumes `Build-Conventions-v1.6.md`.

M3 is small in code and large in debugging. M4 is the reverse — but M4's schema changed
materially under ADR-012, so read session 2 carefully before pasting it.

Paste the M1 preamble at the start of every session.

---

# M3 — Offline and Mobile (four sessions)

**Goal:** a secretary with no signal files three reports, reconnects, and finds exactly
three — not zero, not six.

Same-origin now (the SPA is served from the API container), so service worker scope is
trivial and there is no CORS in the sync path. That removes the two most common sources of
difficulty here.

---

## Session 1 — PWA shell and service worker

```
Read docs/02-Architecture.md ADR-006 and docs/01-SRS.md NFR-1, NFR-6.3.

Make apps/web an installable PWA.

- vite-plugin-pwa with a Workbox-generated service worker.
- Manifest: name, short name, Rotaract-branded icons at every required size,
  theme colour, display standalone, start URL.
- Caching:
    * app shell and hashed assets — precache, cache-first
    * GET /activity-types, /clubs, /positions — stale-while-revalidate
      (reference data that changes rarely)
    * every other API GET — network-first with a short fallback
    * NEVER cache a response containing personal data beyond the session.
      Clear ALL caches on logout. This is a data protection requirement, not
      a nicety — test it.
- Install prompt after the second visit, not the first.
- Online/offline indicator driven by navigator.onLine PLUS a lightweight
  heartbeat, because navigator.onLine lies on captive portals — which is
  exactly what a Ugandan hotel or campus wifi looks like.
- Update flow: a waiting service worker shows a "New version — reload" toast.
  Never reload under the user mid-form.

Since the SPA is served from the same origin as the API, make sure the service
worker does not intercept /api paths for caching writes — only GETs, per the
strategy above.
```

**Commit:** `feat(web): PWA shell and service worker`

---

## Session 2 — Offline submission queue

The session where correctness matters most.

```
Read docs/04-Diagrams.md §3.1 and ADR-006.

Implement the outbox in apps/web/src/lib/offline.

1. IndexedDB (idb) store 'outbox':
     { id (client UUID), endpoint, method, body, files: Blob[],
       createdAt, attempts, lastError, status }

2. Submission path for activities and membership events:
   - generate the UUID client-side
   - write to the outbox FIRST, always, online or not
   - if online, attempt immediately; on success remove
   - otherwise leave queued and register a background sync

3. Background sync drains it:
   - POST with the client UUID as the record id
   - 201 → remove
   - 409 → treat as SUCCESS and remove. This is the entire point of
     idempotency: a replay after an ambiguous failure must not duplicate.
   - other 4xx → mark failed with the error, stop retrying, surface for
     correction
   - 5xx / network → exponential backoff, cap at 10 attempts
   - files upload after the parent record succeeds

4. UI: a pending badge in the header; a /pending screen with status, retry and
   delete; queued items appear optimistically in lists, visually marked;
   failures show the reason and an edit-and-retry path.

5. Interval-based fallback where Background Sync is unsupported — iOS Safari
   does not have it.

Tests (vitest + fake-indexeddb): offline submit queues without throwing;
drain removes on 201; drain removes on 409 WITHOUT creating a duplicate; 422
marks failed and stops; backoff schedule on repeated 500s.
```

**Verify — manual, cannot be unit tested:** on a phone, aeroplane mode, submit three
reports, reconnect, confirm exactly three. Then repeat while killing the browser between
submit and reconnect.

**Commit:** `feat(web): offline submission queue`

---

## Session 3 — Payload budget

```
Read docs/01-SRS.md NFR-1. Users pay per megabyte.

1. Client-side image compression before upload: max 1600px longest edge, WebP
   where supported, target under 400KB per image. Show the before/after size —
   it builds trust that the app is not eating their data.
2. Route-level code splitting: admin, finance and assessment screens lazy.
   Keep the club-officer path (dashboard, report, activities, members) in the
   main bundle.
3. Bundle analysis in CI. Fail the build over 250KB gzipped initial JS.
4. Verify no list endpoint returns full-size image keys — lists get thumbs.
5. A data-usage note in settings showing approximate per-submission cost.

Report measured numbers: initial bundle, a typical activity list response, and
total bytes for one report submission with a photo.
```

**Commit:** `perf(web): payload budgets and image compression`

---

## Session 4 — Real device pass

Not a Claude Code session. Do it yourself, on real hardware.

**The full checklist is `docs/17-Device-Pass.md`** — written out during session 2, including
the setup that is easy to get wrong (a service worker needs a secure context, so a LAN
address tests none of it) and a table for the measured numbers. The summary below is what it
expands on.

- A mid-range Android, not your best phone, on real mobile data
- Install as a PWA from the browser
- File a report in weak signal
- Screen off mid-upload — does it complete or queue?
- Kill the browser mid-submission, reopen, confirm the queue survived
- iOS Safari: confirm the interval fallback drains
- Measure total data for a session with three reports

Every friction point logged here becomes an M6 pilot fix.

---

## M3 exit checklist

Status as at session 3. **Ticked means proven, not written.**

- [ ] Installable on Android and iOS — built (manifest, icons, prompt after the second
      visit); unverified on hardware
- [ ] Three offline submissions → exactly three records — proven in `outbox.test.ts`
      against `fake-indexeddb`; **unverified on a real phone**, which is the point of
      session 4
- [x] 409 replay never duplicates — `outbox.test.ts`, and a second drain sends nothing
- [ ] Caches cleared on logout, verified by test — `clearDeviceState()` runs on sign-out,
      but there is **no test**; Cache Storage needs a browser environment, so this wants a
      jsdom-plus-`Cache` harness or a Playwright case
- [x] Under 250KB gzipped, enforced in CI — **90.6 KB**, 36% of budget, failed by
      `scripts/bundle-budget.mjs` in the CI pipeline
- [ ] One report with photo under 500KB — compression is built and the arithmetic says yes
      (a body is a few KB, a photograph targets 400 KB), but the only honest measurement is
      on a phone with a real camera
- [ ] Tested on real hardware over real mobile data — `docs/17-Device-Pass.md`, **not run**

**Two of the seven can only be closed by session 4**, which is the point: everything the
suite can prove is proven, and what is left needs a phone.

---

# M4 — Finance (five sessions)

**Read this first.** ADR-012 removed `dues_invoices.status` and `member_dues.amount_paid`.
They are views. The earlier M4 document told you to recalculate invoice status on payment —
**do not**. Status is derived from the payments that exist.

Money is `NUMERIC` throughout. Never `FLOAT`, never JavaScript number arithmetic on
currency.

---

## Session 1 — Budgets and transactions

```
Read docs/03-Data-Model.md and docs/01-SRS.md FR-5.

Implement budgets and transactions in modules/finance.

  GET/POST/PATCH         /api/v1/budgets
  GET/POST/PATCH/DELETE  /api/v1/budgets/:id/lines
  GET/POST               /api/v1/transactions
  GET                    /api/v1/finance/summary
  GET/POST               /api/v1/finance/categories

- Budgets are unique on (ownerScopeType, ownerScopeId, rotaryYearId).
  ownerScopeId may be a club, district, region or committee — validate it
  against the caller's scopes, which now carry all four arrays.
- All money NUMERIC(14,2). Use Prisma's Decimal end to end; if a number must
  cross into the client, serialise as a string and format there. A float that
  reaches an award or a receipt is indefensible.
- budget_lines are child rows with no scope column — they inherit through
  `via` on budget. Register the rule, including the fk name.
- /finance/summary returns income, expenditure, net, and per-category variance
  against budget.
- Club SECRETARIES hold finance:read:club as well as treasurers. The incumbent
  let secretaries see collections but not expenditure — a logged complaint.
  Both roles see both.
- Approving a budget locks its lines against deletion (a guard, so:
  invariants.sql check plus the count update).

Tests: variance arithmetic against a fixture; secretary read access; treasurer
write access; a club officer cannot reach another club's finances, including
through a nested budget_lines read.
```

**Commit:** `feat(finance): budgets and transactions`

---

## Session 2 — Dues

```
IMPORTANT — schema v1.6 under ADR-012:
  dues_invoices.status does NOT exist. Invoice status is a VIEW derived from
  amount_due and the sum of confirmed dues_payments.
  member_dues.amount_paid does NOT exist. Same reasoning.
Do not add them back. Do not write status on payment. Read the view.

Implement dues in modules/finance.

  GET/POST  /api/v1/dues/invoices
  POST      /api/v1/dues/invoices/:id/payments
  GET       /api/v1/dues/status
  GET/POST  /api/v1/member-dues

- One invoice per (club, year, duesType). Bulk issue to every club in the
  district for a year in one operation, through the job queue if it is slow.
- Recording a payment inserts a row. Status follows from the view. Overpayment
  is allowed and flagged by the view, not rejected.
- Receipt numbers: sequential, unique, never reused, generated on confirmation.
  Use a database sequence and a unique constraint, not application counting —
  two concurrent confirmations must not collide.
- Confirming a payment notifies the club president and treasurer, and calls
  assessment.markStale() (dues status is a scored criterion).
- member_dues supports prepayment against a future year: scope to the target
  year, set is_prepaid.
- /dues/status returns the district-wide grid — club × status × balance — from
  the view. This is the District Treasurer's main working screen.

Tests: partial payment sequences reaching exactly PAID with no rounding drift;
receipt numbers unique under concurrent confirmation; overpayment flagged;
prepayment lands in the right year; the view agrees with hand arithmetic.
```

**Commit:** `feat(finance): dues invoicing and reconciliation`

---

## Session 3 — TRF

```
Implement TRF contributions in modules/finance.

  GET/POST  /api/v1/trf/contributions
  POST      /api/v1/trf/contributions/:id/verify
  GET       /api/v1/trf/summary

- Attach to a club; person optional (NULL = a club-level gift).
- amount_usd is NUMERIC(12,2). The rubric's bands are USD even though club
  finances are UGX — store as reported, do not convert.
- Only VERIFIED contributions count toward scoring by default. M5's
  trf.contribution_usd resolver depends on this.
- Verification calls assessment.markStale().
- /trf/summary: by club, by fund type, cumulative year-to-date, and the
  contributing-member rate.

Tests: verified-only filtering; per-club and per-fund aggregation; cumulative
YTD against a fixture.
```

**Commit:** `feat(finance): TRF contributions with verification`

---

## Session 4 — Finance UI

```
Build finance screens in apps/web/src/features/finance.

1. Club profile Finance tab: income vs expenditure, budget variance by
   category, recent transactions. Visible to secretary, treasurer, president.
2. /finance/transactions — list with filters; record income or expenditure
   with category, amount, date, description, optional evidence upload and
   optional link to an activity.
3. /finance/budget — line builder by category with a running total; submit for
   approval.
4. /finance/dues — club view: invoice, balance, payment history, receipts.
   Treasurer view: the club × status grid, record payment, bulk issue.
5. /finance/trf — record contribution, list with verification badges, club
   summary.

Format all currency with locale and currency code. Amounts arrive as strings;
never parse one into a float for display arithmetic.
```

**Commit:** `feat(web): finance screens`

---

## Session 5 — Finance hardening

```
Consolidation. No new features.

1. Audit every currency path for float contamination, client and server.
   Search for arithmetic on money fields; confirm Decimal or string handling
   throughout.
2. Verify the authorisation matrix for every finance endpoint, especially that
   a club officer cannot read another club's finances through ANY nested
   response — budget_lines, dues_payments and member_dues are all child tables
   scoped via a parent, so this is precisely where a via rule being wrong shows
   up.
3. Extend the seed with a realistic financial year: transactions across all 68
   clubs, dues invoices at mixed payment states, TRF contributions with a mix
   of verified and unverified. M5 scores against this.
4. EXPLAIN ANALYZE the finance summary and dues status views at full scale.
5. no-pii, scope-registry and invariants green.
```

**Commit:** `chore: M4 hardening`

---

## M4 exit checklist

Status at session 5. **Ticked means proven by something that runs, not written.**

- [x] No stored `status` or `amount_paid` — both read from views. Schema v2.1 also fixed
      those views to count CONFIRMED payments only; they had been counting claims, which
      would have let a self-reported payment score.
- [x] All money `NUMERIC`; no float anywhere in the path — and `doc-check.mjs` now FAILS on
      `Number(`/`parseFloat`/`parseInt` in the finance path without a `money-safe:` marker.
      Verified by introducing a violation and watching it fail.
- [x] Partial payments reach exactly `PAID` with no drift — three uneven instalments to
      1,500,000.33 in `dues.test.ts`.
- [x] Receipt numbers unique under concurrency — a database SEQUENCE, allocated by a
      trigger; eight concurrent confirmations, eight distinct numbers.
- [x] Secretaries see expenditure as well as collections — one permission covers both
      halves, and there is a test so nobody tidies it back.
- [x] Only verified TRF counts toward scoring — and verification runs both ways: a
      contribution later queried stops counting.
- [x] Cross-club finance access impossible, including through child tables —
      `finance-scope.test.ts`, six cases, every endpoint, including sideways through
      `budget_lines`, `dues_payments` and `member_dues_payments`.
- [x] Seed contains a realistic financial year across 68 clubs — 520 transactions across all
      68, 48 budgets, 68 dues invoices spread across paid/partial/unpaid/waived, 116 TRF
      contributions with a reconciliation backlog.

**All eight closed.** M4 is code-complete. What remains before the milestone can be called
done is M3's device pass, which is not an M4 item but does gate the release.

**Next:** M5 — the assessment engine.