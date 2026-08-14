-- 058_company_drive_folder_url.sql
-- Optional Google Drive folder link per company/client. When set, exported
-- Excel files are auto-uploaded there in addition to the normal download.
-- Safe to re-run.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS drive_folder_url text;

COMMENT ON COLUMN public.companies.drive_folder_url IS
  'Optional Google Drive folder URL/ID. When set, AP invoice Excel exports are auto-uploaded there.';

NOTIFY pgrst, 'reload schema';
