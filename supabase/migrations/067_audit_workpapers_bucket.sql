-- 067_audit_workpapers_bucket.sql
-- Private storage for Internal Audit workpaper evidence.
-- Only the backend (service role) reads or writes this bucket and hands out signed
-- URLs, so no storage.objects policies are created: signed-in browser sessions get
-- no direct access. Objects live under `<workspace_id>/<company_id>/<procedure_id>/…`.
-- Safe to re-run.

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('audit-workpapers', 'audit-workpapers', false, 20971520)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit;
