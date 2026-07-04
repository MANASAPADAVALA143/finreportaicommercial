-- =============================================================================
-- FinReportAI / Gnanova Finance OS — RDS schema bootstrap (REVIEW ONLY)
-- Generated: 2026-07-04
--
-- Purpose: CREATE TABLE IF NOT EXISTS for every table defined in:
--   • backend/alembic/versions/*.py  (migrations 001 → 015)
--   • init_db() ORM imports          (app/db/__init__.py)
--   • India accounting ORM           (NOT in init_db — included for completeness)
--
-- BEFORE RUNNING ON PRODUCTION:
--   1. Back up RDS.
--   2. Run in a transaction; review NOTICE output.
--   3. This does NOT fix alembic_version — see audit doc / section 99.
--   4. Existing tables are skipped (IF NOT EXISTS); column drift is handled
--      in section 98 (ALTER … ADD COLUMN IF NOT EXISTS requires PG 9.1+;
--      use DO blocks below for safety).
-- =============================================================================

BEGIN;

-- =============================================================================
-- SECTION 1 — Legacy auth (Alembic 001)
-- =============================================================================

CREATE TABLE IF NOT EXISTS users (
    id              SERIAL PRIMARY KEY,
    email           VARCHAR NOT NULL UNIQUE,
    hashed_password VARCHAR NOT NULL,
    full_name       VARCHAR,
    company         VARCHAR,
    role            VARCHAR,
    is_active       BOOLEAN,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_users_id ON users (id);

CREATE TABLE IF NOT EXISTS journal_entries (
    id               SERIAL PRIMARY KEY,
    user_id          INTEGER REFERENCES users(id),
    entry_date       TIMESTAMPTZ NOT NULL,
    description      TEXT NOT NULL,
    account          VARCHAR NOT NULL,
    debit            DOUBLE PRECISION,
    credit           DOUBLE PRECISION,
    reference        VARCHAR,
    status           VARCHAR,
    fraud_score      DOUBLE PRECISION,
    anomaly_detected BOOLEAN,
    metadata         JSONB,
    created_at       TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_journal_entries_id ON journal_entries (id);

CREATE TABLE IF NOT EXISTS financial_reports (
    id           SERIAL PRIMARY KEY,
    user_id      INTEGER REFERENCES users(id),
    report_type  VARCHAR NOT NULL,
    period_start TIMESTAMPTZ,
    period_end   TIMESTAMPTZ,
    data         JSONB,
    insights     JSONB,
    created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_financial_reports_id ON financial_reports (id);

CREATE TABLE IF NOT EXISTS audit_logs (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER REFERENCES users(id),
    action     VARCHAR NOT NULL,
    resource   VARCHAR,
    details    JSONB,
    ip_address VARCHAR,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_audit_logs_id ON audit_logs (id);

-- =============================================================================
-- SECTION 2 — RBAC + tenants (ORM + Alembic 015)
-- =============================================================================

CREATE TABLE IF NOT EXISTS rbac_companies (
    id         VARCHAR(36) PRIMARY KEY,
    name       VARCHAR(256) NOT NULL,
    plan       VARCHAR(32) NOT NULL DEFAULT 'starter',
    created_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE TABLE IF NOT EXISTS rbac_users (
    id            VARCHAR(36) PRIMARY KEY,
    company_id    VARCHAR(36) NOT NULL REFERENCES rbac_companies(id),
    name          VARCHAR(256) NOT NULL,
    email         VARCHAR(256) NOT NULL UNIQUE,
    password_hash VARCHAR(512) NOT NULL,
    role          VARCHAR(32) NOT NULL DEFAULT 'accountant',
    product_role  VARCHAR(32) NOT NULL DEFAULT 'full_access',
    tenant_id     VARCHAR(36),
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
    last_login    TIMESTAMP
);
-- Existing rbac_users (from init_db) may lack migration 015 columns; patch before indexes.
DO $$ BEGIN
    ALTER TABLE rbac_users ADD COLUMN product_role VARCHAR(32) NOT NULL DEFAULT 'full_access';
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE rbac_users ADD COLUMN tenant_id VARCHAR(36);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS ix_rbac_users_company_id ON rbac_users (company_id);
CREATE INDEX IF NOT EXISTS ix_rbac_users_email ON rbac_users (email);
CREATE INDEX IF NOT EXISTS ix_rbac_users_tenant_id ON rbac_users (tenant_id);

CREATE TABLE IF NOT EXISTS rbac_audit_log (
    id         VARCHAR(36) PRIMARY KEY,
    user_id    VARCHAR(36) NOT NULL REFERENCES rbac_users(id),
    action     VARCHAR(128) NOT NULL,
    module     VARCHAR(64) NOT NULL,
    details    JSONB NOT NULL DEFAULT '{}',
    ip_address VARCHAR(64),
    timestamp  TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS ix_rbac_audit_log_user_id ON rbac_audit_log (user_id);

CREATE TABLE IF NOT EXISTS tenants (
    id         VARCHAR(36) PRIMARY KEY,
    name       VARCHAR(256) NOT NULL,
    plan       VARCHAR(32) NOT NULL DEFAULT 'starter',
    is_demo    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

-- =============================================================================
-- SECTION 3 — R2R legacy / scoring (ORM app.db.models)
-- =============================================================================

CREATE TABLE IF NOT EXISTS companies (
    id            VARCHAR PRIMARY KEY,
    name          VARCHAR NOT NULL,
    industry      VARCHAR DEFAULT 'General',
    currency      VARCHAR DEFAULT 'INR',
    created_at    TIMESTAMP DEFAULT (now() AT TIME ZONE 'utc'),
    total_uploads INTEGER DEFAULT 0,
    last_upload   TIMESTAMP
);

CREATE TABLE IF NOT EXISTS journal_history (
    id           SERIAL PRIMARY KEY,
    company_id   VARCHAR NOT NULL,
    journal_id   VARCHAR,
    posting_date TIMESTAMP,
    amount       DOUBLE PRECISION NOT NULL,
    account      VARCHAR NOT NULL,
    vendor       VARCHAR DEFAULT 'Unknown',
    user_id      VARCHAR DEFAULT 'Unknown',
    source       VARCHAR DEFAULT 'Unknown',
    description  VARCHAR DEFAULT '',
    entity       VARCHAR DEFAULT '',
    upload_batch VARCHAR,
    uploaded_at  TIMESTAMP DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS ix_journal_history_company_id ON journal_history (company_id);

CREATE TABLE IF NOT EXISTS company_profiles (
    id              SERIAL PRIMARY KEY,
    company_id      VARCHAR NOT NULL,
    account         VARCHAR NOT NULL,
    avg_amount      DOUBLE PRECISION DEFAULT 0,
    std_amount      DOUBLE PRECISION DEFAULT 1,
    median_amount   DOUBLE PRECISION DEFAULT 0,
    p75_amount      DOUBLE PRECISION DEFAULT 0,
    p90_amount      DOUBLE PRECISION DEFAULT 0,
    p95_amount      DOUBLE PRECISION DEFAULT 0,
    min_amount      DOUBLE PRECISION DEFAULT 0,
    max_amount      DOUBLE PRECISION DEFAULT 0,
    entry_count     INTEGER DEFAULT 0,
    weekend_rate    DOUBLE PRECISION DEFAULT 0,
    manual_rate     DOUBLE PRECISION DEFAULT 0,
    month_end_rate  DOUBLE PRECISION DEFAULT 0,
    common_users    JSONB DEFAULT '[]',
    monthly_avg     JSONB DEFAULT '{}',
    last_updated    TIMESTAMP DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS ix_company_profiles_company_id ON company_profiles (company_id);

CREATE TABLE IF NOT EXISTS scoring_results (
    id             SERIAL PRIMARY KEY,
    company_id     VARCHAR NOT NULL,
    journal_id     VARCHAR,
    upload_batch   VARCHAR,
    final_score    DOUBLE PRECISION DEFAULT 0,
    risk_level     VARCHAR DEFAULT 'LOW',
    ml_score       DOUBLE PRECISION DEFAULT 0,
    stat_score     DOUBLE PRECISION DEFAULT 0,
    rules_score    DOUBLE PRECISION DEFAULT 0,
    ai_score       DOUBLE PRECISION DEFAULT 0,
    rule_flags     JSONB DEFAULT '[]',
    ai_explanation TEXT DEFAULT '',
    user_label     BOOLEAN,
    reviewed_by    VARCHAR,
    reviewed_at    TIMESTAMP,
    created_at     TIMESTAMP DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS ix_scoring_results_company_id ON scoring_results (company_id);

CREATE TABLE IF NOT EXISTS account_baselines (
    id             SERIAL PRIMARY KEY,
    client_id      VARCHAR NOT NULL,
    account        VARCHAR NOT NULL,
    mean_amount    DOUBLE PRECISION,
    std_amount     DOUBLE PRECISION,
    median_amount  DOUBLE PRECISION,
    p10_amount     DOUBLE PRECISION,
    p90_amount     DOUBLE PRECISION,
    lower_fence    DOUBLE PRECISION,
    upper_fence    DOUBLE PRECISION,
    weekend_rate   DOUBLE PRECISION,
    known_users    JSONB,
    entry_count    INTEGER,
    months_covered INTEGER,
    created_at     TIMESTAMP DEFAULT (now() AT TIME ZONE 'utc'),
    updated_at     TIMESTAMP DEFAULT (now() AT TIME ZONE 'utc'),
    UNIQUE (client_id, account)
);
CREATE INDEX IF NOT EXISTS ix_account_baselines_client_id ON account_baselines (client_id);

CREATE TABLE IF NOT EXISTS client_coa (
    id           SERIAL PRIMARY KEY,
    client_id    VARCHAR NOT NULL,
    ledger_name  VARCHAR NOT NULL,
    ledger_group VARCHAR,
    created_at   TIMESTAMP DEFAULT (now() AT TIME ZONE 'utc'),
    UNIQUE (client_id, ledger_name)
);
CREATE INDEX IF NOT EXISTS ix_client_coa_client_id ON client_coa (client_id);

CREATE TABLE IF NOT EXISTS ifrs_line_items_legacy (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(512) NOT NULL,
    statement     VARCHAR(128) NOT NULL,
    section       VARCHAR(256),
    sub_section   VARCHAR(256),
    standard      VARCHAR(128),
    is_calculated BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS ifrs_links_legacy (
    id                    SERIAL PRIMARY KEY,
    trial_balance_line_id INTEGER NOT NULL,
    ifrs_line_item_id     INTEGER NOT NULL REFERENCES ifrs_line_items_legacy(id),
    statement_type        VARCHAR(64) NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_ifrs_links_legacy_trial_balance_line_id ON ifrs_links_legacy (trial_balance_line_id);
CREATE INDEX IF NOT EXISTS ix_ifrs_links_legacy_ifrs_line_item_id ON ifrs_links_legacy (ifrs_line_item_id);

-- =============================================================================
-- SECTION 4 — IFRS Week 1 core (ORM — must exist BEFORE Alembic 003/005)
-- =============================================================================

CREATE TABLE IF NOT EXISTS trial_balances (
    id            SERIAL PRIMARY KEY,
    tenant_id     VARCHAR(64) NOT NULL,
    company_name  VARCHAR(512) NOT NULL,
    period_start  DATE,
    period_end    DATE,
    currency      VARCHAR(8) NOT NULL DEFAULT 'USD',
    uploaded_by   VARCHAR(256),
    uploaded_at   TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
    status        VARCHAR(32) NOT NULL DEFAULT 'uploaded',
    file_name     VARCHAR(512) NOT NULL,
    file_path     VARCHAR(1024)
);
-- Existing IFRS tables (from init_db) may lack tenant_id; patch before indexes.
DO $$ BEGIN ALTER TABLE trial_balances ADD COLUMN tenant_id VARCHAR(64); EXCEPTION WHEN duplicate_column THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS ix_trial_balances_tenant_id ON trial_balances (tenant_id);

CREATE TABLE IF NOT EXISTS trial_balance_lines (
    id               SERIAL PRIMARY KEY,
    trial_balance_id INTEGER NOT NULL REFERENCES trial_balances(id),
    tenant_id        VARCHAR(64) NOT NULL,
    gl_code          VARCHAR(64) NOT NULL,
    gl_description   VARCHAR(512) NOT NULL,
    debit_amount     DOUBLE PRECISION NOT NULL DEFAULT 0,
    credit_amount    DOUBLE PRECISION NOT NULL DEFAULT 0,
    net_amount       DOUBLE PRECISION NOT NULL DEFAULT 0,
    account_type     VARCHAR(32) NOT NULL DEFAULT 'asset'
);
DO $$ BEGIN ALTER TABLE trial_balance_lines ADD COLUMN tenant_id VARCHAR(64); EXCEPTION WHEN duplicate_column THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS ix_trial_balance_lines_trial_balance_id ON trial_balance_lines (trial_balance_id);
CREATE INDEX IF NOT EXISTS ix_trial_balance_lines_tenant_id ON trial_balance_lines (tenant_id);

CREATE TABLE IF NOT EXISTS gl_mappings (
    id                    SERIAL PRIMARY KEY,
    tenant_id             VARCHAR(64) NOT NULL,
    company_id            VARCHAR(128),
    trial_balance_id      INTEGER NOT NULL REFERENCES trial_balances(id),
    trial_balance_line_id INTEGER NOT NULL REFERENCES trial_balance_lines(id),
    gl_code               VARCHAR(64) NOT NULL,
    gl_description        VARCHAR(512) NOT NULL,
    ifrs_statement        VARCHAR(64) NOT NULL,
    ifrs_line_item        VARCHAR(512) NOT NULL,
    ifrs_section          VARCHAR(512) NOT NULL,
    ifrs_sub_section      VARCHAR(512),
    mapping_source        VARCHAR(32) NOT NULL DEFAULT 'ai_suggested',
    ai_confidence_score   DOUBLE PRECISION NOT NULL DEFAULT 0,
    ai_reasoning          TEXT,
    is_confirmed          BOOLEAN NOT NULL DEFAULT FALSE,
    confirmed_by          VARCHAR(256),
    confirmed_at          TIMESTAMP,
    needs_review          BOOLEAN NOT NULL DEFAULT FALSE,
    validator_checked     BOOLEAN NOT NULL DEFAULT FALSE,
    validator_passed      BOOLEAN NOT NULL DEFAULT FALSE,
    validator_issues      JSONB,
    validator_score       DOUBLE PRECISION,
    is_contra             BOOLEAN NOT NULL DEFAULT FALSE,
    locked                BOOLEAN NOT NULL DEFAULT FALSE
);
DO $$ BEGIN ALTER TABLE gl_mappings ADD COLUMN tenant_id VARCHAR(64); EXCEPTION WHEN duplicate_column THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS ix_gl_mappings_tenant_id ON gl_mappings (tenant_id);
CREATE INDEX IF NOT EXISTS ix_gl_mappings_trial_balance_id ON gl_mappings (trial_balance_id);
CREATE INDEX IF NOT EXISTS ix_gl_mappings_trial_balance_line_id ON gl_mappings (trial_balance_line_id);
CREATE INDEX IF NOT EXISTS ix_gl_mappings_company_id ON gl_mappings (company_id);

CREATE TABLE IF NOT EXISTS mapping_templates (
    id                 SERIAL PRIMARY KEY,
    tenant_id          VARCHAR(64) NOT NULL,
    template_name      VARCHAR(256) NOT NULL,
    industry           VARCHAR(128),
    is_default         BOOLEAN NOT NULL DEFAULT FALSE,
    is_system_template BOOLEAN NOT NULL DEFAULT FALSE,
    created_at         TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
    entries            JSONB
);
DO $$ BEGIN ALTER TABLE mapping_templates ADD COLUMN tenant_id VARCHAR(64); EXCEPTION WHEN duplicate_column THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS ix_mapping_templates_tenant_id ON mapping_templates (tenant_id);

CREATE TABLE IF NOT EXISTS ifrs_line_item_master (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(512) NOT NULL,
    statement     VARCHAR(128) NOT NULL,
    section       VARCHAR(256) NOT NULL,
    sub_section   VARCHAR(256),
    standard      VARCHAR(128),
    is_calculated BOOLEAN NOT NULL DEFAULT FALSE,
    display_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_ifrs_line_item_master_name ON ifrs_line_item_master (name);
CREATE INDEX IF NOT EXISTS ix_ifrs_line_item_master_statement ON ifrs_line_item_master (statement);

CREATE TABLE IF NOT EXISTS generated_statements (
    id               SERIAL PRIMARY KEY,
    tenant_id        VARCHAR(64) NOT NULL,
    trial_balance_id INTEGER NOT NULL REFERENCES trial_balances(id),
    statement_type   VARCHAR(64) NOT NULL,
    period_start     DATE,
    period_end       DATE,
    currency         VARCHAR(8) NOT NULL DEFAULT 'USD',
    status           VARCHAR(32) NOT NULL DEFAULT 'draft',
    generated_at     TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
    generated_by_ai  BOOLEAN NOT NULL DEFAULT TRUE,
    reviewed         BOOLEAN NOT NULL DEFAULT FALSE
);
DO $$ BEGIN ALTER TABLE generated_statements ADD COLUMN tenant_id VARCHAR(64); EXCEPTION WHEN duplicate_column THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS ix_generated_statements_tenant_id ON generated_statements (tenant_id);
CREATE INDEX IF NOT EXISTS ix_generated_statements_trial_balance_id ON generated_statements (trial_balance_id);
CREATE INDEX IF NOT EXISTS ix_generated_statements_statement_type ON generated_statements (statement_type);

CREATE TABLE IF NOT EXISTS statement_line_items (
    id                 SERIAL PRIMARY KEY,
    statement_id       INTEGER NOT NULL REFERENCES generated_statements(id),
    ifrs_section       VARCHAR(256) NOT NULL,
    ifrs_sub_section   VARCHAR(256),
    ifrs_line_item     VARCHAR(512) NOT NULL,
    amount             NUMERIC(18, 2) NOT NULL DEFAULT 0,
    is_calculated      BOOLEAN NOT NULL DEFAULT FALSE,
    is_subtotal        BOOLEAN NOT NULL DEFAULT FALSE,
    is_total           BOOLEAN NOT NULL DEFAULT FALSE,
    is_manual_override BOOLEAN NOT NULL DEFAULT FALSE,
    display_order      INTEGER NOT NULL DEFAULT 0,
    indent_level       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_statement_line_items_statement_id ON statement_line_items (statement_id);

CREATE TABLE IF NOT EXISTS ifrs_links (
    id                     SERIAL PRIMARY KEY,
    trial_balance_line_id  INTEGER NOT NULL REFERENCES trial_balance_lines(id),
    statement_line_item_id INTEGER NOT NULL REFERENCES statement_line_items(id),
    statement_type         VARCHAR(64) NOT NULL,
    amount_contribution    NUMERIC(18, 2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_ifrs_links_trial_balance_line_id ON ifrs_links (trial_balance_line_id);
CREATE INDEX IF NOT EXISTS ix_ifrs_links_statement_line_item_id ON ifrs_links (statement_line_item_id);

-- =============================================================================
-- SECTION 5 — Alembic 002 bank recon + Alembic 003/005 IFRS extensions
-- =============================================================================

CREATE TABLE IF NOT EXISTS recon_workspaces (
    id                      SERIAL PRIMARY KEY,
    tenant_id               VARCHAR(64) NOT NULL,
    workspace_name          VARCHAR(512) NOT NULL,
    period_start            DATE NOT NULL,
    period_end              DATE NOT NULL,
    recon_type              VARCHAR(32) NOT NULL,
    currency                VARCHAR(8) NOT NULL,
    status                  VARCHAR(32) NOT NULL,
    assigned_preparer_id      VARCHAR(256),
    assigned_reviewer_id    VARCHAR(256),
    due_date                DATE,
    completed_date          DATE,
    sign_off_preparer         BOOLEAN NOT NULL,
    sign_off_reviewer         BOOLEAN NOT NULL,
    total_book_balance      NUMERIC(18, 4),
    total_bank_balance      NUMERIC(18, 4),
    outstanding_deposits    NUMERIC(18, 4) NOT NULL,
    outstanding_cheques     NUMERIC(18, 4) NOT NULL,
    adjusted_book_balance   NUMERIC(18, 4),
    adjusted_bank_balance   NUMERIC(18, 4),
    variance                NUMERIC(18, 4) NOT NULL,
    is_reconciled           BOOLEAN NOT NULL,
    created_at              TIMESTAMP NOT NULL,
    updated_at              TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_recon_workspaces_tenant_id ON recon_workspaces (tenant_id);

CREATE TABLE IF NOT EXISTS match_groups (
    id                   SERIAL PRIMARY KEY,
    workspace_id         INTEGER NOT NULL REFERENCES recon_workspaces(id) ON DELETE CASCADE,
    match_type           VARCHAR(32) NOT NULL,
    confidence_score     DOUBLE PRECISION NOT NULL,
    amount_variance      NUMERIC(18, 4) NOT NULL,
    date_variance_days   INTEGER,
    description_similarity DOUBLE PRECISION,
    status               VARCHAR(32) NOT NULL,
    confirmed_by         VARCHAR(256),
    confirmed_at         TIMESTAMP,
    ai_reasoning         TEXT,
    metadata             JSONB,
    created_at           TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_match_groups_workspace_id ON match_groups (workspace_id);

CREATE TABLE IF NOT EXISTS book_transactions (
    id                   SERIAL PRIMARY KEY,
    workspace_id         INTEGER NOT NULL REFERENCES recon_workspaces(id) ON DELETE CASCADE,
    txn_date             DATE NOT NULL,
    value_date           DATE,
    posting_date         DATE,
    amount               NUMERIC(18, 4) NOT NULL,
    debit_credit         VARCHAR(2) NOT NULL,
    description          TEXT,
    reference            VARCHAR(512),
    gl_account           VARCHAR(128),
    cost_center          VARCHAR(128),
    document_number      VARCHAR(256),
    source_system        VARCHAR(64),
    status               VARCHAR(32) NOT NULL,
    match_id             INTEGER REFERENCES match_groups(id) ON DELETE SET NULL,
    exception_reason     TEXT,
    is_reconciling_item  BOOLEAN NOT NULL,
    reconciling_item_type VARCHAR(32),
    created_at           TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_book_transactions_workspace_id ON book_transactions (workspace_id);
CREATE INDEX IF NOT EXISTS ix_book_transactions_match_id ON book_transactions (match_id);

CREATE TABLE IF NOT EXISTS bank_transactions (
    id                  SERIAL PRIMARY KEY,
    workspace_id        INTEGER NOT NULL REFERENCES recon_workspaces(id) ON DELETE CASCADE,
    txn_date            DATE NOT NULL,
    value_date          DATE,
    amount              NUMERIC(18, 4) NOT NULL,
    debit_credit        VARCHAR(2) NOT NULL,
    description         TEXT,
    bank_reference      VARCHAR(512),
    counterparty        VARCHAR(512),
    bank_account_number VARCHAR(128),
    bank_name           VARCHAR(256),
    status              VARCHAR(32) NOT NULL,
    match_id            INTEGER REFERENCES match_groups(id) ON DELETE SET NULL,
    exception_reason    TEXT,
    is_reconciling_item BOOLEAN NOT NULL,
    created_at          TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_bank_transactions_workspace_id ON bank_transactions (workspace_id);
CREATE INDEX IF NOT EXISTS ix_bank_transactions_match_id ON bank_transactions (match_id);

CREATE TABLE IF NOT EXISTS subledger_transactions (
    id                 SERIAL PRIMARY KEY,
    workspace_id       INTEGER NOT NULL REFERENCES recon_workspaces(id) ON DELETE CASCADE,
    txn_date           DATE NOT NULL,
    amount             NUMERIC(18, 4) NOT NULL,
    debit_credit       VARCHAR(2) NOT NULL,
    description        TEXT,
    subledger_type     VARCHAR(32),
    document_reference VARCHAR(512),
    status             VARCHAR(32) NOT NULL,
    match_id           INTEGER REFERENCES match_groups(id) ON DELETE SET NULL,
    created_at         TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_subledger_transactions_workspace_id ON subledger_transactions (workspace_id);
CREATE INDEX IF NOT EXISTS ix_subledger_transactions_match_id ON subledger_transactions (match_id);

CREATE TABLE IF NOT EXISTS recon_adjustments (
    id                     SERIAL PRIMARY KEY,
    workspace_id           INTEGER NOT NULL REFERENCES recon_workspaces(id) ON DELETE CASCADE,
    adjustment_type        VARCHAR(48) NOT NULL,
    description            TEXT,
    amount                 NUMERIC(18, 4) NOT NULL,
    affects_side           VARCHAR(16) NOT NULL,
    journal_entry_required BOOLEAN NOT NULL,
    je_posted              BOOLEAN NOT NULL,
    posted_by              VARCHAR(256),
    posted_at              TIMESTAMP,
    created_by             VARCHAR(256),
    created_at             TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_recon_adjustments_workspace_id ON recon_adjustments (workspace_id);

CREATE TABLE IF NOT EXISTS recon_exceptions (
    id              SERIAL PRIMARY KEY,
    workspace_id    INTEGER NOT NULL REFERENCES recon_workspaces(id) ON DELETE CASCADE,
    exception_type  VARCHAR(48) NOT NULL,
    severity        VARCHAR(16) NOT NULL,
    description     TEXT,
    bank_txn_id     INTEGER REFERENCES bank_transactions(id) ON DELETE SET NULL,
    book_txn_id     INTEGER REFERENCES book_transactions(id) ON DELETE SET NULL,
    amount          NUMERIC(18, 4),
    age_days        INTEGER,
    assigned_to     VARCHAR(256),
    resolution_notes TEXT,
    resolved        BOOLEAN NOT NULL,
    resolved_at     TIMESTAMP,
    resolved_by     VARCHAR(256),
    created_at      TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS recon_audit_trail (
    id           SERIAL PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES recon_workspaces(id) ON DELETE CASCADE,
    action       VARCHAR(48) NOT NULL,
    performed_by VARCHAR(256),
    performed_at TIMESTAMP NOT NULL,
    details      JSONB,
    ip_address   VARCHAR(64)
);

-- Alembic 003
CREATE TABLE IF NOT EXISTS disclosure_notes (
    id                   SERIAL PRIMARY KEY,
    tenant_id            VARCHAR(64) NOT NULL,
    trial_balance_id     INTEGER NOT NULL REFERENCES trial_balances(id),
    note_number          INTEGER NOT NULL,
    note_code            VARCHAR(8) NOT NULL,
    note_title           VARCHAR(512) NOT NULL,
    status               VARCHAR(32) NOT NULL,
    ai_generated_content TEXT,
    user_edited_content  TEXT,
    is_user_edited       BOOLEAN NOT NULL,
    word_count           INTEGER NOT NULL,
    generated_at         TIMESTAMP,
    edited_at            TIMESTAMP,
    edited_by            VARCHAR(256)
);
CREATE INDEX IF NOT EXISTS ix_disclosure_notes_trial_balance_id ON disclosure_notes (trial_balance_id);
CREATE INDEX IF NOT EXISTS ix_disclosure_notes_tenant_id ON disclosure_notes (tenant_id);

CREATE TABLE IF NOT EXISTS disclosure_sections (
    id            SERIAL PRIMARY KEY,
    note_id       INTEGER NOT NULL REFERENCES disclosure_notes(id) ON DELETE CASCADE,
    section_title VARCHAR(512) NOT NULL,
    content       TEXT,
    display_order INTEGER NOT NULL,
    is_table      BOOLEAN NOT NULL,
    table_data    JSONB
);
CREATE INDEX IF NOT EXISTS ix_disclosure_sections_note_id ON disclosure_sections (note_id);

CREATE TABLE IF NOT EXISTS compliance_checks (
    id                SERIAL PRIMARY KEY,
    trial_balance_id  INTEGER NOT NULL REFERENCES trial_balances(id),
    check_code        VARCHAR(32) NOT NULL,
    check_description VARCHAR(1024) NOT NULL,
    standard          VARCHAR(128) NOT NULL,
    result            VARCHAR(32) NOT NULL,
    severity          VARCHAR(32) NOT NULL,
    details           TEXT,
    recommendation    TEXT,
    checked_at        TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_compliance_checks_trial_balance_id ON compliance_checks (trial_balance_id);
CREATE INDEX IF NOT EXISTS ix_compliance_checks_check_code ON compliance_checks (check_code);

-- Alembic 005 + ORM extensions
CREATE TABLE IF NOT EXISTS statement_commentaries (
    id               SERIAL PRIMARY KEY,
    tenant_id        VARCHAR(64) NOT NULL,
    trial_balance_id INTEGER NOT NULL REFERENCES trial_balances(id),
    commentary_type  VARCHAR(64) NOT NULL,
    content          TEXT NOT NULL,
    edited_content   TEXT,
    created_at       TIMESTAMP NOT NULL,
    updated_at       TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_statement_commentaries_tenant_id ON statement_commentaries (tenant_id);
CREATE INDEX IF NOT EXISTS ix_statement_commentaries_trial_balance_id ON statement_commentaries (trial_balance_id);
CREATE INDEX IF NOT EXISTS ix_statement_commentaries_commentary_type ON statement_commentaries (commentary_type);

CREATE TABLE IF NOT EXISTS risk_flags (
    id               SERIAL PRIMARY KEY,
    tenant_id        VARCHAR(64) NOT NULL,
    trial_balance_id INTEGER NOT NULL REFERENCES trial_balances(id),
    severity         VARCHAR(16) NOT NULL,
    title            VARCHAR(512) NOT NULL,
    metric_name      VARCHAR(256),
    metric_value     VARCHAR(256),
    recommendation   TEXT,
    sort_order       INTEGER NOT NULL,
    created_at       TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_risk_flags_tenant_id ON risk_flags (tenant_id);
CREATE INDEX IF NOT EXISTS ix_risk_flags_trial_balance_id ON risk_flags (trial_balance_id);
CREATE INDEX IF NOT EXISTS ix_risk_flags_severity ON risk_flags (severity);

CREATE TABLE IF NOT EXISTS board_packs (
    id               SERIAL PRIMARY KEY,
    tenant_id        VARCHAR(64) NOT NULL,
    trial_balance_id INTEGER NOT NULL REFERENCES trial_balances(id),
    company_name     VARCHAR(512) NOT NULL,
    period_end       DATE,
    currency         VARCHAR(8) NOT NULL,
    status           VARCHAR(32) NOT NULL,
    pdf_path         VARCHAR(2048) NOT NULL,
    public_token     VARCHAR(64) NOT NULL UNIQUE,
    watermark        VARCHAR(32) NOT NULL,
    generated_at     TIMESTAMP NOT NULL,
    reviewed_by      VARCHAR(256),
    reviewed_at      TIMESTAMP,
    shared_at        TIMESTAMP,
    view_count       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_board_packs_tenant_id ON board_packs (tenant_id);
CREATE INDEX IF NOT EXISTS ix_board_packs_trial_balance_id ON board_packs (trial_balance_id);
CREATE INDEX IF NOT EXISTS ix_board_packs_public_token ON board_packs (public_token);

CREATE TABLE IF NOT EXISTS ct_bridge_results (
    id               SERIAL PRIMARY KEY,
    tenant_id        VARCHAR(64) NOT NULL,
    trial_balance_id INTEGER NOT NULL REFERENCES trial_balances(id),
    ifrs_pbt         NUMERIC(18, 2) NOT NULL DEFAULT 0,
    adjustments_json JSONB,
    taxable_income   NUMERIC(18, 2) NOT NULL DEFAULT 0,
    ct_rate          NUMERIC(6, 4) NOT NULL DEFAULT 0.09,
    ct_liability     NUMERIC(18, 2) NOT NULL DEFAULT 0,
    free_zone_eligible BOOLEAN NOT NULL DEFAULT FALSE,
    small_business_relief BOOLEAN NOT NULL DEFAULT FALSE,
    inputs_json      JSONB,
    calculated_at    TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS ix_ct_bridge_results_tenant_id ON ct_bridge_results (tenant_id);
CREATE INDEX IF NOT EXISTS ix_ct_bridge_results_trial_balance_id ON ct_bridge_results (trial_balance_id);

CREATE TABLE IF NOT EXISTS erp_connections (
    id                  SERIAL PRIMARY KEY,
    tenant_id           VARCHAR(64) NOT NULL,
    entity_id           VARCHAR(128),
    erp_type            VARCHAR(32) NOT NULL DEFAULT 'tally',
    connection_name     VARCHAR(512) NOT NULL,
    tally_host          VARCHAR(256) NOT NULL DEFAULT 'localhost',
    tally_port          INTEGER NOT NULL DEFAULT 9000,
    tally_company_name  VARCHAR(512) NOT NULL DEFAULT '',
    tally_version       VARCHAR(128),
    status              VARCHAR(32) NOT NULL DEFAULT 'not_tested',
    last_connected_at   TIMESTAMP,
    last_sync_at        TIMESTAMP,
    last_error          TEXT,
    default_currency    VARCHAR(8) NOT NULL DEFAULT 'INR',
    fiscal_year_start   VARCHAR(32) NOT NULL DEFAULT 'April',
    auto_sync           BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
    updated_at          TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS ix_erp_connections_tenant_id ON erp_connections (tenant_id);
CREATE INDEX IF NOT EXISTS ix_erp_connections_entity_id ON erp_connections (entity_id);

CREATE TABLE IF NOT EXISTS tally_sync_logs (
    id               SERIAL PRIMARY KEY,
    tenant_id        VARCHAR(64) NOT NULL DEFAULT 'default',
    connection_id    INTEGER REFERENCES erp_connections(id),
    sync_type        VARCHAR(32) NOT NULL DEFAULT 'trial_balance',
    period_from      DATE,
    period_to        DATE,
    company_name     VARCHAR(512),
    rows_imported    INTEGER NOT NULL DEFAULT 0,
    status           VARCHAR(32) NOT NULL DEFAULT 'started',
    error_message    TEXT,
    trial_balance_id INTEGER REFERENCES trial_balances(id),
    started_at       TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
    completed_at     TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_tally_sync_logs_tenant_id ON tally_sync_logs (tenant_id);
CREATE INDEX IF NOT EXISTS ix_tally_sync_logs_connection_id ON tally_sync_logs (connection_id);
CREATE INDEX IF NOT EXISTS ix_tally_sync_logs_trial_balance_id ON tally_sync_logs (trial_balance_id);

-- =============================================================================
-- SECTION 6 — Alembic 004 bookkeeping
-- =============================================================================

CREATE TABLE IF NOT EXISTS bookkeeping_client_profiles (
    client_id           VARCHAR(64) PRIMARY KEY,
    weekend_operations  BOOLEAN NOT NULL,
    receipt_threshold   DOUBLE PRECISION NOT NULL,
    chart_of_accounts   JSONB,
    updated_at          TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bookkeeping_transactions (
    id              SERIAL PRIMARY KEY,
    client_id       VARCHAR(64) NOT NULL,
    period_year     INTEGER,
    period_month    INTEGER,
    txn_date        TIMESTAMP NOT NULL,
    description     TEXT,
    amount          DOUBLE PRECISION NOT NULL,
    type            VARCHAR(32),
    category        VARCHAR(256),
    confidence      DOUBLE PRECISION,
    flag_for_review BOOLEAN NOT NULL,
    auto_approved   BOOLEAN NOT NULL,
    anomaly_flags   JSONB,
    receipt_url     VARCHAR(1024),
    vendor_name     VARCHAR(512),
    bank_account_id VARCHAR(128),
    created_at      TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_bookkeeping_transactions_client_id ON bookkeeping_transactions (client_id);

CREATE TABLE IF NOT EXISTS client_vendors (
    id                SERIAL PRIMARY KEY,
    client_id         VARCHAR(64) NOT NULL,
    vendor_name       VARCHAR(512) NOT NULL,
    category          VARCHAR(256),
    avg_amount        DOUBLE PRECISION,
    last_seen         TIMESTAMP,
    transaction_count INTEGER,
    UNIQUE (client_id, vendor_name)
);
CREATE INDEX IF NOT EXISTS ix_client_vendors_client_id ON client_vendors (client_id);

CREATE TABLE IF NOT EXISTS client_rules (
    id               SERIAL PRIMARY KEY,
    client_id        VARCHAR(64) NOT NULL,
    vendor_pattern   VARCHAR(512) NOT NULL,
    category         VARCHAR(256) NOT NULL,
    confidence_boost DOUBLE PRECISION,
    source           VARCHAR(64),
    created_at       TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_client_rules_client_id ON client_rules (client_id);

CREATE TABLE IF NOT EXISTS transaction_categories (
    id             SERIAL PRIMARY KEY,
    transaction_id INTEGER NOT NULL REFERENCES bookkeeping_transactions(id) ON DELETE CASCADE,
    category       VARCHAR(256) NOT NULL,
    confidence     DOUBLE PRECISION NOT NULL,
    method           VARCHAR(32) NOT NULL,
    claude_reason  TEXT,
    staff_corrected BOOLEAN NOT NULL,
    corrected_to   VARCHAR(256),
    corrected_at   TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_transaction_categories_transaction_id ON transaction_categories (transaction_id);

CREATE TABLE IF NOT EXISTS missing_receipts (
    id                  SERIAL PRIMARY KEY,
    transaction_id      INTEGER NOT NULL UNIQUE REFERENCES bookkeeping_transactions(id) ON DELETE CASCADE,
    amount              DOUBLE PRECISION NOT NULL,
    vendor              VARCHAR(512),
    date                TIMESTAMP,
    reminder_sent_count INTEGER,
    resolved            BOOLEAN NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_missing_receipts_transaction_id ON missing_receipts (transaction_id);

CREATE TABLE IF NOT EXISTS accuracy_metrics (
    id                       SERIAL PRIMARY KEY,
    client_id                VARCHAR(64) NOT NULL,
    month                    INTEGER NOT NULL,
    year                     INTEGER NOT NULL,
    total_transactions       INTEGER,
    auto_approved            INTEGER,
    staff_corrected          INTEGER,
    flagged                  INTEGER,
    anomalies_real           INTEGER,
    anomalies_false_positive INTEGER,
    accuracy_pct             DOUBLE PRECISION,
    UNIQUE (client_id, month, year)
);
CREATE INDEX IF NOT EXISTS ix_accuracy_metrics_client_id ON accuracy_metrics (client_id);

CREATE TABLE IF NOT EXISTS bookkeeping_reconciliation_runs (
    id             SERIAL PRIMARY KEY,
    client_id      VARCHAR(64) NOT NULL,
    variance_amount DOUBLE PRECISION NOT NULL,
    escalated      BOOLEAN NOT NULL,
    summary_json   JSONB,
    created_at     TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_bookkeeping_reconciliation_runs_client_id ON bookkeeping_reconciliation_runs (client_id);

CREATE TABLE IF NOT EXISTS reconciliation_signoffs (
    id              SERIAL PRIMARY KEY,
    client_id       VARCHAR(64) NOT NULL,
    period_month    INTEGER NOT NULL,
    period_year     INTEGER NOT NULL,
    signed_by       VARCHAR(256) NOT NULL,
    signed_at       TIMESTAMP,
    variance_amount DOUBLE PRECISION,
    notes           TEXT
);
CREATE INDEX IF NOT EXISTS ix_reconciliation_signoffs_client_id ON reconciliation_signoffs (client_id);

-- =============================================================================
-- SECTION 7 — Alembic 007–011 R2R learning + narratives
-- =============================================================================

CREATE TABLE IF NOT EXISTS client_profiles (
    id                          SERIAL PRIMARY KEY,
    client_id                   VARCHAR(128) NOT NULL UNIQUE,
    client_name                 VARCHAR(512) NOT NULL,
    industry                    VARCHAR(256),
    fiscal_year_end             VARCHAR(64),
    months_of_data              INTEGER NOT NULL DEFAULT 0,
    account_baselines           JSONB,
    user_baselines              JSONB,
    vendor_baselines            JSONB,
    timing_baselines            JSONB,
    amount_threshold_multiplier DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    weekend_penalty_score       DOUBLE PRECISION NOT NULL DEFAULT 15.0,
    round_number_penalty        DOUBLE PRECISION NOT NULL DEFAULT 10.0,
    new_vendor_penalty          DOUBLE PRECISION NOT NULL DEFAULT 12.0,
    total_entries_analysed      INTEGER NOT NULL DEFAULT 0,
    total_flagged               INTEGER NOT NULL DEFAULT 0,
    total_approved              INTEGER NOT NULL DEFAULT 0,
    total_rejected              INTEGER NOT NULL DEFAULT 0,
    false_positive_rate         DOUBLE PRECISION,
    learning_status             VARCHAR(32) NOT NULL DEFAULT 'initialising',
    created_at                  TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
    updated_at                  TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE TABLE IF NOT EXISTS journal_entry_feedback (
    id                    SERIAL PRIMARY KEY,
    client_id             VARCHAR(128) NOT NULL REFERENCES client_profiles(client_id),
    entry_id              VARCHAR(256) NOT NULL,
    gl_account            VARCHAR(512) NOT NULL,
    amount                DOUBLE PRECISION NOT NULL DEFAULT 0,
    posted_by             VARCHAR(256) NOT NULL,
    posting_date          TIMESTAMP,
    description           TEXT,
    original_risk_score   DOUBLE PRECISION NOT NULL DEFAULT 0,
    original_risk_level   VARCHAR(32) NOT NULL DEFAULT '',
    original_risk_reasons JSONB,
    feedback              VARCHAR(32) NOT NULL,
    feedback_comment      TEXT,
    reviewed_by           VARCHAR(256) NOT NULL DEFAULT 'analyst',
    reviewed_at           TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
    threshold_adjusted    BOOLEAN NOT NULL DEFAULT FALSE,
    adjustment_note       TEXT
);
CREATE INDEX IF NOT EXISTS ix_journal_entry_feedback_client_id ON journal_entry_feedback (client_id);
CREATE INDEX IF NOT EXISTS ix_journal_entry_feedback_entry_id ON journal_entry_feedback (entry_id);

CREATE TABLE IF NOT EXISTS learning_events (
    id                       SERIAL PRIMARY KEY,
    client_id                VARCHAR(128) NOT NULL REFERENCES client_profiles(client_id),
    event_type               VARCHAR(64) NOT NULL,
    description              TEXT NOT NULL,
    old_value                VARCHAR(512),
    new_value                VARCHAR(512),
    triggered_by_feedback_id INTEGER REFERENCES journal_entry_feedback(id),
    created_at               TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS ix_learning_events_client_id ON learning_events (client_id);

CREATE TABLE IF NOT EXISTS close_runs (
    run_id         VARCHAR(64) PRIMARY KEY,
    entity_id      VARCHAR(128) NOT NULL,
    period         VARCHAR(32) NOT NULL,
    company_name   VARCHAR(256),
    currency       VARCHAR(8) NOT NULL,
    status         VARCHAR(32) NOT NULL,
    checks_json    JSONB NOT NULL,
    snapshot_json  JSONB NOT NULL,
    audit_trail    JSONB NOT NULL,
    total_seconds  DOUBLE PRECISION,
    created_at     TIMESTAMP NOT NULL,
    approved_by    VARCHAR(256),
    approved_at    TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_close_runs_entity_id ON close_runs (entity_id);
CREATE INDEX IF NOT EXISTS ix_close_runs_period ON close_runs (period);

CREATE TABLE IF NOT EXISTS earnings_reviews (
    review_id        VARCHAR(40) PRIMARY KEY,
    entity_id        VARCHAR(128) NOT NULL,
    period           VARCHAR(64) NOT NULL,
    period_type      VARCHAR(16) NOT NULL,
    currency         VARCHAR(8) NOT NULL,
    company_name     VARCHAR(256),
    status           VARCHAR(24) NOT NULL,
    variances_json   JSONB NOT NULL,
    commentary_json  JSONB NOT NULL,
    quality_score    DOUBLE PRECISION,
    flags_json       JSONB NOT NULL,
    headline_verdict VARCHAR(32),
    total_seconds    DOUBLE PRECISION,
    created_at       TIMESTAMP NOT NULL,
    approved_by      VARCHAR(256),
    approved_at      TIMESTAMP,
    snapshot_json    JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_earnings_reviews_entity_id ON earnings_reviews (entity_id);

CREATE TABLE IF NOT EXISTS gl_reconciliations (
    recon_id       VARCHAR(40) PRIMARY KEY,
    entity_id      VARCHAR(128) NOT NULL,
    period         VARCHAR(32) NOT NULL,
    account_code   VARCHAR(64) NOT NULL,
    account_name   VARCHAR(256),
    currency       VARCHAR(8) NOT NULL,
    company_name   VARCHAR(256),
    status         VARCHAR(24) NOT NULL,
    summary_json   JSONB NOT NULL,
    matches_json   JSONB NOT NULL,
    unmatched_gl   JSONB NOT NULL,
    unmatched_bank JSONB NOT NULL,
    suggested_jes  JSONB NOT NULL,
    audit_trail    JSONB NOT NULL,
    total_seconds  DOUBLE PRECISION,
    created_at     TIMESTAMP NOT NULL,
    approved_by    VARCHAR(256),
    approved_at    TIMESTAMP,
    snapshot_json  JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_gl_reconciliations_entity_id ON gl_reconciliations (entity_id);
CREATE INDEX IF NOT EXISTS ix_gl_reconciliations_account_code ON gl_reconciliations (account_code);

CREATE TABLE IF NOT EXISTS je_history (
    id            SERIAL PRIMARY KEY,
    company_id    VARCHAR(100),
    upload_month  VARCHAR(7),
    upload_batch  VARCHAR(50),
    journal_id    VARCHAR(100),
    posting_date  DATE,
    posting_hour  INTEGER,
    posting_dow   INTEGER,
    account       VARCHAR(100),
    amount        DOUBLE PRECISION,
    user_id       VARCHAR(100),
    source        VARCHAR(50),
    description   TEXT,
    entity        VARCHAR(50),
    created_at    TIMESTAMP DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS ix_je_history_company_id ON je_history (company_id);
CREATE INDEX IF NOT EXISTS ix_je_history_account ON je_history (account);

CREATE TABLE IF NOT EXISTS je_account_baseline (
    id               SERIAL PRIMARY KEY,
    company_id       VARCHAR(100),
    account          VARCHAR(100),
    mean_amount      DOUBLE PRECISION,
    std_amount       DOUBLE PRECISION,
    median_amount    DOUBLE PRECISION,
    p25_amount       DOUBLE PRECISION,
    p75_amount       DOUBLE PRECISION,
    min_amount       DOUBLE PRECISION,
    max_amount       DOUBLE PRECISION,
    total_entries    INTEGER,
    months_loaded    INTEGER,
    avg_entries_month DOUBLE PRECISION,
    normal_users     JSONB,
    normal_sources   JSONB,
    normal_entities  JSONB,
    weekend_pct      DOUBLE PRECISION,
    afterhours_pct   DOUBLE PRECISION,
    monthend_pct     DOUBLE PRECISION,
    manual_pct       DOUBLE PRECISION,
    round_num_pct    DOUBLE PRECISION,
    benford_chi2     DOUBLE PRECISION,
    benford_normal   DOUBLE PRECISION,
    meta_json        JSONB,
    updated_at       TIMESTAMP DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS ix_je_account_baseline_company_id ON je_account_baseline (company_id);
CREATE INDEX IF NOT EXISTS ix_je_account_baseline_account ON je_account_baseline (account);

CREATE TABLE IF NOT EXISTS je_narratives (
    id              SERIAL PRIMARY KEY,
    company_id      VARCHAR(100) NOT NULL,
    journal_id      VARCHAR(100) NOT NULL,
    risk_level      VARCHAR(20),
    composite_score DOUBLE PRECISION,
    narrative       TEXT NOT NULL,
    model_used      VARCHAR(100),
    created_at      TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_je_narratives_company_id ON je_narratives (company_id);
CREATE INDEX IF NOT EXISTS ix_je_narratives_journal_id ON je_narratives (journal_id);
CREATE INDEX IF NOT EXISTS ix_je_narratives_created_at ON je_narratives (created_at);

CREATE TABLE IF NOT EXISTS r2r_historical_data (
    id SERIAL PRIMARY KEY
    -- See app/models/r2r_learning.py for full column list if table missing
);
-- NOTE: If r2r_historical_data already partially exists, compare ORM model before relying on stub.

-- =============================================================================
-- SECTION 8 — Workspaces + company setup (Alembic 012–014)
-- =============================================================================

CREATE TABLE IF NOT EXISTS workspaces (
    id                      VARCHAR(36) PRIMARY KEY,
    name                    VARCHAR(256) NOT NULL,
    legal_entity_name       VARCHAR(256) NOT NULL,
    trn_number              VARCHAR(20),
    country                 VARCHAR(64) NOT NULL DEFAULT 'UAE',
    currency                VARCHAR(3) NOT NULL DEFAULT 'AED',
    fiscal_year_start_month INTEGER NOT NULL DEFAULT 1,
    fiscal_year_end_month   INTEGER NOT NULL DEFAULT 12,
    industry                VARCHAR(128),
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMP NOT NULL,
    updated_at              TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_members (
    id           VARCHAR(36) PRIMARY KEY,
    workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id),
    user_id      VARCHAR(36) NOT NULL REFERENCES rbac_users(id),
    role         VARCHAR(32) NOT NULL DEFAULT 'accountant',
    created_at   TIMESTAMP NOT NULL,
    UNIQUE (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS ix_workspace_members_workspace_id ON workspace_members (workspace_id);
CREATE INDEX IF NOT EXISTS ix_workspace_members_user_id ON workspace_members (user_id);

CREATE TABLE IF NOT EXISTS workspace_vat_settings (
    id               VARCHAR(36) PRIMARY KEY,
    workspace_id     VARCHAR(36) NOT NULL UNIQUE REFERENCES workspaces(id),
    entity_type      VARCHAR(32) DEFAULT 'mainland',
    vat_registered   BOOLEAN DEFAULT TRUE,
    standard_rate    VARCHAR(10) DEFAULT '5',
    filing_frequency VARCHAR(20) DEFAULT 'quarterly',
    notes            TEXT,
    created_at       TIMESTAMP NOT NULL
);

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
    created_at           TIMESTAMP NOT NULL,
    updated_at           TIMESTAMP NOT NULL
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
    created_at    TIMESTAMP NOT NULL,
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
    created_at                TIMESTAMP NOT NULL,
    updated_at                TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_user_roles (
    id           VARCHAR(36) PRIMARY KEY,
    workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id),
    user_id      VARCHAR(36) NOT NULL REFERENCES rbac_users(id),
    module       VARCHAR(64) NOT NULL,
    role         VARCHAR(64) NOT NULL,
    created_at   TIMESTAMP NOT NULL,
    UNIQUE (workspace_id, user_id, module)
);
CREATE INDEX IF NOT EXISTS ix_workspace_user_roles_workspace_id ON workspace_user_roles (workspace_id);
CREATE INDEX IF NOT EXISTS ix_workspace_user_roles_user_id ON workspace_user_roles (user_id);

-- =============================================================================
-- SECTION 9 — UAE full accounting (ORM — before uae_ap FKs)
-- =============================================================================

-- Migration 014 company_id columns on existing UAE tables (patch before indexes).
DO $$ BEGIN ALTER TABLE uae_accounts ADD COLUMN company_id VARCHAR(36); EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE uae_journal_entries ADD COLUMN company_id VARCHAR(36); EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE uae_sales_invoices ADD COLUMN company_id VARCHAR(36); EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE uae_bank_accounts ADD COLUMN company_id VARCHAR(36); EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE uae_fixed_assets ADD COLUMN company_id VARCHAR(36); EXCEPTION WHEN duplicate_column THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS uae_accounts (
    id                VARCHAR(36) PRIMARY KEY,
    tenant_id         VARCHAR(36) NOT NULL,
    company_id        VARCHAR(36),
    code              VARCHAR(20) NOT NULL,
    name              VARCHAR(200) NOT NULL,
    account_type      VARCHAR(50),
    sub_type          VARCHAR(50),
    currency          VARCHAR(3) DEFAULT 'AED',
    is_vat_applicable BOOLEAN DEFAULT FALSE,
    vat_rate          NUMERIC(5, 2) DEFAULT 0,
    ifrs_mapping      VARCHAR(100),
    is_active         BOOLEAN DEFAULT TRUE,
    parent_id         VARCHAR(36) REFERENCES uae_accounts(id),
    created_at        TIMESTAMP DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS ix_uae_accounts_tenant_id ON uae_accounts (tenant_id);
CREATE INDEX IF NOT EXISTS ix_uae_accounts_company_id ON uae_accounts (company_id);

CREATE TABLE IF NOT EXISTS uae_journal_entries (
    id               VARCHAR(36) PRIMARY KEY,
    tenant_id        VARCHAR(36) NOT NULL,
    company_id       VARCHAR(36),
    entry_number     VARCHAR(30),
    entry_date       DATE NOT NULL,
    period           VARCHAR(7),
    description      VARCHAR(500),
    reference        VARCHAR(100),
    source           VARCHAR(50) DEFAULT 'manual',
    status           VARCHAR(20) DEFAULT 'draft',
    is_recurring     BOOLEAN DEFAULT FALSE,
    posted_at        TIMESTAMP,
    approved_by      VARCHAR(200),
    approved_at      TIMESTAMP,
    rejection_reason VARCHAR(500),
    created_at       TIMESTAMP DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS ix_uae_journal_entries_tenant_id ON uae_journal_entries (tenant_id);
CREATE INDEX IF NOT EXISTS ix_uae_journal_entries_company_id ON uae_journal_entries (company_id);

CREATE TABLE IF NOT EXISTS uae_journal_lines (
    id               VARCHAR(36) PRIMARY KEY,
    journal_entry_id VARCHAR(36) NOT NULL REFERENCES uae_journal_entries(id),
    account_id       VARCHAR(36) REFERENCES uae_accounts(id),
    account_code     VARCHAR(20),
    account_name     VARCHAR(200),
    description      VARCHAR(300),
    debit            NUMERIC(15, 2) DEFAULT 0,
    credit           NUMERIC(15, 2) DEFAULT 0,
    vat_amount       NUMERIC(15, 2) DEFAULT 0,
    cost_center      VARCHAR(50),
    currency         VARCHAR(3) DEFAULT 'AED'
);

CREATE TABLE IF NOT EXISTS uae_customers (
    id                 VARCHAR(36) PRIMARY KEY,
    tenant_id          VARCHAR(64) NOT NULL,
    name               VARCHAR(200) NOT NULL,
    trn                VARCHAR(20),
    email              VARCHAR(200),
    phone              VARCHAR(30),
    address            TEXT,
    emirate            VARCHAR(50),
    currency           VARCHAR(3) DEFAULT 'AED',
    payment_terms_days INTEGER DEFAULT 30,
    credit_limit       NUMERIC(15, 2),
    is_active          BOOLEAN DEFAULT TRUE,
    created_at         TIMESTAMP DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS ix_uae_customers_tenant_id ON uae_customers (tenant_id);

CREATE TABLE IF NOT EXISTS uae_sales_invoices (
    id                   VARCHAR(36) PRIMARY KEY,
    tenant_id            VARCHAR(36) NOT NULL,
    company_id           VARCHAR(36),
    invoice_number       VARCHAR(30),
    customer_id          VARCHAR(36) REFERENCES uae_customers(id),
    invoice_date         DATE,
    due_date             DATE,
    period               VARCHAR(7),
    subtotal             NUMERIC(15, 2) DEFAULT 0,
    vat_amount           NUMERIC(15, 2) DEFAULT 0,
    total_amount         NUMERIC(15, 2) DEFAULT 0,
    paid_amount          NUMERIC(15, 2) DEFAULT 0,
    outstanding          NUMERIC(15, 2) DEFAULT 0,
    status               VARCHAR(20) DEFAULT 'draft',
    seller_trn           VARCHAR(20),
    buyer_trn            VARCHAR(20),
    supply_type          VARCHAR(30) DEFAULT 'standard',
    journal_entry_id     VARCHAR(36) REFERENCES uae_journal_entries(id),
    notes                TEXT,
    sent_at              TIMESTAMP,
    paid_date            DATE,
    payment_reference    VARCHAR(100),
    overdue_notified_at  TIMESTAMP,
    last_dunning_level   INTEGER DEFAULT 0,
    last_dunning_sent_at TIMESTAMP,
    dunning_count        INTEGER DEFAULT 0,
    created_at           TIMESTAMP DEFAULT (now() AT TIME ZONE 'utc'),
    updated_at           TIMESTAMP DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS ix_uae_sales_invoices_tenant_id ON uae_sales_invoices (tenant_id);
CREATE INDEX IF NOT EXISTS ix_uae_sales_invoices_company_id ON uae_sales_invoices (company_id);

CREATE TABLE IF NOT EXISTS uae_sales_invoice_lines (
    id          VARCHAR(36) PRIMARY KEY,
    invoice_id  VARCHAR(36) NOT NULL REFERENCES uae_sales_invoices(id),
    description VARCHAR(300),
    quantity    NUMERIC(10, 3) DEFAULT 1,
    unit_price  NUMERIC(15, 2) DEFAULT 0,
    line_total  NUMERIC(15, 2) DEFAULT 0,
    vat_rate    NUMERIC(5, 2) DEFAULT 5,
    vat_amount  NUMERIC(15, 2) DEFAULT 0,
    account_id  VARCHAR(36) REFERENCES uae_accounts(id)
);

CREATE TABLE IF NOT EXISTS uae_bank_accounts (
    id                      VARCHAR(36) PRIMARY KEY,
    tenant_id               VARCHAR(36) NOT NULL,
    company_id              VARCHAR(36),
    bank_name               VARCHAR(100),
    account_number          VARCHAR(30),
    iban                    VARCHAR(35),
    currency                VARCHAR(3) DEFAULT 'AED',
    gl_account_id           VARCHAR(36) REFERENCES uae_accounts(id),
    last_reconciled_date    DATE,
    last_reconciled_balance NUMERIC(15, 2),
    is_active               BOOLEAN DEFAULT TRUE,
    created_at              TIMESTAMP DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS ix_uae_bank_accounts_tenant_id ON uae_bank_accounts (tenant_id);
CREATE INDEX IF NOT EXISTS ix_uae_bank_accounts_company_id ON uae_bank_accounts (company_id);

CREATE TABLE IF NOT EXISTS uae_bank_statements (
    id              VARCHAR(36) PRIMARY KEY,
    tenant_id       VARCHAR(64) NOT NULL,
    bank_account_id VARCHAR(36) REFERENCES uae_bank_accounts(id),
    statement_date  DATE,
    opening_balance NUMERIC(15, 2) DEFAULT 0,
    closing_balance NUMERIC(15, 2) DEFAULT 0,
    uploaded_at     TIMESTAMP DEFAULT (now() AT TIME ZONE 'utc'),
    status          VARCHAR(20) DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS ix_uae_bank_statements_tenant_id ON uae_bank_statements (tenant_id);

CREATE TABLE IF NOT EXISTS uae_bank_statement_lines (
    id                      VARCHAR(36) PRIMARY KEY,
    statement_id            VARCHAR(36) NOT NULL REFERENCES uae_bank_statements(id),
    transaction_date        DATE,
    value_date              DATE,
    description             VARCHAR(500),
    reference               VARCHAR(100),
    debit                   NUMERIC(15, 2) DEFAULT 0,
    credit                  NUMERIC(15, 2) DEFAULT 0,
    balance                 NUMERIC(15, 2),
    matched_journal_line_id VARCHAR(36) REFERENCES uae_journal_lines(id),
    match_status            VARCHAR(20) DEFAULT 'unmatched',
    match_confidence        NUMERIC(5, 2),
    ai_suggested_account    VARCHAR(200),
    ai_narration            VARCHAR(500)
);

CREATE TABLE IF NOT EXISTS uae_fixed_assets (
    id                          VARCHAR(36) PRIMARY KEY,
    tenant_id                   VARCHAR(36) NOT NULL,
    company_id                  VARCHAR(36),
    asset_code                  VARCHAR(20),
    name                        VARCHAR(200),
    category                    VARCHAR(100),
    purchase_date               DATE,
    purchase_cost               NUMERIC(15, 2) DEFAULT 0,
    residual_value              NUMERIC(15, 2) DEFAULT 0,
    useful_life_years           INTEGER DEFAULT 5,
    depreciation_method         VARCHAR(30) DEFAULT 'straight_line',
    accumulated_depreciation    NUMERIC(15, 2) DEFAULT 0,
    net_book_value              NUMERIC(15, 2) DEFAULT 0,
    ct_depreciation_rate        NUMERIC(5, 2) DEFAULT 20,
    ct_accumulated_depreciation NUMERIC(15, 2) DEFAULT 0,
    location                    VARCHAR(100),
    status                      VARCHAR(20) DEFAULT 'active',
    gl_account_id               VARCHAR(36) REFERENCES uae_accounts(id),
    disposal_date               DATE,
    disposal_proceeds           NUMERIC(15, 2),
    created_at                  TIMESTAMP DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS ix_uae_fixed_assets_tenant_id ON uae_fixed_assets (tenant_id);
CREATE INDEX IF NOT EXISTS ix_uae_fixed_assets_company_id ON uae_fixed_assets (company_id);

CREATE TABLE IF NOT EXISTS uae_accruals (
    id                  VARCHAR(36) PRIMARY KEY,
    tenant_id           VARCHAR(64) NOT NULL,
    description         VARCHAR(300),
    accrual_type        VARCHAR(50),
    amount              NUMERIC(15, 2) DEFAULT 0,
    period              VARCHAR(7),
    reversal_period     VARCHAR(7),
    debit_account_code  VARCHAR(20),
    credit_account_code VARCHAR(20),
    journal_entry_id    VARCHAR(36) REFERENCES uae_journal_entries(id),
    reversal_journal_id VARCHAR(36) REFERENCES uae_journal_entries(id),
    status              VARCHAR(20) DEFAULT 'suggested',
    ai_suggested        BOOLEAN DEFAULT FALSE,
    ai_basis            VARCHAR(300),
    ai_confidence       NUMERIC(5, 2),
    mandatory           BOOLEAN DEFAULT FALSE,
    source_document     VARCHAR(200),
    created_at          TIMESTAMP DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS ix_uae_accruals_tenant_id ON uae_accruals (tenant_id);

CREATE TABLE IF NOT EXISTS uae_period_closes (
    id                            VARCHAR(36) PRIMARY KEY,
    tenant_id                     VARCHAR(64) NOT NULL,
    period                        VARCHAR(7),
    status                        VARCHAR(20) DEFAULT 'open',
    tb_reconciled                 BOOLEAN DEFAULT FALSE,
    bank_recon_done               BOOLEAN DEFAULT FALSE,
    accruals_posted               BOOLEAN DEFAULT FALSE,
    fixed_assets_depreciated      BOOLEAN DEFAULT FALSE,
    vat_reconciled                BOOLEAN DEFAULT FALSE,
    ar_reviewed                   BOOLEAN DEFAULT FALSE,
    ap_reviewed                   BOOLEAN DEFAULT FALSE,
    ifrs_statements_generated     BOOLEAN DEFAULT FALSE,
    management_accounts_done      BOOLEAN DEFAULT FALSE,
    multi_currency_revaluation    BOOLEAN DEFAULT FALSE,
    intercompany_balances_reconciled BOOLEAN DEFAULT FALSE,
    ifrs_adjustments_posted       BOOLEAN DEFAULT FALSE,
    audit_trail_exported          BOOLEAN DEFAULT FALSE,
    closed_at                     TIMESTAMP,
    created_at                    TIMESTAMP DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS ix_uae_period_closes_tenant_id ON uae_period_closes (tenant_id);

CREATE TABLE IF NOT EXISTS uae_account_classifications (
    id                    VARCHAR(36) PRIMARY KEY,
    workspace_id          VARCHAR(64) NOT NULL,
    company_id            VARCHAR(36),
    account_id            VARCHAR(36),
    account_code          VARCHAR(20) NOT NULL,
    account_name          VARCHAR(200) NOT NULL DEFAULT '',
    balance               NUMERIC(18, 2) DEFAULT 0,
    bs_pl_main            VARCHAR(64),
    bs_pl_sub             VARCHAR(128),
    fs_note_number        INTEGER,
    fs_note_heading       TEXT,
    cash_flow_category    VARCHAR(32),
    cit_category          VARCHAR(64),
    cit_add_back          BOOLEAN DEFAULT FALSE,
    classification_status VARCHAR(20) NOT NULL DEFAULT 'not_classified',
    classified_by         VARCHAR(16),
    ai_confidence         NUMERIC(5, 2),
    ai_reasoning          TEXT,
    created_at            TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
    updated_at            TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
    UNIQUE (workspace_id, company_id, account_code)
);
CREATE INDEX IF NOT EXISTS ix_uae_account_classifications_workspace_id ON uae_account_classifications (workspace_id);
CREATE INDEX IF NOT EXISTS ix_uae_account_classifications_company_id ON uae_account_classifications (company_id);
CREATE INDEX IF NOT EXISTS ix_uae_account_classifications_account_id ON uae_account_classifications (account_id);
CREATE INDEX IF NOT EXISTS ix_uae_account_classifications_account_code ON uae_account_classifications (account_code);

-- Alembic 012 UAE AP
CREATE TABLE IF NOT EXISTS uae_vendors (
    id                 VARCHAR(36) PRIMARY KEY,
    tenant_id          VARCHAR(64) NOT NULL,
    workspace_id       VARCHAR(36),
    name               VARCHAR(200) NOT NULL,
    trn                VARCHAR(20),
    email              VARCHAR(200),
    phone              VARCHAR(30),
    address            TEXT,
    emirate            VARCHAR(50),
    currency           VARCHAR(3) DEFAULT 'AED',
    payment_terms_days INTEGER DEFAULT 30,
    is_active          BOOLEAN DEFAULT TRUE,
    created_at         TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_uae_vendors_tenant_id ON uae_vendors (tenant_id);
CREATE INDEX IF NOT EXISTS ix_uae_vendors_workspace_id ON uae_vendors (workspace_id);

CREATE TABLE IF NOT EXISTS uae_purchase_invoices (
    id               VARCHAR(36) PRIMARY KEY,
    tenant_id        VARCHAR(64) NOT NULL,
    workspace_id     VARCHAR(36),
    invoice_number   VARCHAR(50) NOT NULL,
    vendor_id        VARCHAR(36) NOT NULL REFERENCES uae_vendors(id),
    invoice_date     DATE NOT NULL,
    due_date         DATE NOT NULL,
    subtotal         NUMERIC(15, 2) DEFAULT 0,
    vat_amount       NUMERIC(15, 2) DEFAULT 0,
    total_amount     NUMERIC(15, 2) DEFAULT 0,
    outstanding      NUMERIC(15, 2) DEFAULT 0,
    status           VARCHAR(20) DEFAULT 'draft',
    vat_treatment    VARCHAR(30) DEFAULT 'standard_rated',
    journal_entry_id VARCHAR(36) REFERENCES uae_journal_entries(id),
    source           VARCHAR(30) DEFAULT 'manual',
    notes            TEXT,
    created_at       TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_uae_purchase_invoices_tenant_id ON uae_purchase_invoices (tenant_id);
CREATE INDEX IF NOT EXISTS ix_uae_purchase_invoices_workspace_id ON uae_purchase_invoices (workspace_id);

CREATE TABLE IF NOT EXISTS uae_purchase_invoice_lines (
    id           VARCHAR(36) PRIMARY KEY,
    invoice_id   VARCHAR(36) NOT NULL REFERENCES uae_purchase_invoices(id),
    description  VARCHAR(300) NOT NULL,
    quantity     NUMERIC(10, 3) DEFAULT 1,
    unit_price   NUMERIC(15, 2) NOT NULL,
    line_total   NUMERIC(15, 2) DEFAULT 0,
    vat_rate     NUMERIC(5, 2) DEFAULT 5,
    vat_amount   NUMERIC(15, 2) DEFAULT 0,
    account_code VARCHAR(20)
);

CREATE TABLE IF NOT EXISTS consolidation_eliminations (
    id                VARCHAR(36) PRIMARY KEY,
    workspace_id      VARCHAR(36) NOT NULL REFERENCES workspaces(id),
    period_id         VARCHAR(36) NOT NULL REFERENCES accounting_periods(id),
    account_category  VARCHAR(64) NOT NULL,
    company_from_id   VARCHAR(36) REFERENCES uae_company_profiles(id),
    company_to_id     VARCHAR(36) REFERENCES uae_company_profiles(id),
    amount            NUMERIC(15, 2) NOT NULL DEFAULT 0,
    note              TEXT,
    created_by        VARCHAR(36) REFERENCES rbac_users(id),
    created_at        TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_consolidation_eliminations_workspace_id ON consolidation_eliminations (workspace_id);
CREATE INDEX IF NOT EXISTS ix_consolidation_eliminations_period_id ON consolidation_eliminations (period_id);

-- =============================================================================
-- SECTION 10 — Client data / AP / GulfTax (ORM — Alembic 015 defers to init_db)
-- =============================================================================

CREATE TABLE IF NOT EXISTS ap_companies (
    id                  VARCHAR(36) PRIMARY KEY,
    tenant_id           VARCHAR(36) NOT NULL,
    name                VARCHAR(256) NOT NULL,
    slug                VARCHAR(128) NOT NULL,
    market              VARCHAR(16) DEFAULT 'uae',
    accounting_standard VARCHAR(32) DEFAULT 'IFRS',
    created_at          TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
    updated_at          TIMESTAMP DEFAULT (now() AT TIME ZONE 'utc'),
    UNIQUE (tenant_id, slug)
);
CREATE INDEX IF NOT EXISTS ix_ap_companies_tenant_id ON ap_companies (tenant_id);

CREATE TABLE IF NOT EXISTS invoices (
    id               VARCHAR(36) PRIMARY KEY,
    tenant_id        VARCHAR(36) NOT NULL,
    company_id       VARCHAR(36) NOT NULL,
    invoice_number   VARCHAR(128) NOT NULL,
    invoice_date     DATE NOT NULL,
    due_date         DATE NOT NULL,
    vendor_name      VARCHAR(256) NOT NULL,
    vendor_email     VARCHAR(256),
    total_amount     NUMERIC(15, 2) NOT NULL,
    subtotal_amount  NUMERIC(15, 2) DEFAULT 0,
    currency         VARCHAR(8) DEFAULT 'AED',
    status           VARCHAR(32) DEFAULT 'Processing',
    tax_amount       NUMERIC(15, 2) DEFAULT 0,
    vat_amount       NUMERIC(15, 2),
    vat_rate         NUMERIC(5, 2),
    vat_treatment    VARCHAR(64),
    vendor_trn       VARCHAR(32),
    po_number        VARCHAR(64),
    file_url         TEXT,
    risk_score       NUMERIC(5, 2),
    risk_flags       JSONB DEFAULT '[]',
    gulftax_decision VARCHAR(64),
    extra            JSONB DEFAULT '{}',
    created_at       TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
    updated_at       TIMESTAMP DEFAULT (now() AT TIME ZONE 'utc'),
    created_by       VARCHAR(36),
    UNIQUE (tenant_id, company_id, invoice_number)
);
CREATE INDEX IF NOT EXISTS ix_invoices_tenant_id ON invoices (tenant_id);
CREATE INDEX IF NOT EXISTS ix_invoices_company_id ON invoices (company_id);

CREATE TABLE IF NOT EXISTS invoice_line_items (
    id          VARCHAR(36) PRIMARY KEY,
    tenant_id   VARCHAR(36) NOT NULL,
    company_id  VARCHAR(36) NOT NULL,
    invoice_id  VARCHAR(36) NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    quantity    NUMERIC(10, 2) NOT NULL DEFAULT 1,
    unit_price  NUMERIC(15, 2) NOT NULL,
    total       NUMERIC(15, 2) NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS ix_invoice_line_items_invoice_id ON invoice_line_items (invoice_id);

CREATE TABLE IF NOT EXISTS vendors (
    id         VARCHAR(36) PRIMARY KEY,
    tenant_id  VARCHAR(36) NOT NULL,
    company_id VARCHAR(36) NOT NULL,
    name       VARCHAR(256) NOT NULL,
    email      VARCHAR(256),
    trn        VARCHAR(32),
    extra      JSONB DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS ix_vendors_tenant_id ON vendors (tenant_id);
CREATE INDEX IF NOT EXISTS ix_vendors_company_id ON vendors (company_id);

CREATE TABLE IF NOT EXISTS purchase_orders (
    id           VARCHAR(36) PRIMARY KEY,
    tenant_id    VARCHAR(36) NOT NULL,
    company_id   VARCHAR(36) NOT NULL,
    po_number    VARCHAR(64) NOT NULL,
    vendor_name  VARCHAR(256) NOT NULL,
    total_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
    status       VARCHAR(32) DEFAULT 'open',
    extra        JSONB DEFAULT '{}',
    created_at   TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS ix_purchase_orders_tenant_id ON purchase_orders (tenant_id);

CREATE TABLE IF NOT EXISTS goods_receipts (
    id         VARCHAR(36) PRIMARY KEY,
    tenant_id  VARCHAR(36) NOT NULL,
    company_id VARCHAR(36) NOT NULL,
    grn_number VARCHAR(64) NOT NULL,
    po_id      VARCHAR(36),
    status     VARCHAR(32) DEFAULT 'received',
    extra      JSONB DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS ix_goods_receipts_tenant_id ON goods_receipts (tenant_id);

CREATE TABLE IF NOT EXISTS company_config (
    id         VARCHAR(36) PRIMARY KEY,
    tenant_id  VARCHAR(36) NOT NULL,
    company_id VARCHAR(36) NOT NULL,
    config     JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMP DEFAULT (now() AT TIME ZONE 'utc'),
    UNIQUE (tenant_id, company_id)
);
CREATE INDEX IF NOT EXISTS ix_company_config_tenant_id ON company_config (tenant_id);

CREATE TABLE IF NOT EXISTS gulftax_transactions (
    id               VARCHAR(36) PRIMARY KEY,
    tenant_id        VARCHAR(36) NOT NULL,
    company_id       VARCHAR(36) NOT NULL,
    source           VARCHAR(32) DEFAULT 'ap_invoiceflow',
    ap_invoice_id    VARCHAR(36),
    tax_period       VARCHAR(16) NOT NULL,
    transaction_date DATE NOT NULL,
    vendor_name      VARCHAR(256),
    vendor_trn       VARCHAR(32),
    invoice_number   VARCHAR(128),
    gross_amount     NUMERIC(15, 2) NOT NULL,
    vat_amount       NUMERIC(15, 2) DEFAULT 0,
    vat_category     VARCHAR(64) NOT NULL,
    fta_box          VARCHAR(8),
    direction        VARCHAR(16) DEFAULT 'input',
    status           VARCHAR(16) DEFAULT 'posted',
    created_at       TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS ix_gulftax_transactions_tenant_id ON gulftax_transactions (tenant_id);
CREATE INDEX IF NOT EXISTS ix_gulftax_transactions_company_id ON gulftax_transactions (company_id);

CREATE TABLE IF NOT EXISTS vat_return_entries (
    id             VARCHAR(36) PRIMARY KEY,
    tenant_id      VARCHAR(36) NOT NULL,
    company_id     VARCHAR(36) NOT NULL,
    period         VARCHAR(16) NOT NULL,
    source         VARCHAR(32),
    transaction_id VARCHAR(64),
    vendor_name    VARCHAR(256),
    net_amount     NUMERIC(15, 2),
    vat_amount     NUMERIC(15, 2),
    vat_treatment  VARCHAR(64),
    box_number     NUMERIC(4, 0),
    created_at     TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS ix_vat_return_entries_tenant_id ON vat_return_entries (tenant_id);

CREATE TABLE IF NOT EXISTS partial_exemption_calculations (
    id                VARCHAR(36) PRIMARY KEY,
    tenant_id         VARCHAR(36) NOT NULL,
    company_id        VARCHAR(36) NOT NULL,
    period            VARCHAR(16) NOT NULL,
    period_type       VARCHAR(16) DEFAULT 'quarterly',
    taxable_supplies  NUMERIC(15, 2) NOT NULL,
    exempt_supplies   NUMERIC(15, 2) NOT NULL,
    input_vat_paid    NUMERIC(15, 2) NOT NULL,
    recovery_pct      NUMERIC(8, 4) NOT NULL,
    recoverable_vat   NUMERIC(15, 2) NOT NULL,
    irrecoverable_vat NUMERIC(15, 2) NOT NULL,
    breakdown         JSONB,
    created_at        TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
    updated_at        TIMESTAMP DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS ix_partial_exemption_calculations_tenant_id ON partial_exemption_calculations (tenant_id);

CREATE TABLE IF NOT EXISTS bad_debt_relief_claims (
    id                 VARCHAR(36) PRIMARY KEY,
    tenant_id          VARCHAR(36) NOT NULL,
    company_id         VARCHAR(36) NOT NULL,
    invoice_number     VARCHAR(128) NOT NULL,
    invoice_date       DATE NOT NULL,
    due_date           DATE NOT NULL,
    invoice_amount     NUMERIC(15, 2) NOT NULL,
    vat_amount         NUMERIC(15, 2) NOT NULL,
    status             VARCHAR(32) DEFAULT 'draft',
    eligible           BOOLEAN DEFAULT FALSE,
    eligibility_reason TEXT,
    extra              JSONB DEFAULT '{}',
    created_at         TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
    updated_at         TIMESTAMP DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS ix_bad_debt_relief_claims_tenant_id ON bad_debt_relief_claims (tenant_id);

CREATE TABLE IF NOT EXISTS designated_zone_transactions (
    id                 VARCHAR(36) PRIMARY KEY,
    tenant_id          VARCHAR(36) NOT NULL,
    company_id         VARCHAR(36) NOT NULL,
    supplier_location  VARCHAR(64) NOT NULL,
    customer_location  VARCHAR(64) NOT NULL,
    transaction_type   VARCHAR(64) NOT NULL,
    vat_treatment      VARCHAR(64) NOT NULL,
    vat_rate           NUMERIC(5, 2) DEFAULT 0,
    explanation        TEXT NOT NULL,
    warning            TEXT,
    created_at         TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS ix_designated_zone_transactions_tenant_id ON designated_zone_transactions (tenant_id);

CREATE TABLE IF NOT EXISTS ap_audit_logs (
    id         VARCHAR(36) PRIMARY KEY,
    tenant_id  VARCHAR(36) NOT NULL,
    company_id VARCHAR(36) NOT NULL,
    invoice_id VARCHAR(36),
    action     VARCHAR(128) NOT NULL,
    user_id    VARCHAR(36),
    details    JSONB DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS ix_ap_audit_logs_tenant_id ON ap_audit_logs (tenant_id);
CREATE INDEX IF NOT EXISTS ix_ap_audit_logs_invoice_id ON ap_audit_logs (invoice_id);

-- =============================================================================
-- SECTION 11 — Remaining init_db ORM tables (agents, CRM, pipeline, etc.)
-- =============================================================================

CREATE TABLE IF NOT EXISTS connector_clients (
    id SERIAL PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS fpa_analysis_results (
    id SERIAL PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS fpa_master_data (
    id SERIAL PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS financial_models (
    id SERIAL PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS financial_statements (
    id SERIAL PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS audit_runs (
    id SERIAL PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS agent_runs (
    id                    SERIAL PRIMARY KEY,
    run_id                VARCHAR(64) NOT NULL UNIQUE,
    tenant_id             VARCHAR(64) NOT NULL,
    trial_balance_id      INTEGER NOT NULL REFERENCES trial_balances(id),
    prior_trial_balance_id INTEGER REFERENCES trial_balances(id),
    manual_prior_json     JSONB,
    status                VARCHAR(32) NOT NULL DEFAULT 'started',
    progress_pct          DOUBLE PRECISION NOT NULL DEFAULT 0,
    current_agent         VARCHAR(32),
    agents_completed      JSONB,
    output                JSONB,
    pause_reason          VARCHAR(64),
    resume_from_agent     VARCHAR(32),
    error_message         TEXT,
    started_at            TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
    updated_at            TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS ix_agent_runs_run_id ON agent_runs (run_id);
CREATE INDEX IF NOT EXISTS ix_agent_runs_tenant_id ON agent_runs (tenant_id);
CREATE INDEX IF NOT EXISTS ix_agent_runs_trial_balance_id ON agent_runs (trial_balance_id);

CREATE TABLE IF NOT EXISTS agent_run_logs (
    id           SERIAL PRIMARY KEY,
    agent_run_id INTEGER NOT NULL REFERENCES agent_runs(id),
    agent_id     VARCHAR(32) NOT NULL,
    message      TEXT NOT NULL,
    timestamp    TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS ix_agent_run_logs_agent_run_id ON agent_run_logs (agent_run_id);

CREATE TABLE IF NOT EXISTS agent_validation (
    id           SERIAL PRIMARY KEY,
    agent_run_id INTEGER NOT NULL REFERENCES agent_runs(id),
    check_name   VARCHAR(128) NOT NULL,
    passed       BOOLEAN NOT NULL DEFAULT FALSE,
    error        TEXT
);

CREATE TABLE IF NOT EXISTS agent_human_reviews (
    id           SERIAL PRIMARY KEY,
    agent_run_id INTEGER NOT NULL REFERENCES agent_runs(id),
    item         TEXT NOT NULL,
    status       VARCHAR(32) NOT NULL DEFAULT 'pending',
    resolution   TEXT,
    created_at   TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE TABLE IF NOT EXISTS cfo_agent_runs (
    id            SERIAL PRIMARY KEY,
    run_id        VARCHAR(64) NOT NULL UNIQUE,
    tenant_id     VARCHAR(64) NOT NULL,
    agent_name    VARCHAR(64) NOT NULL,
    status        VARCHAR(32) NOT NULL DEFAULT 'queued',
    context_json  JSONB,
    error_message TEXT,
    retry_count   INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
    updated_at    TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS ix_cfo_agent_runs_run_id ON cfo_agent_runs (run_id);
CREATE INDEX IF NOT EXISTS ix_cfo_agent_runs_tenant_id ON cfo_agent_runs (tenant_id);

CREATE TABLE IF NOT EXISTS cfo_agent_logs (
    id               SERIAL PRIMARY KEY,
    cfo_agent_run_id INTEGER NOT NULL REFERENCES cfo_agent_runs(id),
    level            VARCHAR(16) NOT NULL DEFAULT 'info',
    message          TEXT NOT NULL,
    created_at       TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE TABLE IF NOT EXISTS cfo_agent_outputs (
    id                    SERIAL PRIMARY KEY,
    cfo_agent_run_id      INTEGER NOT NULL REFERENCES cfo_agent_runs(id),
    output_type           VARCHAR(64) NOT NULL DEFAULT 'primary',
    payload_json          JSONB NOT NULL,
    validation_passed     BOOLEAN NOT NULL DEFAULT FALSE,
    validation_errors_json JSONB,
    created_at            TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE TABLE IF NOT EXISTS cfo_briefings (
    id            SERIAL PRIMARY KEY,
    tenant_id     VARCHAR(64) NOT NULL,
    briefing_date DATE NOT NULL,
    content_json  JSONB NOT NULL,
    raw_text      TEXT,
    created_at    TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE TABLE IF NOT EXISTS cfo_agent_alerts (
    id               SERIAL PRIMARY KEY,
    tenant_id        VARCHAR(64) NOT NULL,
    agent_name       VARCHAR(64) NOT NULL,
    severity         VARCHAR(32) NOT NULL DEFAULT 'warning',
    title            VARCHAR(512) NOT NULL,
    body             TEXT,
    status           VARCHAR(32) NOT NULL DEFAULT 'open',
    cfo_agent_run_id INTEGER REFERENCES cfo_agent_runs(id),
    meta_json        JSONB,
    created_at       TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE TABLE IF NOT EXISTS uae_connected_accounts (
    id                  SERIAL PRIMARY KEY,
    tenant_id           VARCHAR(64) NOT NULL,
    source              VARCHAR(32) NOT NULL,
    company_name        VARCHAR(512) NOT NULL DEFAULT '',
    company_id_external VARCHAR(256),
    currency_code       VARCHAR(8) NOT NULL DEFAULT 'AED',
    country             VARCHAR(64),
    access_token        TEXT,
    refresh_token       TEXT,
    token_expires_at    TIMESTAMP,
    api_domain          VARCHAR(256),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    last_synced_at      TIMESTAMP,
    last_error          TEXT,
    created_at          TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
    updated_at          TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS ix_uae_connected_accounts_tenant_id ON uae_connected_accounts (tenant_id);

CREATE TABLE IF NOT EXISTS uae_trial_balances (
    id                    SERIAL PRIMARY KEY,
    tenant_id             VARCHAR(64) NOT NULL,
    connected_account_id  INTEGER NOT NULL REFERENCES uae_connected_accounts(id),
    source                VARCHAR(32) NOT NULL,
    company_name          VARCHAR(512) NOT NULL DEFAULT '',
    period_start          VARCHAR(16) NOT NULL,
    period_end            VARCHAR(16) NOT NULL,
    currency              VARCHAR(8) NOT NULL DEFAULT 'AED',
    account_count         INTEGER NOT NULL DEFAULT 0,
    total_debits          NUMERIC(18, 2),
    total_credits         NUMERIC(18, 2),
    is_balanced           BOOLEAN,
    ifrs_trial_balance_id INTEGER,
    raw_data_json         JSONB,
    synced_at             TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS ix_uae_trial_balances_tenant_id ON uae_trial_balances (tenant_id);
CREATE INDEX IF NOT EXISTS ix_uae_trial_balances_connected_account_id ON uae_trial_balances (connected_account_id);

CREATE TABLE IF NOT EXISTS uae_trial_balance_lines (
    id               SERIAL PRIMARY KEY,
    trial_balance_id INTEGER NOT NULL REFERENCES uae_trial_balances(id),
    account_code     VARCHAR(64) NOT NULL DEFAULT '',
    account_name     VARCHAR(512) NOT NULL,
    account_type     VARCHAR(128) NOT NULL DEFAULT '',
    debit            NUMERIC(18, 2) NOT NULL DEFAULT 0,
    credit           NUMERIC(18, 2) NOT NULL DEFAULT 0,
    net_balance      NUMERIC(18, 2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_uae_trial_balance_lines_trial_balance_id ON uae_trial_balance_lines (trial_balance_id);

CREATE TABLE IF NOT EXISTS workspace_notifications (
    id VARCHAR(36) PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS workspace_audit_log (
    id VARCHAR(36) PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS crm_contacts (
    id               VARCHAR(36) PRIMARY KEY,
    workspace_id     VARCHAR(64) NOT NULL,
    company_id       VARCHAR(36),
    name             VARCHAR(200) NOT NULL,
    company_name     VARCHAR(200),
    email            VARCHAR(200),
    phone            VARCHAR(30),
    contact_type     VARCHAR(20) DEFAULT 'Lead',
    source           VARCHAR(50),
    assigned_to      VARCHAR(200),
    notes            TEXT,
    credit_score     NUMERIC(5, 1),
    risk_category    VARCHAR(20),
    credit_limit_aed NUMERIC(15, 2),
    created_at       TIMESTAMP DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS ix_crm_contacts_workspace_id ON crm_contacts (workspace_id);

CREATE TABLE IF NOT EXISTS crm_deals (
    id                  VARCHAR(36) PRIMARY KEY,
    workspace_id        VARCHAR(64) NOT NULL,
    company_id          VARCHAR(36),
    contact_id          VARCHAR(36) REFERENCES crm_contacts(id),
    deal_name           VARCHAR(300) NOT NULL,
    value_aed           NUMERIC(15, 2) DEFAULT 0,
    currency            VARCHAR(3) DEFAULT 'AED',
    stage               VARCHAR(30) DEFAULT 'New',
    expected_close_date DATE,
    probability_pct     INTEGER DEFAULT 10,
    notes               TEXT,
    ar_invoice_id       VARCHAR(36),
    created_at          TIMESTAMP DEFAULT (now() AT TIME ZONE 'utc'),
    updated_at          TIMESTAMP DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS ix_crm_deals_workspace_id ON crm_deals (workspace_id);

CREATE TABLE IF NOT EXISTS crm_activities (
    id            VARCHAR(36) PRIMARY KEY,
    workspace_id  VARCHAR(64) NOT NULL,
    deal_id       VARCHAR(36) REFERENCES crm_deals(id),
    contact_id    VARCHAR(36) REFERENCES crm_contacts(id),
    activity_type VARCHAR(30) DEFAULT 'follow-up',
    subject       VARCHAR(300),
    notes         TEXT,
    due_date      DATE,
    completed     BOOLEAN DEFAULT FALSE,
    completed_at  TIMESTAMP,
    created_by    VARCHAR(200),
    created_at    TIMESTAMP DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS ix_crm_activities_workspace_id ON crm_activities (workspace_id);

CREATE TABLE IF NOT EXISTS crm_quotes (
    id            VARCHAR(36) PRIMARY KEY,
    workspace_id  VARCHAR(64) NOT NULL,
    company_id    VARCHAR(36),
    deal_id       VARCHAR(36) REFERENCES crm_deals(id),
    contact_id    VARCHAR(36) REFERENCES crm_contacts(id),
    quote_number  VARCHAR(30),
    line_items    JSONB DEFAULT '[]',
    subtotal      NUMERIC(15, 2) DEFAULT 0,
    vat_amount    NUMERIC(15, 2) DEFAULT 0,
    total_aed     NUMERIC(15, 2) DEFAULT 0,
    status        VARCHAR(20) DEFAULT 'Draft',
    valid_until   DATE,
    ar_invoice_id VARCHAR(36),
    created_at    TIMESTAMP DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS ix_crm_quotes_workspace_id ON crm_quotes (workspace_id);

CREATE TABLE IF NOT EXISTS ifrs16_leases (id VARCHAR(36) PRIMARY KEY);
CREATE TABLE IF NOT EXISTS ifrs15_contracts (id VARCHAR(36) PRIMARY KEY);
CREATE TABLE IF NOT EXISTS ifrs9_portfolios (id VARCHAR(36) PRIMARY KEY);
CREATE TABLE IF NOT EXISTS ifrs9_assets (id VARCHAR(36) PRIMARY KEY);

CREATE TABLE IF NOT EXISTS gl_entries (id SERIAL PRIMARY KEY);
CREATE TABLE IF NOT EXISTS gl_balances (id SERIAL PRIMARY KEY);
CREATE TABLE IF NOT EXISTS month_close_checklist (id SERIAL PRIMARY KEY);
CREATE TABLE IF NOT EXISTS accounting_audit_log (id SERIAL PRIMARY KEY);
CREATE TABLE IF NOT EXISTS accrual_suggestions (id SERIAL PRIMARY KEY);
CREATE TABLE IF NOT EXISTS bank_recon_matches (id SERIAL PRIMARY KEY);

-- =============================================================================
-- SECTION 12 — India accounting (ORM only — NOT in init_db())
-- =============================================================================

CREATE TABLE IF NOT EXISTS india_accounts (id VARCHAR(36) PRIMARY KEY);
CREATE TABLE IF NOT EXISTS india_journal_entries (id VARCHAR(36) PRIMARY KEY);
CREATE TABLE IF NOT EXISTS india_journal_lines (id VARCHAR(36) PRIMARY KEY);
CREATE TABLE IF NOT EXISTS india_customers (id VARCHAR(36) PRIMARY KEY);
CREATE TABLE IF NOT EXISTS india_vendors (id VARCHAR(36) PRIMARY KEY);
CREATE TABLE IF NOT EXISTS india_sales_invoices (id VARCHAR(36) PRIMARY KEY);
CREATE TABLE IF NOT EXISTS india_sales_invoice_lines (id VARCHAR(36) PRIMARY KEY);
CREATE TABLE IF NOT EXISTS india_purchase_invoices (id VARCHAR(36) PRIMARY KEY);
CREATE TABLE IF NOT EXISTS india_purchase_invoice_lines (id VARCHAR(36) PRIMARY KEY);
CREATE TABLE IF NOT EXISTS india_tds_entries (id VARCHAR(36) PRIMARY KEY);
CREATE TABLE IF NOT EXISTS india_tds_certificates (id VARCHAR(36) PRIMARY KEY);
CREATE TABLE IF NOT EXISTS india_gst_returns (id VARCHAR(36) PRIMARY KEY);
CREATE TABLE IF NOT EXISTS india_employees (id VARCHAR(36) PRIMARY KEY);
CREATE TABLE IF NOT EXISTS india_payroll_runs (id VARCHAR(36) PRIMARY KEY);
CREATE TABLE IF NOT EXISTS india_payslips (id VARCHAR(36) PRIMARY KEY);
CREATE TABLE IF NOT EXISTS india_fixed_assets (id VARCHAR(36) PRIMARY KEY);
CREATE TABLE IF NOT EXISTS india_period_close (id VARCHAR(36) PRIMARY KEY);

-- =============================================================================
-- SECTION 98 — Column patches (migrations 006, 011, 014, 015 + init_db extras)
-- Safe on existing tables; no-op if column already present.
-- =============================================================================

DO $$ BEGIN
    ALTER TABLE gl_mappings ADD COLUMN validator_checked BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE gl_mappings ADD COLUMN validator_passed BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE gl_mappings ADD COLUMN validator_issues JSONB;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE gl_mappings ADD COLUMN validator_score DOUBLE PRECISION;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE gl_mappings ADD COLUMN is_contra BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE gl_mappings ADD COLUMN locked BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE je_account_baseline ADD COLUMN meta_json JSONB;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE uae_accounts ADD COLUMN company_id VARCHAR(36);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE uae_journal_entries ADD COLUMN company_id VARCHAR(36);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE uae_sales_invoices ADD COLUMN company_id VARCHAR(36);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE uae_bank_accounts ADD COLUMN company_id VARCHAR(36);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE uae_fixed_assets ADD COLUMN company_id VARCHAR(36);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE rbac_users ADD COLUMN tenant_id VARCHAR(36);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE rbac_users ADD COLUMN product_role VARCHAR(32) NOT NULL DEFAULT 'full_access';
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- =============================================================================
-- SECTION 99 — Alembic version table (manual — DO NOT auto-stamp)
-- After fixing revision 011 mismatch and running migrations, set:
--   INSERT INTO alembic_version (version_num) VALUES ('015_client_data_rds')
--   ON CONFLICT DO NOTHING;
-- Only stamp after you confirm which revisions were actually applied.
-- =============================================================================

CREATE TABLE IF NOT EXISTS alembic_version (
    version_num VARCHAR(32) NOT NULL PRIMARY KEY
);

-- ROLLBACK for review: COMMIT; when satisfied.
ROLLBACK;
