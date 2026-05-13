"""FastAPI auth dependencies for RBAC."""

from __future__ import annotations

from collections.abc import Callable

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.users import User, UserRole
from app.services.auth_service import decode_token


def _bearer_token(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    return authorization.replace("Bearer ", "", 1).strip()


def get_current_user(
    db: Session = Depends(get_db),
    authorization: str | None = Header(default=None),
) -> User:
    token = _bearer_token(authorization)
    try:
        payload = decode_token(token)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid access token")

    user_id = str(payload.get("sub", ""))
    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user


def require_role(*roles: UserRole | str) -> Callable:
    wanted = {str(r.value if isinstance(r, UserRole) else r) for r in roles}

    def _dep(user: User = Depends(get_current_user)) -> User:
        if str(user.role.value if hasattr(user.role, "value") else user.role) not in wanted:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user

    return _dep


ROLE_PERMISSIONS: dict[str, set[str]] = {
    "super_admin": {"*"},
    "cfo": {"dashboard", "r2r", "fpa", "ifrs", "earnings", "close", "gl_recon", "model_builder", "approve"},
    "finance_manager": {"r2r", "fpa", "ifrs", "earnings", "close", "gl_recon", "model_builder"},
    "accountant": {"upload", "analysis", "view"},
    "auditor": {"read_only", "audit_trail"},
}
