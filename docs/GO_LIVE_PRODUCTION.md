# Go Live — AWS EC2 (API) + Vercel (UI)

> **Current stack:** Vercel frontend + **AWS EC2** backend + **AWS RDS** database.  
> Full EC2 guide: [`deploy/ec2/README.md`](../deploy/ec2/README.md)  
> Railway steps below are **deprecated** — kept for reference only.

FinReportAI is a monorepo: **backend** on EC2, **frontend** on Vercel, **auth** on Supabase, **data** on AWS RDS.

---

## Pre-flight (done locally)

- [x] Migration `026_vat_advanced.sql` applied in Supabase
- [x] `npm run build` passes in `frontend/`
- [x] Backend imports (`from app.main import app`) succeed
- [x] Test users: `test_uae@gnanova.pro`, `test_india@gnanova.pro`, `test_full@gnanova.pro` / `Test@123456`

---

## 1. Railway — FastAPI backend

### Create / configure service

1. [Railway Dashboard](https://railway.app) → **New Project** → **Deploy from GitHub** → select this repo.
2. **Settings → Root Directory** → `backend` (critical — Dockerfile lives here).
3. **Settings → Build** → Dockerfile (`backend/railway.toml` pins this).
4. **Settings → Deploy** → Health check path: `/health`.

### Environment variables (Railway → Variables)

| Variable | Value |
|----------|--------|
| `DEBUG` | `False` |
| `SECRET_KEY` | Random 32+ char string |
| `ANTHROPIC_API_KEY` | `sk-ant-...` |
| `SUPABASE_URL` | `https://ftlycgfgbboxapxhlpad.supabase.co` |
| `SUPABASE_KEY` | Service role key (not anon) |
| `DATABASE_URL` | Railway Postgres plugin URI, or keep SQLite for demo-only |
| `FRONTEND_URL` | Your Vercel URL after step 2 (e.g. `https://finreportai.vercel.app`) |

Optional: `SUPABASE_DB_URL` for bootstrap scripts; `ENABLE_CFO_SCHEDULER=False` on free tier.

### Verify

```text
GET https://YOUR-SERVICE.up.railway.app/health
→ {"status":"ok", ...}

GET https://YOUR-SERVICE.up.railway.app/docs
→ Swagger UI loads
```

Copy the public Railway URL — you need it for Vercel.

---

## 2. Vercel — React frontend

### Create / configure project

1. [Vercel Dashboard](https://vercel.com) → **Add New Project** → import GitHub repo.
2. **Root Directory** → leave as repo root (uses root `vercel.json`).
3. Framework: Vite (auto-detected).

### Environment variables (Vercel → Settings → Environment Variables)

Apply to **Production** and **Preview**:

| Variable | Value |
|----------|--------|
| `VITE_API_URL` | `https://YOUR-SERVICE.up.railway.app` (no trailing slash) |
| `VITE_SUPABASE_URL` | `https://ftlycgfgbboxapxhlpad.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key (Dashboard → API) |

See `frontend/.env.production.example`.

### Deploy

- Push to `main` → Vercel auto-deploys, **or**
- Local: `vercel --prod` from repo root (Vercel CLI installed).

### Verify

1. Open Vercel URL → `/login`
2. Log in as `test_full@gnanova.pro` / `Test@123456`
3. GulfTax → VAT Advanced → save a Partial Exemption row
4. AP Invoices → Settings loads (CurrencyCombobox)

---

## 3. Wire backend ↔ frontend

After first Vercel deploy, set on **Railway**:

```env
FRONTEND_URL=https://your-project.vercel.app
```

Redeploy Railway. CORS already allows `*.vercel.app` via regex; `FRONTEND_URL` adds your custom domain if you use one.

---

## 4. Supabase auth redirect URLs

Supabase → **Authentication → URL Configuration**:

- **Site URL**: `https://your-project.vercel.app`
- **Redirect URLs**: add `https://your-project.vercel.app/**` and `http://localhost:3006/**`

---

## 5. Demo links (next week)

Send each prospect:

```text
https://your-project.vercel.app/login
Email: test_uae@gnanova.pro
Password: Test@123456
→ lands on GulfTax (UAE client role)
```

| Contact | Role account | Landing |
|---------|--------------|---------|
| AbuBakr, Bilal, Mohammed Noor | `test_uae@gnanova.pro` | `/gulftax` |
| India prospects | `test_india@gnanova.pro` | `/dashboard` |
| Full demo | `test_full@gnanova.pro` | everything |

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Blank page after login | Set `VITE_API_URL` on Vercel; redeploy |
| CORS error in browser console | Set `FRONTEND_URL` on Railway; confirm `*.vercel.app` regex |
| VAT Advanced Save fails | Re-run `026_vat_advanced.sql` in Supabase SQL Editor |
| Railway build fails | Root Directory must be `backend`, not repo root |
| Health check timeout | First boot can take 2–3 min; `healthcheckTimeout` is 600s in `railway.toml` |

---

## CLI quick reference

```bash
# Vercel (from repo root)
vercel --prod

# Railway (install: npm i -g @railway/cli)
cd backend && railway login && railway up
```
