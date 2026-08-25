"""Zoho webhook ingestion — HMAC-SHA256 verified, idempotent, dead-letter queue.

HMAC verification and idempotency key format are ported exactly as specified
in the migration brief (Task 01 — Construction Progress API Bridge).
"""
from __future__ import annotations

import hashlib
import hmac
import os
from datetime import datetime
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.rera import RERABooking, RERAProject, RERAWebhookEvent

ZOHO_WEBHOOK_SECRET = os.getenv("ZOHO_WEBHOOK_SECRET", "")


def _verify_signature(body: bytes, signature_header: str, secret: str) -> bool:
    expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature_header or "")


def verify_zoho_signature(body: bytes, signature_header: str | None) -> bool:
    if not ZOHO_WEBHOOK_SECRET:
        return False
    return _verify_signature(body, signature_header or "", ZOHO_WEBHOOK_SECRET)


def build_idempotency_key(spa_id: str, event_type: str, event_timestamp: str) -> str:
    return f"{spa_id}:{event_type}:{event_timestamp}"


def _parse_event_timestamp(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def _resolve_workspace_from_spa(db: Session, spa_id: str) -> str | None:
    """Best-effort workspace lookup when the webhook URL wasn't configured with ?workspace_id=.

    Zoho fires before a booking necessarily exists for a brand-new SPA, so this
    can legitimately return None — the event is still stored (workspace_id
    nullable) and picked up by workspace-scoped scans once the booking exists.
    """
    booking = db.query(RERABooking).filter(RERABooking.spa_id == spa_id).first()
    if booking is None:
        return None
    project = db.get(RERAProject, booking.project_id)
    return project.workspace_id if project else None


def ingest_event(
    db: Session,
    *,
    payload: dict[str, Any],
    raw_body: dict[str, Any],
    workspace_id: str | None,
) -> tuple[RERAWebhookEvent | None, bool]:
    """Insert a webhook event with ON CONFLICT DO NOTHING semantics on idempotency_key.

    Returns (event_or_none, created). event is None + created=False when the
    idempotency key already existed (duplicate delivery).
    """
    spa_id = str(payload.get("spa_id") or payload.get("spaId") or "").strip()
    event_type = str(payload.get("event_type") or payload.get("eventType") or "").strip()
    event_timestamp = _parse_event_timestamp(payload.get("event_timestamp") or payload.get("timestamp"))
    ts_key = (event_timestamp.isoformat() if event_timestamp else "") or str(payload.get("timestamp") or "")

    if not spa_id or not event_type:
        return None, False

    idempotency_key = build_idempotency_key(spa_id, event_type, ts_key)

    existing = db.query(RERAWebhookEvent).filter_by(idempotency_key=idempotency_key).first()
    if existing:
        return None, False

    if not workspace_id:
        workspace_id = _resolve_workspace_from_spa(db, spa_id)

    event = RERAWebhookEvent(
        idempotency_key=idempotency_key,
        workspace_id=workspace_id,
        spa_id=spa_id,
        event_type=event_type,
        event_timestamp=event_timestamp,
        source="zoho_webhook",
        data=payload.get("data") if isinstance(payload.get("data"), dict) else payload,
        zoho_raw=raw_body,
        is_dlq=False,
    )
    db.add(event)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return None, False
    db.refresh(event)
    return event, True


def move_to_dlq(db: Session, *, payload: dict[str, Any], raw_body: dict[str, Any], reason: str) -> RERAWebhookEvent:
    spa_id = str(payload.get("spa_id") or payload.get("spaId") or "unknown").strip()
    event_type = str(payload.get("event_type") or payload.get("eventType") or "unknown").strip()
    key = build_idempotency_key(spa_id, event_type, datetime.utcnow().isoformat())
    event = RERAWebhookEvent(
        idempotency_key=key,
        spa_id=spa_id,
        event_type=event_type,
        event_timestamp=_parse_event_timestamp(payload.get("event_timestamp")),
        source="zoho_webhook",
        data=payload,
        zoho_raw=raw_body,
        is_dlq=True,
        dlq_reason=reason,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def replay_dlq(db: Session, *, event_id: str, workspace_id: str | None) -> RERAWebhookEvent:
    event = db.get(RERAWebhookEvent, event_id)
    if event is None or not event.is_dlq:
        raise ValueError("DLQ event not found")
    replayed, created = ingest_event(
        db,
        payload=event.data or {},
        raw_body=event.zoho_raw or {},
        workspace_id=workspace_id or event.workspace_id,
    )
    if created and replayed is not None:
        event.is_dlq = False
        event.dlq_reason = None
        db.commit()
        db.refresh(event)
    return event
