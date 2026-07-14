# Gnanova AP cron scripts (EC2)

Deploy path: `/home/ubuntu/finreportaicommercial/scripts/`

Replaces n8n for Daily CFO email, duplicate scan, anomaly scan, and vendor WhatsApp.
All scripts load secrets from `backend/.env`, log under `/var/log/gnanova/`, support `--test`, and alert `ADMIN_EMAIL` on fatal failure.

## Scripts

| # | File | Cron (UTC) | Purpose |
|---|------|------------|---------|
| 1 | `cfo_email_uae.py` | `0 4 * * *` | Daily CFO briefing (AED / UAE) → 08:00 Dubai |
| 2 | `cfo_email_india.py` | `30 2 * * *` | Daily CFO briefing (INR / India) → 08:00 IST |
| 3 | `duplicate_scan.py` | `0 3 * * 5` | Weekly 90-day duplicate flag + CFO email |
| 4 | `vendor_whatsapp.py` | *(API)* | Twilio WhatsApp on Approved/Paid |
| 5 | `anomaly_scan.py` | `0 5 * * 1` | Weekly anomaly flags + CFO email |
| 6 | `setup_crons.sh` | once | Install crons + log dir + logrotate |

Shared helpers: `_gnanova_cron_common.py`  
Logrotate sample: `logrotate-gnanova.conf`

## CFO email resolution

1. `company_settings.cfo_email`
2. `companies.admin_email`
3. `CFO_EMAIL_BY_COMPANY` JSON env map
4. `CFO_EMAIL` fallback (local / ops override)

## Docker (finreportai-backend)

Scripts ship inside the image at `/app/scripts/` (build context = repo root).

```bash
# From repo root on EC2
cd /home/ubuntu/finreportaicommercial
git pull
cd backend && docker compose build --no-cache backend && docker compose up -d

# Smoke test inside container (uses image venv — has supabase/httpx)
docker exec -e CFO_EMAIL=you@gmail.com finreportai-backend \
  python3 /app/scripts/cfo_email_uae.py --test --send \
  --company-id 0deaa402-f6a1-4c38-90e8-711f4fd0aa09
```

Crons on the host should call `docker exec … python3 /app/scripts/…` **or** run
`setup_crons.sh` after pointing `PYTHON` / paths at docker exec wrappers.


## Manual smoke tests

```bash
cd /home/ubuntu/finreportaicommercial

# Script 1 — dry run
python3 scripts/cfo_email_uae.py --test --company-id 0deaa402-f6a1-4c38-90e8-711f4fd0aa09

# Script 1 — send once
CFO_EMAIL=you@gmail.com python3 scripts/cfo_email_uae.py --test --send --company-id 0deaa402-f6a1-4c38-90e8-711f4fd0aa09

# Script 2 — India (force company even if market=uae)
CFO_EMAIL=you@gmail.com python3 scripts/cfo_email_india.py --test --send --company-id 0deaa402-f6a1-4c38-90e8-711f4fd0aa09

# Script 3 — read-only
python3 scripts/duplicate_scan.py --test --no-write --company-id 0deaa402-f6a1-4c38-90e8-711f4fd0aa09

# Script 4 — WhatsApp dry run
python3 scripts/vendor_whatsapp.py --test --invoice-id <uuid> --status Approved

# Script 5 — read-only
python3 scripts/anomaly_scan.py --test --no-write --company-id 0deaa402-f6a1-4c38-90e8-711f4fd0aa09
```

## Vendor WhatsApp (FastAPI)

```
POST /api/ap/vendor-whatsapp
{ "invoice_id": "...", "status": "Approved" }

POST /api/ap/vendor-whatsapp-notify
{ "to": "+971...", "status": "Paid", "vendor_name": "...", "invoice_number": "...",
  "amount": 1000, "currency": "AED", "due_date": "2026-07-30" }
```

Env: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`

Frontend uses `VITE_API_URL/api/ap/vendor-whatsapp-notify` when set (override with `VITE_VENDOR_WHATSAPP_WEBHOOK_URL`).

## Required env (backend/.env)

- Supabase: via existing FastAPI `app.core.supabase`
- Email: `RESEND_API_KEY` **or** `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS`
- `FROM_EMAIL` / `SMTP_FROM`
- `ADMIN_EMAIL` (failure alerts)
- Optional: `CFO_EMAIL`, `CFO_EMAIL_BY_COMPANY`
- Twilio (Script 4): `TWILIO_*`
