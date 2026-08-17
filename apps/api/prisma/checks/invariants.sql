-- =====================================================================
-- INVARIANT CONFORMANCE SUITE  (ADR-012)
--
-- Every database-side invariant is exercised here by attempting the
-- violation and asserting it fails. A guard without a check in this file
-- is a guard nobody has proven works.
--
-- Run:
--   psql "$DATABASE_URL" -f prisma/checks/invariants.sql
--   (psql must be on PATH: C:\Program Files\PostgreSQL\17\bin)
--
-- Every line of output must read PASS. Rolls back — writes nothing.
--
-- These become vitest integration tests in M0 session 5, when the test
-- database harness exists; until then this file is the harness.
-- =====================================================================
BEGIN;

INSERT INTO districts (id, ri_district_code, name)
VALUES ('11111111-1111-1111-1111-111111111111', '9218', 'Rotaract District 9218');
INSERT INTO rotary_years (id, label, starts_on, ends_on)
VALUES ('22222222-2222-2222-2222-222222222222', '2027-28', '2027-07-01', '2028-06-30');
INSERT INTO clubs (id, name, slug, base_type)
VALUES ('33333333-3333-3333-3333-333333333333', 'Rotaract Club of Kampala', 'rc-kampala', 'CBC');
INSERT INTO persons (id, first_name, last_name)
VALUES ('44444444-4444-4444-4444-444444444444', 'Ann', 'Nakato');

-- 1. person_visibility row is created automatically, contact fields closed
DO $$
DECLARE v person_visibility%ROWTYPE;
BEGIN
  SELECT * INTO v FROM person_visibility WHERE person_id = '44444444-4444-4444-4444-444444444444';
  IF NOT FOUND THEN
    RAISE NOTICE 'FAIL 1  visibility row not created';
  ELSIF v.show_email OR v.show_phone OR v.show_city THEN
    RAISE NOTICE 'FAIL 1  a contact field defaulted open';
  ELSIF NOT v.show_photo OR NOT v.show_occupation THEN
    RAISE NOTICE 'FAIL 1  photo/occupation should default open';
  ELSE
    RAISE NOTICE 'PASS 1  visibility row auto-created, contact fields closed';
  END IF;
END $$;

-- 2. membership_events is append-only
INSERT INTO membership_events (id, district_id, rotary_year_id, person_id, club_id, event_type, effective_on)
VALUES ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222', '44444444-4444-4444-4444-444444444444',
        '33333333-3333-3333-3333-333333333333', 'JOIN', '2027-07-15');

DO $$
BEGIN
  UPDATE membership_events SET reason_note = 'tampered' WHERE id = '55555555-5555-5555-5555-555555555555';
  RAISE NOTICE 'FAIL 2a UPDATE of a fact was allowed';
EXCEPTION WHEN SQLSTATE 'DIS01' THEN RAISE NOTICE 'PASS 2a UPDATE blocked with DIS01';
END $$;

DO $$
BEGIN
  DELETE FROM membership_events WHERE id = '55555555-5555-5555-5555-555555555555';
  RAISE NOTICE 'FAIL 2b DELETE was allowed';
EXCEPTION WHEN SQLSTATE 'DIS01' THEN RAISE NOTICE 'PASS 2b DELETE blocked with DIS01';
END $$;

DO $$
BEGIN
  UPDATE membership_events SET corroborated_at = now() WHERE id = '55555555-5555-5555-5555-555555555555';
  RAISE NOTICE 'PASS 2c corroborated_at may still be set';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'FAIL 2c corroborated_at rejected: %', SQLERRM;
END $$;

-- 3. CORRECTION must supersede something
DO $$
BEGIN
  INSERT INTO membership_events (district_id, rotary_year_id, person_id, club_id, event_type, effective_on)
  VALUES ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
          '44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333',
          'CORRECTION', '2027-07-20');
  RAISE NOTICE 'FAIL 3  dangling CORRECTION accepted';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 3  dangling CORRECTION rejected';
END $$;

-- 4. roster: the joining member appears
REFRESH MATERIALIZED VIEW club_rosters;
DO $$
DECLARE d DATE; n INT;
BEGIN
  SELECT count(*), min(since) INTO n, d FROM club_rosters
   WHERE person_id = '44444444-4444-4444-4444-444444444444';
  IF n = 1 AND d = '2027-07-15' THEN RAISE NOTICE 'PASS 4  member on roster, since 2027-07-15';
  ELSE RAISE NOTICE 'FAIL 4  rows=% since=%', n, d; END IF;
END $$;

-- 5. restating a fact: corrected JOIN supersedes the original
INSERT INTO membership_events (id, district_id, rotary_year_id, person_id, club_id, event_type,
                               effective_on, supersedes_event_id)
VALUES ('66666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222', '44444444-4444-4444-4444-444444444444',
        '33333333-3333-3333-3333-333333333333', 'JOIN', '2027-08-01',
        '55555555-5555-5555-5555-555555555555');
REFRESH MATERIALIZED VIEW club_rosters;
DO $$
DECLARE d DATE; n INT;
BEGIN
  SELECT count(*), min(since) INTO n, d FROM club_rosters
   WHERE person_id = '44444444-4444-4444-4444-444444444444';
  IF n = 1 AND d = '2027-08-01' THEN RAISE NOTICE 'PASS 5  correction replaced the original date';
  ELSE RAISE NOTICE 'FAIL 5  rows=% since=% (expected 1 / 2027-08-01)', n, d; END IF;
END $$;

-- 6. retracting a fact: CORRECTION drops the member from the roster
INSERT INTO membership_events (district_id, rotary_year_id, person_id, club_id, event_type,
                               effective_on, supersedes_event_id)
VALUES ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
        '44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333',
        'CORRECTION', '2027-08-02', '66666666-6666-6666-6666-666666666666');
REFRESH MATERIALIZED VIEW club_rosters;
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM club_rosters WHERE person_id = '44444444-4444-4444-4444-444444444444';
  IF n = 0 THEN RAISE NOTICE 'PASS 6  retraction removed the member from the roster';
  ELSE RAISE NOTICE 'FAIL 6  still on roster (rows=%)', n; END IF;
END $$;

-- 7. dues status derived from payments
INSERT INTO dues_invoices (id, district_id, rotary_year_id, club_id, amount_due, due_on)
VALUES ('77777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333',
        100000.00, '2027-09-30');
DO $$
DECLARE s invoice_status;
BEGIN
  SELECT status INTO s FROM dues_invoice_states WHERE invoice_id = '77777777-7777-7777-7777-777777777777';
  IF s = 'UNPAID' THEN RAISE NOTICE 'PASS 7a no payments -> UNPAID';
  ELSE RAISE NOTICE 'FAIL 7a got %', s; END IF;
END $$;

INSERT INTO dues_payments (invoice_id, amount, paid_on)
VALUES ('77777777-7777-7777-7777-777777777777', 40000.00, '2027-08-10');
DO $$
DECLARE s invoice_status; o NUMERIC;
BEGIN
  SELECT status, amount_outstanding INTO s, o FROM dues_invoice_states
   WHERE invoice_id = '77777777-7777-7777-7777-777777777777';
  IF s = 'PARTIAL' AND o = 60000.00 THEN RAISE NOTICE 'PASS 7b part payment -> PARTIAL, 60000 outstanding';
  ELSE RAISE NOTICE 'FAIL 7b status=% outstanding=%', s, o; END IF;
END $$;

INSERT INTO dues_payments (invoice_id, amount, paid_on)
VALUES ('77777777-7777-7777-7777-777777777777', 60000.00, '2027-09-01');
DO $$
DECLARE s invoice_status; o NUMERIC;
BEGIN
  SELECT status, amount_outstanding INTO s, o FROM dues_invoice_states
   WHERE invoice_id = '77777777-7777-7777-7777-777777777777';
  IF s = 'PAID' AND o = 0 THEN RAISE NOTICE 'PASS 7c settled -> PAID, nothing outstanding';
  ELSE RAISE NOTICE 'FAIL 7c status=% outstanding=%', s, o; END IF;
END $$;

UPDATE dues_invoices SET waived_at = now() WHERE id = '77777777-7777-7777-7777-777777777777';
DO $$
DECLARE s invoice_status;
BEGIN
  SELECT status INTO s FROM dues_invoice_states WHERE invoice_id = '77777777-7777-7777-7777-777777777777';
  IF s = 'WAIVED' THEN RAISE NOTICE 'PASS 7d waiver beats payment state';
  ELSE RAISE NOTICE 'FAIL 7d got %', s; END IF;
END $$;

-- 8. member dues totals derived from the payment log
INSERT INTO member_dues (id, district_id, rotary_year_id, club_id, person_id, amount_due)
VALUES ('88888888-8888-8888-8888-888888888888', '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333',
        '44444444-4444-4444-4444-444444444444', 50000.00);
INSERT INTO member_dues_payments (member_dues_id, amount, paid_on)
VALUES ('88888888-8888-8888-8888-888888888888', 20000.00, '2027-08-05'),
       ('88888888-8888-8888-8888-888888888888', 5000.00, '2027-08-20');
DO $$
DECLARE p NUMERIC; o NUMERIC;
BEGIN
  SELECT amount_paid, amount_outstanding INTO p, o FROM member_dues_states
   WHERE member_dues_id = '88888888-8888-8888-8888-888888888888';
  IF p = 25000.00 AND o = 25000.00 THEN RAISE NOTICE 'PASS 8  member dues summed from the log';
  ELSE RAISE NOTICE 'FAIL 8  paid=% outstanding=%', p, o; END IF;
END $$;

-- 9. money may not go negative
DO $$
BEGIN
  INSERT INTO dues_payments (invoice_id, amount, paid_on)
  VALUES ('77777777-7777-7777-7777-777777777777', -5000.00, '2027-09-02');
  RAISE NOTICE 'FAIL 9  negative payment accepted';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 9  negative payment rejected';
END $$;

-- 10. an activity may not end before it starts
INSERT INTO activity_types (id, code, name, category)
VALUES ('99999999-9999-9999-9999-999999999999', 'FELLOWSHIP', 'Fellowship', 'FELLOWSHIP');
DO $$
BEGIN
  INSERT INTO activities (district_id, rotary_year_id, activity_type_id, host_scope_type,
                          host_scope_id, title, starts_at, ends_at)
  VALUES ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
          '99999999-9999-9999-9999-999999999999', 'CLUB',
          '33333333-3333-3333-3333-333333333333', 'Backwards fellowship',
          '2027-08-10 18:00+03', '2027-08-10 16:00+03');
  RAISE NOTICE 'FAIL 10 activity ending before it starts accepted';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 10 end-before-start rejected';
END $$;

-- 11. negative scored quantities
DO $$
BEGIN
  INSERT INTO activities (district_id, rotary_year_id, activity_type_id, host_scope_type,
                          host_scope_id, title, starts_at, trees_planted)
  VALUES ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
          '99999999-9999-9999-9999-999999999999', 'CLUB',
          '33333333-3333-3333-3333-333333333333', 'Negative planting', '2027-08-10 09:00+03', -40);
  RAISE NOTICE 'FAIL 11 negative trees_planted accepted';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 11 negative quantity rejected';
END $$;

-- 12. template codes are unique across NULL districts
INSERT INTO positions (district_id, code, name, scope) VALUES (NULL, 'DRR', 'District Rotaract Rep', 'DISTRICT');
DO $$
BEGIN
  INSERT INTO positions (district_id, code, name, scope) VALUES (NULL, 'DRR', 'Duplicate DRR', 'DISTRICT');
  RAISE NOTICE 'FAIL 12 duplicate template position code accepted';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASS 12 duplicate template code rejected';
END $$;

-- 13. a committee may not be its own parent
DO $$
DECLARE cid UUID := gen_random_uuid();
BEGIN
  INSERT INTO committees (id, district_id, rotary_year_id, name, parent_committee_id)
  VALUES (cid, '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
          'Ouroboros', cid);
  RAISE NOTICE 'FAIL 13 self-parenting committee accepted';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 13 self-parenting rejected';
END $$;

-- 14. one district per club per year
INSERT INTO club_district_affiliations (club_id, district_id, rotary_year_id, tier)
VALUES ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222', 'T1');
DO $$
BEGIN
  INSERT INTO club_district_affiliations (club_id, district_id, rotary_year_id, tier)
  VALUES ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
          '22222222-2222-2222-2222-222222222222', 'T2');
  RAISE NOTICE 'FAIL 14 second affiliation for the same club-year accepted';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASS 14 one district per club per year enforced';
END $$;

-- 15. exactly one current year per district
INSERT INTO district_years (district_id, rotary_year_id, is_current)
VALUES ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', TRUE);
INSERT INTO rotary_years (id, label, starts_on, ends_on)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2028-29', '2028-07-01', '2029-06-30');
DO $$
BEGIN
  INSERT INTO district_years (district_id, rotary_year_id, is_current)
  VALUES ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', TRUE);
  RAISE NOTICE 'FAIL 15 two current years accepted';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASS 15 only one current year per district';
END $$;

-- 16. rotary year dates must be ordered
DO $$
BEGIN
  INSERT INTO rotary_years (label, starts_on, ends_on) VALUES ('bad', '2029-07-01', '2028-06-30');
  RAISE NOTICE 'FAIL 16 backwards rotary year accepted';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 16 backwards rotary year rejected';
END $$;

-- ===== assessment (domain 7) =====

-- District, year, club and person fixtures already exist from the checks above.
-- A second club, so tier ranking has something to rank against.
INSERT INTO clubs (id, name, slug, base_type)
VALUES ('3333333a-3333-3333-3333-333333333333', 'Rotaract Club of Entebbe', 'rc-entebbe', 'CBC');
INSERT INTO assessment_frameworks (id, district_id, rotary_year_id, name, total_points)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222', 'RY2027-28 Rubric', 100);
INSERT INTO assessment_parameters (id, framework_id, sequence, name, max_points)
VALUES ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 1, 'Service', 60),
       ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 2, 'TRF', 40);
INSERT INTO assessment_criteria (id, parameter_id, sequence, description, points, evaluation_mode, resolver_key)
VALUES ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 1, 'Projects held', 60, 'AUTO', 'activity.count'),
       ('cccccccc-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 1, 'TRF giving', 40, 'AUTO', 'trf.total');
INSERT INTO assessment_periods (id, framework_id, period_type, label, starts_on, ends_on, submission_deadline)
VALUES ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
        'QUARTERLY', 'Q1 2027-28', '2027-07-01', '2027-09-30', '2027-10-07 23:59+03');

-- 17. AUTO criterion must name a resolver
DO $$
BEGIN
  INSERT INTO assessment_criteria (parameter_id, sequence, description, points, evaluation_mode)
  VALUES ('bbbbbbbb-0000-0000-0000-000000000001', 99, 'No resolver', 5, 'AUTO');
  RAISE NOTICE 'FAIL 17 AUTO criterion without a resolver accepted';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 17 AUTO criterion requires a resolver';
END $$;

DO $$
BEGIN
  INSERT INTO assessment_criteria (parameter_id, sequence, description, points, evaluation_mode)
  VALUES ('bbbbbbbb-0000-0000-0000-000000000001', 98, 'Assessor judged', 5, 'ASSESSOR');
  RAISE NOTICE 'PASS 17b ASSESSOR criterion may omit a resolver';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'FAIL 17b %', SQLERRM;
END $$;
-- Remove it again: it is worth 5 points and would unbalance the rubric that
-- check 18a is about to assert is balanced.
DELETE FROM assessment_criteria
 WHERE parameter_id = 'bbbbbbbb-0000-0000-0000-000000000001' AND sequence = 98;

-- 18. rubric balance is visible
DO $$
DECLARE r RECORD;
BEGIN
  SELECT * INTO r FROM framework_point_totals WHERE framework_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  IF r.is_balanced AND r.parameter_total = 100 THEN
    RAISE NOTICE 'PASS 18a balanced rubric reports is_balanced';
  ELSE RAISE NOTICE 'FAIL 18a declared=% params=% criteria=% balanced=%',
    r.declared_total, r.parameter_total, r.criterion_total, r.is_balanced; END IF;
END $$;

UPDATE assessment_parameters SET max_points = 65 WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';
DO $$
DECLARE r RECORD;
BEGIN
  SELECT * INTO r FROM framework_point_totals WHERE framework_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  IF NOT r.is_balanced THEN RAISE NOTICE 'PASS 18b unbalanced rubric detected (params=%)', r.parameter_total;
  ELSE RAISE NOTICE 'FAIL 18b unbalanced rubric reported as balanced'; END IF;
END $$;
UPDATE assessment_parameters SET max_points = 60 WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';

-- 19. a score may not exceed the criterion
INSERT INTO club_assessments (id, district_id, period_id, club_id, tier) VALUES
  ('eeeeeeee-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'dddddddd-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'T1'),
  ('eeeeeeee-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'dddddddd-0000-0000-0000-000000000001', '3333333a-3333-3333-3333-333333333333', 'T1');
DO $$
BEGIN
  INSERT INTO assessment_scores (club_assessment_id, criterion_id, points_awarded, points_possible, source)
  VALUES ('eeeeeeee-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 75, 60, 'AUTO');
  RAISE NOTICE 'FAIL 19 score above the criterion maximum accepted';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 19 score above criterion maximum rejected';
END $$;

-- 20. totals and ranking derived from the scores
INSERT INTO assessment_scores (club_assessment_id, criterion_id, points_awarded, points_possible, source) VALUES
  ('eeeeeeee-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 45, 60, 'AUTO'),
  ('eeeeeeee-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002', 30, 40, 'AUTO'),
  ('eeeeeeee-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000001', 55, 60, 'AUTO'),
  ('eeeeeeee-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000002', 35, 40, 'AUTO');
DO $$
DECLARE a RECORD; b RECORD;
BEGIN
  SELECT * INTO a FROM club_assessment_states WHERE club_assessment_id = 'eeeeeeee-0000-0000-0000-000000000001';
  SELECT * INTO b FROM club_assessment_states WHERE club_assessment_id = 'eeeeeeee-0000-0000-0000-000000000002';
  IF a.total_score = 75 AND a.max_possible = 100 AND a.percentage = 75.00 AND a.rank_in_tier = 2
     AND b.total_score = 90 AND b.rank_in_tier = 1 THEN
    RAISE NOTICE 'PASS 20 totals, percentage and tier ranking all derived correctly';
  ELSE
    RAISE NOTICE 'FAIL 20 a=(% / % / % / rank %) b=(% / rank %)',
      a.total_score, a.max_possible, a.percentage, a.rank_in_tier, b.total_score, b.rank_in_tier;
  END IF;
END $$;

-- 21. ranking follows a score change with no recompute step
UPDATE assessment_scores SET points_awarded = 60
 WHERE club_assessment_id = 'eeeeeeee-0000-0000-0000-000000000001'
   AND criterion_id = 'cccccccc-0000-0000-0000-000000000001';
DO $$
DECLARE a RECORD;
BEGIN
  SELECT * INTO a FROM club_assessment_states WHERE club_assessment_id = 'eeeeeeee-0000-0000-0000-000000000001';
  IF a.total_score = 90 AND a.rank_in_tier = 1 THEN
    RAISE NOTICE 'PASS 21 standings moved with the score, nothing to recompute';
  ELSE RAISE NOTICE 'FAIL 21 total=% rank=%', a.total_score, a.rank_in_tier; END IF;
END $$;

-- 22. period dates and dispute window
DO $$
BEGIN
  INSERT INTO assessment_periods (framework_id, period_type, label, starts_on, ends_on, submission_deadline)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'MONTHLY', 'Backwards', '2027-09-30', '2027-09-01', '2027-10-07 23:59+03');
  RAISE NOTICE 'FAIL 22a period ending before it starts accepted';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 22a backwards period rejected';
END $$;
DO $$
BEGIN
  INSERT INTO assessment_periods (framework_id, period_type, label, starts_on, ends_on, submission_deadline, dispute_closes_at)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'MONTHLY', 'Early dispute close', '2027-09-01', '2027-09-30',
          '2027-10-07 23:59+03', '2027-10-01 00:00+03');
  RAISE NOTICE 'FAIL 22b dispute window closing before submission accepted';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 22b dispute window must follow submission';
END $$;

-- 23. duplicate district-wide assessor assignment
INSERT INTO assessor_assignments (period_id, parameter_id, person_id)
VALUES ('dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
        '44444444-4444-4444-4444-444444444444');
DO $$
BEGIN
  INSERT INTO assessor_assignments (period_id, parameter_id, person_id)
  VALUES ('dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
          '44444444-4444-4444-4444-444444444444');
  RAISE NOTICE 'FAIL 23 duplicate all-clubs assessor assignment accepted';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASS 23 duplicate all-clubs assignment rejected';
END $$;


-- ===== platform (domain 8) =====

-- 24. audit_log is append-only
INSERT INTO audit_log (district_id, entity_type, entity_id, action)
VALUES ('11111111-1111-1111-1111-111111111111', 'clubs',
        '33333333-3333-3333-3333-333333333333', 'CREATE');
DO $$
BEGIN
  UPDATE audit_log SET action = 'TAMPERED' WHERE entity_type = 'clubs';
  RAISE NOTICE 'FAIL 24a audit_log UPDATE allowed';
EXCEPTION WHEN SQLSTATE 'DIS02' THEN RAISE NOTICE 'PASS 24a audit_log UPDATE blocked with DIS02';
END $$;
DO $$
BEGIN
  DELETE FROM audit_log WHERE entity_type = 'clubs';
  RAISE NOTICE 'FAIL 24b audit_log DELETE allowed';
EXCEPTION WHEN SQLSTATE 'DIS02' THEN RAISE NOTICE 'PASS 24b audit_log DELETE blocked with DIS02';
END $$;

-- 25. document type must be a known code
INSERT INTO document_types (code, name) VALUES ('URSB_CERT', 'URSB certificate');
DO $$
BEGIN
  INSERT INTO documents (district_id, owner_scope_type, owner_scope_id, doc_type, title, storage_key)
  VALUES ('11111111-1111-1111-1111-111111111111', 'CLUB', '33333333-3333-3333-3333-333333333333',
          'ursb_cert', 'Wrong case', 'docs/x.pdf');
  RAISE NOTICE 'FAIL 25 unknown document type accepted';
EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'PASS 25 unknown document type rejected';
END $$;

-- 26. a document may not expire before it was issued
DO $$
BEGIN
  INSERT INTO documents (district_id, owner_scope_type, owner_scope_id, doc_type, title, storage_key,
                         issued_on, expires_on)
  VALUES ('11111111-1111-1111-1111-111111111111', 'CLUB', '33333333-3333-3333-3333-333333333333',
          'URSB_CERT', 'Backwards', 'docs/y.pdf', '2027-06-01', '2027-01-01');
  RAISE NOTICE 'FAIL 26 document expiring before issue accepted';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 26 document date order enforced';
END $$;

-- 27. one account per club per platform, with no casing escape hatch
INSERT INTO social_platforms (code, name) VALUES ('INSTAGRAM', 'Instagram');
INSERT INTO social_accounts (district_id, owner_scope_type, owner_scope_id, platform, url)
VALUES ('11111111-1111-1111-1111-111111111111', 'CLUB', '33333333-3333-3333-3333-333333333333',
        'INSTAGRAM', 'https://instagram.com/rckampala');
DO $$
BEGIN
  INSERT INTO social_accounts (district_id, owner_scope_type, owner_scope_id, platform, url)
  VALUES ('11111111-1111-1111-1111-111111111111', 'CLUB', '33333333-3333-3333-3333-333333333333',
          'Instagram', 'https://instagram.com/rckampala-again');
  RAISE NOTICE 'FAIL 27 casing variant created a second account';
EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'PASS 27 casing variant rejected by the lookup';
END $$;

-- 28. social counts may not be negative
DO $$
DECLARE acct UUID;
BEGIN
  SELECT id INTO acct FROM social_accounts LIMIT 1;
  INSERT INTO social_snapshots (social_account_id, captured_on, follower_count)
  VALUES (acct, '2027-08-01', -100);
  RAISE NOTICE 'FAIL 28 negative follower count accepted';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 28 negative follower count rejected';
END $$;

-- ---------------------------------------------------------------------
-- Finance (M4 session 1)
-- ---------------------------------------------------------------------

INSERT INTO finance_categories (id, district_id, code, name, direction)
VALUES ('66666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111',
        'FUNDRAISING', 'Fundraising', 'INCOME');
INSERT INTO budgets (id, district_id, rotary_year_id, owner_scope_type, owner_scope_id)
VALUES ('77777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222', 'CLUB', '33333333-3333-3333-3333-333333333333');
INSERT INTO budget_lines (id, budget_id, category_id, description, amount_planned)
VALUES ('88888888-8888-8888-8888-888888888888', '77777777-7777-7777-7777-777777777777',
        '66666666-6666-6666-6666-666666666666', 'Car wash', 1500000.00);

-- 29. one budget per owner per year
DO $$
BEGIN
  INSERT INTO budgets (district_id, rotary_year_id, owner_scope_type, owner_scope_id)
  VALUES ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
          'CLUB', '33333333-3333-3333-3333-333333333333');
  RAISE NOTICE 'FAIL 29 a second budget for the same owner and year was accepted';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASS 29 one budget per owner per year';
END $$;

-- 30. a transaction amount may not be negative: direction carries the sign
DO $$
BEGIN
  INSERT INTO financial_transactions (district_id, rotary_year_id, owner_scope_type,
                                      owner_scope_id, category_id, direction, amount, occurred_on)
  VALUES ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
          'CLUB', '33333333-3333-3333-3333-333333333333',
          '66666666-6666-6666-6666-666666666666', 'INCOME', -5000, '2027-08-01');
  RAISE NOTICE 'FAIL 30 a negative amount was accepted';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 30 negative amount rejected';
END $$;

-- 31. lines may still be edited while the budget is a draft
DO $$
BEGIN
  UPDATE budget_lines SET amount_planned = 1600000.00
   WHERE id = '88888888-8888-8888-8888-888888888888';
  RAISE NOTICE 'PASS 31 a draft budget''s lines are editable';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'FAIL 31 draft line edit rejected: %', SQLERRM;
END $$;

-- 32. approval freezes the lines (DIS03)
UPDATE budgets SET approved_at = now() WHERE id = '77777777-7777-7777-7777-777777777777';

DO $$
BEGIN
  UPDATE budget_lines SET amount_planned = 9999999.00
   WHERE id = '88888888-8888-8888-8888-888888888888';
  RAISE NOTICE 'FAIL 32a an approved budget''s line was changed';
EXCEPTION WHEN SQLSTATE 'DIS03' THEN RAISE NOTICE 'PASS 32a approved line UPDATE blocked with DIS03';
END $$;

DO $$
BEGIN
  DELETE FROM budget_lines WHERE id = '88888888-8888-8888-8888-888888888888';
  RAISE NOTICE 'FAIL 32b an approved budget''s line was deleted';
EXCEPTION WHEN SQLSTATE 'DIS03' THEN RAISE NOTICE 'PASS 32b approved line DELETE blocked with DIS03';
END $$;

DO $$
BEGIN
  INSERT INTO budget_lines (budget_id, category_id, description, amount_planned)
  VALUES ('77777777-7777-7777-7777-777777777777', '66666666-6666-6666-6666-666666666666',
          'Added after approval', 100.00);
  RAISE NOTICE 'FAIL 32c a line was added to an approved budget';
EXCEPTION WHEN SQLSTATE 'DIS03' THEN RAISE NOTICE 'PASS 32c approved line INSERT blocked with DIS03';
END $$;

-- 33. un-approving is the way back, and it restores the lines
DO $$
BEGIN
  UPDATE budgets SET approved_at = NULL WHERE id = '77777777-7777-7777-7777-777777777777';
  UPDATE budget_lines SET amount_planned = 1700000.00
   WHERE id = '88888888-8888-8888-8888-888888888888';
  RAISE NOTICE 'PASS 33 un-approving restores the lines';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'FAIL 33 line still frozen after un-approval: %', SQLERRM;
END $$;

ROLLBACK;
