# Multi-Tenant Workspace Architecture — Deployment Guide

## Overview

Each **Workspace** represents one UAE legal entity (client company). All accounting data is isolated by `workspace_id`, which maps to `tenant_id` on UAE accounting tables.

## Folder Structure

```
backend/
  app/
    models/
      workspace.py          # workspaces, workspace_members, workspace_vat_settings
      uae_ap.py             # uae_vendors, uae_purchase_invoices
    middleware/
      workspace.py          # validate_workspace() dependency
    routers/
      workspaces.py         # /api/workspaces/*
    services/
      workspace_service.py  # CRUD, dashboard KPIs, ABC Trading seed
  alembic/versions/
    012_workspaces.py       # Migration

frontend/
  src/
    context/
      WorkspaceContext.tsx  # Active workspace state
    components/
      WorkspaceSelector.tsx # Top-nav dropdown
    services/
      workspaceService.ts   # API client
    pages/workspaces/
      WorkspaceList.tsx
      WorkspaceCreate.tsx
      WorkspaceDashboard.tsx
      WorkspaceSettings.tsx
      WorkspaceUsers.tsx
```

## Database Schema

### `workspaces`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Also used as `tenant_id` |
| name | string | Display name |
| legal_entity_name | string | Registered name |
| trn_number | string | UAE TRN |
| country | string | Default UAE |
| currency | string | Default AED |
| fiscal_year_start_month | int | 1-12 |
| fiscal_year_end_month | int | 1-12 |
| industry | string | Optional |

### Scoped tables (via `tenant_id` = workspace.id)
- `uae_accounts`, `uae_journal_entries`, `uae_customers`, `uae_sales_invoices`
- `uae_bank_accounts`, `uae_fixed_assets`, `uae_accruals`
- `uae_vendors`, `uae_purchase_invoices` (also have `workspace_id`)

## Step-by-Step Deployment

### 1. Backend

```bash
cd backend
pip install -r requirements.txt

# SQLite (dev) — tables auto-created on startup via init_db()
uvicorn app.main:app --reload --port 8001

# PostgreSQL (production)
export DATABASE_URL=postgresql://user:pass@host:5432/finreportai
alembic upgrade head
uvicorn app.main:app --host 0.0.0.0 --port 8001
```

### 2. Frontend

```bash
cd frontend
npm install
# .env
# VITE_API_URL=http://localhost:8001
npm run dev
```

### 3. Login & Seed

1. Login: `admin@gnanova.com` / `Admin@123`
2. ABC Trading LLC is auto-seeded on first startup
3. Or manually: POST `/api/workspaces/seed/abc-trading` (CFO/super_admin)

### 4. Create a Workspace

1. Top nav → workspace dropdown → **Create workspace**
2. Or visit `/workspaces/create`
3. On create: UAE CoA (62 accounts) + VAT settings auto-generated

### 5. Switch Workspace

1. Top nav dropdown → select company
2. Page reloads; all modules use new `X-Workspace-ID` header
3. No cross-company data leakage

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces` | List user's workspaces |
| POST | `/api/workspaces` | Create workspace |
| GET | `/api/workspaces/{id}` | Get workspace |
| PATCH | `/api/workspaces/{id}` | Update settings |
| DELETE | `/api/workspaces/{id}` | Deactivate |
| GET | `/api/workspaces/{id}/dashboard` | KPI dashboard |
| GET | `/api/workspaces/{id}/users` | List members |
| POST | `/api/workspaces/{id}/users` | Add member |
| POST | `/api/workspaces/seed/abc-trading` | Seed demo data |

**Required headers on all accounting API calls:**
```
Authorization: Bearer <jwt>
X-Workspace-ID: <workspace-uuid>
```

## RBAC — Workspace Roles

| Role | Permissions |
|------|-------------|
| owner | Full access, delete workspace |
| finance_manager | Edit settings, manage users |
| accountant | Create/edit accounting records |
| auditor | Read-only + audit trail |
| viewer | Read-only dashboard |

## AP Integration Flow

```
Workspace (X-Workspace-ID)
  → AP Invoice Upload (Supabase AP module)
  → GulfTax /api/uae/ap/classify-invoice
  → Approval /api/uae/ap/approve-and-post
  → uae_purchase_invoices (workspace_id saved)
  → Journal Entry stub
```

## Acceptance Criteria Checklist

- [x] User creates workspace → CoA + VAT settings auto-generated
- [x] AP invoice upload saves `workspace_id`
- [x] Workspace switcher in top navigation
- [x] Dashboard shows workspace-scoped KPIs
- [x] `validate_workspace()` middleware on workspace routes
- [x] ABC Trading LLC seed: 20 vendors, 10 customers, 50 AP, 25 AR, 200 JEs, 20 FA, 100 bank txs
