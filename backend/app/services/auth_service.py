"""Password hashing + JWT helpers for RBAC."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import uuid

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings
from app.core.database import SessionLocal
from app.models.users import Company, User, UserRole

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

ACCESS_HOURS = 8
REFRESH_DAYS = 7

_revoked_refresh_jti: set[str] = set()
_active_refresh_jti: dict[str, str] = {}


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def _encode(payload: dict) -> str:
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_access_token(user_id: str, role: str, company_id: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=ACCESS_HOURS)
    payload = {
        "sub": user_id,
        "role": role,
        "company_id": company_id,
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
    return payload


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
    finally:
        db.close()
