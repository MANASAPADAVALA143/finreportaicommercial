"""RBAC authentication routes."""

from __future__ import annotations

from datetime import datetime
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.middleware.auth import ROLE_PERMISSIONS, get_current_user
from app.models.users import AuditLog, Company, User, UserRole
from app.services.auth_service import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    invalidate_refresh_token,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["rbac-auth"])


class RegisterBody(BaseModel):
    company_name: str
    name: str
    email: EmailStr
    password: str


class LoginBody(BaseModel):
    email: EmailStr
    password: str


class RefreshBody(BaseModel):
    refresh_token: str | None = None


class PasswordChangeBody(BaseModel):
    current_password: str
    new_password: str


def _audit(db: Session, user_id: str, action: str, module: str, details: dict, ip: str | None) -> None:
    db.add(
        AuditLog(
            id=str(uuid.uuid4()),
            user_id=user_id,
            action=action,
            module=module,
            details=details,
            ip_address=ip,
        )
    )


def _user_payload(user: User, company: Company | None) -> dict:
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "role": role,
        "company_id": user.company_id,
        "company_name": company.name if company else None,
        "permissions": sorted(ROLE_PERMISSIONS.get(role, set())),
        "is_active": bool(user.is_active),
    }


@router.post("/register")
def register(body: RegisterBody, request: Request, response: Response, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == body.email.lower().strip()).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    company = Company(id=str(uuid.uuid4()), name=body.company_name.strip(), plan="starter")
    user = User(
        id=str(uuid.uuid4()),
        company_id=company.id,
        name=body.name.strip(),
        email=body.email.lower().strip(),
        password_hash=hash_password(body.password),
        role=UserRole.super_admin,
        is_active=True,
        last_login=datetime.utcnow(),
    )
    db.add(company)
    db.add(user)
    _audit(db, user.id, "register", "auth", {"company": company.name}, request.client.host if request.client else None)
    db.commit()

    access = create_access_token(user.id, UserRole.super_admin.value, company.id)
    refresh = create_refresh_token(user.id, UserRole.super_admin.value, company.id)
    response.set_cookie("refresh_token", refresh, httponly=True, samesite="lax")
    return {"access_token": access, "refresh_token": refresh, "user": _user_payload(user, company)}


@router.post("/login")
def login(body: LoginBody, request: Request, response: Response, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == body.email.lower().strip()).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="User is inactive")

    user.last_login = datetime.utcnow()
    company = db.get(Company, user.company_id)
    _audit(db, user.id, "login", "auth", {}, request.client.host if request.client else None)
    db.commit()

    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    access = create_access_token(user.id, role, user.company_id)
    refresh = create_refresh_token(user.id, role, user.company_id)
    response.set_cookie("refresh_token", refresh, httponly=True, samesite="lax")
    return {"access_token": access, "refresh_token": refresh, "user": _user_payload(user, company)}


@router.post("/refresh")
def refresh(body: RefreshBody, request: Request, response: Response):
    token = body.refresh_token or request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=400, detail="refresh_token required")
    try:
        payload = decode_token(token)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    user_id = str(payload.get("sub"))
    # role/company fetched from DB in middleware on next request if needed
    access = create_access_token(user_id, payload.get("role", "accountant"), payload.get("company_id", ""))
    response.set_cookie("refresh_token", token, httponly=True, samesite="lax")
    return {"access_token": access}


@router.post("/logout")
def logout(response: Response, body: RefreshBody = Body(default=RefreshBody())):
    if body.refresh_token:
        try:
            invalidate_refresh_token(body.refresh_token)
        except Exception:
            pass
    response.delete_cookie("refresh_token")
    return {"status": "logged_out"}


@router.get("/me")
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    company = db.get(Company, user.company_id)
    return _user_payload(user, company)


@router.put("/me/password")
def change_password(body: PasswordChangeBody, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    user.password_hash = hash_password(body.new_password)
    db.add(user)
    db.commit()
    return {"status": "password_updated"}
