-- CreateEnum
CREATE TYPE "club_base_type" AS ENUM ('CBC', 'IBC', 'ECLUB');

-- CreateEnum
CREATE TYPE "club_status" AS ENUM ('PROVISIONAL', 'ACTIVE', 'SUSPENDED', 'TERMINATED', 'MERGED');

-- CreateEnum
CREATE TYPE "club_tier" AS ENUM ('T1', 'T2', 'IBC');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'DISABLED');

-- CreateEnum
CREATE TYPE "org_scope" AS ENUM ('DISTRICT', 'REGION', 'CLUSTER', 'CLUB', 'COMMITTEE');

-- CreateEnum
CREATE TYPE "membership_event_type" AS ENUM ('JOIN', 'INDUCT', 'TRANSFER_IN', 'TRANSFER_OUT', 'TERMINATE', 'TRANSITION_TO_ROTARY', 'REINSTATE', 'CATEGORY_CHANGE', 'CORRECTION');

-- CreateEnum
CREATE TYPE "member_category" AS ENUM ('ACTIVE', 'HONORARY', 'CORPORATE');

-- CreateEnum
CREATE TYPE "activity_status" AS ENUM ('PLANNED', 'HELD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "verification_state" AS ENUM ('UNVERIFIED', 'VERIFIED', 'QUERIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "partner_type" AS ENUM ('ROTARACT_CLUB', 'ROTARY_CLUB', 'INTERACT_CLUB', 'CORPORATE', 'NGO', 'GOVERNMENT', 'ACADEMIC', 'OTHER');

-- CreateEnum
CREATE TYPE "attendee_role" AS ENUM ('MEMBER', 'VISITOR', 'GUEST', 'SPEAKER');

-- CreateEnum
CREATE TYPE "txn_direction" AS ENUM ('INCOME', 'EXPENDITURE');

-- CreateEnum
CREATE TYPE "invoice_status" AS ENUM ('UNPAID', 'PARTIAL', 'PAID', 'WAIVED');

-- CreateEnum
CREATE TYPE "dues_type" AS ENUM ('DISTRICT', 'RI');

-- CreateEnum
CREATE TYPE "trf_fund_type" AS ENUM ('ANNUAL_FUND', 'POLIO_PLUS', 'ENDOWMENT', 'DISASTER_RESPONSE', 'OTHER');

-- CreateEnum
CREATE TYPE "framework_status" AS ENUM ('DRAFT', 'PUBLISHED', 'LOCKED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "evaluation_mode" AS ENUM ('AUTO', 'ASSESSOR', 'HYBRID');

-- CreateEnum
CREATE TYPE "period_type" AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "period_status" AS ENUM ('SCHEDULED', 'OPEN', 'CLOSED', 'FINALISED');

-- CreateEnum
CREATE TYPE "assessment_status" AS ENUM ('PENDING', 'AUTO_SCORED', 'UNDER_REVIEW', 'FINALISED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "score_source" AS ENUM ('AUTO', 'ASSESSOR', 'OVERRIDE');

-- CreateEnum
CREATE TYPE "comment_visibility" AS ENUM ('INTERNAL', 'CLUB');

-- CreateEnum
CREATE TYPE "dispute_status" AS ENUM ('OPEN', 'UPHELD', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "notification_channel" AS ENUM ('EMAIL', 'WHATSAPP', 'SMS', 'IN_APP');

-- CreateEnum
CREATE TYPE "notification_status" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "export_status" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "export_format" AS ENUM ('XLSX', 'CSV');

-- CreateTable
CREATE TABLE "districts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ri_district_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country_code" CHAR(2) NOT NULL DEFAULT 'UG',
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Kampala',
    "currency_code" CHAR(3) NOT NULL DEFAULT 'UGX',
    "chartered_on" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "districts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rotary_years" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "label" TEXT NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "ri_theme" TEXT,

    CONSTRAINT "rotary_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "district_years" (
    "district_id" UUID NOT NULL,
    "rotary_year_id" UUID NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "is_locked" BOOLEAN NOT NULL DEFAULT false,
    "opened_at" TIMESTAMPTZ(6),
    "locked_at" TIMESTAMPTZ(6),

    CONSTRAINT "district_years_pkey" PRIMARY KEY ("district_id","rotary_year_id")
);

-- CreateTable
CREATE TABLE "regions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "district_id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "regions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clusters" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "district_id" UUID NOT NULL,
    "rotary_year_id" UUID NOT NULL,
    "region_id" UUID,
    "name" TEXT NOT NULL,

    CONSTRAINT "clusters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clubs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ri_club_id" BIGINT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "base_type" "club_base_type" NOT NULL,
    "status" "club_status" NOT NULL DEFAULT 'ACTIVE',
    "chartered_on" DATE,
    "chartered_member_count" INTEGER,
    "sponsor_rotary_club" TEXT,
    "host_institution" TEXT,
    "meeting_day" SMALLINT,
    "meeting_time" TIME(6),
    "meeting_venue" TEXT,
    "is_virtual" BOOLEAN NOT NULL DEFAULT false,
    "postal_address" TEXT,
    "ursb_number" TEXT,
    "bank_name" TEXT,
    "bank_account_ref" TEXT,
    "logo_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "clubs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_district_affiliations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "club_id" UUID NOT NULL,
    "district_id" UUID NOT NULL,
    "rotary_year_id" UUID NOT NULL,
    "tier" "club_tier" NOT NULL,
    "is_confirmed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "club_district_affiliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_cluster_assignments" (
    "club_id" UUID NOT NULL,
    "cluster_id" UUID NOT NULL,
    "rotary_year_id" UUID NOT NULL,

    CONSTRAINT "club_cluster_assignments_pkey" PRIMARY KEY ("club_id","rotary_year_id")
);

-- CreateTable
CREATE TABLE "persons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ri_member_id" BIGINT,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "other_names" TEXT,
    "gender" TEXT,
    "date_of_birth" DATE,
    "email" CITEXT,
    "phone" TEXT,
    "alt_phone" TEXT,
    "occupation" TEXT,
    "classification" TEXT,
    "employer" TEXT,
    "nationality" TEXT,
    "country_code" CHAR(2),
    "city" TEXT,
    "photo_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person_visibility" (
    "person_id" UUID NOT NULL,
    "show_email" BOOLEAN NOT NULL DEFAULT false,
    "show_phone" BOOLEAN NOT NULL DEFAULT false,
    "show_photo" BOOLEAN NOT NULL DEFAULT true,
    "show_occupation" BOOLEAN NOT NULL DEFAULT true,
    "show_city" BOOLEAN NOT NULL DEFAULT false,
    "directory_optout" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "person_visibility_pkey" PRIMARY KEY ("person_id")
);

-- CreateTable
CREATE TABLE "consents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "person_id" UUID NOT NULL,
    "consent_type" TEXT NOT NULL,
    "policy_version" TEXT NOT NULL,
    "granted_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "source_ip" INET,

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "person_id" UUID NOT NULL,
    "password_hash" TEXT,
    "status" "user_status" NOT NULL DEFAULT 'INVITED',
    "mfa_secret" TEXT,
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" TIMESTAMPTZ(6),
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),

    CONSTRAINT "user_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "positions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "district_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" "org_scope" NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "is_unique_per_scope" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "position_permissions" (
    "position_id" UUID NOT NULL,
    "permission_code" TEXT NOT NULL,

    CONSTRAINT "position_permissions_pkey" PRIMARY KEY ("position_id","permission_code")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "district_id" UUID NOT NULL,
    "rotary_year_id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "position_id" UUID NOT NULL,
    "scope_type" "org_scope" NOT NULL,
    "scope_id" UUID,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "committees" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "district_id" UUID NOT NULL,
    "rotary_year_id" UUID NOT NULL,
    "parent_committee_id" UUID,
    "name" TEXT NOT NULL,
    "mandate" TEXT,

    CONSTRAINT "committees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "committee_members" (
    "committee_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "role_label" TEXT,

    CONSTRAINT "committee_members_pkey" PRIMARY KEY ("committee_id","appointment_id")
);

-- CreateTable
CREATE TABLE "membership_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "district_id" UUID NOT NULL,
    "rotary_year_id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "club_id" UUID NOT NULL,
    "event_type" "membership_event_type" NOT NULL,
    "member_category" "member_category" NOT NULL DEFAULT 'ACTIVE',
    "effective_on" DATE NOT NULL,
    "reason_code" TEXT,
    "reason_note" TEXT,
    "counterparty_club_id" UUID,
    "rotary_club_name" TEXT,
    "rotary_club_ri_id" BIGINT,
    "corroborated_at" TIMESTAMPTZ(6),
    "supersedes_event_id" UUID,
    "evidence_url" TEXT,
    "recorded_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "areas_of_focus" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "areas_of_focus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "district_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "allowed_host_scopes" "org_scope"[] DEFAULT ARRAY['CLUB']::"org_scope"[],
    "requires_photo" BOOLEAN NOT NULL DEFAULT false,
    "requires_report" BOOLEAN NOT NULL DEFAULT false,
    "requires_attendance" BOOLEAN NOT NULL DEFAULT false,
    "requires_partner" BOOLEAN NOT NULL DEFAULT false,
    "requires_area_of_focus" BOOLEAN NOT NULL DEFAULT false,
    "is_scoring_eligible" BOOLEAN NOT NULL DEFAULT true,
    "field_config" JSONB NOT NULL DEFAULT '{}',
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "activity_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "district_id" UUID NOT NULL,
    "rotary_year_id" UUID NOT NULL,
    "activity_type_id" UUID NOT NULL,
    "host_scope_type" "org_scope" NOT NULL,
    "host_scope_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6),
    "venue" TEXT,
    "is_virtual" BOOLEAN NOT NULL DEFAULT false,
    "meeting_url" TEXT,
    "status" "activity_status" NOT NULL DEFAULT 'PLANNED',
    "theme_alignment" TEXT,
    "report_url" TEXT,
    "narrative_report" TEXT,
    "spc_reference" TEXT,
    "attendance_members" INTEGER,
    "attendance_visitors" INTEGER,
    "attendance_guests" INTEGER,
    "beneficiaries_count" INTEGER,
    "trees_planted" INTEGER,
    "funds_raised" DECIMAL(14,2),
    "volunteer_hours" DECIMAL(10,2),
    "extra" JSONB NOT NULL DEFAULT '{}',
    "verification" "verification_state" NOT NULL DEFAULT 'UNVERIFIED',
    "verified_by_user_id" UUID,
    "verified_at" TIMESTAMPTZ(6),
    "created_by_user_id" UUID,
    "client_generated" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_areas_of_focus" (
    "activity_id" UUID NOT NULL,
    "area_of_focus_id" UUID NOT NULL,

    CONSTRAINT "activity_areas_of_focus_pkey" PRIMARY KEY ("activity_id","area_of_focus_id")
);

-- CreateTable
CREATE TABLE "activity_partners" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "activity_id" UUID NOT NULL,
    "partner_type" "partner_type" NOT NULL,
    "partner_club_id" UUID,
    "partner_org_name" TEXT,
    "country_code" CHAR(2) NOT NULL DEFAULT 'UG',
    "contribution_note" TEXT,

    CONSTRAINT "activity_partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_media" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "activity_id" UUID NOT NULL,
    "media_type" TEXT NOT NULL DEFAULT 'IMAGE',
    "storage_key" TEXT NOT NULL,
    "thumb_key" TEXT,
    "caption" TEXT,
    "sequence" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "activity_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_attendees" (
    "activity_id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "role" "attendee_role" NOT NULL DEFAULT 'MEMBER',
    "confirmed_at" TIMESTAMPTZ(6),

    CONSTRAINT "activity_attendees_pkey" PRIMARY KEY ("activity_id","person_id")
);

-- CreateTable
CREATE TABLE "finance_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "district_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "direction" "txn_direction" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "finance_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "district_id" UUID NOT NULL,
    "rotary_year_id" UUID NOT NULL,
    "owner_scope_type" "org_scope" NOT NULL,
    "owner_scope_id" UUID NOT NULL,
    "currency_code" CHAR(3) NOT NULL DEFAULT 'UGX',
    "approved_at" TIMESTAMPTZ(6),
    "approved_by_user_id" UUID,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "budget_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "amount_planned" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "budget_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "district_id" UUID NOT NULL,
    "rotary_year_id" UUID NOT NULL,
    "owner_scope_type" "org_scope" NOT NULL,
    "owner_scope_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "budget_line_id" UUID,
    "direction" "txn_direction" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency_code" CHAR(3) NOT NULL DEFAULT 'UGX',
    "occurred_on" DATE NOT NULL,
    "description" TEXT,
    "evidence_url" TEXT,
    "activity_id" UUID,
    "recorded_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "financial_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dues_invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "district_id" UUID NOT NULL,
    "rotary_year_id" UUID NOT NULL,
    "club_id" UUID NOT NULL,
    "dues_type" "dues_type" NOT NULL DEFAULT 'DISTRICT',
    "amount_due" DECIMAL(14,2) NOT NULL,
    "currency_code" CHAR(3) NOT NULL DEFAULT 'UGX',
    "due_on" DATE NOT NULL,
    "waived_at" TIMESTAMPTZ(6),
    "waived_by_user_id" UUID,
    "waiver_reason" TEXT,

    CONSTRAINT "dues_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dues_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paid_on" DATE NOT NULL,
    "method" TEXT,
    "reference" TEXT,
    "evidence_url" TEXT,
    "receipt_no" TEXT,
    "confirmed_by_user_id" UUID,
    "confirmed_at" TIMESTAMPTZ(6),

    CONSTRAINT "dues_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_dues" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "district_id" UUID NOT NULL,
    "rotary_year_id" UUID NOT NULL,
    "club_id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "amount_due" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "is_prepaid" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "member_dues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_dues_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "member_dues_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paid_on" DATE NOT NULL,
    "method" TEXT,
    "reference" TEXT,
    "evidence_url" TEXT,
    "receipt_no" TEXT,
    "confirmed_by_user_id" UUID,
    "confirmed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_dues_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_frameworks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "district_id" UUID NOT NULL,
    "rotary_year_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "total_points" DECIMAL(6,2) NOT NULL DEFAULT 100,
    "status" "framework_status" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMPTZ(6),
    "locked_at" TIMESTAMPTZ(6),

    CONSTRAINT "assessment_frameworks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_parameters" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "framework_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "max_points" DECIMAL(6,2) NOT NULL,
    "description" TEXT,

    CONSTRAINT "assessment_parameters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_criteria" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "parameter_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "points" DECIMAL(6,2) NOT NULL,
    "evaluation_mode" "evaluation_mode" NOT NULL,
    "resolver_key" TEXT,
    "rule" JSONB,
    "applies_to_tiers" "club_tier"[] DEFAULT ARRAY['T1', 'T2', 'IBC']::"club_tier"[],
    "guidance" TEXT,

    CONSTRAINT "assessment_criteria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_periods" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "framework_id" UUID NOT NULL,
    "period_type" "period_type" NOT NULL,
    "label" TEXT NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "submission_deadline" TIMESTAMPTZ(6) NOT NULL,
    "dispute_closes_at" TIMESTAMPTZ(6),
    "status" "period_status" NOT NULL DEFAULT 'SCHEDULED',

    CONSTRAINT "assessment_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_assessments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "district_id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "club_id" UUID NOT NULL,
    "tier" "club_tier" NOT NULL,
    "status" "assessment_status" NOT NULL DEFAULT 'PENDING',
    "is_stale" BOOLEAN NOT NULL DEFAULT true,
    "computed_at" TIMESTAMPTZ(6),
    "finalised_at" TIMESTAMPTZ(6),
    "finalised_by_user_id" UUID,

    CONSTRAINT "club_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_scores" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "club_assessment_id" UUID NOT NULL,
    "criterion_id" UUID NOT NULL,
    "points_awarded" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "points_possible" DECIMAL(6,2) NOT NULL,
    "source" "score_source" NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "assessor_user_id" UUID,
    "comment" TEXT,
    "scored_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessor_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "period_id" UUID NOT NULL,
    "parameter_id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "cluster_id" UUID,

    CONSTRAINT "assessor_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_comments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "club_assessment_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "visibility" "comment_visibility" NOT NULL DEFAULT 'CLUB',
    "is_commendation" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_disputes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "club_assessment_id" UUID NOT NULL,
    "criterion_id" UUID,
    "raised_by_user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "evidence_url" TEXT,
    "status" "dispute_status" NOT NULL DEFAULT 'OPEN',
    "resolution_note" TEXT,
    "resolved_by_user_id" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_types" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "document_types_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "social_platforms" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "social_platforms_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "goals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "district_id" UUID NOT NULL,
    "rotary_year_id" UUID NOT NULL,
    "owner_scope_type" "org_scope" NOT NULL DEFAULT 'DISTRICT',
    "owner_scope_id" UUID,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "target_value" DECIMAL(14,2) NOT NULL,
    "baseline_value" DECIMAL(14,2),
    "resolver_key" TEXT,
    "resolver_config" JSONB NOT NULL DEFAULT '{}',
    "sequence" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "goal_id" UUID NOT NULL,
    "as_of" DATE NOT NULL,
    "actual_value" DECIMAL(14,2) NOT NULL,
    "source" "score_source" NOT NULL DEFAULT 'AUTO',
    "note" TEXT,

    CONSTRAINT "goal_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "district_id" UUID NOT NULL,
    "owner_scope_type" "org_scope" NOT NULL,
    "owner_scope_id" UUID NOT NULL,
    "doc_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT,
    "size_bytes" BIGINT,
    "issued_on" DATE,
    "expires_on" DATE,
    "verification" "verification_state" NOT NULL DEFAULT 'UNVERIFIED',
    "verified_by_user_id" UUID,
    "uploaded_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "district_id" UUID NOT NULL,
    "owner_scope_type" "org_scope" NOT NULL,
    "owner_scope_id" UUID NOT NULL,
    "platform" TEXT NOT NULL,
    "handle" TEXT,
    "url" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "social_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "social_account_id" UUID NOT NULL,
    "captured_on" DATE NOT NULL,
    "follower_count" INTEGER,
    "post_count_30d" INTEGER,

    CONSTRAINT "social_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_appearances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "district_id" UUID NOT NULL,
    "rotary_year_id" UUID NOT NULL,
    "owner_scope_type" "org_scope" NOT NULL,
    "owner_scope_id" UUID NOT NULL,
    "outlet" TEXT NOT NULL,
    "outlet_type" TEXT,
    "url" TEXT,
    "appeared_on" DATE NOT NULL,
    "evidence_url" TEXT,

    CONSTRAINT "media_appearances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "district_id" UUID,
    "actor_user_id" UUID,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip_address" INET,
    "user_agent" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "code" TEXT NOT NULL,
    "channel" "notification_channel" NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "district_id" UUID,
    "recipient_person_id" UUID NOT NULL,
    "channel" "notification_channel" NOT NULL,
    "template_code" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "notification_status" NOT NULL DEFAULT 'QUEUED',
    "scheduled_for" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(6),
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "district_id" UUID NOT NULL,
    "requested_by_user_id" UUID NOT NULL,
    "resource" TEXT NOT NULL,
    "format" "export_format" NOT NULL DEFAULT 'XLSX',
    "filters" JSONB NOT NULL DEFAULT '{}',
    "status" "export_status" NOT NULL DEFAULT 'QUEUED',
    "storage_key" TEXT,
    "row_count" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),

    CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trf_contributions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "district_id" UUID NOT NULL,
    "rotary_year_id" UUID NOT NULL,
    "club_id" UUID NOT NULL,
    "person_id" UUID,
    "fund_type" "trf_fund_type" NOT NULL DEFAULT 'ANNUAL_FUND',
    "amount_usd" DECIMAL(12,2) NOT NULL,
    "contributed_on" DATE NOT NULL,
    "ri_receipt_ref" TEXT,
    "evidence_url" TEXT,
    "verification" "verification_state" NOT NULL DEFAULT 'UNVERIFIED',
    "verified_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trf_contributions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "districts_ri_district_code_key" ON "districts"("ri_district_code");

-- CreateIndex
CREATE UNIQUE INDEX "rotary_years_label_key" ON "rotary_years"("label");

-- CreateIndex
CREATE UNIQUE INDEX "regions_district_id_name_key" ON "regions"("district_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "clusters_district_id_rotary_year_id_name_key" ON "clusters"("district_id", "rotary_year_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "clubs_ri_club_id_key" ON "clubs"("ri_club_id");

-- CreateIndex
CREATE UNIQUE INDEX "clubs_slug_key" ON "clubs"("slug");

-- CreateIndex
CREATE INDEX "clubs_name_trgm" ON "clubs" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "cda_district_year" ON "club_district_affiliations"("district_id", "rotary_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "club_district_affiliations_club_id_rotary_year_id_key" ON "club_district_affiliations"("club_id", "rotary_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "persons_ri_member_id_key" ON "persons"("ri_member_id");

-- CreateIndex
CREATE UNIQUE INDEX "persons_email_key" ON "persons"("email");

-- CreateIndex
CREATE INDEX "consents_person" ON "consents"("person_id", "consent_type");

-- CreateIndex
CREATE UNIQUE INDEX "users_person_id_key" ON "users"("person_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_tokens_hash" ON "user_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "positions_district_id_code_key" ON "positions"("district_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "committees_district_id_rotary_year_id_name_key" ON "committees"("district_id", "rotary_year_id", "name");

-- CreateIndex
CREATE INDEX "me_club_date" ON "membership_events"("club_id", "effective_on");

-- CreateIndex
CREATE INDEX "me_person" ON "membership_events"("person_id", "effective_on");

-- CreateIndex
CREATE INDEX "me_type_year" ON "membership_events"("district_id", "rotary_year_id", "event_type");

-- CreateIndex
CREATE UNIQUE INDEX "areas_of_focus_code_key" ON "areas_of_focus"("code");

-- CreateIndex
CREATE UNIQUE INDEX "activity_types_district_id_code_key" ON "activity_types"("district_id", "code");

-- CreateIndex
CREATE INDEX "act_host_year" ON "activities"("host_scope_type", "host_scope_id", "rotary_year_id");

-- CreateIndex
CREATE INDEX "act_type_date" ON "activities"("activity_type_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "finance_categories_district_id_code_key" ON "finance_categories"("district_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_owner_scope_type_owner_scope_id_rotary_year_id_key" ON "budgets"("owner_scope_type", "owner_scope_id", "rotary_year_id");

-- CreateIndex
CREATE INDEX "ft_owner_year" ON "financial_transactions"("owner_scope_type", "owner_scope_id", "rotary_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "dues_invoices_club_id_rotary_year_id_dues_type_key" ON "dues_invoices"("club_id", "rotary_year_id", "dues_type");

-- CreateIndex
CREATE UNIQUE INDEX "dues_payments_receipt_no_key" ON "dues_payments"("receipt_no");

-- CreateIndex
CREATE INDEX "dues_payments_invoice" ON "dues_payments"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "member_dues_person_id_club_id_rotary_year_id_key" ON "member_dues"("person_id", "club_id", "rotary_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "member_dues_payments_receipt_no_key" ON "member_dues_payments"("receipt_no");

-- CreateIndex
CREATE INDEX "mdp_member_dues" ON "member_dues_payments"("member_dues_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_frameworks_district_id_rotary_year_id_version_key" ON "assessment_frameworks"("district_id", "rotary_year_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_parameters_framework_id_sequence_key" ON "assessment_parameters"("framework_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_criteria_parameter_id_sequence_key" ON "assessment_criteria"("parameter_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_periods_framework_id_label_key" ON "assessment_periods"("framework_id", "label");

-- CreateIndex
CREATE UNIQUE INDEX "club_assessments_period_id_club_id_key" ON "club_assessments"("period_id", "club_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_scores_club_assessment_id_criterion_id_key" ON "assessment_scores"("club_assessment_id", "criterion_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessor_assignments_period_id_parameter_id_person_id_clust_key" ON "assessor_assignments"("period_id", "parameter_id", "person_id", "cluster_id");

-- CreateIndex
CREATE UNIQUE INDEX "goal_snapshots_goal_id_as_of_key" ON "goal_snapshots"("goal_id", "as_of");

-- CreateIndex
CREATE INDEX "documents_owner" ON "documents"("owner_scope_type", "owner_scope_id", "doc_type");

-- CreateIndex
CREATE UNIQUE INDEX "social_accounts_owner_scope_type_owner_scope_id_platform_key" ON "social_accounts"("owner_scope_type", "owner_scope_id", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "social_snapshots_social_account_id_captured_on_key" ON "social_snapshots"("social_account_id", "captured_on");

-- CreateIndex
CREATE INDEX "audit_entity" ON "audit_log"("entity_type", "entity_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_actor" ON "audit_log"("actor_user_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "trf_club_year" ON "trf_contributions"("club_id", "rotary_year_id");

-- AddForeignKey
ALTER TABLE "district_years" ADD CONSTRAINT "district_years_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "district_years" ADD CONSTRAINT "district_years_rotary_year_id_fkey" FOREIGN KEY ("rotary_year_id") REFERENCES "rotary_years"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "regions" ADD CONSTRAINT "regions_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "clusters" ADD CONSTRAINT "clusters_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "clusters" ADD CONSTRAINT "clusters_rotary_year_id_fkey" FOREIGN KEY ("rotary_year_id") REFERENCES "rotary_years"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "clusters" ADD CONSTRAINT "clusters_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "regions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "club_district_affiliations" ADD CONSTRAINT "club_district_affiliations_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "club_district_affiliations" ADD CONSTRAINT "club_district_affiliations_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "club_district_affiliations" ADD CONSTRAINT "club_district_affiliations_rotary_year_id_fkey" FOREIGN KEY ("rotary_year_id") REFERENCES "rotary_years"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "club_cluster_assignments" ADD CONSTRAINT "club_cluster_assignments_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "club_cluster_assignments" ADD CONSTRAINT "club_cluster_assignments_cluster_id_fkey" FOREIGN KEY ("cluster_id") REFERENCES "clusters"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "club_cluster_assignments" ADD CONSTRAINT "club_cluster_assignments_rotary_year_id_fkey" FOREIGN KEY ("rotary_year_id") REFERENCES "rotary_years"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "person_visibility" ADD CONSTRAINT "person_visibility_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_tokens" ADD CONSTRAINT "user_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "position_permissions" ADD CONSTRAINT "position_permissions_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "position_permissions" ADD CONSTRAINT "position_permissions_permission_code_fkey" FOREIGN KEY ("permission_code") REFERENCES "permissions"("code") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_rotary_year_id_fkey" FOREIGN KEY ("rotary_year_id") REFERENCES "rotary_years"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "committees" ADD CONSTRAINT "committees_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "committees" ADD CONSTRAINT "committees_rotary_year_id_fkey" FOREIGN KEY ("rotary_year_id") REFERENCES "rotary_years"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "committees" ADD CONSTRAINT "committees_parent_committee_id_fkey" FOREIGN KEY ("parent_committee_id") REFERENCES "committees"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "committee_members" ADD CONSTRAINT "committee_members_committee_id_fkey" FOREIGN KEY ("committee_id") REFERENCES "committees"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "committee_members" ADD CONSTRAINT "committee_members_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "membership_events" ADD CONSTRAINT "membership_events_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "membership_events" ADD CONSTRAINT "membership_events_rotary_year_id_fkey" FOREIGN KEY ("rotary_year_id") REFERENCES "rotary_years"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "membership_events" ADD CONSTRAINT "membership_events_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "membership_events" ADD CONSTRAINT "membership_events_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "membership_events" ADD CONSTRAINT "membership_events_counterparty_club_id_fkey" FOREIGN KEY ("counterparty_club_id") REFERENCES "clubs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "membership_events" ADD CONSTRAINT "membership_events_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "membership_events" ADD CONSTRAINT "membership_events_supersedes_event_id_fkey" FOREIGN KEY ("supersedes_event_id") REFERENCES "membership_events"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "activity_types" ADD CONSTRAINT "activity_types_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_rotary_year_id_fkey" FOREIGN KEY ("rotary_year_id") REFERENCES "rotary_years"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_activity_type_id_fkey" FOREIGN KEY ("activity_type_id") REFERENCES "activity_types"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_verified_by_user_id_fkey" FOREIGN KEY ("verified_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "activity_areas_of_focus" ADD CONSTRAINT "activity_areas_of_focus_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "activity_areas_of_focus" ADD CONSTRAINT "activity_areas_of_focus_area_of_focus_id_fkey" FOREIGN KEY ("area_of_focus_id") REFERENCES "areas_of_focus"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "activity_partners" ADD CONSTRAINT "activity_partners_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "activity_partners" ADD CONSTRAINT "activity_partners_partner_club_id_fkey" FOREIGN KEY ("partner_club_id") REFERENCES "clubs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "activity_media" ADD CONSTRAINT "activity_media_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "activity_attendees" ADD CONSTRAINT "activity_attendees_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "activity_attendees" ADD CONSTRAINT "activity_attendees_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "finance_categories" ADD CONSTRAINT "finance_categories_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_rotary_year_id_fkey" FOREIGN KEY ("rotary_year_id") REFERENCES "rotary_years"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "finance_categories"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_rotary_year_id_fkey" FOREIGN KEY ("rotary_year_id") REFERENCES "rotary_years"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "finance_categories"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_budget_line_id_fkey" FOREIGN KEY ("budget_line_id") REFERENCES "budget_lines"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "dues_invoices" ADD CONSTRAINT "dues_invoices_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "dues_invoices" ADD CONSTRAINT "dues_invoices_rotary_year_id_fkey" FOREIGN KEY ("rotary_year_id") REFERENCES "rotary_years"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "dues_invoices" ADD CONSTRAINT "dues_invoices_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "dues_invoices" ADD CONSTRAINT "dues_invoices_waived_by_user_id_fkey" FOREIGN KEY ("waived_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "dues_payments" ADD CONSTRAINT "dues_payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "dues_invoices"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "dues_payments" ADD CONSTRAINT "dues_payments_confirmed_by_user_id_fkey" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "member_dues" ADD CONSTRAINT "member_dues_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "member_dues" ADD CONSTRAINT "member_dues_rotary_year_id_fkey" FOREIGN KEY ("rotary_year_id") REFERENCES "rotary_years"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "member_dues" ADD CONSTRAINT "member_dues_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "member_dues" ADD CONSTRAINT "member_dues_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "member_dues_payments" ADD CONSTRAINT "member_dues_payments_member_dues_id_fkey" FOREIGN KEY ("member_dues_id") REFERENCES "member_dues"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "member_dues_payments" ADD CONSTRAINT "member_dues_payments_confirmed_by_user_id_fkey" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assessment_frameworks" ADD CONSTRAINT "assessment_frameworks_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assessment_frameworks" ADD CONSTRAINT "assessment_frameworks_rotary_year_id_fkey" FOREIGN KEY ("rotary_year_id") REFERENCES "rotary_years"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assessment_parameters" ADD CONSTRAINT "assessment_parameters_framework_id_fkey" FOREIGN KEY ("framework_id") REFERENCES "assessment_frameworks"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assessment_criteria" ADD CONSTRAINT "assessment_criteria_parameter_id_fkey" FOREIGN KEY ("parameter_id") REFERENCES "assessment_parameters"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assessment_periods" ADD CONSTRAINT "assessment_periods_framework_id_fkey" FOREIGN KEY ("framework_id") REFERENCES "assessment_frameworks"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "club_assessments" ADD CONSTRAINT "club_assessments_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "club_assessments" ADD CONSTRAINT "club_assessments_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "assessment_periods"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "club_assessments" ADD CONSTRAINT "club_assessments_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "club_assessments" ADD CONSTRAINT "club_assessments_finalised_by_user_id_fkey" FOREIGN KEY ("finalised_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assessment_scores" ADD CONSTRAINT "assessment_scores_club_assessment_id_fkey" FOREIGN KEY ("club_assessment_id") REFERENCES "club_assessments"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assessment_scores" ADD CONSTRAINT "assessment_scores_criterion_id_fkey" FOREIGN KEY ("criterion_id") REFERENCES "assessment_criteria"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assessment_scores" ADD CONSTRAINT "assessment_scores_assessor_user_id_fkey" FOREIGN KEY ("assessor_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assessor_assignments" ADD CONSTRAINT "assessor_assignments_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "assessment_periods"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assessor_assignments" ADD CONSTRAINT "assessor_assignments_parameter_id_fkey" FOREIGN KEY ("parameter_id") REFERENCES "assessment_parameters"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assessor_assignments" ADD CONSTRAINT "assessor_assignments_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assessor_assignments" ADD CONSTRAINT "assessor_assignments_cluster_id_fkey" FOREIGN KEY ("cluster_id") REFERENCES "clusters"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assessment_comments" ADD CONSTRAINT "assessment_comments_club_assessment_id_fkey" FOREIGN KEY ("club_assessment_id") REFERENCES "club_assessments"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assessment_comments" ADD CONSTRAINT "assessment_comments_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assessment_disputes" ADD CONSTRAINT "assessment_disputes_club_assessment_id_fkey" FOREIGN KEY ("club_assessment_id") REFERENCES "club_assessments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assessment_disputes" ADD CONSTRAINT "assessment_disputes_criterion_id_fkey" FOREIGN KEY ("criterion_id") REFERENCES "assessment_criteria"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assessment_disputes" ADD CONSTRAINT "assessment_disputes_raised_by_user_id_fkey" FOREIGN KEY ("raised_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assessment_disputes" ADD CONSTRAINT "assessment_disputes_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_rotary_year_id_fkey" FOREIGN KEY ("rotary_year_id") REFERENCES "rotary_years"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "goal_snapshots" ADD CONSTRAINT "goal_snapshots_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_doc_type_fkey" FOREIGN KEY ("doc_type") REFERENCES "document_types"("code") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_verified_by_user_id_fkey" FOREIGN KEY ("verified_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_platform_fkey" FOREIGN KEY ("platform") REFERENCES "social_platforms"("code") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "social_snapshots" ADD CONSTRAINT "social_snapshots_social_account_id_fkey" FOREIGN KEY ("social_account_id") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "media_appearances" ADD CONSTRAINT "media_appearances_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "media_appearances" ADD CONSTRAINT "media_appearances_rotary_year_id_fkey" FOREIGN KEY ("rotary_year_id") REFERENCES "rotary_years"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_person_id_fkey" FOREIGN KEY ("recipient_person_id") REFERENCES "persons"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_template_code_fkey" FOREIGN KEY ("template_code") REFERENCES "notification_templates"("code") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "trf_contributions" ADD CONSTRAINT "trf_contributions_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "trf_contributions" ADD CONSTRAINT "trf_contributions_rotary_year_id_fkey" FOREIGN KEY ("rotary_year_id") REFERENCES "rotary_years"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "trf_contributions" ADD CONSTRAINT "trf_contributions_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "trf_contributions" ADD CONSTRAINT "trf_contributions_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "trf_contributions" ADD CONSTRAINT "trf_contributions_verified_by_user_id_fkey" FOREIGN KEY ("verified_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
