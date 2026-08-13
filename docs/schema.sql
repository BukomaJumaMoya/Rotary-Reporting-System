-- =====================================================================
-- Rotaract District Information System (DIS)
-- Authoritative PostgreSQL 16 schema — design baseline v1.0
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
  mfa_secret      TEXT,
  mfa_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at   TIMESTAMPTZ,
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL,                        -- 'RESET','INVITE','VERIFY'
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

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

CREATE TABLE committees (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id         UUID NOT NULL REFERENCES districts(id),
  rotary_year_id      UUID NOT NULL REFERENCES rotary_years(id),
  parent_committee_id UUID REFERENCES committees(id),
  name                TEXT NOT NULL,
  mandate             TEXT,
  UNIQUE (district_id, rotary_year_id, name)
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
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX me_club_date ON membership_events (club_id, effective_on);
CREATE INDEX me_person     ON membership_events (person_id, effective_on);
CREATE INDEX me_type_year  ON membership_events (district_id, rotary_year_id, event_type);

-- Derived current roster. Refreshed on event write and nightly.
CREATE MATERIALIZED VIEW club_rosters AS
WITH ranked AS (
  SELECT DISTINCT ON (person_id, club_id)
         person_id, club_id, district_id, event_type, member_category, effective_on
  FROM membership_events
  WHERE supersedes_event_id IS NULL
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
  deleted_at               TIMESTAMPTZ
);
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
  country_code      CHAR(2),                        -- <> 'UG' qualifies international service
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
  amount_planned NUMERIC(14,2) NOT NULL
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
  dues_type      TEXT NOT NULL DEFAULT 'DISTRICT',  -- DISTRICT | RI
  amount_due     NUMERIC(14,2) NOT NULL,
  currency_code  CHAR(3) NOT NULL DEFAULT 'UGX',
  due_on         DATE NOT NULL,
  status         invoice_status NOT NULL DEFAULT 'UNPAID',
  UNIQUE (club_id, rotary_year_id, dues_type)
);

CREATE TABLE dues_payments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id   UUID NOT NULL REFERENCES dues_invoices(id) ON DELETE CASCADE,
  amount       NUMERIC(14,2) NOT NULL,
  paid_on      DATE NOT NULL,
  method       TEXT,
  reference    TEXT,
  evidence_url TEXT,
  receipt_no   TEXT UNIQUE,
  confirmed_by_user_id UUID REFERENCES users(id),
  confirmed_at TIMESTAMPTZ
);

CREATE TABLE member_dues (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id    UUID NOT NULL REFERENCES districts(id),
  rotary_year_id UUID NOT NULL REFERENCES rotary_years(id),
  club_id        UUID NOT NULL REFERENCES clubs(id),
  person_id      UUID NOT NULL REFERENCES persons(id),
  amount_due     NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_paid    NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_prepaid     BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (person_id, club_id, rotary_year_id)
);

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
  max_points   NUMERIC(6,2) NOT NULL,
  description  TEXT,
  UNIQUE (framework_id, sequence)
);

CREATE TABLE assessment_criteria (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parameter_id     UUID NOT NULL REFERENCES assessment_parameters(id) ON DELETE CASCADE,
  sequence         INT NOT NULL,
  description      TEXT NOT NULL,
  points           NUMERIC(6,2) NOT NULL,
  evaluation_mode  evaluation_mode NOT NULL,
  resolver_key     TEXT,                            -- registry key; NULL for ASSESSOR mode
  rule             JSONB,                           -- see 06-Assessment-Engine.md
  applies_to_tiers club_tier[] NOT NULL DEFAULT '{T1,T2,IBC}',
  guidance         TEXT,
  UNIQUE (parameter_id, sequence)
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
  UNIQUE (framework_id, label)
);

CREATE TABLE club_assessments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id  UUID NOT NULL REFERENCES districts(id),
  period_id    UUID NOT NULL REFERENCES assessment_periods(id),
  club_id      UUID NOT NULL REFERENCES clubs(id),
  tier         club_tier NOT NULL,
  status       assessment_status NOT NULL DEFAULT 'PENDING',
  total_score  NUMERIC(6,2),
  max_possible NUMERIC(6,2),
  rank_in_tier INT,
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
  UNIQUE (club_assessment_id, criterion_id)
);

CREATE TABLE assessor_assignments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id    UUID NOT NULL REFERENCES assessment_periods(id) ON DELETE CASCADE,
  parameter_id UUID NOT NULL REFERENCES assessment_parameters(id),
  person_id    UUID NOT NULL REFERENCES persons(id),
  cluster_id   UUID REFERENCES clusters(id),        -- NULL = all clubs
  UNIQUE (period_id, parameter_id, person_id, cluster_id)
);

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

CREATE TABLE documents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id      UUID NOT NULL REFERENCES districts(id),
  owner_scope_type org_scope NOT NULL,
  owner_scope_id   UUID NOT NULL,
  doc_type         TEXT NOT NULL,                   -- URSB_CERT, AUDITED_ACCOUNTS, CONSTITUTION, MOU
  title            TEXT NOT NULL,
  storage_key      TEXT NOT NULL,
  mime_type        TEXT,
  size_bytes       BIGINT,
  issued_on        DATE,
  expires_on       DATE,
  verification     verification_state NOT NULL DEFAULT 'UNVERIFIED',
  verified_by_user_id UUID REFERENCES users(id),
  uploaded_by_user_id UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ
);

-- =====================================================================
-- 10. PUBLIC IMAGE
-- =====================================================================

CREATE TABLE social_accounts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id      UUID NOT NULL REFERENCES districts(id),
  owner_scope_type org_scope NOT NULL,
  owner_scope_id   UUID NOT NULL,
  platform         TEXT NOT NULL,                   -- X, INSTAGRAM, FACEBOOK, TIKTOK,
                                                    -- LINKEDIN, YOUTUBE, OTHER
  handle           TEXT,
  url              TEXT NOT NULL,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (owner_scope_type, owner_scope_id, platform)
);

CREATE TABLE social_snapshots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  social_account_id UUID NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
  captured_on       DATE NOT NULL,
  follower_count    INT,
  post_count_30d    INT,
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

CREATE TABLE export_jobs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id    UUID NOT NULL REFERENCES districts(id),
  requested_by_user_id UUID NOT NULL REFERENCES users(id),
  resource       TEXT NOT NULL,
  format         TEXT NOT NULL DEFAULT 'XLSX',
  filters        JSONB NOT NULL DEFAULT '{}',
  status         TEXT NOT NULL DEFAULT 'QUEUED',
  storage_key    TEXT,
  row_count      INT,
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