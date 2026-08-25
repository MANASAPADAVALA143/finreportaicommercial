-- 052_ca_schedule3_output.sql
-- ⚠️  RLS NOTE: Policies use tenant_id = auth.uid().
--     In FinReportAI, "tenant" is a workspace UUID, not the user UUID.
--     If browser clients write directly, align tenant_id with your
--     workspace membership table (e.g. workspace_members.workspace_id).
--     Backend service-role writes bypass RLS and are unaffected.
--
-- Final Schedule III output per TB upload
-- Stores the generated JSON structure + file URLs for Excel and PDF

CREATE TABLE IF NOT EXISTS ca_schedule3_output (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    upload_id           UUID NOT NULL REFERENCES ca_tb_uploads(id) ON DELETE CASCADE,
    firm_id             UUID NOT NULL REFERENCES ca_firms(id) ON DELETE CASCADE,
    tenant_id           UUID NOT NULL,

    -- Config
    division            VARCHAR(20) NOT NULL CHECK (division IN (
                            'DIV1_NON_IND_AS',
                            'DIV1_IND_AS',
                            'DIV2_NBFC',
                            'DIV3_INSURANCE'
                        )),
    period_end          DATE NOT NULL,
    financial_year      VARCHAR(10),

    -- Generated output
    bs_json             JSONB,          -- Balance Sheet structured data
    pl_json             JSONB,          -- P&L structured data
    notes_json          JSONB,          -- Notes to accounts
    validation_json     JSONB,          -- Validation checks (BS tally, etc.)

    -- Validation summary
    bs_tallies          BOOLEAN,        -- Assets = Equity + Liabilities
    total_assets        NUMERIC(20,2),
    total_equity_liab   NUMERIC(20,2),
    difference          NUMERIC(20,2),  -- should be 0
    unclassified_count  INTEGER DEFAULT 0,
    unclassified_amount NUMERIC(20,2) DEFAULT 0,

    -- File exports
    excel_url           TEXT,           -- S3/Supabase storage URL
    pdf_url             TEXT,
    excel_generated_at  TIMESTAMPTZ,
    pdf_generated_at    TIMESTAMPTZ,

    -- AI commentary
    ai_commentary       TEXT,           -- Claude-generated MD&A / notes commentary

    -- Status
    status              VARCHAR(20) DEFAULT 'DRAFT'
                        CHECK (status IN (
                            'DRAFT',        -- generated but not finalised
                            'FINALISED',    -- CA marked as final
                            'ARCHIVED'      -- superseded by newer version
                        )),
    version             INTEGER DEFAULT 1,  -- increments on regeneration
    generated_by        VARCHAR(255),
    finalised_by        VARCHAR(255),
    finalised_at        TIMESTAMPTZ,

    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ca_sch3_output_upload_id ON ca_schedule3_output(upload_id);
CREATE INDEX IF NOT EXISTS idx_ca_sch3_output_firm_id ON ca_schedule3_output(firm_id);
CREATE INDEX IF NOT EXISTS idx_ca_sch3_output_tenant_id ON ca_schedule3_output(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ca_sch3_output_period ON ca_schedule3_output(firm_id, period_end);

CREATE OR REPLACE FUNCTION update_ca_schedule3_output_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ca_schedule3_output_updated_at
    BEFORE UPDATE ON ca_schedule3_output
    FOR EACH ROW EXECUTE FUNCTION update_ca_schedule3_output_updated_at();

ALTER TABLE ca_schedule3_output ENABLE ROW LEVEL SECURITY;

CREATE POLICY ca_schedule3_output_tenant_isolation ON ca_schedule3_output
    USING (tenant_id = auth.uid())
    WITH CHECK (tenant_id = auth.uid());

COMMENT ON TABLE ca_schedule3_output IS 'Final Schedule III output per upload. Stores BS/PL/Notes as JSONB + Excel/PDF file URLs. version increments on regeneration. bs_tallies must be TRUE before CA can finalise.';

-- ─────────────────────────────────────────────
-- SUMMARY VIEW: Upload pipeline status per firm
-- ─────────────────────────────────────────────
CREATE OR REPLACE VIEW ca_firm_upload_summary AS
SELECT
    f.id                AS firm_id,
    f.firm_name,
    f.tenant_id,
    COUNT(u.id)         AS total_uploads,
    COUNT(u.id) FILTER (WHERE u.status = 'COMPLETED')       AS completed,
    COUNT(u.id) FILTER (WHERE u.status = 'REVIEW_PENDING')  AS pending_review,
    COUNT(u.id) FILTER (WHERE u.status = 'FAILED')          AS failed,
    MAX(u.period_end)   AS latest_period
FROM ca_firms f
LEFT JOIN ca_tb_uploads u ON u.firm_id = f.id
GROUP BY f.id, f.firm_name, f.tenant_id;

COMMENT ON VIEW ca_firm_upload_summary IS 'Dashboard summary: upload counts per CA firm, grouped by status.';
