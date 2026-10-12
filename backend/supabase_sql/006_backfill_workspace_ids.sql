-- One-off backfill for rows created before per-workspace isolation (close runs, audit runs,
-- bookkeeping clients). Run once in the Supabase SQL editor AFTER the API with the isolation
-- change has started (startup adds the workspace_id columns and widens bookkeeping client_id).
--
-- 1. Find your workspace id:   select id, name from workspaces;
-- 2. Paste it into `ws` below and run. Everything happens in one transaction; any error rolls back.

DO $$
DECLARE
  ws text := 'PASTE-WORKSPACE-ID-HERE';
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  bk_tables constant text[] := ARRAY[
    'bookkeeping_client_profiles', 'bookkeeping_transactions', 'client_vendors', 'client_rules',
    'accuracy_metrics', 'bookkeeping_reconciliation_runs', 'reconciliation_signoffs'
  ];
  -- Tables with a unique key on client_id: skip a legacy client if its namespaced row already exists.
  unique_tables constant text[] := ARRAY['bookkeeping_client_profiles', 'client_vendors', 'accuracy_metrics'];
  t text;
  n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM workspaces WHERE id = ws) THEN
    RAISE EXCEPTION 'Workspace "%" not found. Paste an id from: select id, name from workspaces;', ws;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'close_runs' AND column_name = 'workspace_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'audit_runs' AND column_name = 'workspace_id') THEN
    RAISE EXCEPTION 'workspace_id columns are missing. Deploy the API first; it adds them on startup.';
  END IF;

  -- Month-end close: tracker rows already carry their workspace in entity_id.
  UPDATE close_runs c SET workspace_id = c.entity_id
   WHERE c.workspace_id IS NULL AND c.status = 'tracker'
     AND EXISTS (SELECT 1 FROM workspaces w WHERE w.id = c.entity_id);
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'close_runs: % tracker rows tagged with their own workspace', n;

  UPDATE close_runs SET workspace_id = ws WHERE workspace_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'close_runs: % rows assigned to %', n, ws;

  -- Audit runs: going-concern runs record the workspace they assessed.
  UPDATE audit_runs a SET workspace_id = a.full_result->>'workspace_id'
   WHERE a.workspace_id IS NULL
     AND EXISTS (SELECT 1 FROM workspaces w WHERE w.id = a.full_result->>'workspace_id');
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'audit_runs: % going-concern rows tagged with their own workspace', n;

  UPDATE audit_runs SET workspace_id = ws WHERE workspace_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'audit_runs: % rows assigned to %', n, ws;

  -- Bookkeeping: free-text client ids become ws:<workspace>:<label>. UUID client ids (workspace or
  -- company ids) are already access-checked by the API and stay as they are.
  FOREACH t IN ARRAY bk_tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE '%: table not found, skipped', t;
      CONTINUE;
    END IF;
    IF (SELECT character_maximum_length FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = t AND column_name = 'client_id') < 128 THEN
      RAISE EXCEPTION '%.client_id is still VARCHAR(64). Deploy the API first; it widens it on startup.', t;
    END IF;
    EXECUTE format(
      'UPDATE public.%I o SET client_id = $1 || o.client_id
        WHERE o.client_id NOT LIKE ''ws:%%''
          AND o.client_id !~* $2
          AND length(o.client_id) <= 60' ||
      CASE WHEN t = ANY (unique_tables)
           THEN ' AND NOT EXISTS (SELECT 1 FROM public.%I x WHERE x.client_id = $1 || o.client_id)'
           ELSE '' END,
      t, t)
      USING 'ws:' || ws || ':', uuid_re;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE '%: % rows moved under %', t, n, ws;
  END LOOP;
END $$;
