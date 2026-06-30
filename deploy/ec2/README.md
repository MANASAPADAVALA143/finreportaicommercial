# AWS EC2 + RDS + Vercel — Gnanova production stack

```
Vercel   → Frontend (free)
EC2      → FastAPI backend (~$8/mo t3.micro)
RDS      → PostgreSQL (estatecfo — already provisioned)
S3       → File uploads
Supabase → Auth only (no client data)
```

**No Railway. No Render.**

---

## Before you launch EC2 — RDS password

Your `backend/.env` in this repo does **not** contain `DATABASE_URL` or the RDS password.

### If you remember it
Use it in `deploy/ec2/env.production.example` → copy to EC2 as `backend/.env`.

### If you forgot it
1. AWS Console → **RDS** → `estatecfo` instance
2. **Modify** → change master password → apply immediately
3. Update `estatecfo_master` password everywhere (EC2 `.env`, any local `.env`)

### RDS must accept connections from EC2
1. RDS → your instance → **VPC security group** (inbound)
2. Add rule: **PostgreSQL 5432** from the **EC2 instance security group** (not `0.0.0.0/0` in production)

Test from EC2:
```bash
psql "postgresql://estatecfo_master:PASSWORD@estatecfo.c3ma0ssuch0u.us-west-1.rds.amazonaws.com:5432/postgres" -c "SELECT 1"
```

Create app database (once):
```bash
psql -h estatecfo.c3ma0ssuch0u.us-west-1.rds.amazonaws.com -U estatecfo_master -d postgres \
  -c "CREATE DATABASE finreportai;"
```

---

## Step 1 — Launch EC2

| Setting | Value |
|---------|--------|
| Name | `gnanova-backend` |
| AMI | Ubuntu 22.04 LTS |
| Type | `t3.micro` |
| Key pair | `gnanova-key.pem` (download and store safely) |
| Inbound | SSH 22, HTTP 80, HTTPS 443 from your IP / `0.0.0.0/0` for demo |
| Storage | 20 GB |

**Note:** Port 8000 does not need to be public — Nginx proxies on 80. Bind gunicorn to `127.0.0.1:8000` only (see `finreportai.service`).

---

## Step 2 — SSH from Windows

```powershell
cd C:\path\to\where\gnanova-key.pem
ssh -i gnanova-key.pem ubuntu@YOUR_EC2_PUBLIC_IP
```

---

## Docker deploy (recommended — no pip errors on EC2)

Build on a machine with Docker Desktop running (or on EC2 with enough RAM for first build):

```bash
cd backend
docker compose build
docker compose up -d
curl http://localhost:8000/health
```

Uses `backend/Dockerfile` (Python 3.11-slim) + `backend/docker-compose.yml` + `backend/.env`.

On EC2 after `git pull`:
```bash
cd finreportaicommercial/backend
docker compose pull   # if using registry
docker compose build
docker compose up -d
```

---

## Manual venv deploy (alternative)

```bash
# On EC2
git clone https://github.com/MANASAPADAVALA143/finreportaicommercial.git
cp finreportaicommercial/deploy/ec2/env.production.example finreportaicommercial/backend/.env
nano finreportaicommercial/backend/.env   # fill RDS password, keys

bash finreportaicommercial/deploy/ec2/setup-ec2.sh
```

Or follow manual steps in the repo root conversation / your checklist.

---

## Step 4 — Verify

```bash
curl http://YOUR_EC2_PUBLIC_IP/health
curl http://YOUR_EC2_PUBLIC_IP/docs
sudo systemctl status finreportai
sudo journalctl -u finreportai -f
```

---

## Step 5 — Vercel frontend

Project → Environment Variables:

| Variable | Value |
|----------|--------|
| `VITE_API_URL` | `http://YOUR_EC2_PUBLIC_IP` (later `https://api.gnanova.pro`) |
| `VITE_SUPABASE_URL` | `https://ftlycgfgbboxapxhlpad.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key |

Redeploy Vercel. Set on EC2 `.env`:

```
FRONTEND_URL=https://your-project.vercel.app
```

Restart: `sudo systemctl restart finreportai`

---

## HTTPS (recommended before UAE clients)

```bash
sudo apt install certbot python3-certbot-nginx -y
# Point api.gnanova.pro A record → EC2 public IP first
sudo certbot --nginx -d api.gnanova.pro
```

Then `VITE_API_URL=https://api.gnanova.pro`

---

## Three backends on one EC2

| Project | Port | Nginx `server_name` |
|---------|------|---------------------|
| FinReportAI / Gnanova | 8000 | `api.gnanova.pro` |
| EstateCFO | 8001 | `estatecfo.gnanova.pro` |
| ifrs.ai | 8002 | `ifrs.gnanova.pro` |

Clone each repo, duplicate systemd unit with different `WorkingDirectory` and `--bind 127.0.0.1:PORT`.

---

## Important `.env` corrections

| Variable | Use |
|----------|-----|
| `SUPABASE_KEY` | **Service role** key on backend (not anon) |
| `DATABASE_URL` | `postgresql://user:pass@host:5432/finreportai` |
| `SECRET_KEY` | Random 32+ chars — not a guessable string |

---

## After deploy — tenant isolation

```bash
python backend/scripts/create_client.py --name "Client A" --email test_client_a@gnanova.pro --role uae_client
python backend/scripts/create_client.py --name "Client B" --email test_client_b@gnanova.pro --role uae_client
python backend/scripts/verify_tenant_isolation.py
```

See `docs/RDS_MIGRATION_STATUS.md`.
