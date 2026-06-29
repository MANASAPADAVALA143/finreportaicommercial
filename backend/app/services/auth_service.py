"""Password hashing + JWT helpers for RBAC."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import uuid

import bcrypt
from jose import JWTError, jwt

from app.core.config import settings
from app.core.database import SessionLocal
from app.models.users import Company, User, UserRole

ACCESS_HOURS = 8
REFRESH_DAYS = 7

_revoked_refresh_jti: set[str] = set()
_active_refresh_jti: dict[str, str] = {}
_revoked_reset_jti: set[str] = set()

RESET_HOURS = 1


def _is_bcrypt_hash(value: str) -> bool:
    return value.startswith(("$2a$", "$2b$", "$2y$"))


def hash_password(password: str) -> str:
    """Hash a plaintext password once with bcrypt."""
    if _is_bcrypt_hash(password):
        return password
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def _encode(payload: dict) -> str:
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_access_token(user_id: str, role: str, company_id: str, product_role: str = "full_access") -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=ACCESS_HOURS)
    payload = {
        "sub": user_id,
        "role": role,
        "company_id": company_id,
        "product_role": product_role,
        "type": "access",
        "exp": exp,
    }
    return _encode(payload)


def create_refresh_token(user_id: str, role: str | None = None, company_id: str | None = None) -> str:
    exp = datetime.now(timezone.utc) + timedelta(days=REFRESH_DAYS)
    jti = str(uuid.uuid4())
    payload = {
        "sub": user_id,
        "type": "refresh",
        "jti": jti,
        "role": role,
        "company_id": company_id,
        "exp": exp,
    }
    _active_refresh_jti[user_id] = jti
    return _encode(payload)


def invalidate_refresh_token(token: str) -> None:
    payload = decode_token(token)
    jti = payload.get("jti")
    if jti:
        _revoked_refresh_jti.add(str(jti))


def decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError as exc:
        raise ValueError("Invalid token") from exc
    if payload.get("type") == "refresh":
        jti = str(payload.get("jti", ""))
        if jti and jti in _revoked_refresh_jti:
            raise ValueError("Refresh token revoked")
        uid = str(payload.get("sub", ""))
        active = _active_refresh_jti.get(uid)
        if active and jti and active != jti:
            raise ValueError("Refresh token superseded")
    if payload.get("type") == "password_reset":
        jti = str(payload.get("jti", ""))
        if jti and jti in _revoked_reset_jti:
            raise ValueError("Reset link already used")
    return payload


def create_password_reset_token(user_id: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=RESET_HOURS)
    jti = str(uuid.uuid4())
    payload = {"sub": user_id, "type": "password_reset", "jti": jti, "exp": exp}
    return _encode(payload)


def consume_password_reset_token(token: str) -> str:
    payload = decode_token(token)
    if payload.get("type") != "password_reset":
        raise ValueError("Invalid reset token")
    jti = str(payload.get("jti", ""))
    if jti:
        _revoked_reset_jti.add(jti)
    user_id = str(payload.get("sub", ""))
    if not user_id:
        raise ValueError("Invalid reset token")
    return user_id


def ensure_seed_data() -> None:
    db = SessionLocal()
    try:
        company = db.query(Company).filter(Company.name == "Gnanova Demo").first()
        if not company:
            company = Company(id=str(uuid.uuid4()), name="Gnanova Demo", plan="starter")
            db.add(company)
            db.flush()

        user = db.query(User).filter(User.email == "admin@gnanova.com").first()
        if not user:
            user = User(
                id=str(uuid.uuid4()),
                company_id=company.id,
                name="Admin",
                email="admin@gnanova.com",
                password_hash=hash_password("Admin@123"),
                role=UserRole.super_admin,
                is_active=True,
            )
            db.add(user)
        db.commit()

        try:
            from app.services.workspace_service import seed_abc_trading_workspace
            seed_abc_trading_workspace(db, user)
        except Exception:
            pass
    finally:
        db.close()
