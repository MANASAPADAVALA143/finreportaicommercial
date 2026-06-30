# AP InvoiceFlow → FinReportAI Consolidation

AP invoice pages already live in `frontend/src/pages/ap-invoices/` (copied from [apinvoice](https://github.com/MANASAPADAVALA143/apinvoice.git)).

This guide completes the move to **one Supabase project**: `ftlycgfgbboxapxhlpad` (finreportaicommercial).

## 1. Run database schema (required once)

1. Open [Supabase dashboard](https://supabase.com/dashboard) → project **finreportaicommercial** (`ftlycgfgbboxapxhlpad`)
2. SQL Editor → New query
3. **Start with** `supabase/migrations/ap_invoice_bootstrap.sql` (small, ~150 lines — always works)
4. For **Purchase Orders / GRN / Excel import**, also run **`supabase/migrations/020_ap_po_grn_tables.sql`**
5. If the upload page logs `company_settings` / `app_settings` / `company_members` schema errors, also run **`supabase/migrations/017_ap_missing_core_tables.sql`**
6. Optionally run `ap_invoice_full_schema.sql` later for approvals, GST recon, etc.

**CLI alternative** (requires database password in `backend/.env`):

```env
SUPABASE_DB_URL=postgresql://postgres.[ref]:[password]@...pooler.supabase.com:5432/postgres
```

```bash
cd backend && python scripts/bootstrap_ap_supabase.py
# or POST http://localhost:8001/api/ap/bootstrap-supabase-tables
```

Do **not** run this in the old InvoiceFlow project (`xuaaqonmaarldzklocax`).

## 2. Configure frontend `.env`

```env
VITE_API_URL=http://localhost:8001
VITE_SUPABASE_URL=https://ftlycgfgbboxapxhlpad.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key from Settings → API>
```

Restart: `cd frontend && npm run dev`

## 3. Backend (already configured)

`backend/.env` should have:

```env
SUPABASE_URL=https://ftlycgfgbboxapxhlpad.supabase.co
SUPABASE_KEY=<service_role key>
```

## 4. What changed in code

| Before | After |
|--------|-------|
| Supabase `xuaaqonmaarldzklocax` | `ftlycgfgbboxapxhlpad` |
| Railway `apinvoice-production` | FinReportAI backend `:8001` |
| External InvoiceFlow links | Internal `/ap-invoices/*` routes |

## 5. GulfTax + UAE GL

- Classification: `POST /api/uae/ap/classify-invoice` (embedded GulfTax)
- Approve + journal entry: `POST /api/uae/ap/approve-and-post`

## 6. Verify

1. Upload Excel on `/ap-invoices/upload` → rows appear in `/ap-invoices/list`
2. Console shows no `xuaaqonmaarldzklocax` or `placeholder.supabase.co` errors
3. Data visible in Supabase Table Editor → `invoices` on **ftlycgfgbboxapxhlpad**
