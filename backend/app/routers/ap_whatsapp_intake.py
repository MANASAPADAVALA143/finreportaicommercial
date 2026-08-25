"""Meta WhatsApp Business API inbound invoice webhook."""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import APIRouter, Query, Request, Response
from fastapi.responses import PlainTextResponse

from app.services.ap_ses_intake_service import (
    create_invoice_from_extraction,
    extract_invoice_fields,
    resolve_company_id,
    sync_invoice_after_intake_extract,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ap/whatsapp-intake", tags=["ap-whatsapp-intake"])

GRAPH_BASE = "https://graph.facebook.com/v18.0"


def _token() -> str:
    return (os.getenv("WHATSAPP_TOKEN") or "").strip()


def _phone_number_id() -> str:
    return (os.getenv("WHATSAPP_PHONE_NUMBER_ID") or "").strip()


def _verify_token() -> str:
    return (os.getenv("WHATSAPP_VERIFY_TOKEN") or "gnanova_waba_2026").strip()


async def _reply_whatsapp(to_phone: str, body: str) -> None:
    phone_id = _phone_number_id()
    token = _token()
    if not phone_id or not token or not to_phone:
        logger.info("whatsapp reply skipped (missing config or phone): %s", body[:80])
        return
    url = f"{GRAPH_BASE}/{phone_id}/messages"
    payload = {
        "messaging_product": "whatsapp",
        "to": to_phone.replace("whatsapp:", "").lstrip("+"),
        "type": "text",
        "text": {"body": body},
    }
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                url,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json=payload,
            )
            if r.status_code >= 300:
                logger.warning("whatsapp reply failed %s: %s", r.status_code, r.text[:300])
    except Exception:
        logger.exception("whatsapp reply error")


async def _download_media(media_id: str) -> tuple[bytes, str]:
    token = _token()
    async with httpx.AsyncClient(timeout=60) as client:
        meta = await client.get(
            f"{GRAPH_BASE}/{media_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        meta.raise_for_status()
        info = meta.json()
        media_url = info.get("url") or ""
        mime = (info.get("mime_type") or "application/pdf").split(";")[0]
        if not media_url:
            raise RuntimeError("No media URL from Meta")
        bin_resp = await client.get(
            media_url,
            headers={"Authorization": f"Bearer {token}"},
        )
        bin_resp.raise_for_status()
        return bin_resp.content, mime


def _filename_for_mime(mime: str) -> str:
    if "pdf" in mime:
        return "whatsapp-invoice.pdf"
    if "png" in mime:
        return "whatsapp-invoice.png"
    if "webp" in mime:
        return "whatsapp-invoice.webp"
    return "whatsapp-invoice.jpg"


@router.get("/webhook")
async def verify_whatsapp_webhook(
    hub_mode: str | None = Query(None, alias="hub.mode"),
    hub_verify_token: str | None = Query(None, alias="hub.verify_token"),
    hub_challenge: str | None = Query(None, alias="hub.challenge"),
):
    """Meta webhook verification."""
    if hub_mode == "subscribe" and hub_verify_token == _verify_token():
        return PlainTextResponse(content=hub_challenge or "", status_code=200)
    return Response(status_code=403)


@router.post("/webhook")
async def receive_whatsapp_webhook(request: Request) -> dict[str, Any]:
    """Always HTTP 200 so Meta does not retry aggressively."""
    try:
        body = await request.json()
    except Exception:
        return {"ok": True}

    try:
        await _handle_payload(body)
    except Exception:
        logger.exception("whatsapp webhook handler error")
    return {"ok": True}


async def _handle_payload(body: dict[str, Any]) -> None:
    for entry in body.get("entry") or []:
        for change in entry.get("changes") or []:
            value = change.get("value") or {}
            messages = value.get("messages") or []
            for msg in messages:
                sender = (msg.get("from") or "").strip()
                msg_type = (msg.get("type") or "").lower()

                if msg_type == "document":
                    doc = msg.get("document") or {}
                    media_id = doc.get("id")
                    filename = doc.get("filename") or "invoice.pdf"
                    if not media_id:
                        await _reply_whatsapp(sender, "Please send your invoice as a PDF attachment 📎")
                        continue
                    content, mime = await _download_media(media_id)
                    if "pdf" not in mime and not filename.lower().endswith(".pdf"):
                        # still try OCR for images
                        pass
                    extracted = await extract_invoice_fields(content, filename or _filename_for_mime(mime))
                    company_id = resolve_company_id(f"{sender}@whatsapp.local")
                    # Prefer default company when phone-only
                    if not company_id:
                        company_id = resolve_company_id("")
                    inv_id = None
                    if company_id:
                        inv_id = create_invoice_from_extraction(
                            company_id=company_id,
                            extracted=extracted,
                            from_email="",
                            subject="WhatsApp invoice",
                            received_at=datetime.now(timezone.utc).isoformat(),
                            source="whatsapp",
                            whatsapp_from=sender,
                        )
                        if inv_id:
                            sync_invoice_after_intake_extract(
                                invoice_id=inv_id,
                                company_id=company_id,
                                extracted=extracted,
                            )
                    number = extracted.get("invoice_number") or "—"
                    amount = extracted.get("total_amount") or extracted.get("amount") or 0
                    currency = extracted.get("currency") or "AED"
                    if inv_id:
                        await _reply_whatsapp(
                            sender,
                            f"Invoice received ✅\nInvoice #{number} {currency} {amount}\n"
                            "Processing time: up to 24 hours",
                        )
                    else:
                        await _reply_whatsapp(
                            sender,
                            "We received your file but could not create an invoice yet. Our team will review it.",
                        )

                elif msg_type == "image":
                    image = msg.get("image") or {}
                    media_id = image.get("id")
                    if not media_id:
                        await _reply_whatsapp(sender, "Please send your invoice as a PDF attachment 📎")
                        continue
                    content, mime = await _download_media(media_id)
                    extracted = await extract_invoice_fields(content, _filename_for_mime(mime))
                    company_id = resolve_company_id("") or resolve_company_id(f"{sender}@whatsapp.local")
                    inv_id = None
                    if company_id:
                        inv_id = create_invoice_from_extraction(
                            company_id=company_id,
                            extracted=extracted,
                            from_email="",
                            subject="WhatsApp invoice",
                            received_at=datetime.now(timezone.utc).isoformat(),
                            source="whatsapp",
                            whatsapp_from=sender,
                        )
                        if inv_id:
                            sync_invoice_after_intake_extract(
                                invoice_id=inv_id,
                                company_id=company_id,
                                extracted=extracted,
                            )
                    number = extracted.get("invoice_number") or "—"
                    amount = extracted.get("total_amount") or 0
                    currency = extracted.get("currency") or "AED"
                    if inv_id:
                        await _reply_whatsapp(
                            sender,
                            f"Invoice received ✅\nInvoice #{number} {currency} {amount}\n"
                            "Processing time: up to 24 hours",
                        )
                    else:
                        await _reply_whatsapp(
                            sender,
                            "We received your image but could not create an invoice yet.",
                        )

                elif msg_type == "text":
                    await _reply_whatsapp(sender, "Please send your invoice as a PDF attachment 📎")
                else:
                    await _reply_whatsapp(sender, "Please send your invoice as a PDF attachment 📎")
