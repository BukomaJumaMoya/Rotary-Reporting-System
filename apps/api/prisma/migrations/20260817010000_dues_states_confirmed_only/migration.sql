-- ---------------------------------------------------------------------
-- M4 session 2 — the dues state views counted UNCONFIRMED payments.
--
-- Found by a test that expected an unconfirmed payment to leave an invoice
-- PARTIAL and got PAID.
--
-- Both views summed every row in the payments table regardless of
-- `confirmed_at`, which made the confirmation step decorative: it issued a
-- receipt number and changed nothing else. Three things were wrong with
-- that, in increasing order of seriousness.
--
--   1. `confirmed_at` recorded nothing that mattered. A district treasurer
--      entering a payment they had not yet verified against the bank
--      immediately marked the club paid.
--
--   2. It contradicts this milestone's own design. Confirming is what
--      issues the receipt number and what calls assessment.markStale() —
--      and marking a scorecard stale at confirmation only makes sense if
--      the status CHANGES at confirmation.
--
--   3. `dues.status` is a SCORED CRITERION (06-Assessment-Engine §168:
--      "District dues paid or fully paid"). The moment clubs are given
--      their own submission endpoint — which the design anticipates — an
--      unconfirmed self-reported payment would award points for money
--      nobody has seen. That is not a reporting inconvenience; it is an
--      award scandal with a clean audit trail showing exactly how.
--
-- So: a payment counts when it is CONFIRMED. Recording one is a claim,
-- confirming it is the district agreeing the money arrived, and the status
-- follows the second of those.
--
-- Still derived, still no stored column, still nothing to drift (ADR-012).
-- ---------------------------------------------------------------------

DROP VIEW IF EXISTS dues_invoice_states;
DROP VIEW IF EXISTS member_dues_states;

CREATE VIEW dues_invoice_states AS
SELECT i.id            AS invoice_id,
       i.district_id,
       i.rotary_year_id,
       i.club_id,
       i.dues_type,
       i.amount_due,
       i.due_on,
       COALESCE(p.paid, 0) AS amount_paid,
       GREATEST(i.amount_due - COALESCE(p.paid, 0), 0) AS amount_outstanding,
       CASE WHEN i.waived_at IS NOT NULL             THEN 'WAIVED'::invoice_status
            WHEN COALESCE(p.paid, 0) >= i.amount_due THEN 'PAID'::invoice_status
            WHEN COALESCE(p.paid, 0) > 0            THEN 'PARTIAL'::invoice_status
            ELSE                                         'UNPAID'::invoice_status
       END AS status
FROM dues_invoices i
LEFT JOIN LATERAL (
  SELECT SUM(amount) AS paid
    FROM dues_payments
   WHERE invoice_id = i.id
     AND confirmed_at IS NOT NULL
) p ON TRUE;

CREATE VIEW member_dues_states AS
SELECT m.id AS member_dues_id,
       m.district_id,
       m.rotary_year_id,
       m.club_id,
       m.person_id,
       m.amount_due,
       m.is_prepaid,
       COALESCE(p.paid, 0) AS amount_paid,
       GREATEST(m.amount_due - COALESCE(p.paid, 0), 0) AS amount_outstanding
FROM member_dues m
LEFT JOIN LATERAL (
  SELECT SUM(amount) AS paid
    FROM member_dues_payments
   WHERE member_dues_id = m.id
     AND confirmed_at IS NOT NULL
) p ON TRUE;

-- The confirmed-only predicate is now on the hot path of both views.
CREATE INDEX dues_payments_confirmed
  ON dues_payments (invoice_id)
  WHERE confirmed_at IS NOT NULL;

CREATE INDEX member_dues_payments_confirmed
  ON member_dues_payments (member_dues_id)
  WHERE confirmed_at IS NOT NULL;
