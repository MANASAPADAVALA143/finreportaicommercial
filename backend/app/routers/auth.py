"""RBAC authentication routes."""

from __future__ import annotations

import logging
import os
from datetime import datetime
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.middleware.auth import ROLE_PERMISSIONS, get_current_user
from app.models.users import AuditLog, Company, User, UserRole
from app.core.config import settings
from app.services.auth_service import (
    consume_password_reset_token,
    create_access_token,
    create_password_reset_token,
    create_refresh_token,
    decode_token,
    hash_password,
    invalidate_refresh_token,
    verify_password,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["rbac-auth"])
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3006")


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


class ForgotPasswordBody(BaseModel):
    email: EmailStr


class ResetPasswordBody(BaseModel):
    token: str
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
    product_role = getattr(user, "product_role", None) or "full_access"
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "role": role,
        "product_role": product_role,
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
    db.flush()  # company + user must exist before audit_log FK insert (autoflush=False)
    _audit(db, user.id, "register", "auth", {"company": company.name}, request.client.host if request.client else None)
    db.commit()
    db.refresh(user)
    try:
        from app.services.workspace_service import create_workspace
        create_workspace(
            db,
            name=body.company_name.strip(),
            legal_entity_name=body.company_name.strip(),
            trn_number=None,
            country="UAE",
            currency="AED",
            fiscal_year_start_month=1,
            fiscal_year_end_month=12,
            industry=None,
            owner_user_id=user.id,
        )
    except Exception:
        pass

    access = create_access_token(user.id, UserRole.super_admin.value, company.id, "full_access")
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
    product_role = getattr(user, "product_role", None) or "full_access"
    access = create_access_token(user.id, role, user.company_id, product_role)
    refresh = create_refresh_token(user.id, role, user.company_id)
    response.set_cookie("refresh_token", refresh, httponly=True, samesite="lax")
    return {"access_token": access, "refresh_token": refresh, "user": _user_payload(user, company)}


@router.post("/refresh")
def refresh(body: RefreshBody, request: Request, response: Response, db: Session = Depends(get_db)):
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
    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    product_role = getattr(user, "product_role", None) or "full_access"
    access = create_access_token(user.id, role, user.company_id, product_role)
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


def _send_reset_email(to_email: str, reset_link: str) -> bool:
    smtp_host = os.getenv("SMTP_HOST", "")
    smtp_user = os.getenv("SMTP_USER", "")
    smtp_pass = os.getenv("SMTP_PASSWORD", "")
    smtp_from = os.getenv("SMTP_FROM", smtp_user)
    if not all([smtp_host, smtp_user, smtp_pass, smtp_from]):
        logger.info("SMTP not configured — password reset link for %s: %s", to_email, reset_link)
        return False
    try:
        import smtplib
        from email.mime.text import MIMEText

        msg = MIMEText(
            f"Reset your FinReportAI password:\n\n{reset_link}\n\n"
            f"This link expires in 1 hour. If you did not request this, ignore this email."
        )
        msg["Subject"] = "FinReportAI — Password Reset"
        msg["From"] = smtp_from
        msg["To"] = to_email
        with smtplib.SMTP(smtp_host, int(os.getenv("SMTP_PORT", "587"))) as server:
            server.starttls()
            server.login(smtp_user, smtp_pass)
            server.send_message(msg)
        return True
    except Exception:
        logger.exception("Failed to send password reset email to %s", to_email)
        return False


@router.post("/forgot-password")
def forgot_password(body: ForgotPasswordBody, db: Session = Depends(get_db)):
    """Request a password reset link. Always returns success to avoid email enumeration."""
    email = body.email.lower().strip()
    user = db.query(User).filter(User.email == email, User.is_active == True).first()  # noqa: E712
    response: dict = {
        "message": "If that email is registered, a password reset link has been sent.",
    }
    if user:
        token = create_password_reset_token(user.id)
        reset_link = f"{FRONTEND_URL.rstrip('/')}/reset-password?token={token}"
        emailed = _send_reset_email(user.email, reset_link)
        if settings.DEBUG or not emailed:
            response["reset_link"] = reset_link
    return response


@router.post("/reset-password")
def reset_password(body: ResetPasswordBody, db: Session = Depends(get_db)):
    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    try:
        user_id = consume_password_reset_token(body.token)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link")
    user.password_hash = hash_password(body.new_password)
    db.add(user)
    db.commit()
    return {"message": "Password updated. You can now sign in."}


@router.put("/me/password")
def change_password(body: PasswordChangeBody, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    user.password_hash = hash_password(body.new_password)
    db.add(user)
    db.commit()
    return {"status": "password_updated"}
