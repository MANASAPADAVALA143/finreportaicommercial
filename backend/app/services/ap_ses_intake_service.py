"""Process SES → S3 email objects into AP invoices (public.invoices)."""
from __future__ import annotations

import email
import email.policy
import io
import logging
import os
import re
from datetime import date, datetime, timedelta, timezone
from email.message import EmailMessage, Message
from typing import Any

from botocore.exceptions import ClientError

from app.core.aws_config import (
    EMAIL_INTAKE_BUCKET,
    EMAIL_INTAKE_PREFIX,
    get_email_s3_client,
)

logger = logging.getLogger(__name__)

_PROCESSED_PREFIX = f"{EMAIL_INTAKE_PREFIX}processed/"
_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
_PDF_EXTS = {".pdf"}


def _sb():
    from app.core.supabase import get_supabase

    return get_supabase()


def _default_due(invoice_date: str | None) -> str:
    try:
        base = date.fromisoformat((invoice_date or "")[:10])
    except ValueError:
        base = date.today()
    return (base + timedelta(days=30)).isoformat()


def list_pending_email_keys(max_keys: int = 50) -> list[str]:
    """Keys under email-intake/ that are not under processed/."""
    s3 = get_email_s3_client()
    pending: list[str] = []
    token: str | None = None
    while len(pending) < max_keys:
        kwargs: dict[str, Any] = {
            "Bucket": EMAIL_INTAKE_BUCKET,
            "Prefix": EMAIL_INTAKE_PREFIX,
            "MaxKeys": min(100, max_keys - len(pending) + 20),
        }
        if token:
            kwargs["ContinuationToken"] = token
        resp = s3.list_objects_v2(**kwargs)
        for obj in resp.get("Contents") or []:
            key = obj.get("Key") or ""
            if not key or key.endswith("/"):
                continue
            if key.startswith(_PROCESSED_PREFIX):
                continue
            # Only top-level intake objects (not nested folders other than raw keys)
            rest = key[len(EMAIL_INTAKE_PREFIX) :]
            if "/" in rest.rstrip("/"):
                # allow nested SES message folders but skip processed/
                if rest.startswith("processed/"):
                    continue
            pending.append(key)
            if len(pending) >= max_keys:
                break
        if not resp.get("IsTruncated"):
            break
        token = resp.get("NextContinuationToken")
        if not token:
            break
    return pending


def count_pending_emails() -> int:
    try:
        return len(list_pending_email_keys(max_keys=200))
    except Exception as exc:
        logger.warning("count_pending_emails failed: %s", exc)
        return -1


def test_email_intake_bucket() -> dict[str, Any]:
    s3 = get_email_s3_client()
    try:
        s3.head_bucket(Bucket=EMAIL_INTAKE_BUCKET)
        pending = count_pending_emails()
        return {
            "status": "connected",
            "pending_emails": max(pending, 0),
            "bucket": EMAIL_INTAKE_BUCKET,
            "region": os.getenv("AWS_SES_REGION", "us-west-1"),
        }
    except ClientError as exc:
        return {
            "status": "error",
            "pending_emails": 0,
            "bucket": EMAIL_INTAKE_BUCKET,
            "error": str(exc),
        }
    except Exception as exc:
        return {
            "status": "error",
            "pending_emails": 0,
            "bucket": EMAIL_INTAKE_BUCKET,
            "error": str(exc),
        }


def _parse_address(raw: str | None) -> str:
    if not raw:
        return ""
    # "Name <user@domain>" → user@domain
    m = re.search(r"<([^>]+)>", raw)
    if m:
        return m.group(1).strip().lower()
    return raw.strip().lower()


def _domain(addr: str) -> str:
    if "@" not in addr:
        return ""
    return addr.split("@", 1)[1].lower()


def resolve_company_id(from_email: str) -> str | None:
    """Match company by inbox config / member email domain, else first active company."""
    sb = _sb()
    domain = _domain(from_email)

    try:
        cfg = (
            sb.table("email_inbox_config")
            .select("company_id,forwarding_address,is_active")
            .eq("is_active", True)
            .limit(50)
            .execute()
        )
        for row in cfg.data or []:
            fwd = (row.get("forwarding_address") or "").lower()
            if from_email and from_email in fwd:
                return row.get("company_id")
            if domain and domain in fwd:
                return row.get("company_id")
            cid = row.get("company_id")
            if cid and len(cfg.data or []) == 1:
                return cid
    except Exception as exc:
        logger.debug("email_inbox_config lookup: %s", exc)

    if domain:
        try:
            members = (
                sb.table("company_members")
                .select("company_id,email")
                .eq("is_active", True)
                .limit(200)
                .execute()
            )
            for m in members.data or []:
                em = (m.get("email") or "").lower()
                if em.endswith(f"@{domain}"):
                    return m.get("company_id")
        except Exception as exc:
            logger.debug("company_members domain match: %s", exc)

    try:
        companies = sb.table("companies").select("id").limit(1).execute()
        if companies.data:
            return companies.data[0].get("id")
    except Exception as exc:
        logger.warning("default company lookup failed: %s", exc)
    return None


def parse_email_bytes(raw: bytes) -> dict[str, Any]:
    """Parse MIME/.eml → from, subject, received_at, attachments[{filename, content, content_type}]."""
    msg: Message = email.message_from_bytes(raw, policy=email.policy.default)
    from_addr = _parse_address(msg.get("From"))
    subject = (msg.get("Subject") or "").strip()
    date_hdr = msg.get("Date")
    received_at = datetime.now(timezone.utc).isoformat()
    if date_hdr:
        try:
            from email.utils import parsedate_to_datetime

            dt = parsedate_to_datetime(date_hdr)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            received_at = dt.isoformat()
        except Exception:
            pass

    attachments: list[dict[str, Any]] = []
    for part in msg.walk():
        if part.get_content_maintype() == "multipart":
            continue
        disposition = (part.get_content_disposition() or "").lower()
        filename = part.get_filename() or ""
        ctype = (part.get_content_type() or "").lower()
        payload = part.get_payload(decode=True)
        if not payload:
            continue
        is_pdf = ctype == "application/pdf" or filename.lower().endswith(".pdf")
        is_image = ctype.startswith("image/") or any(filename.lower().endswith(e) for e in _IMAGE_EXTS)
        if disposition == "attachment" or is_pdf or is_image:
            if not filename:
                filename = "attachment.pdf" if is_pdf else "attachment.jpg"
            attachments.append(
                {
                    "filename": filename,
                    "content": payload,
                    "content_type": ctype or "application/octet-stream",
                }
            )

    # SES sometimes stores raw without multipart attachments marked — still try
    if not attachments and isinstance(msg, EmailMessage):
        pass

    return {
        "from": from_addr,
        "subject": subject,
        "received_at": received_at,
        "attachments": attachments,
    }


async def extract_invoice_fields(file_bytes: bytes, filename: str) -> dict[str, Any]:
    """Reuse Claude Vision pipeline from agent_extract."""
    from app.api.routes.agent_extract import (
        _demo_extraction,
        _extract_with_claude,
        _media_type,
    )

    data = file_bytes
    lower = (filename or "").lower()
    if lower.endswith(".pdf") or filename.lower().endswith(".pdf"):
        try:
            from pdf2image import convert_from_bytes

            images = convert_from_bytes(data, first_page=1, last_page=1, dpi=150)
            if not images:
                return _demo_extraction(filename)
            buf = io.BytesIO()
            images[0].save(buf, format="JPEG")
            data = buf.getvalue()
            media_type = "image/jpeg"
        except Exception as exc:
            logger.warning("PDF convert failed for %s: %s", filename, exc)
            return _demo_extraction(filename)
    else:
        media_type = _media_type(filename, None)

    try:
        return await _extract_with_claude(data, media_type)
    except RuntimeError:
        return _demo_extraction(filename)
    except Exception as exc:
        demo = _demo_extraction(filename)
        demo["_fallback_reason"] = str(exc)[:200]
        return demo


def create_invoice_from_extraction(
    *,
    company_id: str,
    extracted: dict[str, Any],
    from_email: str,
    subject: str,
    received_at: str,
    source: str = "email",
    whatsapp_from: str | None = None,
) -> str | None:
    sb = _sb()
    amount = float(extracted.get("total_amount") or extracted.get("amount") or 0)
    tax = extracted.get("tax_amount")
    inv_date = (extracted.get("invoice_date") or date.today().isoformat())[:10]
    due = (extracted.get("due_date") or "").strip() or _default_due(inv_date)
    vendor = extracted.get("vendor_name") or (from_email.split("@")[0] if from_email else "Unknown vendor")
    inv_num = extracted.get("invoice_number") or f"EMAIL-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"

    row: dict[str, Any] = {
        "company_id": company_id,
        "invoice_number": inv_num,
        "invoice_date": inv_date,
        "due_date": due,
        "vendor_name": vendor,
        "vendor_email": from_email or None,
        "total_amount": amount,
        "subtotal_amount": amount - float(tax or 0) if tax is not None else amount,
        "tax_type": "VAT" if tax else "None",
        "tax_rate": 0,
        "tax_amount": float(tax or 0),
        "currency": extracted.get("currency") or "AED",
        "status": "Processing",
        "file_url": f"ses-{inv_num}",
        "file_type": "application/pdf",
        "ifrs_category": extracted.get("ifrs_category") or "",
        "ifrs_confidence": float(extracted.get("ifrs_confidence") or 0.7),
        "ifrs_explanation": "",
        "source": source,
        "source_email_from": from_email if source == "email" else None,
        "source_email_subject": subject if source == "email" else None,
        "source_email_received_at": received_at if source == "email" else None,
    }
    if whatsapp_from:
        row["source_whatsapp_from"] = whatsapp_from
        row["source"] = "whatsapp"
        row["vendor_phone"] = whatsapp_from

    try:
        res = sb.table("invoices").insert(row).select("id").single().execute()
        return (res.data or {}).get("id")
    except Exception as exc:
        logger.exception("invoice insert failed: %s", exc)
        # Retry without optional columns that may not exist yet
        for drop in ("source_whatsapp_from", "source_email_received_at", "subtotal_amount"):
            row.pop(drop, None)
        try:
            res = sb.table("invoices").insert(row).select("id").single().execute()
            return (res.data or {}).get("id")
        except Exception as exc2:
            logger.exception("invoice insert retry failed: %s", exc2)
            return None


def sync_invoice_after_intake_extract(
    *,
    invoice_id: str,
    company_id: str,
    extracted: dict[str, Any],
) -> None:
    """After SES/WhatsApp PDF extract save — shared gulftax auto-sync (≥85%)."""
    try:
        from app.services.ap_invoice_post_service import maybe_sync_ap_invoice_after_pdf_extract

        vat_t = extracted.get("vat_treatment") or extracted.get("vatTreatment")
        if vat_t:
            try:
                _sb().table("invoices").update({"vat_treatment": str(vat_t)}).eq("id", invoice_id).execute()
            except Exception:
                pass
        conf = extracted.get("confidence") or extracted.get("ocr_confidence") or extracted.get("ifrs_confidence")
        maybe_sync_ap_invoice_after_pdf_extract(
            invoice_id=invoice_id,
            company_id=company_id,
            workspace_id=company_id,
            confidence_override=float(conf) if conf is not None else None,
        )
    except Exception:
        logger.exception("GulfTax sync-after-extract failed for intake invoice %s", invoice_id)


def _already_processed(s3_key: str) -> bool:
    sb = _sb()
    try:
        res = (
            sb.table("email_intake_log")
            .select("id")
            .eq("s3_key", s3_key)
            .in_("status", ["processed", "failed", "skipped"])
            .limit(1)
            .execute()
        )
        return bool(res.data)
    except Exception:
        return False


def _write_log(
    *,
    company_id: str | None,
    from_email: str,
    subject: str,
    received_at: str,
    attachment_count: int,
    invoices_created: int,
    status: str,
    error_message: str | None,
    s3_key: str,
) -> None:
    sb = _sb()
    payload = {
        "company_id": company_id,
        "from_address": from_email,
        "from_email": from_email,
        "subject": subject,
        "received_at": received_at,
        "attachment_count": attachment_count,
        "attachments_count": attachment_count,
        "invoices_created": invoices_created,
        "status": status if status in ("pending", "processed", "failed", "skipped") else "processed",
        "processing_status": status,
        "error_message": error_message,
        "s3_key": s3_key,
        "raw_payload": None,
    }
    try:
        sb.table("email_intake_log").insert(payload).execute()
    except Exception as exc:
        logger.warning("email_intake_log insert failed (%s); retrying slim row", exc)
        slim = {
            "company_id": company_id,
            "from_address": from_email,
            "subject": subject,
            "received_at": received_at,
            "attachment_count": attachment_count,
            "invoices_created": invoices_created,
            "status": "processed" if status == "processed" else "failed",
            "error_message": error_message,
            "raw_payload": {},
        }
        try:
            sb.table("email_intake_log").insert(slim).execute()
        except Exception as exc2:
            logger.exception("email_intake_log slim insert failed: %s", exc2)


def _archive_s3_object(key: str) -> None:
    s3 = get_email_s3_client()
    filename = key.split("/")[-1] or key.replace("/", "_")
    dest = f"{_PROCESSED_PREFIX}{filename}"
    try:
        s3.copy_object(
            Bucket=EMAIL_INTAKE_BUCKET,
            CopySource={"Bucket": EMAIL_INTAKE_BUCKET, "Key": key},
            Key=dest,
            ServerSideEncryption="AES256",
        )
        s3.delete_object(Bucket=EMAIL_INTAKE_BUCKET, Key=key)
    except Exception as exc:
        logger.warning("archive S3 object %s failed: %s", key, exc)


async def process_s3_email_object(key: str) -> dict[str, Any]:
    if _already_processed(key):
        return {"key": key, "skipped": True, "invoices_created": 0}

    s3 = get_email_s3_client()
    obj = s3.get_object(Bucket=EMAIL_INTAKE_BUCKET, Key=key)
    raw = obj["Body"].read()

    parsed = parse_email_bytes(raw)
    from_email = parsed["from"]
    subject = parsed["subject"]
    received_at = parsed["received_at"]
    attachments = [
        a
        for a in parsed["attachments"]
        if a["filename"].lower().endswith(".pdf")
        or any(a["filename"].lower().endswith(e) for e in _IMAGE_EXTS)
        or (a.get("content_type") or "").startswith("image/")
        or (a.get("content_type") or "") == "application/pdf"
    ]

    company_id = resolve_company_id(from_email)
    created = 0
    errors: list[str] = []

    if not attachments:
        _write_log(
            company_id=company_id,
            from_email=from_email,
            subject=subject,
            received_at=received_at,
            attachment_count=0,
            invoices_created=0,
            status="skipped",
            error_message="No PDF/image attachments",
            s3_key=key,
        )
        _archive_s3_object(key)
        return {"key": key, "invoices_created": 0, "status": "skipped"}

    if not company_id:
        errors.append("No company_id resolved")

    for att in attachments:
        try:
            extracted = await extract_invoice_fields(att["content"], att["filename"])
            if not company_id:
                raise RuntimeError("missing company_id")
            inv_id = create_invoice_from_extraction(
                company_id=company_id,
                extracted=extracted,
                from_email=from_email,
                subject=subject,
                received_at=received_at,
                source="email",
            )
            if inv_id:
                created += 1
                sync_invoice_after_intake_extract(
                    invoice_id=inv_id,
                    company_id=company_id,
                    extracted=extracted,
                )
            else:
                errors.append(f"{att['filename']}: insert failed")
        except Exception as exc:
            errors.append(f"{att['filename']}: {exc}")
            logger.exception("attachment process failed")

    status = "processed" if created > 0 and not errors else ("failed" if created == 0 else "processed")
    _write_log(
        company_id=company_id,
        from_email=from_email,
        subject=subject,
        received_at=received_at,
        attachment_count=len(attachments),
        invoices_created=created,
        status=status,
        error_message="; ".join(errors) if errors else None,
        s3_key=key,
    )
    _archive_s3_object(key)
    return {"key": key, "invoices_created": created, "status": status, "errors": errors}


async def process_pending_emails(limit: int = 20) -> dict[str, Any]:
    keys = list_pending_email_keys(max_keys=limit)
    processed = 0
    invoices_created = 0
    details: list[dict[str, Any]] = []
    for key in keys:
        try:
            result = await process_s3_email_object(key)
            if not result.get("skipped"):
                processed += 1
            invoices_created += int(result.get("invoices_created") or 0)
            details.append(result)
        except Exception as exc:
            logger.exception("process key %s failed", key)
            details.append({"key": key, "status": "failed", "error": str(exc)})
            try:
                _write_log(
                    company_id=None,
                    from_email="",
                    subject="",
                    received_at=datetime.now(timezone.utc).isoformat(),
                    attachment_count=0,
                    invoices_created=0,
                    status="failed",
                    error_message=str(exc)[:500],
                    s3_key=key,
                )
            except Exception:
                pass

    return {
        "processed": processed,
        "invoices_created": invoices_created,
        "pending_seen": len(keys),
        "details": details,
    }


def fetch_intake_logs(company_id: str | None, limit: int = 50) -> list[dict[str, Any]]:
    sb = _sb()
    q = (
        sb.table("email_intake_log")
        .select("*")
        .order("received_at", desc=True)
        .limit(limit)
    )
    if company_id:
        q = q.eq("company_id", company_id)
    res = q.execute()
    return list(res.data or [])
