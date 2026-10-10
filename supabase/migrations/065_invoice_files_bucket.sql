-- 065_invoice_files_bucket.sql
-- Private storage for original invoice files and payment proofs.
-- Objects live under `<company_id>/…`; only members of that company (or super
-- admins) can read, upload, replace or delete them. The app stores the object
-- path in invoices.file_url / payment_proof_url and opens it via signed URLs.
-- Safe to re-run.

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('invoice-files', 'invoice-files', false, 26214400)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit;

CREATE OR REPLACE FUNCTION public.can_access_invoice_file(object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_super_admin()
    OR split_part(object_name, '/', 1) = COALESCE(public.get_effective_company_id()::text, '')
    OR split_part(object_name, '/', 1) IN (
      SELECT c::text FROM public.user_visible_company_ids() AS c
    );
$$;

GRANT EXECUTE ON FUNCTION public.can_access_invoice_file(text) TO authenticated;

DROP POLICY IF EXISTS invoice_files_select ON storage.objects;
CREATE POLICY invoice_files_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'invoice-files' AND public.can_access_invoice_file(name));

DROP POLICY IF EXISTS invoice_files_insert ON storage.objects;
CREATE POLICY invoice_files_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'invoice-files' AND public.can_access_invoice_file(name));

DROP POLICY IF EXISTS invoice_files_update ON storage.objects;
CREATE POLICY invoice_files_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'invoice-files' AND public.can_access_invoice_file(name))
  WITH CHECK (bucket_id = 'invoice-files' AND public.can_access_invoice_file(name));

DROP POLICY IF EXISTS invoice_files_delete ON storage.objects;
CREATE POLICY invoice_files_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'invoice-files' AND public.can_access_invoice_file(name));
