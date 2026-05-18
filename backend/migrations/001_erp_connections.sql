-- ============================================================
-- 001_erp_connections.sql
-- Run in Supabase SQL editor (one-time)
-- Creates: erp_connections, sync_logs, vendor_patterns
-- ============================================================

-- ERP connection config per client
CREATE TABLE IF NOT EXISTS erp_connections (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    client_id UUID,
    client_name TEXT NOT NULL,
    erp_type TEXT NOT NULL CHECK (erp_type IN ('zoho', 'tally', 'quickbooks', 'oracle', 'xero')),
    api_key TEXT NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,

    -- Zoho-specific fields
    zoho_org_id TEXT,
    zoho_access_token TEXT,
    zoho_refresh_token TEXT,
    zoho_token_expiry TIMESTAMPTZ,

    -- Tally-specific fields
    tally_server_ip TEXT DEFAULT 'localhost',
    tally_port INTEGER DEFAULT 9000,
    tally_company_name TEXT,

    -- Flexible config blob (extra ERP-specific settings)
    config JSONB DEFAULT '{}',

    -- Sync configuration
    sync_invoices BOOLEAN DEFAULT true,
    sync_journal_entries BOOLEAN DEFAULT true,
    sync_hour INTEGER DEFAULT 6,
    days_to_pull INTEGER DEFAULT 30,

    -- Status
    is_active BOOLEAN DEFAULT true,
    last_sync_at TIMESTAMPTZ,
    last_sync_status TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Log every sync run
CREATE TABLE IF NOT EXISTS sync_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    connection_id UUID REFERENCES erp_connections(id) ON DELETE CASCADE,
    erp_type TEXT NOT NULL,
    sync_type TEXT NOT NULL CHECK (sync_type IN ('invoices', 'journal_entries', 'full')),
    records_fetched INTEGER DEFAULT 0,
    records_processed INTEGER DEFAULT 0,
    anomalies_found INTEGER DEFAULT 0,
    invoices_approved INTEGER DEFAULT 0,
    invoices_flagged INTEGER DEFAULT 0,
    status TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
    error_message TEXT,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- Vendor pattern learning (for auto-classification)
CREATE TABLE IF NOT EXISTS vendor_patterns (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    client_id UUID NOT NULL,
    vendor_name TEXT NOT NULL,
    vendor_id TEXT,
    typical_gl_code TEXT,
    typical_ifrs_category TEXT,
    typical_amount_min NUMERIC,
    typical_amount_max NUMERIC,
    invoices_processed INTEGER DEFAULT 0,
    confidence_score NUMERIC DEFAULT 0,
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(client_id, vendor_name)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_erp_connections_client ON erp_connections(client_id);
CREATE INDEX IF NOT EXISTS idx_erp_connections_type   ON erp_connections(erp_type);
CREATE INDEX IF NOT EXISTS idx_sync_logs_connection   ON sync_logs(connection_id);
CREATE INDEX IF NOT EXISTS idx_sync_logs_started      ON sync_logs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_vendor_patterns_client ON vendor_patterns(client_id);
