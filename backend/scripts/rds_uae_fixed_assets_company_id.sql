-- rds_uae_fixed_assets_company_id.sql
-- Target: AWS RDS used by api.finreportai.com (NOT Supabase).
-- Fixes: GET /api/uae/full/dashboard → column "company_id" does not exist on uae_fixed_assets.
--
-- PART 1 ONLY (safe): ADD COLUMN + INDEX. No blind workspace→company backfill.
-- Multi-company workspaces (e.g. b5e18ef9-...) must not get DISTINCT ON misattribution.
-- Safe to re-run.

BEGIN;

ALTER TABLE uae_fixed_assets
  ADD COLUMN IF NOT EXISTS company_id VARCHAR(36);

CREATE INDEX IF NOT EXISTS ix_uae_fixed_assets_company_id
  ON uae_fixed_assets (company_id);

-- Verify column exists
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'uae_fixed_assets'
  AND column_name = 'company_id';

COMMIT;

-- =============================================================================
-- PART 2 — DIAGNOSTIC ONLY (do not run as a mass UPDATE until you review counts)
-- Can gl_account_id → uae_accounts.company_id disambiguate per row?
-- =============================================================================
/*
SELECT
  count(*) AS total_assets,
  count(*) FILTER (
    WHERE fa.gl_account_id IS NOT NULL
      AND a.company_id IS NOT NULL
  ) AS resolvable_via_gl_account,
  count(*) FILTER (
    WHERE fa.gl_account_id IS NULL
       OR a.id IS NULL
       OR a.company_id IS NULL
  ) AS ambiguous_leave_null,
  count(*) FILTER (
    WHERE fa.tenant_id = 'b5e18ef9-e81b-4312-b895-20eef28a3bb3'
  ) AS assets_in_multi_company_workspace
FROM uae_fixed_assets fa
LEFT JOIN uae_accounts a ON a.id = fa.gl_account_id;

-- Optional safe per-row backfill ONLY where the GL join is unambiguous:
-- UPDATE uae_fixed_assets fa
-- SET company_id = a.company_id
-- FROM uae_accounts a
-- WHERE fa.company_id IS NULL
--   AND fa.gl_account_id = a.id
--   AND a.company_id IS NOT NULL;
*/
