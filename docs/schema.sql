-- =====================================================================
-- Rotaract District Information System (DIS)
-- Authoritative PostgreSQL 16 schema — design baseline v1.8
--
-- v1.8 (people, M2 s5): person_erasure_requests. A member's request to be erased is
-- REVIEWED before anything happens — erasure is irreversible and the request arrives
-- from a session, which is the thing an attacker takes — and the work then runs as a
-- job under a system context. Erasure ANONYMISES rather than deletes: membership_events
-- is append-only and a club's retention rate for a past year must not change
-- retroactively because a member left. Migration 20260815101123_person_erasure_requests.
--
-- The pgboss SCHEMA also exists from M2 s1, created by migration
-- 20260816000000_pgboss_schema from pg-boss's own construction plans. It is deliberately
-- NOT recorded here: it is not this system's schema, it is a library's, and transcribing
-- it would create a second definition that drifts on the next pg-boss upgrade.
--
-- v1.7 (governance, M1): user_tokens.created_at, so an outstanding-invitations screen
-- can say how long somebody has been sitting on an invitation without assuming the TTL
-- has never changed. Migration 20260815010000_user_token_created_at.
--
-- v1.7 also adds the `session` table, which has existed in the database since M0
-- session 3 and was never recorded here. Found by rebuilding from this file and
-- diffing the catalog against the migrated database — which is the check that should
-- run whenever this file is amended.
--
-- v1.5 (auth): users.mfa_last_used_step, so a TOTP code cannot be replayed within its
-- validity window.
-- v1.6 (auth): mfa_recovery_codes, so a lost authenticator does not mean a locked-out
-- officer; users.mfa_secret is now stored encrypted rather than in clear.
--
-- v1.4 (platform): audit_log made append-only by trigger; document types and
-- social platforms became lookup tables rather than free text a scoring rule
-- would string-match; export status and format became enums; document dates,
-- file sizes and social counts bounded.
--
-- v1.3 (assessment): a score may not exceed the criterion it is awarded
-- against; scorecard totals and tier ranking became the club_assessment_states
-- view rather than three stored columns; framework_point_totals exposes whether
-- a rubric adds up; AUTO/HYBRID criteria must name a resolver; period dates
-- ordered; assessor "all clubs" assignments made unique.
--
-- v1.2 applies ADR-012 (where an invariant lives): declarative constraints
-- first; derived state is a VIEW, never a stored column maintained by a
-- trigger; triggers only as guards, each with a stable SQLSTATE. This removed
-- dues_invoices.status and member_dues.amount_paid in favour of the
-- dues_invoice_states and member_dues_states views.
--
-- Amendments since v1.0 (all raised during the Prisma translation, M0 s2):
--   * person_visibility rows created by trigger — a column default cannot
--     apply to a row that does not exist
--   * user_tokens.token_hash indexed UNIQUE — looked up on every reset
--   * positions and activity_types: template codes (district_id IS NULL)
--     made unique
--   * committees: a committee may not be its own parent
--   * membership_events: CORRECTION must supersede something; the log is
--     made immutable by trigger rather than by convention
--   * club_rosters: the superseded-event predicate was inverted, so
--     corrections were ignored and the rows they corrected still counted
--   * activities: dates ordered, scored quantities non-negative, and the
--     authoritative attendance source stated
--   * activity_partners.country_code NOT NULL DEFAULT 'UG' — international
--     service is derived from it, so it may not be unknown
--   * finance_categories: template codes made unique (third instance)
--   * every money column now CHECK (>= 0), not just two of them
--   * dues_type is an enum: it is part of a unique key, and free text there
--     means 'district' and 'DISTRICT' are two invoices for one debt
--   * dues_invoices.status maintained by trigger, WAIVED preserved
--   * member_dues_payments added — member cash collection had no audit trail
--
-- Conventions:
--   * UUID primary keys via gen_random_uuid()   (ADR-004)
--   * district_id on every tenant-scoped table  (ADR-010)
--   * rotary_year_id on every transactional row (Axiom 1)
--   * snake_case; plural table names; *_id foreign keys
--   * Soft delete via deleted_at where governed
--   * Anything a district officer should be able to add without a
--     deployment is a LOOKUP TABLE, never a native enum.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------
-- SYSTEM ENUMS (fixed values — changing these is a code change by design)
-- ---------------------------------------------------------------------
CREATE TYPE org_scope        AS ENUM ('DISTRICT','REGION','CLUSTER','CLUB','COMMITTEE');
CREATE TYPE club_base_type   AS ENUM ('CBC','IBC','ECLUB');
CREATE TYPE club_tier        AS ENUM ('T1','T2','IBC');
CREATE TYPE club_status      AS ENUM ('PROVISIONAL','ACTIVE','SUSPENDED','TERMINATED','MERGED');
CREATE TYPE member_category  AS ENUM ('ACTIVE','HONORARY','CORPORATE');
CREATE TYPE membership_event_type AS ENUM (
  'JOIN','INDUCT','TRANSFER_IN','TRANSFER_OUT','TERMINATE',
  'TRANSITION_TO_ROTARY','REINSTATE','CATEGORY_CHANGE','CORRECTION');
CREATE TYPE activity_status  AS ENUM ('PLANNED','HELD','CANCELLED');
CREATE TYPE verification_state AS ENUM ('UNVERIFIED','VERIFIED','QUERIED','REJECTED');
CREATE TYPE txn_direction    AS ENUM ('INCOME','EXPENDITURE');
CREATE TYPE invoice_status   AS ENUM ('UNPAID','PARTIAL','PAID','WAIVED');
CREATE TYPE dues_type        AS ENUM ('DISTRICT','RI');
CREATE TYPE export_status    AS ENUM ('QUEUED','RUNNING','COMPLETED','FAILED','EXPIRED');
CREATE TYPE export_format    AS ENUM ('XLSX','CSV');
CREATE TYPE framework_status AS ENUM ('DRAFT','PUBLISHED','LOCKED','ARCHIVED');
CREATE TYPE evaluation_mode  AS ENUM ('AUTO','ASSESSOR','HYBRID');
CREATE TYPE period_type      AS ENUM ('MONTHLY','QUARTERLY','ANNUAL');
CREATE TYPE period_status    AS ENUM ('SCHEDULED','OPEN','CLOSED','FINALISED');
CREATE TYPE assessment_status AS ENUM ('PENDING','AUTO_SCORED','UNDER_REVIEW','FINALISED','DISPUTED');
CREATE TYPE score_source     AS ENUM ('AUTO','ASSESSOR','OVERRIDE');
CREATE TYPE comment_visibility AS ENUM ('INTERNAL','CLUB');
CREATE TYPE dispute_status   AS ENUM ('OPEN','UPHELD','REJECTED','WITHDRAWN');
CREATE TYPE partner_type     AS ENUM ('ROTARACT_CLUB','ROTARY_CLUB','INTERACT_CLUB','CORPORATE','NGO','GOVERNMENT','ACADEMIC','OTHER');
CREATE TYPE attendee_role    AS ENUM ('MEMBER','VISITOR','GUEST','SPEAKER');
CREATE TYPE notification_channel AS ENUM ('EMAIL','WHATSAPP','SMS','IN_APP');
CREATE TYPE notification_status  AS ENUM ('QUEUED','SENT','FAILED','CANCELLED');
CREATE TYPE user_status      AS ENUM ('INVITED','ACTIVE','SUSPENDED','DISABLED');
CREATE TYPE trf_fund_type    AS ENUM ('ANNUAL_FUND','POLIO_PLUS','ENDOWMENT','DISASTER_RESPONSE','OTHER');

-- =====================================================================
-- 1. ORGANISATION
-- =====================================================================

CREATE TABLE districts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ri_district_code  TEXT NOT NULL UNIQUE,          -- '9218'
  name              TEXT NOT NULL,
  country_code      CHAR(2) NOT NULL DEFAULT 'UG',
  timezone          TEXT NOT NULL DEFAULT 'Africa/Kampala',
  currency_code     CHAR(3) NOT NULL DEFAULT 'UGX',
  chartered_on      DATE,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The Rotary Year is global (1 Jul - 30 Jun) but lock state is per district.
CREATE TABLE rotary_years (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label         TEXT NOT NULL UNIQUE,              -- '2027-28'
  starts_on     DATE NOT NULL,
  ends_on       DATE NOT NULL,
  ri_theme      TEXT,
  CONSTRAINT ry_dates CHECK (ends_on > starts_on)
);

CREATE TABLE district_years (
  district_id     UUID NOT NULL REFERENCES districts(id),
  rotary_year_id  UUID NOT NULL REFERENCES rotary_years(id),
  is_current      BOOLEAN NOT NULL DEFAULT FALSE,
  is_locked       BOOLEAN NOT NULL DEFAULT FALSE,  -- locked = read-only
  opened_at       TIMESTAMPTZ,
  locked_at       TIMESTAMPTZ,
  PRIMARY KEY (district_id, rotary_year_id)
);
-- Exactly one current year per district.
CREATE UNIQUE INDEX district_years_one_current
  ON district_years (district_id) WHERE is_current;

CREATE TABLE regions (                              -- LDRR territory
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id  UUID NOT NULL REFERENCES districts(id),
  name         TEXT NOT NULL,
  UNIQUE (district_id, name)
);

-- Clusters are redrawn annually, so they are year-scoped.
CREATE TABLE clusters (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id     UUID NOT NULL REFERENCES districts(id),
  rotary_year_id  UUID NOT NULL REFERENCES rotary_years(id),
  region_id       UUID REFERENCES regions(id),
  name            TEXT NOT NULL,
  UNIQUE (district_id, rotary_year_id, name)
);

-- Clubs are GLOBAL entities keyed on RI Club ID. A club is not owned by a
-- district; it is affiliated to one, for a year. (Axiom 2)
CREATE TABLE clubs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ri_club_id            BIGINT UNIQUE,               -- e.g. 8825240
  name                  TEXT NOT NULL,
  slug                  TEXT NOT NULL UNIQUE,
  base_type             club_base_type NOT NULL,
  status                club_status NOT NULL DEFAULT 'ACTIVE',
  chartered_on          DATE,
  chartered_member_count INT,
  sponsor_rotary_club   TEXT,
  host_institution      TEXT,                        -- IBCs
  meeting_day           SMALLINT CHECK (meeting_day BETWEEN 0 AND 6),
  meeting_time          TIME,
  meeting_venue         TEXT,
  is_virtual            BOOLEAN NOT NULL DEFAULT FALSE,
  postal_address        TEXT,
  ursb_number           TEXT,
  bank_name             TEXT,
  bank_account_ref      TEXT,
  logo_url              TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at            TIMESTAMPTZ
);
CREATE INDEX clubs_name_trgm ON clubs USING gin (name gin_trgm_ops);

-- THE table that makes redistricting survivable.
CREATE TABLE club_district_affiliations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id         UUID NOT NULL REFERENCES clubs(id),
  district_id     UUID NOT NULL REFERENCES districts(id),
  rotary_year_id  UUID NOT NULL REFERENCES rotary_years(id),
  tier            club_tier NOT NULL,               -- recalculated at rollover
  is_confirmed    BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (club_id, rotary_year_id)                  -- one district per club per year
);
CREATE INDEX cda_district_year ON club_district_affiliations (district_id, rotary_year_id);

CREATE TABLE club_cluster_assignments (
  club_id         UUID NOT NULL REFERENCES clubs(id),
  cluster_id      UUID NOT NULL REFERENCES clusters(id),
  rotary_year_id  UUID NOT NULL REFERENCES rotary_years(id),
  PRIMARY KEY (club_id, rotary_year_id)
);

-- =====================================================================
-- 2. PEOPLE, IDENTITY, CONSENT
-- =====================================================================

CREATE TABLE persons (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ri_member_id    BIGINT UNIQUE,
  first_name      TEXT NOT NULL,
  last_name       TEXT NOT NULL,
  other_names     TEXT,
  gender          TEXT,
  date_of_birth   DATE,
  email           CITEXT UNIQUE,
  phone           TEXT,
  alt_phone       TEXT,
  occupation      TEXT,
  classification  TEXT,
  employer        TEXT,
  nationality     TEXT,
  country_code    CHAR(2),
  city            TEXT,
  photo_url       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX persons_name_trgm ON persons USING gin ((first_name||' '||last_name) gin_trgm_ops);

-- Private by default. Nothing here is ever served unauthenticated. (Axiom 6)
CREATE TABLE person_visibility (
  person_id       UUID PRIMARY KEY REFERENCES persons(id) ON DELETE CASCADE,
  show_email      BOOLEAN NOT NULL DEFAULT FALSE,
  show_phone      BOOLEAN NOT NULL DEFAULT FALSE,
  show_photo      BOOLEAN NOT NULL DEFAULT TRUE,
  show_occupation BOOLEAN NOT NULL DEFAULT TRUE,
  show_city       BOOLEAN NOT NULL DEFAULT FALSE,
  directory_optout BOOLEAN NOT NULL DEFAULT FALSE
);

-- Every person gets a visibility row at insert. Without this, a person created by
-- a seed, an import or an offline sync has NO visibility row at all, the column
-- defaults above never apply, and whatever the application does with a missing row
-- becomes the real default. That is too important a decision to leave implicit.
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

CREATE TABLE consents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id       UUID NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  consent_type    TEXT NOT NULL,                    -- 'DATA_PROCESSING','DIRECTORY','MARKETING'
  policy_version  TEXT NOT NULL,
  granted_at      TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  source_ip       INET
);
CREATE INDEX consents_person ON consents (person_id, consent_type);

CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id       UUID NOT NULL UNIQUE REFERENCES persons(id),
  password_hash   TEXT,                             -- Argon2id
  status          user_status NOT NULL DEFAULT 'INVITED',
  -- TOTP shared secret, ENCRYPTED with AES-256-GCM before it reaches this column
  -- (apps/api/src/platform/crypto.ts). The key lives in the hosting platform's secret
  -- store, never in this database and never in its backups, so a leaked dump does not
  -- hand over the second factor along with the first. Format: keyId.iv.ciphertext.tag
  mfa_secret      TEXT,
  mfa_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  -- Highest TOTP step already accepted. A code stays valid for its 30-second step plus
  -- the tolerance window either side; without this, anyone who sees a code once — over a
  -- shoulder, in a screenshot, through a phishing page — can replay it until it expires.
  mfa_last_used_step BIGINT,
  last_login_at   TIMESTAMPTZ,
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Single-use codes that stand in for an authenticator app.
--
-- Without these, a member whose phone is lost or wiped cannot sign in at all, and the
-- only remedy is an administrator clearing their MFA by hand — which for the DRR or the
-- District Treasurer means being locked out of the award system until someone with
-- database access is available. Codes are hashed: this table is as sensitive as a
-- password column and must not be readable as credentials.
CREATE TABLE mfa_recovery_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL UNIQUE,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX mfa_recovery_user ON mfa_recovery_codes (user_id);

CREATE TABLE user_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL,                        -- 'RESET','INVITE','VERIFY'
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  -- v1.7. When the link was SENT. Expiry alone cannot answer "how long has this person
  -- been sitting on an invitation" without assuming the TTL has never changed.
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Tokens are looked up by hash on every reset and invite acceptance. Unique so a
-- collision or a duplicated issue is an error rather than an ambiguous match.
CREATE UNIQUE INDEX user_tokens_hash ON user_tokens (token_hash);

-- A member asking to be erased, and the review that has to happen first.
--
-- Reviewed rather than immediate: erasure is irreversible and the request arrives from a
-- session, which is the thing an attacker takes. A district officer reading it first
-- costs a day and prevents a member's whole record being blanked by somebody who
-- borrowed their phone.
--
-- The work then ANONYMISES rather than deletes. membership_events is append-only and a
-- club's retention rate for 2027-28 is a fact about the club; deleting the person would
-- change it retroactively. The person row survives under the same id with the names
-- replaced and every contact column nulled, so every event, appointment and attendance
-- still points at something real.
CREATE TYPE erasure_status AS ENUM ('PENDING','APPROVED','REJECTED','COMPLETED');

CREATE TABLE person_erasure_requests (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The district that reviews it: the requester's at the time of asking.
  district_id          UUID NOT NULL REFERENCES districts(id),
  person_id            UUID NOT NULL REFERENCES persons(id),
  requested_by_user_id UUID REFERENCES users(id),
  status               erasure_status NOT NULL DEFAULT 'PENDING',
  reason               TEXT,
  reviewed_by_user_id  UUID REFERENCES users(id),
  reviewed_at          TIMESTAMPTZ,
  review_note          TEXT,
  completed_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX erasure_district_status ON person_erasure_requests (district_id, status);

-- =====================================================================
-- 3. GOVERNANCE — positions, appointments, committees
-- Permissions attach to appointments, never to persons. (SRS §2)
-- =====================================================================

CREATE TABLE permissions (
  code        TEXT PRIMARY KEY,                     -- 'activity:create:club'
  description TEXT NOT NULL
);

CREATE TABLE positions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id  UUID REFERENCES districts(id),       -- NULL = system-wide template
  code         TEXT NOT NULL,
  name         TEXT NOT NULL,
  scope        org_scope NOT NULL,
  sequence     INT NOT NULL DEFAULT 0,
  is_unique_per_scope BOOLEAN NOT NULL DEFAULT FALSE, -- e.g. only one DRR
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (district_id, code)
);
-- UNIQUE above does NOT constrain templates: Postgres treats NULLs as distinct,
-- so two rows with district_id IS NULL could share a code. Templates are seeded,
-- so a duplicate would be silent and would make position lookup ambiguous.
CREATE UNIQUE INDEX positions_template_code ON positions (code) WHERE district_id IS NULL;

CREATE TABLE position_permissions (
  position_id     UUID NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES permissions(code),
  PRIMARY KEY (position_id, permission_code)
);

CREATE TABLE appointments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id     UUID NOT NULL REFERENCES districts(id),
  rotary_year_id  UUID NOT NULL REFERENCES rotary_years(id),
  person_id       UUID NOT NULL REFERENCES persons(id),
  position_id     UUID NOT NULL REFERENCES positions(id),
  scope_type      org_scope NOT NULL,
  scope_id        UUID,                             -- club/cluster/region/committee id
  starts_on       DATE NOT NULL,
  ends_on         DATE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX appointments_lookup
  ON appointments (person_id, rotary_year_id) WHERE is_active;
CREATE INDEX appointments_scope
  ON appointments (scope_type, scope_id, rotary_year_id) WHERE is_active;
-- NOT enforceable here: an appointment's district_id must match its position's
-- district_id, unless the position is a template (district_id IS NULL). A
-- composite foreign key cannot express that, because the nullable half would
-- reject every template. The governance service validates it; M1 tests it.
-- Likewise scope_id, which is polymorphic by design.

CREATE TABLE committees (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id         UUID NOT NULL REFERENCES districts(id),
  rotary_year_id      UUID NOT NULL REFERENCES rotary_years(id),
  parent_committee_id UUID REFERENCES committees(id),
  name                TEXT NOT NULL,
  mandate             TEXT,
  UNIQUE (district_id, rotary_year_id, name),
  -- Stops the trivial cycle. Longer cycles (A -> B -> A) cannot be expressed as
  -- a CHECK; the service layer walks the ancestry before setting a parent, and a
  -- cycle would otherwise hang the recursive query that renders the tree.
  CONSTRAINT committees_not_self_parent CHECK (parent_committee_id IS DISTINCT FROM id)
);

CREATE TABLE committee_members (
  committee_id   UUID NOT NULL REFERENCES committees(id) ON DELETE CASCADE,
  appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  role_label     TEXT,
  PRIMARY KEY (committee_id, appointment_id)
);

-- =====================================================================
-- 4. MEMBERSHIP — an immutable event log. Roster is derived. (Axiom 3)
-- =====================================================================

CREATE TABLE membership_events (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id          UUID NOT NULL REFERENCES districts(id),
  rotary_year_id       UUID NOT NULL REFERENCES rotary_years(id),
  person_id            UUID NOT NULL REFERENCES persons(id),
  club_id              UUID NOT NULL REFERENCES clubs(id),
  event_type           membership_event_type NOT NULL,
  member_category      member_category NOT NULL DEFAULT 'ACTIVE',
  effective_on         DATE NOT NULL,
  reason_code          TEXT,                        -- 'RELOCATION','STUDIES_ENDED','NON_PAYMENT',...
  reason_note          TEXT,
  counterparty_club_id UUID REFERENCES clubs(id),   -- transfers
  rotary_club_name     TEXT,                        -- TRANSITION_TO_ROTARY
  rotary_club_ri_id    BIGINT,
  corroborated_at      TIMESTAMPTZ,
  supersedes_event_id  UUID REFERENCES membership_events(id), -- CORRECTION
  evidence_url         TEXT,
  recorded_by_user_id  UUID REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A correction must say what it corrects. (Non-correction events MAY also
  -- supersede: a restated JOIN is how a wrong date is fixed — see below.)
  CONSTRAINT me_correction_supersedes
    CHECK (event_type <> 'CORRECTION' OR supersedes_event_id IS NOT NULL)
);
CREATE INDEX me_club_date ON membership_events (club_id, effective_on);
CREATE INDEX me_person     ON membership_events (person_id, effective_on);
CREATE INDEX me_type_year  ON membership_events (district_id, rotary_year_id, event_type);

-- Axiom 3 enforced, not merely documented. The log is the evidentiary basis for
-- contested awards, so "append-only" cannot depend on every future code path
-- remembering. corroborated_at is the single legitimate mutation: corroboration
-- of a transition to Rotary happens after the event is recorded.
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

-- Derived current roster. Refreshed on event write and nightly.
--
-- HOW CORRECTIONS WORK, because the predicate below depends on it:
--   * To fix a wrong fact, append the corrected event with its REAL type — a
--     mistyped join date is a second JOIN carrying the right date, with
--     supersedes_event_id pointing at the original.
--   * To retract a fact entirely ("this never happened"), append an event of
--     type CORRECTION pointing at the original. It supersedes the original and,
--     not being a joining type, drops the person from the roster.
--   * Either way the original row stays. The log is never edited.
--
-- The predicate excludes events that HAVE BEEN superseded, not events that
-- supersede. v1.0 had this inverted (WHERE supersedes_event_id IS NULL), which
-- silently discarded every correction and kept counting the row it corrected.
-- Chains resolve naturally: only the tip of a supersede chain survives.
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

-- =====================================================================
-- 5. ACTIVITY — one model, configurable types. (Axiom 4)
-- =====================================================================

CREATE TABLE areas_of_focus (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);
-- Seed: PEACE, DISEASE, WATER, MATERNAL_CHILD, EDUCATION, ECONOMIC, ENVIRONMENT

CREATE TABLE activity_types (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id         UUID REFERENCES districts(id),
  code                TEXT NOT NULL,
  name                TEXT NOT NULL,
  category            TEXT NOT NULL,   -- FELLOWSHIP | SERVICE | INTERNATIONAL | YOUTH
                                       -- | PLD | GOVERNANCE | CLUSTER | DISTRICT | COMMITTEE
  allowed_host_scopes org_scope[] NOT NULL DEFAULT '{CLUB}',
  requires_photo      BOOLEAN NOT NULL DEFAULT FALSE,
  requires_report     BOOLEAN NOT NULL DEFAULT FALSE,
  requires_attendance BOOLEAN NOT NULL DEFAULT FALSE,
  requires_partner    BOOLEAN NOT NULL DEFAULT FALSE,
  requires_area_of_focus BOOLEAN NOT NULL DEFAULT FALSE,
  is_scoring_eligible BOOLEAN NOT NULL DEFAULT TRUE,
  field_config        JSONB NOT NULL DEFAULT '{}',  -- extra type-specific fields
  sequence            INT NOT NULL DEFAULT 0,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (district_id, code)
);
-- Same NULL-distinct hole as positions: without this, two template types
-- (district_id IS NULL) could share a code and type lookup becomes ambiguous.
CREATE UNIQUE INDEX activity_types_template_code ON activity_types (code) WHERE district_id IS NULL;

CREATE TABLE activities (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id              UUID NOT NULL REFERENCES districts(id),
  rotary_year_id           UUID NOT NULL REFERENCES rotary_years(id),
  activity_type_id         UUID NOT NULL REFERENCES activity_types(id),
  host_scope_type          org_scope NOT NULL,
  host_scope_id            UUID NOT NULL,           -- club / cluster / committee / district
  title                    TEXT NOT NULL,
  description              TEXT,                    -- no length limit, by design
  starts_at                TIMESTAMPTZ NOT NULL,
  ends_at                  TIMESTAMPTZ,
  venue                    TEXT,
  is_virtual               BOOLEAN NOT NULL DEFAULT FALSE,
  meeting_url              TEXT,
  status                   activity_status NOT NULL DEFAULT 'PLANNED',
  theme_alignment          TEXT,                    -- monthly Rotary theme
  report_url               TEXT,
  narrative_report         TEXT,
  spc_reference            TEXT,                    -- RI Service Project Centre
  attendance_members       INT,
  attendance_visitors      INT,
  attendance_guests        INT,
  beneficiaries_count      INT,
  trees_planted            INT,
  funds_raised             NUMERIC(14,2),
  volunteer_hours          NUMERIC(10,2),
  extra                    JSONB NOT NULL DEFAULT '{}',
  verification             verification_state NOT NULL DEFAULT 'UNVERIFIED',
  verified_by_user_id      UUID REFERENCES users(id),
  verified_at              TIMESTAMPTZ,
  created_by_user_id       UUID REFERENCES users(id),
  client_generated         BOOLEAN NOT NULL DEFAULT FALSE,  -- offline sync
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at               TIMESTAMPTZ,
  CONSTRAINT act_dates CHECK (ends_at IS NULL OR ends_at >= starts_at),
  -- Every scored quantity is non-negative. NULL means "not reported" and passes;
  -- a negative is always data entry gone wrong, and it would score.
  CONSTRAINT act_non_negative CHECK (
    attendance_members >= 0 AND attendance_visitors >= 0 AND
    attendance_guests  >= 0 AND beneficiaries_count >= 0 AND
    trees_planted      >= 0 AND funds_raised        >= 0 AND
    volunteer_hours    >= 0
  )
);

-- WHICH ATTENDANCE NUMBER IS AUTHORITATIVE (the scoring engine depends on this):
--   activity_types.requires_attendance = TRUE  -> count activity_attendees rows;
--     the columns below are ignored and the client does not collect them.
--   activity_types.requires_attendance = FALSE -> use attendance_members /
--     _visitors / _guests; attendee rows are optional detail and are not scored.
-- Named attendance where it is practical to collect, counts where it is not — a
-- 400-person community project cannot list every beneficiary by name.
--
-- Enforced in the activity service at submission, NOT by a trigger: a deferred
-- constraint trigger would reject the legitimate flow where a secretary marks an
-- activity HELD and then adds attendees one at a time.
CREATE INDEX act_host_year   ON activities (host_scope_type, host_scope_id, rotary_year_id);
CREATE INDEX act_type_date   ON activities (activity_type_id, starts_at);
CREATE INDEX act_scoring     ON activities (district_id, rotary_year_id, starts_at)
                               WHERE deleted_at IS NULL AND status = 'HELD';

CREATE TABLE activity_areas_of_focus (
  activity_id      UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  area_of_focus_id UUID NOT NULL REFERENCES areas_of_focus(id),
  PRIMARY KEY (activity_id, area_of_focus_id)
);

CREATE TABLE activity_partners (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id       UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  partner_type      partner_type NOT NULL,
  partner_club_id   UUID REFERENCES clubs(id),
  partner_org_name  TEXT,
  -- <> 'UG' qualifies international service. NOT NULL so the derivation is total
  -- and fails conservatively: a partner nobody classified is domestic, and cannot
  -- silently qualify an activity for international service points.
  country_code      CHAR(2) NOT NULL DEFAULT 'UG',
  contribution_note TEXT
);

CREATE TABLE activity_media (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  media_type  TEXT NOT NULL DEFAULT 'IMAGE',
  storage_key TEXT NOT NULL,
  thumb_key   TEXT,
  caption     TEXT,
  sequence    INT NOT NULL DEFAULT 0
);

CREATE TABLE activity_attendees (
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  person_id   UUID NOT NULL REFERENCES persons(id),
  role        attendee_role NOT NULL DEFAULT 'MEMBER',
  confirmed_at TIMESTAMPTZ,
  PRIMARY KEY (activity_id, person_id)
);

-- =====================================================================
-- 6. FINANCE
-- =====================================================================

CREATE TABLE finance_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id UUID REFERENCES districts(id),
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  direction   txn_direction NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (district_id, code)
);
-- Third instance of the NULL-distinct hole; see positions and activity_types.
CREATE UNIQUE INDEX finance_categories_template_code ON finance_categories (code) WHERE district_id IS NULL;

CREATE TABLE budgets (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id    UUID NOT NULL REFERENCES districts(id),
  rotary_year_id UUID NOT NULL REFERENCES rotary_years(id),
  owner_scope_type org_scope NOT NULL,
  owner_scope_id UUID NOT NULL,
  currency_code  CHAR(3) NOT NULL DEFAULT 'UGX',
  approved_at    TIMESTAMPTZ,
  approved_by_user_id UUID REFERENCES users(id),
  UNIQUE (owner_scope_type, owner_scope_id, rotary_year_id)
);

CREATE TABLE budget_lines (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id    UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  category_id  UUID NOT NULL REFERENCES finance_categories(id),
  description  TEXT NOT NULL,
  amount_planned NUMERIC(14,2) NOT NULL CHECK (amount_planned >= 0)
);

CREATE TABLE financial_transactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id      UUID NOT NULL REFERENCES districts(id),
  rotary_year_id   UUID NOT NULL REFERENCES rotary_years(id),
  owner_scope_type org_scope NOT NULL,
  owner_scope_id   UUID NOT NULL,
  category_id      UUID NOT NULL REFERENCES finance_categories(id),
  budget_line_id   UUID REFERENCES budget_lines(id),
  direction        txn_direction NOT NULL,
  amount           NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  currency_code    CHAR(3) NOT NULL DEFAULT 'UGX',
  occurred_on      DATE NOT NULL,
  description      TEXT,
  evidence_url     TEXT,
  activity_id      UUID REFERENCES activities(id),
  recorded_by_user_id UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ
);
CREATE INDEX ft_owner_year ON financial_transactions (owner_scope_type, owner_scope_id, rotary_year_id);

CREATE TABLE dues_invoices (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id    UUID NOT NULL REFERENCES districts(id),
  rotary_year_id UUID NOT NULL REFERENCES rotary_years(id),
  club_id        UUID NOT NULL REFERENCES clubs(id),
  -- Enum, not free text: this column is part of the unique key below, so
  -- 'district' and 'DISTRICT' would be two invoices for the same debt.
  dues_type      dues_type NOT NULL DEFAULT 'DISTRICT',
  amount_due     NUMERIC(14,2) NOT NULL CHECK (amount_due >= 0),
  currency_code  CHAR(3) NOT NULL DEFAULT 'UGX',
  due_on         DATE NOT NULL,
  -- Status is NOT stored: see dues_invoice_states below and ADR-012. Waiving is
  -- the only part of the state a human decides, so it is the only part recorded.
  waived_at      TIMESTAMPTZ,
  waived_by_user_id UUID REFERENCES users(id),
  waiver_reason  TEXT,
  UNIQUE (club_id, rotary_year_id, dues_type)
);

CREATE TABLE dues_payments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id   UUID NOT NULL REFERENCES dues_invoices(id) ON DELETE CASCADE,
  amount       NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  paid_on      DATE NOT NULL,
  method       TEXT,
  reference    TEXT,
  evidence_url TEXT,
  receipt_no   TEXT UNIQUE,
  confirmed_by_user_id UUID REFERENCES users(id),
  confirmed_at TIMESTAMPTZ
);
CREATE INDEX dues_payments_invoice ON dues_payments (invoice_id);

-- Dues status is DERIVED (ADR-012). No trigger, no stored column, nothing to
-- drift. The as_of parameter that scoring needs is a WHERE clause on paid_on
-- against this same shape — a stored status could only ever answer "now".
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

CREATE TABLE member_dues (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id    UUID NOT NULL REFERENCES districts(id),
  rotary_year_id UUID NOT NULL REFERENCES rotary_years(id),
  club_id        UUID NOT NULL REFERENCES clubs(id),
  person_id      UUID NOT NULL REFERENCES persons(id),
  amount_due     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (amount_due >= 0),
  -- amount_paid is NOT stored: see member_dues_states below and ADR-012.
  is_prepaid     BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (person_id, club_id, rotary_year_id)
);

-- Members hand cash to a club treasurer. That is the collection path most open
-- to dispute, so it gets the same audit trail as club dues rather than a bare
-- running total someone overwrites.
CREATE TABLE member_dues_payments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_dues_id UUID NOT NULL REFERENCES member_dues(id) ON DELETE CASCADE,
  amount         NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  paid_on        DATE NOT NULL,
  method         TEXT,
  reference      TEXT,
  evidence_url   TEXT,
  receipt_no     TEXT UNIQUE,
  confirmed_by_user_id UUID REFERENCES users(id),
  confirmed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX mdp_member_dues ON member_dues_payments (member_dues_id);

-- Derived, not stored (ADR-012).
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

CREATE TABLE trf_contributions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id      UUID NOT NULL REFERENCES districts(id),
  rotary_year_id   UUID NOT NULL REFERENCES rotary_years(id),
  club_id          UUID NOT NULL REFERENCES clubs(id),
  person_id        UUID REFERENCES persons(id),     -- NULL = club-level gift
  fund_type        trf_fund_type NOT NULL DEFAULT 'ANNUAL_FUND',
  amount_usd       NUMERIC(12,2) NOT NULL CHECK (amount_usd >= 0),
  contributed_on   DATE NOT NULL,
  ri_receipt_ref   TEXT,
  evidence_url     TEXT,
  verification     verification_state NOT NULL DEFAULT 'UNVERIFIED',
  verified_by_user_id UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX trf_club_year ON trf_contributions (club_id, rotary_year_id);

-- =====================================================================
-- 7. ASSESSMENT ENGINE — the rubric is data. (Axiom 5)
-- =====================================================================

CREATE TABLE assessment_frameworks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id    UUID NOT NULL REFERENCES districts(id),
  rotary_year_id UUID NOT NULL REFERENCES rotary_years(id),
  name           TEXT NOT NULL,
  version        INT NOT NULL DEFAULT 1,
  total_points   NUMERIC(6,2) NOT NULL DEFAULT 100,
  status         framework_status NOT NULL DEFAULT 'DRAFT',
  published_at   TIMESTAMPTZ,
  locked_at      TIMESTAMPTZ,
  UNIQUE (district_id, rotary_year_id, version)
);

CREATE TABLE assessment_parameters (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  framework_id UUID NOT NULL REFERENCES assessment_frameworks(id) ON DELETE CASCADE,
  sequence     INT NOT NULL,
  name         TEXT NOT NULL,                      -- 'Service Projects','TRF','PLD'...
  max_points   NUMERIC(6,2) NOT NULL CHECK (max_points >= 0),
  description  TEXT,
  UNIQUE (framework_id, sequence)
);

CREATE TABLE assessment_criteria (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parameter_id     UUID NOT NULL REFERENCES assessment_parameters(id) ON DELETE CASCADE,
  sequence         INT NOT NULL,
  description      TEXT NOT NULL,
  points           NUMERIC(6,2) NOT NULL CHECK (points >= 0),
  evaluation_mode  evaluation_mode NOT NULL,
  resolver_key     TEXT,                            -- registry key; NULL for ASSESSOR mode
  rule             JSONB,                           -- see 06-Assessment-Engine.md
  applies_to_tiers club_tier[] NOT NULL DEFAULT '{T1,T2,IBC}',
  guidance         TEXT,
  UNIQUE (parameter_id, sequence),
  -- AUTO and HYBRID criteria are scored by a resolver, so they must name one.
  -- An AUTO criterion with no resolver silently scores nothing. ASSESSOR
  -- criteria MAY carry one, to show the assessor a computed number as guidance.
  CONSTRAINT criterion_resolver_required
    CHECK (evaluation_mode = 'ASSESSOR' OR resolver_key IS NOT NULL)
);

CREATE TABLE assessment_periods (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  framework_id       UUID NOT NULL REFERENCES assessment_frameworks(id),
  period_type        period_type NOT NULL,
  label              TEXT NOT NULL,                 -- 'August 2027','Q1 2027-28'
  starts_on          DATE NOT NULL,
  ends_on            DATE NOT NULL,
  submission_deadline TIMESTAMPTZ NOT NULL,
  dispute_closes_at  TIMESTAMPTZ,
  status             period_status NOT NULL DEFAULT 'SCHEDULED',
  UNIQUE (framework_id, label),
  CONSTRAINT period_dates CHECK (ends_on >= starts_on),
  CONSTRAINT period_dispute_window
    CHECK (dispute_closes_at IS NULL OR dispute_closes_at >= submission_deadline)
  -- submission_deadline >= ends_on is NOT expressible here: casting DATE to
  -- TIMESTAMPTZ is stable, not immutable, so Postgres rejects it in a CHECK.
  -- The assessment service validates it when a period is scheduled.
);

CREATE TABLE club_assessments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id  UUID NOT NULL REFERENCES districts(id),
  period_id    UUID NOT NULL REFERENCES assessment_periods(id),
  club_id      UUID NOT NULL REFERENCES clubs(id),
  tier         club_tier NOT NULL,
  status       assessment_status NOT NULL DEFAULT 'PENDING',
  -- total_score, max_possible and rank_in_tier are NOT stored: they are sums
  -- and a window function over assessment_scores. See club_assessment_states
  -- below and ADR-012. A standings table that disagrees with the scorecard it
  -- links to is precisely the argument this system exists to prevent.
  --
  -- is_stale REMAINS, and is not derived state: it records that the resolvers
  -- need re-running, which is real work the nightly job schedules.
  is_stale     BOOLEAN NOT NULL DEFAULT TRUE,
  computed_at  TIMESTAMPTZ,
  finalised_at TIMESTAMPTZ,
  finalised_by_user_id UUID REFERENCES users(id),
  UNIQUE (period_id, club_id)
);
CREATE INDEX ca_stale ON club_assessments (is_stale) WHERE is_stale;

CREATE TABLE assessment_scores (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_assessment_id UUID NOT NULL REFERENCES club_assessments(id) ON DELETE CASCADE,
  criterion_id       UUID NOT NULL REFERENCES assessment_criteria(id),
  points_awarded     NUMERIC(6,2) NOT NULL DEFAULT 0,
  points_possible    NUMERIC(6,2) NOT NULL,
  source             score_source NOT NULL,
  evidence           JSONB NOT NULL DEFAULT '{}',   -- what the resolver saw
  assessor_user_id   UUID REFERENCES users(id),
  comment            TEXT,
  scored_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (club_assessment_id, criterion_id),
  -- A club cannot be awarded more than a criterion is worth. Without this, one
  -- resolver bug or one assessor typo inflates a total and nothing contradicts
  -- it. If bonus points are ever wanted, raise points_possible on the row.
  CONSTRAINT score_within_bounds
    CHECK (points_possible >= 0 AND points_awarded >= 0 AND points_awarded <= points_possible)
);

-- Scorecard totals and standings, derived (ADR-012). Ranking lives here too:
-- it is a window function over the same numbers, so it cannot disagree with
-- them. If standings ever become hot, this can be materialised behind the same
-- name without changing a single caller.
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

CREATE TABLE assessor_assignments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id    UUID NOT NULL REFERENCES assessment_periods(id) ON DELETE CASCADE,
  parameter_id UUID NOT NULL REFERENCES assessment_parameters(id),
  person_id    UUID NOT NULL REFERENCES persons(id),
  cluster_id   UUID REFERENCES clusters(id),        -- NULL = all clubs
  UNIQUE (period_id, parameter_id, person_id, cluster_id)
);
-- The UNIQUE above does not constrain the "all clubs" case, because NULLs are
-- distinct: the same assessor could be assigned district-wide twice for one
-- parameter. Fourth instance of this pattern in the schema.
CREATE UNIQUE INDEX assessor_assignments_all_clubs
  ON assessor_assignments (period_id, parameter_id, person_id) WHERE cluster_id IS NULL;

-- Does the rubric add up? total_points, the sum of parameter weights and the
-- sum of criterion points are three independent numbers in this design, and
-- nothing forces agreement. Publishing a 103-point framework is silent until
-- clubs compare scorecards. Not expressible as a CHECK (it spans rows), so the
-- assessment service blocks the DRAFT -> PUBLISHED transition when is_balanced
-- is false, and the rubric editor shows this live while the chair works.
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

-- The feedback loop the incumbent system never had.
CREATE TABLE assessment_comments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_assessment_id UUID NOT NULL REFERENCES club_assessments(id) ON DELETE CASCADE,
  author_user_id     UUID NOT NULL REFERENCES users(id),
  body               TEXT NOT NULL,
  visibility         comment_visibility NOT NULL DEFAULT 'CLUB',
  is_commendation    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- NOTE: unlike assessment_comments, this does NOT cascade from
-- club_assessments, and that is deliberate: a dispute is the record of a
-- contest and must survive tidy-up of the assessment it contests. Deleting an
-- assessment with a dispute raises a foreign key error; the service turns that
-- into a domain message rather than letting it reach a client raw.
CREATE TABLE assessment_disputes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_assessment_id UUID NOT NULL REFERENCES club_assessments(id),
  criterion_id       UUID REFERENCES assessment_criteria(id),
  raised_by_user_id  UUID NOT NULL REFERENCES users(id),
  body               TEXT NOT NULL,
  evidence_url       TEXT,
  status             dispute_status NOT NULL DEFAULT 'OPEN',
  resolution_note    TEXT,
  resolved_by_user_id UUID REFERENCES users(id),
  resolved_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- 8. GOALS
-- =====================================================================

CREATE TABLE goals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id      UUID NOT NULL REFERENCES districts(id),
  rotary_year_id   UUID NOT NULL REFERENCES rotary_years(id),
  owner_scope_type org_scope NOT NULL DEFAULT 'DISTRICT',
  owner_scope_id   UUID,
  name             TEXT NOT NULL,                   -- 'TRF Contribution'
  unit             TEXT NOT NULL,                   -- 'USD','clubs','members'
  target_value     NUMERIC(14,2) NOT NULL,
  baseline_value   NUMERIC(14,2),
  resolver_key     TEXT,                            -- NULL = manual entry
  resolver_config  JSONB NOT NULL DEFAULT '{}',
  sequence         INT NOT NULL DEFAULT 0
);

CREATE TABLE goal_snapshots (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id     UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  as_of       DATE NOT NULL,
  actual_value NUMERIC(14,2) NOT NULL,
  source      score_source NOT NULL DEFAULT 'AUTO',
  note        TEXT,
  UNIQUE (goal_id, as_of)
);

-- =====================================================================
-- 9. DOCUMENTS
-- =====================================================================

-- A lookup table, not free text: a criterion like "club has a valid URSB
-- certificate" resolves by matching doc_type, so a typo at upload silently
-- costs a club points. A district adds a type without a deployment (the file's
-- own convention), which is why this is a table rather than an enum.
CREATE TABLE document_types (
  code        TEXT PRIMARY KEY,                     -- URSB_CERT, AUDITED_ACCOUNTS, ...
  name        TEXT NOT NULL,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE documents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id      UUID NOT NULL REFERENCES districts(id),
  owner_scope_type org_scope NOT NULL,
  owner_scope_id   UUID NOT NULL,
  doc_type         TEXT NOT NULL REFERENCES document_types(code),
  title            TEXT NOT NULL,
  storage_key      TEXT NOT NULL,
  mime_type        TEXT,
  size_bytes       BIGINT CHECK (size_bytes >= 0),
  issued_on        DATE,
  expires_on       DATE,
  verification     verification_state NOT NULL DEFAULT 'UNVERIFIED',
  verified_by_user_id UUID REFERENCES users(id),
  uploaded_by_user_id UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ,
  CONSTRAINT document_dates CHECK (expires_on IS NULL OR issued_on IS NULL OR expires_on >= issued_on)
);
CREATE INDEX documents_owner ON documents (owner_scope_type, owner_scope_id, doc_type);

-- =====================================================================
-- 10. PUBLIC IMAGE
-- =====================================================================

-- Lookup, not free text: platform is part of the unique key below, so
-- 'Instagram' and 'INSTAGRAM' would be two accounts for one club on one
-- network. New platforms appear faster than deployments, hence a table.
CREATE TABLE social_platforms (
  code      TEXT PRIMARY KEY,                       -- X, INSTAGRAM, FACEBOOK, TIKTOK,
  name      TEXT NOT NULL,                          -- LINKEDIN, YOUTUBE, OTHER
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE social_accounts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id      UUID NOT NULL REFERENCES districts(id),
  owner_scope_type org_scope NOT NULL,
  owner_scope_id   UUID NOT NULL,
  platform         TEXT NOT NULL REFERENCES social_platforms(code),
  handle           TEXT,
  url              TEXT NOT NULL,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (owner_scope_type, owner_scope_id, platform)
);

CREATE TABLE social_snapshots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  social_account_id UUID NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
  captured_on       DATE NOT NULL,
  follower_count    INT CHECK (follower_count >= 0),
  post_count_30d    INT CHECK (post_count_30d >= 0),
  UNIQUE (social_account_id, captured_on)
);

CREATE TABLE media_appearances (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id      UUID NOT NULL REFERENCES districts(id),
  rotary_year_id   UUID NOT NULL REFERENCES rotary_years(id),
  owner_scope_type org_scope NOT NULL,
  owner_scope_id   UUID NOT NULL,
  outlet           TEXT NOT NULL,
  outlet_type      TEXT,                            -- TV, RADIO, PRINT, ONLINE
  url              TEXT,
  appeared_on      DATE NOT NULL,
  evidence_url     TEXT
);

-- =====================================================================
-- 11. PLATFORM — audit, notifications, exports
-- =====================================================================

CREATE TABLE audit_log (
  id            BIGSERIAL PRIMARY KEY,
  district_id   UUID,
  actor_user_id UUID REFERENCES users(id),
  entity_type   TEXT NOT NULL,
  entity_id     UUID,
  action        TEXT NOT NULL,                      -- CREATE | UPDATE | DELETE | LOGIN | EXPORT
  before        JSONB,
  after         JSONB,
  ip_address    INET,
  user_agent    TEXT,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_entity ON audit_log (entity_type, entity_id, occurred_at DESC);
CREATE INDEX audit_actor  ON audit_log (actor_user_id, occurred_at DESC);

-- Append-only, enforced (ADR-012). An audit log that the application can edit
-- is not an audit log — it is a table of claims. This is the record that makes
-- a contested award reconstructable, so it gets the same treatment as
-- membership_events, with no exception column.
--
-- Retention is indefinite by design. If a retention policy is ever adopted,
-- purging means dropping this trigger deliberately, in a migration, on the
-- record — which is the correct amount of friction for deleting an audit trail.
CREATE FUNCTION audit_log_immutable() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'DIS02';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_mutate
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

CREATE TABLE notification_templates (
  code       TEXT PRIMARY KEY,
  channel    notification_channel NOT NULL,
  subject    TEXT,
  body       TEXT NOT NULL,                         -- handlebars-style
  is_active  BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE notifications (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id    UUID REFERENCES districts(id),
  recipient_person_id UUID NOT NULL REFERENCES persons(id),
  channel        notification_channel NOT NULL,
  template_code  TEXT REFERENCES notification_templates(code),
  payload        JSONB NOT NULL DEFAULT '{}',
  status         notification_status NOT NULL DEFAULT 'QUEUED',
  scheduled_for  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at        TIMESTAMPTZ,
  error          TEXT,
  attempts       INT NOT NULL DEFAULT 0
);
CREATE INDEX notif_due ON notifications (status, scheduled_for) WHERE status = 'QUEUED';

-- The express-session store, written and read by connect-pg-simple (ADR-003).
--
-- Declared here, and in schema.prisma, because Prisma must OWN it: a table Prisma can
-- represent and does not know about is proposed for dropping on the next migrate dev.
-- The column names are the library's and cannot change.
--
-- `expire` deviates from connect-pg-simple's reference DDL, which uses a naive
-- `timestamp`. The library compares that column against to_timestamp(), which yields
-- timestamptz, so with a naive column the comparison resolves through the server's
-- timezone — and this server is not UTC. Timestamptz makes session expiry exact, and
-- matches the project-wide rule that a timestamp is always TIMESTAMPTZ.
CREATE TABLE "session" (
  sid    VARCHAR PRIMARY KEY NOT NULL,
  sess   JSON NOT NULL,
  expire TIMESTAMPTZ(6) NOT NULL
);
CREATE INDEX "IDX_session_expire" ON "session" (expire);

CREATE TABLE export_jobs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id    UUID NOT NULL REFERENCES districts(id),
  requested_by_user_id UUID NOT NULL REFERENCES users(id),
  resource       TEXT NOT NULL,
  format         export_format NOT NULL DEFAULT 'XLSX',
  filters        JSONB NOT NULL DEFAULT '{}',
  status         export_status NOT NULL DEFAULT 'QUEUED',
  storage_key    TEXT,
  row_count      INT CHECK (row_count >= 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at   TIMESTAMPTZ,
  expires_at     TIMESTAMPTZ
);

-- =====================================================================
-- 12. ROW LEVEL SECURITY — defence in depth behind app-layer scoping
-- =====================================================================
-- Enable per tenant-scoped table; the app sets:
--   SET LOCAL app.district_id = '<uuid>';
-- Example:
--
-- ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY activities_tenant ON activities
--   USING (district_id = current_setting('app.district_id', true)::uuid);
--
-- Apply to: activities, membership_events, financial_transactions,
-- club_assessments, goals, documents, appointments, dues_invoices,
-- trf_contributions, media_appearances, social_accounts, notifications.
-- NOTE: application-layer scoping remains the primary control. RLS is a
-- backstop against a forgotten WHERE clause, not a substitute for one.