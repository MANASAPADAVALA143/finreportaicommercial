-- 048_ca_coa_master.sql
-- ⚠️  RLS NOTE: Policies use tenant_id = auth.uid().
--     In FinReportAI, "tenant" is a workspace UUID, not the user UUID.
--     If browser clients write directly, align tenant_id with your
--     workspace membership table (e.g. workspace_members.workspace_id).
--     Backend service-role writes bypass RLS and are unaffected.
--
-- Chart of Accounts master per CA firm
-- CA uploads their standard COA once; used as 2nd priority in mapping engine

CREATE TABLE IF NOT EXISTS ca_coa_master (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firm_id             UUID NOT NULL REFERENCES ca_firms(id) ON DELETE CASCADE,
    tenant_id           UUID NOT NULL,                          -- denormalized for RLS

    -- Tally ledger fields
    ledger_name         VARCHAR(500) NOT NULL,                  -- exact Tally ledger name
    ledger_group        VARCHAR(255),                           -- Tally group (e.g. "Sundry Debtors")
    ledger_alias        VARCHAR(500),                           -- alternate names / aliases
    nature              VARCHAR(10) CHECK (nature IN ('Dr', 'Cr', 'Both')),

    -- Pre-mapped Schedule III head (CA's standard mapping for this ledger)
    schedule3_head      VARCHAR(255),                           -- e.g. "Trade Receivables"
    schedule3_note      VARCHAR(50),                            -- e.g. "Note 8"
    schedule3_division  VARCHAR(20) CHECK (schedule3_division IN (
                            'DIV1_NON_IND_AS',
                            'DIV1_IND_AS',
                            'DIV2_NBFC',
                            'DIV3_INSURANCE',
                            'ALL'                               -- applies to all divisions
                        )),
    bs_or_pl            VARCHAR(5) CHECK (bs_or_pl IN ('BS', 'PL', 'OCI')),
    major_head          VARCHAR(100),                           -- e.g. "Non-Current Assets"
    minor_head          VARCHAR(100),                           -- e.g. "Property, Plant & Equipment"

    -- Source
    source              VARCHAR(20) DEFAULT 'MANUAL'
                        CHECK (source IN ('MANUAL', 'EXCEL_UPLOAD', 'TALLY_XML', 'AI_SUGGESTED')),

    is_active           BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (firm_id, ledger_name)                               -- one mapping per ledger per firm
);

CREATE INDEX IF NOT EXISTS idx_ca_coa_firm_id ON ca_coa_master(firm_id);
CREATE INDEX IF NOT EXISTS idx_ca_coa_tenant_id ON ca_coa_master(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ca_coa_ledger_name ON ca_coa_master(ledger_name);

CREATE OR REPLACE FUNCTION update_ca_coa_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ca_coa_updated_at ON ca_coa_master;
CREATE TRIGGER trg_ca_coa_updated_at
    BEFORE UPDATE ON ca_coa_master
    FOR EACH ROW EXECUTE FUNCTION update_ca_coa_updated_at();

ALTER TABLE ca_coa_master ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ca_coa_tenant_isolation ON ca_coa_master;
CREATE POLICY ca_coa_tenant_isolation ON ca_coa_master
    USING (tenant_id = auth.uid())
    WITH CHECK (tenant_id = auth.uid());

COMMENT ON TABLE ca_coa_master IS 'Per-firm Chart of Accounts with pre-mapped Schedule III heads. Uploaded once by CA, used as 2nd priority in mapping engine (after history, before AI).';
