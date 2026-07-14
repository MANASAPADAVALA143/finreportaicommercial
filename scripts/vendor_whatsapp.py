#!/usr/bin/env python3
"""
SCRIPT 4 — Vendor WhatsApp status (Approved / Paid)

Deploy: /home/ubuntu/finreportaicommercial/scripts/vendor_whatsapp.py
Trigger: FastAPI POST /api/ap/vendor-whatsapp  (not a cron)

Sends Twilio WhatsApp to invoices.vendor_phone:
  "Dear {vendor}, invoice {number} for {currency} {amount} has been {status}.
   Payment due {due_date}. Ref: Gnanova Finance OS"

Usage (CLI / EC2 smoke):
  python3 scripts/vendor_whatsapp.py --test --invoice-id <uuid> --status Approved
  python3 scripts/vendor_whatsapp.py --send --invoice-id <uuid> --status Paid
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any, Literal, Optional

_SCRIPTS_DIR = Path(__file__).resolve().parent
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from _gnanova_cron_common import (  # noqa: E402
    alert_admin,
    get_supabase_client,
    load_env,
    setup_logger,
)

SCRIPT_NAME = "vendor_whatsapp"
Status = Literal["Approved", "Paid"]


def format_amount(amount: float, currency: str) -> str:
    cur = (currency or "AED").upper()
    if cur in ("INR", "₹", "RS"):
        return f"INR {float(amount or 0):,.2f}"
    if cur in ("AED", "DH", "DHS"):
        return f"AED {float(amount or 0):,.2f}"
    return f"{cur} {float(amount or 0):,.2f}"


def build_message(
    *,
    vendor_name: str,
    invoice_number: str,
    amount: float,
    currency: str,
    status: Status,
    due_date: str | None,
) -> str:
    due = (due_date or "")[:10] if due_date else "N/A"
    amt = format_amount(amount, currency)
    # Prefer bare currency label already in amt string
    return (
        f"Dear {vendor_name or 'Vendor'}, invoice {invoice_number or '—'} for {amt} "
        f"has been {status}. Payment due {due}. Ref: Gnanova Finance OS"
    )


def _normalize_whatsapp_to(phone: str) -> str:
    p = (phone or "").strip()
    if p.startswith("whatsapp:"):
        return p
    if not p.startswith("+"):
        # Assume already E.164-ish; leave as-is for Twilio to reject if wrong
        pass
    return f"whatsapp:{p}"


def send_twilio_whatsapp(
    to_phone: str,
    body: str,
    *,
    logger: Optional[logging.Logger] = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Send one WhatsApp message via Twilio. Returns {ok, sid?, error?}."""
    log = logger or logging.getLogger(SCRIPT_NAME)
    to = _normalize_whatsapp_to(to_phone)
    sid = (os.getenv("TWILIO_ACCOUNT_SID") or "").strip()
    token = (os.getenv("TWILIO_AUTH_TOKEN") or "").strip()
    from_num = (os.getenv("TWILIO_WHATSAPP_FROM") or os.getenv("TWILIO_FROM") or "").strip()
    if from_num and not from_num.startswith("whatsapp:"):
        from_num = f"whatsapp:{from_num}"

    if dry_run:
        log.info("[--test] Would WhatsApp → %s | %s", to, body[:120])
        return {"ok": True, "dry_run": True, "to": to, "body": body}

    if not sid or not token or not from_num:
        msg = "Twilio not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_FROM)"
        log.error(msg)
        return {"ok": False, "error": msg, "to": to, "body": body}

    try:
        from twilio.rest import Client as TwilioClient

        client = TwilioClient(sid, token)
        message = client.messages.create(from_=from_num, to=to, body=body)
        log.info("WhatsApp sent → %s sid=%s status=%s", to, message.sid, message.status)
        return {
            "ok": True,
            "sid": message.sid,
            "status": message.status,
            "to": to,
            "body": body,
        }
    except Exception as e:
        log.exception("Twilio WhatsApp failed → %s", to)
        return {"ok": False, "error": str(e), "to": to, "body": body}


def notify_vendor_status(
    *,
    vendor_phone: str,
    vendor_name: str,
    invoice_number: str,
    amount: float,
    currency: str,
    status: Status,
    due_date: str | None = None,
    invoice_id: str | None = None,
    logger: Optional[logging.Logger] = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Public entry used by FastAPI and CLI."""
    log = logger or logging.getLogger(SCRIPT_NAME)
    phone = (vendor_phone or "").strip()
    if not phone:
        return {"ok": False, "skipped": True, "reason": "no_vendor_phone", "invoice_id": invoice_id}

    body = build_message(
        vendor_name=vendor_name,
        invoice_number=invoice_number,
        amount=amount,
        currency=currency,
        status=status,
        due_date=due_date,
    )
    result = send_twilio_whatsapp(phone, body, logger=log, dry_run=dry_run)
    result["invoice_id"] = invoice_id
    result["invoice_number"] = invoice_number
    result["status"] = status
    return result


def notify_from_invoice_id(
    invoice_id: str,
    status: Status,
    *,
    logger: Optional[logging.Logger] = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    sb = get_supabase_client()
    res = (
        sb.table("invoices")
        .select(
            "id,invoice_number,vendor_name,vendor_phone,total_amount,currency,due_date,company_id"
        )
        .eq("id", invoice_id)
        .limit(1)
        .execute()
    )
    row = (res.data or [None])[0]
    if not row:
        return {"ok": False, "error": "invoice_not_found", "invoice_id": invoice_id}

    return notify_vendor_status(
        vendor_phone=row.get("vendor_phone") or "",
        vendor_name=row.get("vendor_name") or "Vendor",
        invoice_number=row.get("invoice_number") or "—",
        amount=float(row.get("total_amount") or 0),
        currency=row.get("currency") or "AED",
        status=status,
        due_date=row.get("due_date"),
        invoice_id=invoice_id,
        logger=logger,
        dry_run=dry_run,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Vendor WhatsApp status notify")
    parser.add_argument("--test", action="store_true", help="Dry-run (do not call Twilio)")
    parser.add_argument("--send", action="store_true", help="Force send even with --test")
    parser.add_argument("--invoice-id", required=True)
    parser.add_argument("--status", choices=["Approved", "Paid"], required=True)
    args = parser.parse_args(argv)

    load_env()
    logger = setup_logger(SCRIPT_NAME)
    dry_run = args.test and not args.send

    try:
        result = notify_from_invoice_id(
            args.invoice_id,
            args.status,  # type: ignore[arg-type]
            logger=logger,
            dry_run=dry_run,
        )
        print(json.dumps({"script": SCRIPT_NAME, **result}, indent=2, default=str))
        return 0 if result.get("ok") or result.get("skipped") else 1
    except Exception as e:
        logger.exception("Fatal")
        try:
            alert_admin(SCRIPT_NAME, e, logger)
        except Exception:
            pass
        print(json.dumps({"ok": False, "error": str(e)}, indent=2))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
