-- 049_ca_mapping_history.sql
-- ⚠️  RLS NOTE: Policies use tenant_id = auth.uid().
--     In FinReportAI, "tenant" is a workspace UUID, not the user UUID.
--     If browser clients write directly, align tenant_id with your
--     workspace membership table (e.g. workspace_members.workspace_id).
--     Backend service-role writes bypass RLS and are unaffected.
--
-- Mapping history per CA firm — learns from every confirmed mapping
-- Priority 1 in the 3-step mapping engine

CREATE TABLE IF NOT EXISTS ca_mapping_history (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firm_id             UUID NOT NULL REFERENCES ca_firms(id) ON DELETE CASCADE,
    tenant_id           UUID NOT NULL,

    -- Ledger identity
    ledger_name         VARCHAR(500) NOT NULL,                  -- exact Tally ledger name (normalized lowercase for matching)
    ledger_name_raw     VARCHAR(500),                           -- original case as seen in TB

    -- Confirmed Schedule III mapping
    schedule3_head      VARCHAR(255) NOT NULL,                  -- e.g. "Trade Receivables"
    schedule3_note      VARCHAR(50),                            -- e.g. "Note 8"
    schedule3_division  VARCHAR(20) NOT NULL CHECK (schedule3_division IN (
                            'DIV1_NON_IND_AS',
                            'DIV1_IND_AS',
                            'DIV2_NBFC',
                            'DIV3_INSURANCE'
                        )),
    bs_or_pl            VARCHAR(5) CHECK (bs_or_pl IN ('BS', 'PL', 'OCI')),
    major_head          VARCHAR(100),
    minor_head          VARCHAR(100),

    -- Who confirmed and how it was sourced
    confirmed_by        VARCHAR(255),                           -- user email / name
    source              VARCHAR(20) DEFAULT 'CA_CONFIRMED'
                        CHECK (source IN (
                            'CA_CONFIRMED',                     -- CA manually confirmed
                            'CA_OVERRIDE',                      -- CA overrode AI suggestion
                            'AI_AUTO_ACCEPTED',                 -- AI suggested, CA accepted without change
                            'COA_MATCH'                         -- matched from COA master
                        )),
    ai_confidence       NUMERIC(5,2),                          -- AI confidence score 0-100 if AI was involved
    use_count           INTEGER DEFAULT 1,                      -- how many times this mapping has been used
    last_used_at        TIMESTAMPTZ DEFAULT NOW(),

    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),

    -- One confirmed mapping per ledger per division per firm
    UNIQUE (firm_id, ledger_name, schedule3_division)
);

CREATE INDEX IF NOT EXISTS idx_mapping_history_firm_id ON ca_mapping_history(firm_id);
CREATE INDEX IF NOT EXISTS idx_mapping_history_tenant_id ON ca_mapping_history(tenant_id);
CREATE INDEX IF NOT EXISTS idx_mapping_history_ledger ON ca_mapping_history(firm_id, ledger_name);

-- Function to upsert mapping history (increment use_count on re-use)
CREATE OR REPLACE FUNCTION upsert_ca_mapping_history(
    p_firm_id           UUID,
    p_tenant_id         UUID,
    p_ledger_name       VARCHAR,
    p_ledger_name_raw   VARCHAR,
    p_schedule3_head    VARCHAR,
    p_schedule3_note    VARCHAR,
    p_division          VARCHAR,
    p_bs_or_pl          VARCHAR,
    p_major_head        VARCHAR,
    p_minor_head        VARCHAR,
    p_confirmed_by      VARCHAR,
    p_source            VARCHAR,
    p_ai_confidence     NUMERIC
)
RETURNS UUID AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO ca_mapping_history (
        firm_id, tenant_id, ledger_name, ledger_name_raw,
        schedule3_head, schedule3_note, schedule3_division,
        bs_or_pl, major_head, minor_head,
        confirmed_by, source, ai_confidence,
        use_count, last_used_at
    ) VALUES (
        p_firm_id, p_tenant_id, LOWER(TRIM(p_ledger_name)), p_ledger_name_raw,
        p_schedule3_head, p_schedule3_note, p_division,
        p_bs_or_pl, p_major_head, p_minor_head,
        p_confirmed_by, p_source, p_ai_confidence,
        1, NOW()
    )
    ON CONFLICT (firm_id, ledger_name, schedule3_division)
    DO UPDATE SET
        schedule3_head  = EXCLUDED.schedule3_head,
        schedule3_note  = EXCLUDED.schedule3_note,
        bs_or_pl        = EXCLUDED.bs_or_pl,
        major_head      = EXCLUDED.major_head,
        minor_head      = EXCLUDED.minor_head,
        confirmed_by    = EXCLUDED.confirmed_by,
        source          = EXCLUDED.source,
        ai_confidence   = EXCLUDED.ai_confidence,
        use_count       = ca_mapping_history.use_count + 1,
        last_used_at    = NOW(),
        updated_at      = NOW()
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_ca_mapping_history_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ca_mapping_history_updated_at
    BEFORE UPDATE ON ca_mapping_history
    FOR EACH ROW EXECUTE FUNCTION update_ca_mapping_history_updated_at();

ALTER TABLE ca_mapping_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY ca_mapping_history_tenant_isolation ON ca_mapping_history
    USING (tenant_id = auth.uid())
    WITH CHECK (tenant_id = auth.uid());

COMMENT ON TABLE ca_mapping_history IS 'Priority 1 mapping source. Every CA-confirmed mapping is saved here. use_count increments on reuse. ledger_name stored lowercase for fuzzy matching.';
