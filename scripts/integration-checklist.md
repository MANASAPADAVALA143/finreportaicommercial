# Integration points — DO NOT overwrite on sync

These files have CFO-specific additions that must be preserved when syncing from standalone repos.

## MyApprovals.tsx

- Added: `useCompany()` import
- Added: GL posting call after full approval via `POST /api/uae/ap/approve-and-post`
- Added: `je_reference` badge / toast on successful GL post
- **PRESERVE** these additions after any sync

## InvoiceUpload.tsx

- Added: VAT classify call after OCR extraction (`POST /api/uae/ap/classify-invoice`)
- Added: VAT treatment badge on extracted invoice preview modal
- **PRESERVE** these additions after any sync

## VATReturn.tsx (gulftax)

- Added: "Auto-fill from AP" button
- Added: `fetchVatReturnBoxes()` population of return boxes
- **PRESERVE** these additions after any sync

## CompanyContext integration

- AP pages read `company_id` from `useCompany().activeCompanyId`
- GulfTax API reads workspace + company from localStorage / CompanyContext
- `CompanyContext.setActiveCompany` also sets `gulftax_company_id`
- **PRESERVE** these on sync

## Backend (CFO-only)

- `backend/app/api/routes/uae_accounting.py` — `approve-and-post` writes to `uae_journal_entries` with `source=AP_INVOICE`
- Supabase `invoices.je_posted` / `invoices.je_reference` columns (commercial project)
- `backend/app/main.py` — calls `register_gulftax_ported_routers(app)` (do not remove)
- `frontend/src/lib/ap-invoice/glPostService.ts`, `gulfTaxService.ts`, `workspaceCompanySync.ts` — never overwrite from apinvoice

## Re-sync from standalone

```bash
git fetch apinvoice uaetax
python scripts/sync-standalone-repos.py
```
