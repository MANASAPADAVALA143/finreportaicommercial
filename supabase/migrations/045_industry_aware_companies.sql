-- Industry-aware workspace: companies.industry + industry_label
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS industry TEXT DEFAULT 'general';

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS industry_label TEXT DEFAULT 'Cost Center';

UPDATE public.companies
SET industry = 'general'
WHERE industry IS NULL OR industry = '';

NOTIFY pgrst, 'reload schema';
