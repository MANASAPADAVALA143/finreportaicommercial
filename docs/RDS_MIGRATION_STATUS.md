# AWS RDS consolidation — status

## Architecture target

| Layer | Store | Notes |
|-------|--------|--------|
| Auth | Supabase only | sign_in, sign_up, session, sign_out |
| All client data | AWS RDS | `DATABASE_URL` → `estatecfo.c3ma0ssuch0u.us-west-1.rds.amazonaws.com` |
| GulfTax ported SQLite | **Removed** | `gulftax.db` fallback deleted from `ported_mount.py` |

## Completed in this pass

- [x] `app/models/client_data.py` — RDS models with `tenant_id` + `company_id` on all client tables
- [x] `app/core/tenant.py` — `get_tenant_id()`, `get_company_id()`, `assert_write_allowed()`
- [x] `GET/POST /api/ap/invoices` — tenant-isolated invoice API
- [x] `GET/POST /api/gulftax/vat-advanced/*` — VAT Advanced on RDS (replaces Supabase PostgREST)
- [x] `frontend/src/services/vatAdvanced.service.ts` — calls FastAPI, Supabase auth only
- [x] `gulftax.db` SQLite fallback removed — requires `DATABASE_URL`
- [x] `slowapi` rate limit 100 req/min + request logging middleware
- [x] `ENVIRONMENT` + `DEMO_TENANT_ID` config
- [x] `scripts/audit_data_stores.py` — Supabase vs RDS table audit
- [x] `scripts/create_client.py` — onboarding (tenant + workspace + Supabase user)
- [x] `scripts/verify_tenant_isolation.py` — 6-check verification harness
- [x] Alembic `015_client_data_rds` — `tenants` table + `rbac_users.tenant_id`

## Your action items

### 1. Point backend to AWS RDS

In `backend/.env`:

```env
DATABASE_URL=postgresql://USER:PASSWORD@estatecfo.c3ma0ssuch0u.us-west-1.rds.amazonaws.com:5432/DATABASE
ENVIRONMENT=production
DEBUG=False
```

Then:

```bash
cd backend
alembic upgrade head
# Tables also created on startup via init_db()
```

### 2. Run audit

```bash
python backend/scripts/audit_data_stores.py
```

Creates a gap list of tables still only in Supabase.

### 3. Run isolation verification

```bash
python backend/scripts/create_client.py --name "Client A" --email test_client_a@gnanova.pro --role uae_client
python backend/scripts/create_client.py --name "Client B" --email test_client_b@gnanova.pro --role uae_client
python backend/scripts/verify_tenant_isolation.py
```

All 6 checks must pass before real client access.

### 4. AWS console (manual)

- RDS → Storage encrypted: verify ON
- RDS → Automated backups: 7+ days retention

## Still to migrate (next phases)

These still read/write **Supabase** for data — need backend APIs + frontend lib updates:

- AP InvoiceFlow (`frontend/src/lib/ap-invoice/*.ts`) — ~25 files
- `gulftax_supabase.py`, `gulftax_sync_service.py`, `ap_company_sync.py`
- GulfTax ported module (`companies` integer-PK tables) — rename or namespace before sharing RDS with AP `invoices` UUID table

**Do not delete Supabase data** until RDS migration is verified and dual-write period completes.

## Demo environment

Set `ENVIRONMENT=demo` in backend `.env`. Writes return 403 except demo seed cron (TODO: `scripts/reset_demo_tenant.py`).

Frontend demo banner: call `GET /api/system/environment` → show banner when `is_demo: true`.
