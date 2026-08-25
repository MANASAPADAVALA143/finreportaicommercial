-- rds_company_setup_patch.sql
-- Target: AWS RDS used by api.finreportai.com (NOT Supabase).
-- Creates only the tables needed for /api/company-setup/controls (Step 4).
-- Safe to re-run (IF NOT EXISTS). Run as a single transaction; COMMIT at end.

BEGIN;

-- Prerequisite: workspaces must already exist (created at signup).
CREATE TABLE IF NOT EXISTS uae_company_profiles (
    id                   VARCHAR(36) PRIMARY KEY,
    workspace_id         VARCHAR(36) NOT NULL REFERENCES workspaces(id),
    company_name         VARCHAR(256) NOT NULL,
    trade_name           VARCHAR(256),
    legal_type           VARCHAR(64),
    trn                  VARCHAR(20),
    license_number       VARCHAR(64),
    license_authority    VARCHAR(128),
    base_currency        VARCHAR(3) NOT NULL DEFAULT 'AED',
    reporting_standard   VARCHAR(32) NOT NULL DEFAULT 'IFRS',
    financial_year_start INTEGER NOT NULL DEFAULT 1,
    industry             VARCHAR(64),
    address              TEXT,
    phone                VARCHAR(32),
    email                VARCHAR(200),
    website              VARCHAR(256),
    logo_url             VARCHAR(512),
    status               VARCHAR(20) NOT NULL DEFAULT 'setup',
    setup_step           INTEGER NOT NULL DEFAULT 1,
    coa_option           VARCHAR(20),
    opening_balance_date DATE,
    created_at           TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
    updated_at           TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS ix_uae_company_profiles_workspace_id ON uae_company_profiles (workspace_id);

CREATE TABLE IF NOT EXISTS accounting_periods (
    id            VARCHAR(36) PRIMARY KEY,
    workspace_id  VARCHAR(36) NOT NULL REFERENCES workspaces(id),
    company_id    VARCHAR(36) REFERENCES uae_company_profiles(id),
    period_number INTEGER NOT NULL,
    period_name   VARCHAR(32) NOT NULL,
    start_date    DATE NOT NULL,
    end_date      DATE NOT NULL,
    status        VARCHAR(20) NOT NULL DEFAULT 'open',
    locked_by     VARCHAR(36),
    locked_at     TIMESTAMP,
    created_at    TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
    UNIQUE (workspace_id, company_id, period_number)
);
CREATE INDEX IF NOT EXISTS ix_accounting_periods_workspace_id ON accounting_periods (workspace_id);
CREATE INDEX IF NOT EXISTS ix_accounting_periods_company_id ON accounting_periods (company_id);

CREATE TABLE IF NOT EXISTS accounting_controls (
    id                        VARCHAR(36) PRIMARY KEY,
    workspace_id              VARCHAR(36) NOT NULL UNIQUE REFERENCES workspaces(id),
    company_id                VARCHAR(36) REFERENCES uae_company_profiles(id),
    je_approval_threshold_aed NUMERIC(15, 2),
    allow_backdating          BOOLEAN NOT NULL DEFAULT TRUE,
    max_backdate_days         INTEGER NOT NULL DEFAULT 30,
    require_docs_account_ids  TEXT,
    dual_approval_account_ids TEXT,
    created_at                TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
    updated_at                TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE TABLE IF NOT EXISTS workspace_user_roles (
    id           VARCHAR(36) PRIMARY KEY,
    workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id),
    user_id      VARCHAR(36) NOT NULL,
    module       VARCHAR(64) NOT NULL,
    role         VARCHAR(64) NOT NULL,
    created_at   TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
    UNIQUE (workspace_id, user_id, module)
);
CREATE INDEX IF NOT EXISTS ix_workspace_user_roles_workspace_id ON workspace_user_roles (workspace_id);
CREATE INDEX IF NOT EXISTS ix_workspace_user_roles_user_id ON workspace_user_roles (user_id);

-- Verify (should return 4 rows, all showing the table exists):
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'uae_company_profiles',
    'accounting_periods',
    'accounting_controls',
    'workspace_user_roles'
  )
ORDER BY tablename;

COMMIT;
