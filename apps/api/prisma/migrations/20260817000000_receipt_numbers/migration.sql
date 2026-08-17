-- ---------------------------------------------------------------------
-- M4 session 2 — receipt numbers.
--
-- A receipt number is the thing a club treasurer writes in a book and
-- quotes back six months later when the district says the money never
-- arrived. It must therefore be sequential, unique, and never reused.
--
-- A SEQUENCE, not application counting. `SELECT max(receipt_no) + 1` is
-- correct exactly until two treasurers confirm a payment in the same
-- second, at which point both read the same maximum and one insert fails
-- — or worse, both succeed against a column nobody made unique. A Postgres
-- sequence is atomic and non-transactional by design: two concurrent
-- callers get two different numbers, and a rolled-back transaction burns
-- its number rather than handing it to somebody else.
--
-- Burning numbers on rollback is the correct trade. A gap in a receipt
-- book invites one question; a receipt number issued twice invites an
-- audit. `UNIQUE` on the column is already there and stays as the backstop.
--
-- Club dues and member dues share one sequence. They are receipts from one
-- district, and two series both starting at 1 would produce two documents
-- reading "Receipt 00042" for different money.
-- ---------------------------------------------------------------------

CREATE SEQUENCE dues_receipt_seq AS BIGINT START WITH 1 INCREMENT BY 1 NO CYCLE;

-- The format is fixed here rather than in TypeScript so that every writer
-- produces the same shape — including a hand-written INSERT during an
-- incident, which is when a receipt is most likely to be issued by hand.
CREATE FUNCTION next_receipt_no() RETURNS TEXT AS $$
  SELECT 'RCT-' || LPAD(nextval('dues_receipt_seq')::TEXT, 6, '0');
$$ LANGUAGE sql VOLATILE;

-- ---------------------------------------------------------------------
-- The number is allocated BY THE DATABASE, at the moment of confirmation.
--
-- Not a column DEFAULT: an unconfirmed payment is a claim, and issuing a
-- receipt number for money nobody has seen is the thing a receipt number
-- exists to prevent. So it is assigned on the transition of confirmed_at
-- from NULL to not-NULL, and never reassigned or cleared afterwards —
-- un-confirming a payment leaves the number spent, which is correct: the
-- receipt may already be in somebody's hand.
--
-- A trigger rather than application code, and this does NOT contradict
-- ADR-012. What that rule forbids is derived STATE maintained by a trigger
-- — a status or a running total that can drift from the rows it summarises.
-- A receipt number is not derived from anything; it is an allocation made
-- once, at a moment, and it has to be atomic with the write that earns it.
-- Doing it in TypeScript would mean a SELECT and an UPDATE with a gap in
-- between, which is where two treasurers confirming at once collide.
--
-- It also keeps raw SQL out of `modules/finance`, which the conventions
-- reserve for the assessment resolvers and membership analytics.
-- ---------------------------------------------------------------------

CREATE FUNCTION assign_dues_receipt_no() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.confirmed_at IS NOT NULL AND NEW.receipt_no IS NULL THEN
    NEW.receipt_no := next_receipt_no();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER dues_payments_receipt
  BEFORE INSERT OR UPDATE ON dues_payments
  FOR EACH ROW EXECUTE FUNCTION assign_dues_receipt_no();

CREATE TRIGGER member_dues_payments_receipt
  BEFORE INSERT OR UPDATE ON member_dues_payments
  FOR EACH ROW EXECUTE FUNCTION assign_dues_receipt_no();

-- ---------------------------------------------------------------------
-- Indexes for the District Treasurer's grid.
--
-- `/dues/status` reads dues_invoice_states for every club in the district
-- for one year, and the view's LATERAL sums dues_payments per invoice.
-- Both sides need help once there are 68 clubs × several years of history.
-- ---------------------------------------------------------------------

CREATE INDEX dues_invoices_district_year
  ON dues_invoices (district_id, rotary_year_id, club_id);

CREATE INDEX member_dues_district_year
  ON member_dues (district_id, rotary_year_id, club_id);
