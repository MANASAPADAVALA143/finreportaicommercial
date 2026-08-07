-- 050_ca_tb_uploads.sql
-- ⚠️  RLS NOTE: Policies use tenant_id = auth.uid().
--     In FinReportAI, "tenant" is a workspace UUID, not the user UUID.
--     If browser clients write directly, align tenant_id with your
--     workspace membership table (e.g. workspace_members.workspace_id).
--     Backend service-role writes bypass RLS and are unaffected.
--
-- TB upload sessions — one row per uploaded Trial Balance file

CREATE TABLE IF NOT EXISTS ca_tb_uploads (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firm_id             UUID NOT NULL REFERENCES ca_firms(id) ON DELETE CASCADE,
    tenant_id           UUID NOT NULL,

    -- Client this TB belongs to (CA firm's client company)
    client_name         VARCHAR(255) NOT NULL,
    client_pan          VARCHAR(10),
    client_gstin        VARCHAR(20),
    cin                 VARCHAR(21),                            -- Company Identification Number

    -- File details
    filename            VARCHAR(500) NOT NULL,
    file_url            TEXT,                                   -- S3/Supabase storage URL
    file_size_bytes     INTEGER,

    -- Period
    period_start        DATE,
    period_end          DATE NOT NULL,
    financial_year      VARCHAR(10),                            -- e.g. "2024-25"

    -- Schedule III config for this upload
    division            VARCHAR(20) NOT NULL CHECK (division IN (
                            'DIV1_NON_IND_AS',
                            'DIV1_IND_AS',
                            'DIV2_NBFC',
                            'DIV3_INSURANCE'
                        )),

    -- Processing status
    status              VARCHAR(30) DEFAULT 'UPLOADED'
                        CHECK (status IN (
                            'UPLOADED',         -- file received
                            'PARSING',          -- TB lines being extracted
                            'PARSED',           -- TB lines extracted, ready for mapping
                            'MAPPING',          -- mapping engine running
                            'REVIEW_PENDING',   -- awaiting CA review & confirm
                            'CONFIRMED',        -- CA confirmed all mappings
                            'GENERATING',       -- Schedule III output being built
                            'COMPLETED',        -- Excel + PDF ready
                            'FAILED'            -- error at any stage
                        )),

    -- Parsing stats
    total_ledgers       INTEGER DEFAULT 0,
    mapped_from_history INTEGER DEFAULT 0,
    mapped_from_coa     INTEGER DEFAULT 0,
    mapped_by_ai        INTEGER DEFAULT 0,
    unclassified        INTEGER DEFAULT 0,

    error_message       TEXT,
    uploaded_by         VARCHAR(255),
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ca_tb_uploads_firm_id ON ca_tb_uploads(firm_id);
CREATE INDEX IF NOT EXISTS idx_ca_tb_uploads_tenant_id ON ca_tb_uploads(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ca_tb_uploads_status ON ca_tb_uploads(status);
CREATE INDEX IF NOT EXISTS idx_ca_tb_uploads_period ON ca_tb_uploads(firm_id, period_end);

CREATE OR REPLACE FUNCTION update_ca_tb_uploads_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ca_tb_uploads_updated_at
    BEFORE UPDATE ON ca_tb_uploads
    FOR EACH ROW EXECUTE FUNCTION update_ca_tb_uploads_updated_at();

ALTER TABLE ca_tb_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY ca_tb_uploads_tenant_isolation ON ca_tb_uploads
    USING (tenant_id = auth.uid())
    WITH CHECK (tenant_id = auth.uid());

COMMENT ON TABLE ca_tb_uploads IS 'One row per TB upload session. Tracks parsing → mapping → review → output pipeline status. client_name is the CA firm''s client company, not the CA firm itself.';
