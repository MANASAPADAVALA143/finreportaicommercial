-- 051_ca_tb_lines.sql
-- ⚠️  RLS NOTE: Policies use tenant_id = auth.uid().
--     In FinReportAI, "tenant" is a workspace UUID, not the user UUID.
--     If browser clients write directly, align tenant_id with your
--     workspace membership table (e.g. workspace_members.workspace_id).
--     Backend service-role writes bypass RLS and are unaffected.
--
-- Individual TB ledger lines extracted from the uploaded Excel
-- One row per ledger per TB upload, with mapping result attached

CREATE TABLE IF NOT EXISTS ca_tb_lines (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    upload_id           UUID NOT NULL REFERENCES ca_tb_uploads(id) ON DELETE CASCADE,
    firm_id             UUID NOT NULL REFERENCES ca_firms(id) ON DELETE CASCADE,
    tenant_id           UUID NOT NULL,

    -- Raw data from Tally TB Excel
    row_number          INTEGER,                                -- original row in Excel
    ledger_name         VARCHAR(500) NOT NULL,                  -- as-is from Excel
    ledger_group        VARCHAR(255),                           -- Tally group if present
    opening_balance     NUMERIC(20,2) DEFAULT 0,
    debit_turnover      NUMERIC(20,2) DEFAULT 0,
    credit_turnover     NUMERIC(20,2) DEFAULT 0,
    closing_balance     NUMERIC(20,2) NOT NULL DEFAULT 0,
    dr_cr               VARCHAR(2) CHECK (dr_cr IN ('Dr', 'Cr')),  -- closing balance nature

    -- Mapping result (3-step engine output)
    mapping_source      VARCHAR(20) CHECK (mapping_source IN (
                            'HISTORY',          -- matched from ca_mapping_history
                            'COA',              -- matched from ca_coa_master
                            'AI',               -- Claude API suggested
                            'UNCLASSIFIED'      -- nothing matched
                        )),
    ai_confidence       NUMERIC(5,2),           -- 0-100, only when mapping_source = 'AI'
    ai_reasoning        TEXT,                   -- Claude's reasoning for the suggestion

    -- Mapped Schedule III fields
    schedule3_head      VARCHAR(255),
    schedule3_note      VARCHAR(50),
    schedule3_division  VARCHAR(20),
    bs_or_pl            VARCHAR(5) CHECK (bs_or_pl IN ('BS', 'PL', 'OCI')),
    major_head          VARCHAR(100),           -- e.g. "Equity and Liabilities > Current Liabilities"
    minor_head          VARCHAR(100),           -- e.g. "Trade Payables"

    -- CA review
    review_status       VARCHAR(20) DEFAULT 'PENDING'
                        CHECK (review_status IN (
                            'PENDING',          -- not yet reviewed by CA
                            'ACCEPTED',         -- CA accepted the suggestion
                            'OVERRIDDEN',       -- CA changed the mapping
                            'SKIPPED'           -- CA marked as not applicable
                        )),
    reviewed_by         VARCHAR(255),
    reviewed_at         TIMESTAMPTZ,

    -- Override fields (populated when CA overrides)
    override_head       VARCHAR(255),
    override_note       VARCHAR(50),
    override_major_head VARCHAR(100),
    override_minor_head VARCHAR(100),
    override_bs_or_pl   VARCHAR(5),

    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ca_tb_lines_upload_id ON ca_tb_lines(upload_id);
CREATE INDEX IF NOT EXISTS idx_ca_tb_lines_firm_id ON ca_tb_lines(firm_id);
CREATE INDEX IF NOT EXISTS idx_ca_tb_lines_tenant_id ON ca_tb_lines(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ca_tb_lines_review_status ON ca_tb_lines(upload_id, review_status);
CREATE INDEX IF NOT EXISTS idx_ca_tb_lines_mapping_source ON ca_tb_lines(upload_id, mapping_source);

-- View: effective mapping (override takes precedence over AI/COA/history)
CREATE OR REPLACE VIEW ca_tb_lines_effective AS
SELECT
    id,
    upload_id,
    firm_id,
    tenant_id,
    ledger_name,
    ledger_group,
    opening_balance,
    debit_turnover,
    credit_turnover,
    closing_balance,
    dr_cr,
    mapping_source,
    ai_confidence,
    review_status,
    -- Effective values (override wins if set)
    COALESCE(override_head,       schedule3_head)      AS eff_schedule3_head,
    COALESCE(override_note,       schedule3_note)      AS eff_schedule3_note,
    COALESCE(override_major_head, major_head)          AS eff_major_head,
    COALESCE(override_minor_head, minor_head)          AS eff_minor_head,
    COALESCE(override_bs_or_pl,   bs_or_pl)            AS eff_bs_or_pl,
    schedule3_division
FROM ca_tb_lines;

CREATE OR REPLACE FUNCTION update_ca_tb_lines_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ca_tb_lines_updated_at
    BEFORE UPDATE ON ca_tb_lines
    FOR EACH ROW EXECUTE FUNCTION update_ca_tb_lines_updated_at();

ALTER TABLE ca_tb_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY ca_tb_lines_tenant_isolation ON ca_tb_lines
    USING (tenant_id = auth.uid())
    WITH CHECK (tenant_id = auth.uid());

COMMENT ON TABLE ca_tb_lines IS 'One row per ledger per TB upload. Stores raw TB data + 3-step mapping result + CA review outcome. Use ca_tb_lines_effective view for final values.';
