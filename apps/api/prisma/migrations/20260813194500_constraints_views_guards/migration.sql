-- =====================================================================
-- Everything in docs/schema.sql that Prisma cannot express.
--
-- Five kinds of object live here, and each is here for a stated reason:
--   1. CHECK constraints        — Prisma has no concept of them
--   2. Partial indexes          — Prisma cannot express a WHERE clause
--   3. Expression indexes       — Prisma cannot index an expression
--   4. NOT NULL on array columns — Prisma list fields are always nullable
--   5. Views, the materialised roster, and the guard triggers
--
-- KEEP THIS FILE IN STEP WITH docs/schema.sql. A constraint added there and
-- not here exists in the design and not in the database.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. CHECK constraints
-- ---------------------------------------------------------------------
ALTER TABLE rotary_years
  ADD CONSTRAINT ry_dates CHECK (ends_on > starts_on);

ALTER TABLE clubs
  ADD CONSTRAINT clubs_meeting_day CHECK (meeting_day BETWEEN 0 AND 6);

ALTER TABLE committees
  ADD CONSTRAINT committees_not_self_parent CHECK (parent_committee_id IS DISTINCT FROM id);

ALTER TABLE membership_events
  ADD CONSTRAINT me_correction_supersedes
  CHECK (event_type <> 'CORRECTION' OR supersedes_event_id IS NOT NULL);

ALTER TABLE activities
  ADD CONSTRAINT act_dates CHECK (ends_at IS NULL OR ends_at >= starts_at),
  ADD CONSTRAINT act_non_negative CHECK (
    attendance_members >= 0 AND attendance_visitors >= 0 AND
    attendance_guests  >= 0 AND beneficiaries_count >= 0 AND
    trees_planted      >= 0 AND funds_raised        >= 0 AND
    volunteer_hours    >= 0
  );

ALTER TABLE budget_lines
  ADD CONSTRAINT budget_lines_amount_non_negative CHECK (amount_planned >= 0);

ALTER TABLE financial_transactions
  ADD CONSTRAINT ft_amount_non_negative CHECK (amount >= 0);

ALTER TABLE dues_invoices
  ADD CONSTRAINT dues_invoices_amount_non_negative CHECK (amount_due >= 0);

ALTER TABLE dues_payments
  ADD CONSTRAINT dues_payments_amount_non_negative CHECK (amount >= 0);

ALTER TABLE member_dues
  ADD CONSTRAINT member_dues_amount_non_negative CHECK (amount_due >= 0);

ALTER TABLE member_dues_payments
  ADD CONSTRAINT member_dues_payments_amount_non_negative CHECK (amount >= 0);

ALTER TABLE trf_contributions
  ADD CONSTRAINT trf_amount_non_negative CHECK (amount_usd >= 0);

ALTER TABLE assessment_parameters
  ADD CONSTRAINT parameter_points_non_negative CHECK (max_points >= 0);

ALTER TABLE assessment_criteria
  ADD CONSTRAINT criterion_points_non_negative CHECK (points >= 0),
  ADD CONSTRAINT criterion_resolver_required
  CHECK (evaluation_mode = 'ASSESSOR' OR resolver_key IS NOT NULL);

ALTER TABLE assessment_periods
  ADD CONSTRAINT period_dates CHECK (ends_on >= starts_on),
  ADD CONSTRAINT period_dispute_window
  CHECK (dispute_closes_at IS NULL OR dispute_closes_at >= submission_deadline);

-- The one that stops an award scandal: a club cannot be given more than a
-- criterion is worth.
ALTER TABLE assessment_scores
  ADD CONSTRAINT score_within_bounds
  CHECK (points_possible >= 0 AND points_awarded >= 0 AND points_awarded <= points_possible);

ALTER TABLE documents
  ADD CONSTRAINT documents_size_non_negative CHECK (size_bytes >= 0),
  ADD CONSTRAINT document_dates
  CHECK (expires_on IS NULL OR issued_on IS NULL OR expires_on >= issued_on);

ALTER TABLE social_snapshots
  ADD CONSTRAINT social_followers_non_negative CHECK (follower_count >= 0),
  ADD CONSTRAINT social_posts_non_negative CHECK (post_count_30d >= 0);

ALTER TABLE export_jobs
  ADD CONSTRAINT export_row_count_non_negative CHECK (row_count >= 0);

-- ---------------------------------------------------------------------
-- 2. NOT NULL on array columns
--    Prisma list fields are always nullable at the database level.
-- ---------------------------------------------------------------------
ALTER TABLE activity_types ALTER COLUMN allowed_host_scopes SET NOT NULL;
ALTER TABLE assessment_criteria ALTER COLUMN applies_to_tiers SET NOT NULL;

-- ---------------------------------------------------------------------
-- 3. Partial indexes
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX district_years_one_current
  ON district_years (district_id) WHERE is_current;

-- Permission resolution runs these on EVERY authenticated request.
CREATE INDEX appointments_lookup
  ON appointments (person_id, rotary_year_id) WHERE is_active;
CREATE INDEX appointments_scope
  ON appointments (scope_type, scope_id, rotary_year_id) WHERE is_active;

CREATE INDEX act_scoring
  ON activities (district_id, rotary_year_id, starts_at)
  WHERE deleted_at IS NULL AND status = 'HELD';

CREATE INDEX ca_stale ON club_assessments (is_stale) WHERE is_stale;

CREATE INDEX notif_due ON notifications (status, scheduled_for) WHERE status = 'QUEUED';

-- NULLs are distinct in Postgres, so the plain UNIQUE keys on these tables do
-- not constrain the NULL case. Without these, two system-wide templates could
-- share a code, and one assessor could be assigned district-wide twice.
CREATE UNIQUE INDEX positions_template_code
  ON positions (code) WHERE district_id IS NULL;
CREATE UNIQUE INDEX activity_types_template_code
  ON activity_types (code) WHERE district_id IS NULL;
CREATE UNIQUE INDEX finance_categories_template_code
  ON finance_categories (code) WHERE district_id IS NULL;
CREATE UNIQUE INDEX assessor_assignments_all_clubs
  ON assessor_assignments (period_id, parameter_id, person_id) WHERE cluster_id IS NULL;

-- ---------------------------------------------------------------------
-- 4. Trigram index on an EXPRESSION.
--    clubs_name_trgm is deliberately NOT here: Prisma CAN represent it,
--    and an index Prisma can represent but does not know about is
--    proposed for dropping on every migrate dev. It lives in the init
--    migration instead. This one indexes an expression, which Prisma
--    cannot represent at all, so it is invisible to the differ.
-- ---------------------------------------------------------------------
CREATE INDEX persons_name_trgm
  ON persons USING gin ((first_name || ' ' || last_name) gin_trgm_ops);

-- ---------------------------------------------------------------------
-- 5a. Guard triggers (ADR-012). Each raises a stable SQLSTATE that
--     platform/errors maps to a domain code.
-- ---------------------------------------------------------------------

-- A column default cannot apply to a row that does not exist, so the row is
-- created here rather than trusting every future write path to remember.
CREATE FUNCTION person_visibility_defaults() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO person_visibility (person_id) VALUES (NEW.id)
  ON CONFLICT (person_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER persons_visibility_ins
  AFTER INSERT ON persons
  FOR EACH ROW EXECUTE FUNCTION person_visibility_defaults();

-- DIS01 -> MEMBERSHIP_IMMUTABLE. corroborated_at is the single legitimate
-- mutation: corroborating a transition to Rotary happens after the fact.
CREATE FUNCTION membership_events_immutable() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'membership_events is append-only: supersede the event instead of deleting it'
      USING ERRCODE = 'DIS01';
  END IF;
  IF ROW(NEW.*) IS DISTINCT FROM ROW(OLD.*) THEN
    IF (to_jsonb(NEW) - 'corroborated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'corroborated_at') THEN
      RAISE EXCEPTION 'membership_events is append-only: only corroborated_at may be set after insert'
        USING ERRCODE = 'DIS01';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER membership_events_no_mutate
  BEFORE UPDATE OR DELETE ON membership_events
  FOR EACH ROW EXECUTE FUNCTION membership_events_immutable();

-- DIS02 -> AUDIT_IMMUTABLE. No exception column: an audit log the application
-- can edit is a table of claims.
CREATE FUNCTION audit_log_immutable() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'DIS02';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_mutate
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

-- ---------------------------------------------------------------------
-- 5b. Derived state (ADR-012). Prisma reads these as views; migrations
--     neither create nor drop them, which is why they are here.
-- ---------------------------------------------------------------------

-- The roster excludes events that HAVE BEEN superseded, not events that
-- supersede. The inverse discards every correction while continuing to count
-- the row it corrected.
CREATE MATERIALIZED VIEW club_rosters AS
WITH live AS (
  SELECT me.*
  FROM membership_events me
  WHERE NOT EXISTS (
    SELECT 1 FROM membership_events c WHERE c.supersedes_event_id = me.id
  )
), ranked AS (
  SELECT DISTINCT ON (person_id, club_id)
         person_id, club_id, district_id, event_type, member_category, effective_on
  FROM live
  ORDER BY person_id, club_id, effective_on DESC, created_at DESC
)
SELECT person_id, club_id, district_id, member_category, effective_on AS since
FROM ranked
WHERE event_type IN ('JOIN','INDUCT','TRANSFER_IN','REINSTATE','CATEGORY_CHANGE');

CREATE UNIQUE INDEX club_rosters_pk ON club_rosters (person_id, club_id);
CREATE INDEX club_rosters_club ON club_rosters (club_id);

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
  SELECT SUM(amount) AS paid FROM dues_payments WHERE invoice_id = i.id
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
  SELECT SUM(amount) AS paid FROM member_dues_payments WHERE member_dues_id = m.id
) p ON TRUE;

-- Ranking is computed from the same numbers it ranks, so standings cannot
-- disagree with the scorecard they link to.
CREATE VIEW club_assessment_states AS
SELECT ca.id           AS club_assessment_id,
       ca.district_id,
       ca.period_id,
       ca.club_id,
       ca.tier,
       ca.status,
       ca.is_stale,
       COALESCE(s.total_score, 0)  AS total_score,
       COALESCE(s.max_possible, 0) AS max_possible,
       CASE WHEN COALESCE(s.max_possible, 0) > 0
            THEN ROUND(100 * s.total_score / s.max_possible, 2)
       END AS percentage,
       COALESCE(s.scored_criteria, 0) AS scored_criteria,
       RANK() OVER (PARTITION BY ca.period_id, ca.tier
                    ORDER BY COALESCE(s.total_score, 0) DESC) AS rank_in_tier
FROM club_assessments ca
LEFT JOIN LATERAL (
  SELECT SUM(points_awarded)  AS total_score,
         SUM(points_possible) AS max_possible,
         count(*)             AS scored_criteria
  FROM assessment_scores WHERE club_assessment_id = ca.id
) s ON TRUE;

CREATE VIEW framework_point_totals AS
SELECT f.id AS framework_id,
       f.district_id,
       f.rotary_year_id,
       f.version,
       f.status,
       f.total_points                    AS declared_total,
       COALESCE(p.parameter_total, 0)    AS parameter_total,
       COALESCE(c.criterion_total, 0)    AS criterion_total,
       (f.total_points = COALESCE(p.parameter_total, 0)
        AND COALESCE(p.parameter_total, 0) = COALESCE(c.criterion_total, 0)) AS is_balanced
FROM assessment_frameworks f
LEFT JOIN LATERAL (
  SELECT SUM(max_points) AS parameter_total
  FROM assessment_parameters WHERE framework_id = f.id
) p ON TRUE
LEFT JOIN LATERAL (
  SELECT SUM(cr.points) AS criterion_total
  FROM assessment_parameters pa
  JOIN assessment_criteria cr ON cr.parameter_id = pa.id
  WHERE pa.framework_id = f.id
) c ON TRUE;
