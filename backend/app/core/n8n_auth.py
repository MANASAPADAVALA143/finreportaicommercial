"""Shared-secret check for server-to-server calls from n8n (X-N8N-Signature header)."""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets

from fastapi import HTTPException


def valid_n8n_signature(secret: str, body: bytes, received: str) -> bool:
    """HMAC-SHA256 hex over the raw body, or the plain shared secret (same as the n8n inbound hooks)."""
    received = (received or "").strip()
    if not received:
        return False
    expected = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, received.lower()) or secrets.compare_digest(received, secret)


def require_n8n_signature(body: bytes, received: str | None) -> None:
    secret = (os.getenv("N8N_WEBHOOK_SECRET") or "").strip()
    if not secret:
        raise HTTPException(status_code=500, detail="N8N_WEBHOOK_SECRET not configured")
    if not valid_n8n_signature(secret, body, received or ""):
        raise HTTPException(status_code=401, detail="Invalid n8n signature")
