-- ---------------------------------------------------------------------
-- M4 session 1 — approval freezes a budget's lines.
--
-- ADR-012: a guard, not a handler check. Approval is the moment a budget
-- stops being a working document and becomes what the district agreed to,
-- so a line changed afterwards would alter the agreement without leaving a
-- trace. A check in the service would hold for the service and for nothing
-- else — not for the seed, not for a job, not for a hand-written fix during
-- an incident, which is exactly when somebody is most likely to try it.
--
-- The budget itself stays editable in one respect: it can be UN-approved,
-- which is a deliberate escape hatch. A treasurer who approved the wrong
-- budget needs a way back that is visible in the audit log rather than a
-- database session.
--
-- DIS03 -> BUDGET_APPROVED in platform/errors.ts. Exercised by
-- prisma/checks/invariants.sql.
-- ---------------------------------------------------------------------

CREATE FUNCTION budget_lines_frozen_when_approved() RETURNS TRIGGER AS $$
DECLARE
  target_budget uuid;
  approved timestamptz;
BEGIN
  -- On DELETE the row is in OLD; on INSERT and UPDATE it is in NEW. An UPDATE
  -- that moved a line between budgets would need both checked, so take the
  -- one that exists and let the second pass handle the other side.
  target_budget := COALESCE(NEW.budget_id, OLD.budget_id);

  SELECT b.approved_at INTO approved FROM budgets b WHERE b.id = target_budget;

  IF approved IS NOT NULL THEN
    RAISE EXCEPTION 'budget % was approved at %: its lines are frozen', target_budget, approved
      USING ERRCODE = 'DIS03';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER budget_lines_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON budget_lines
  FOR EACH ROW EXECUTE FUNCTION budget_lines_frozen_when_approved();

-- An UPDATE moving a line to a DIFFERENT budget must be refused if EITHER
-- side is approved. The trigger above sees only one of them per pass, so the
-- old budget is checked here.
CREATE FUNCTION budget_lines_frozen_source() RETURNS TRIGGER AS $$
DECLARE
  approved timestamptz;
BEGIN
  IF NEW.budget_id IS DISTINCT FROM OLD.budget_id THEN
    SELECT b.approved_at INTO approved FROM budgets b WHERE b.id = OLD.budget_id;
    IF approved IS NOT NULL THEN
      RAISE EXCEPTION 'budget % was approved at %: its lines are frozen', OLD.budget_id, approved
        USING ERRCODE = 'DIS03';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER budget_lines_frozen_move
  BEFORE UPDATE ON budget_lines
  FOR EACH ROW EXECUTE FUNCTION budget_lines_frozen_source();

-- ---------------------------------------------------------------------
-- Indexes Prisma cannot express, or does not know it wants.
--
-- The summary endpoint aggregates transactions by owner and category for
-- one district-year. Without this it is a sequential scan over every
-- transaction the district has ever recorded, which is fine at 200 rows
-- and not fine in year three.
-- ---------------------------------------------------------------------

CREATE INDEX financial_transactions_owner_period
  ON financial_transactions (district_id, rotary_year_id, owner_scope_type, owner_scope_id)
  WHERE deleted_at IS NULL;

CREATE INDEX financial_transactions_category
  ON financial_transactions (category_id)
  WHERE deleted_at IS NULL;
