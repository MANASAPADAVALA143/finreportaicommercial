-- 047_ca_firms.sql
-- ⚠️  RLS NOTE: Policies use tenant_id = auth.uid().
--     In FinReportAI, "tenant" is a workspace UUID, not the user UUID.
--     If browser clients write directly, align tenant_id with your
--     workspace membership table (e.g. workspace_members.workspace_id).
--     Backend service-role writes bypass RLS and are unaffected.
--
-- Multi-tenant CA firm registry
-- Each CA firm is an independent tenant with their own COA, mapping history, and clients

CREATE TABLE IF NOT EXISTS ca_firms (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL,                          -- links to existing Supabase auth tenant
    firm_name           VARCHAR(255) NOT NULL,
    firm_code           VARCHAR(50) UNIQUE,                     -- short code e.g. "RKSCO", "PKASC"
    gstin               VARCHAR(20),
    pan                 VARCHAR(10),
    icai_registration   VARCHAR(30),                            -- ICAI membership/firm reg number
    address             TEXT,
    city                VARCHAR(100),
    state               VARCHAR(100),
    email               VARCHAR(255),
    phone               VARCHAR(20),
    preferred_division  VARCHAR(20) DEFAULT 'DIV1_NON_IND_AS'  -- default Schedule III division
                        CHECK (preferred_division IN (
                            'DIV1_NON_IND_AS',
                            'DIV1_IND_AS',
                            'DIV2_NBFC',
                            'DIV3_INSURANCE'
                        )),
    is_active           BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Index for tenant lookups
CREATE INDEX IF NOT EXISTS idx_ca_firms_tenant_id ON ca_firms(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ca_firms_firm_code ON ca_firms(firm_code);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_ca_firms_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ca_firms_updated_at
    BEFORE UPDATE ON ca_firms
    FOR EACH ROW EXECUTE FUNCTION update_ca_firms_updated_at();

-- RLS: each tenant sees only their own firms
ALTER TABLE ca_firms ENABLE ROW LEVEL SECURITY;

CREATE POLICY ca_firms_tenant_isolation ON ca_firms
    USING (tenant_id = auth.uid())
    WITH CHECK (tenant_id = auth.uid());

COMMENT ON TABLE ca_firms IS 'Multi-tenant CA firm registry. One row per CA firm. tenant_id links to Supabase auth.users.';
