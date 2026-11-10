"""Encrypt small secrets stored in the database (e.g. Slack webhook URLs) with Fernet.

The key is DATA_ENCRYPTION_KEY when set, otherwise derived from SECRET_KEY. Values are stored as
"enc:v1:<token>"; values without that prefix are treated as legacy plaintext and returned as is.
Rotating the key makes earlier values unreadable: decrypt() then raises SecretUnreadable.
"""
from __future__ import annotations

import base64
import hashlib
import os

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings

PREFIX = "enc:v1:"


class SecretUnreadable(ValueError):
    pass


def _fernet() -> Fernet:
    material = (os.getenv("DATA_ENCRYPTION_KEY") or "").strip() or f"finreportai-secrets:{settings.SECRET_KEY}"
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(material.encode()).digest()))


def encrypt(value: str | None) -> str | None:
    if not value:
        return None
    return PREFIX + _fernet().encrypt(value.encode()).decode()


def decrypt(value: str | None) -> str | None:
    if not value:
        return None
    if not value.startswith(PREFIX):
        return value
    try:
        return _fernet().decrypt(value[len(PREFIX):].encode()).decode()
    except InvalidToken as exc:
        raise SecretUnreadable("Stored secret cannot be decrypted with the current key") from exc
