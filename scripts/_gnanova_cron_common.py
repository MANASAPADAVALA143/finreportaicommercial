"""
Shared helpers for Gnanova EC2 cron scripts.

Deploy path (EC2): /home/ubuntu/finreportaicommercial/scripts/
Reads secrets from backend/.env — never hardcode credentials.
"""
from __future__ import annotations

import logging
import os
import smtplib
import sys
import traceback
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any, Optional

import httpx

# Repo root = parent of scripts/  →  …/finreportaicommercial
# Docker image layout: /app/scripts + /app/app (no nested backend/)
REPO_ROOT = Path(__file__).resolve().parent.parent
if (REPO_ROOT / "backend" / "app").is_dir():
    BACKEND_ROOT = REPO_ROOT / "backend"
else:
    BACKEND_ROOT = REPO_ROOT
ENV_PATH = BACKEND_ROOT / ".env"

# Prefer EC2 log dir; fall back to repo-local logs for --test on Windows/dev
EC2_LOG_DIR = Path("/var/log/gnanova")
LOCAL_LOG_DIR = REPO_ROOT / "logs" / "gnanova"


def load_env() -> Path:
    """Load backend/.env into os.environ. Returns path used."""
    try:
        from dotenv import load_dotenv
    except ImportError:
        # minimal fallback: parse KEY=VALUE lines
        if ENV_PATH.is_file():
            for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
        return ENV_PATH

    if ENV_PATH.is_file():
        load_dotenv(ENV_PATH, override=False)
    else:
        load_dotenv(override=False)
    return ENV_PATH


def ensure_backend_on_path() -> None:
    """So scripts can `from app.… import …`."""
    backend = str(BACKEND_ROOT)
    if backend not in sys.path:
        sys.path.insert(0, backend)


def setup_logger(script_name: str) -> logging.Logger:
    """Rotating file logger under /var/log/gnanova/ (or repo logs/)."""
    log_dir = EC2_LOG_DIR if EC2_LOG_DIR.exists() or os.name != "nt" else LOCAL_LOG_DIR
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
    except OSError:
        log_dir = LOCAL_LOG_DIR
        log_dir.mkdir(parents=True, exist_ok=True)

    log_file = log_dir / f"{script_name}.log"
    logger = logging.getLogger(script_name)
    logger.setLevel(logging.INFO)
    logger.handlers.clear()
    logger.propagate = False

    fmt = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    fh = RotatingFileHandler(
        log_file,
        maxBytes=5 * 1024 * 1024,
        backupCount=7,
        encoding="utf-8",
    )
    fh.setFormatter(fmt)
    logger.addHandler(fh)

    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    logger.addHandler(sh)

    logger.info("Logging to %s", log_file)
    return logger


def send_email(
    to_email: str,
    subject: str,
    *,
    text: str = "",
    html: str | None = None,
    logger: Optional[logging.Logger] = None,
) -> bool:
    """Send via Resend API or SMTP (same env vars as FastAPI notification_service)."""
    log = logger or logging.getLogger(__name__)
    if not to_email:
        log.warning("send_email skipped — empty recipient")
        return False

    from_addr = os.getenv(
        "FROM_EMAIL",
        os.getenv("RESEND_FROM", os.getenv("SMTP_FROM", "noreply@finreportai.com")),
    )

    resend_key = (os.getenv("RESEND_API_KEY") or "").strip()
    if resend_key:
        try:
            payload: dict[str, Any] = {
                "from": from_addr,
                "to": [to_email],
                "subject": subject,
                "text": text or "See HTML version.",
            }
            if html:
                payload["html"] = html
            with httpx.Client(timeout=45) as client:
                r = client.post(
                    "https://api.resend.com/emails",
                    headers={
                        "Authorization": f"Bearer {resend_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )
            if r.status_code < 300:
                log.info("Resend OK → %s | %s", to_email, subject)
                return True
            log.error("Resend failed %s: %s", r.status_code, r.text[:400])
            return False
        except Exception:
            log.exception("Resend error")
            return False

    smtp_host = (os.getenv("SMTP_HOST") or "").strip()
    smtp_user = (os.getenv("SMTP_USER") or "").strip()
    smtp_pass = (os.getenv("SMTP_PASS") or os.getenv("SMTP_PASSWORD") or "").strip()
    if smtp_host and smtp_user and smtp_pass:
        try:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = os.getenv("SMTP_FROM", smtp_user)
            msg["To"] = to_email
            if text:
                msg.attach(MIMEText(text, "plain", "utf-8"))
            if html:
                msg.attach(MIMEText(html, "html", "utf-8"))
            with smtplib.SMTP(smtp_host, int(os.getenv("SMTP_PORT", "587"))) as server:
                server.starttls()
                server.login(smtp_user, smtp_pass)
                server.send_message(msg)
            log.info("SMTP OK → %s | %s", to_email, subject)
            return True
        except Exception:
            log.exception("SMTP error")
            return False

    log.warning("Email not configured (RESEND_API_KEY / SMTP_*) — would send to %s: %s", to_email, subject)
    return False


def alert_admin(script_name: str, error: BaseException | str, logger: logging.Logger) -> None:
    """Best-effort failure alert to ADMIN_EMAIL (falls back to CFO_EMAIL)."""
    admin = (os.getenv("ADMIN_EMAIL") or os.getenv("CFO_EMAIL") or "").strip()
    if not admin:
        logger.error("No ADMIN_EMAIL/CFO_EMAIL to alert: %s", error)
        return
    detail = error if isinstance(error, str) else f"{type(error).__name__}: {error}\n{traceback.format_exc()}"
    send_email(
        admin,
        f"[Gnanova] Cron FAILED: {script_name}",
        text=f"Script `{script_name}` failed on EC2.\n\n{detail}",
        html=f"<pre style='font-family:monospace;font-size:12px'>{detail}</pre>",
        logger=logger,
    )


def resolve_cfo_email(company: dict[str, Any] | None = None) -> str:
    """
    Resolve recipient for a company's daily CFO briefing.

    Order:
      1. company_settings.cfo_email  (per-client, set at onboarding / Settings)
      2. companies.admin_email
      3. CFO_EMAIL_BY_COMPANY JSON env map  {"uuid":"cfo@acme.ae"}
      4. CFO_EMAIL from .env (ops fallback / local test only)
    """
    import json

    company_id = (company or {}).get("id")

    if company_id:
        try:
            sb = get_supabase_client()
            cs = (
                sb.table("company_settings")
                .select("cfo_email")
                .eq("company_id", company_id)
                .limit(1)
                .execute()
            )
            row = (cs.data or [None])[0]
            if row and (row.get("cfo_email") or "").strip():
                return str(row["cfo_email"]).strip()
        except Exception:
            pass

        # Prefer value already loaded on the company dict
        for key in ("admin_email", "cfo_email"):
            val = (company or {}).get(key)
            if val and str(val).strip():
                return str(val).strip()

        try:
            sb = get_supabase_client()
            co = (
                sb.table("companies")
                .select("admin_email")
                .eq("id", company_id)
                .limit(1)
                .execute()
            )
            crow = (co.data or [None])[0]
            if crow and (crow.get("admin_email") or "").strip():
                return str(crow["admin_email"]).strip()
        except Exception:
            pass

    raw = (os.getenv("CFO_EMAIL_BY_COMPANY") or "").strip()
    if company_id and raw:
        try:
            mapping = json.loads(raw)
            if isinstance(mapping, dict) and mapping.get(company_id):
                return str(mapping[company_id]).strip()
        except json.JSONDecodeError:
            pass

    return (os.getenv("CFO_EMAIL") or "").strip()


def get_supabase_client():
    ensure_backend_on_path()
    from app.core.supabase import get_supabase

    return get_supabase()
