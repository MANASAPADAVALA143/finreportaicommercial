"""JWT + product-role guard for FinReportAI RBAC API routes."""

from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.services.auth_service import decode_token
from app.services.supabase_auth_service import (
    internal_role_from_supabase,
    product_role_from_supabase,
    verify_supabase_token,
)

PUBLIC_PREFIXES = (
    "/health",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/favicon.ico",
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/refresh",
    "/api/auth/forgot-password",
    "/api/auth/reset-password",
    "/api/v1/auth",
    "/api/voice",
    "/api/gulftax/einvoicing/asp-webhook",
    "/api/ap/integrations/zoho/callback",
    "/api/ap/integrations/qbo/callback",
    "/api/connections/zoho/callback",
)

AUTH_ANY_ROLE_PREFIXES = (
    "/api/auth/me",
    "/api/auth/logout",
    "/api/auth/change-password",
    "/api/workspaces",
    "/api/company-setup",
)

ROLE_API_PREFIXES: dict[str, tuple[str, ...] | None] = {
    "uae_client": (
        "/api/gulftax",
        "/api/ap",
        "/api/ifrs16",
        "/api/vat",
        "/api/invoice",
        "/api/einvoicing",
        "/api/ct",
        "/api/corporatetax",
        "/api/fta",
        "/api/trn",
        "/api/tax",
        "/api/dashboard",
        "/api/automations",
    ),
    "uae_suite": (
        "/api/gulftax",
        "/api/ap",
        "/api/ifrs16",
        "/api/vat",
        "/api/invoice",
        "/api/einvoicing",
        "/api/ct",
        "/api/corporatetax",
        "/api/fta",
        "/api/trn",
        "/api/tax",
        "/api/dashboard",
        "/api/automations",
        "/api/uae/ar",
        "/api/ar-collections",
        "/api/uae-suite",
    ),
    "uae_full": (
        "/api/gulftax",
        "/api/ap",
        "/api/uae",
        "/api/crm",
        "/api/o2c",
        "/api/vat",
        "/api/invoice",
        "/api/einvoicing",
        "/api/ct",
        "/api/corporatetax",
        "/api/fta",
        "/api/trn",
        "/api/tax",
        "/api/dashboard",
        "/api/automations",
        "/api/uae-suite",
    ),
    "india_client": ("/api/india", "/api/bank", "/api/fpa", "/api/reports", "/api/excel", "/api/board-pack", "/api/ca"),
    "india_full": ("/api/india", "/api/ap", "/api/bank", "/api/fpa", "/api/ifrs"),
    "fpa_client": ("/api/fpa", "/api/reports", "/api/excel", "/api/board-pack"),
    "full_access": None,
}


def _is_public(path: str) -> bool:
    return any(path == p or path.startswith(f"{p}/") for p in PUBLIC_PREFIXES)


def _auth_any_role(path: str) -> bool:
    return any(path == p or path.startswith(f"{p}/") for p in AUTH_ANY_ROLE_PREFIXES)


def _path_allowed(product_role: str, internal_role: str, path: str) -> bool:
    if internal_role == "super_admin" or product_role == "full_access":
        return True
    if path.startswith("/api/users"):
        return internal_role == "super_admin"
    if _auth_any_role(path):
        return True
    prefixes = ROLE_API_PREFIXES.get(product_role)
    if prefixes is None:
        return True
    return any(path == p or path.startswith(f"{p}/") for p in prefixes)


class ProductRoleMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method == "OPTIONS":
            return await call_next(request)

        path = request.url.path
        if not path.startswith("/api/") or _is_public(path):
            return await call_next(request)

        auth = request.headers.get("authorization") or request.headers.get("Authorization")
        if not auth or not auth.startswith("Bearer "):
            return JSONResponse(status_code=401, content={"detail": "Missing bearer token"})

        token = auth.replace("Bearer ", "", 1).strip()
        internal_role = ""
        product_role = "full_access"
        user_id = ""

        try:
            payload = decode_token(token)
            if payload.get("type") == "access":
                user_id = str(payload.get("sub") or "")
                internal_role = str(payload.get("role") or "")
                product_role = str(payload.get("product_role") or "full_access")
            else:
                raise ValueError("not rbac access token")
        except ValueError:
            try:
                sb_user = verify_supabase_token(token)
                user_id = str(sb_user.get("id") or "")
                internal_role = internal_role_from_supabase(sb_user)
                product_role = product_role_from_supabase(sb_user)
            except ValueError as exc:
                return JSONResponse(status_code=401, content={"detail": str(exc)})

        if not _path_allowed(product_role, internal_role, path):
            return JSONResponse(status_code=403, content={"detail": "Insufficient product role for this API"})

        request.state.user_id = user_id
        request.state.user_role = internal_role
        request.state.product_role = product_role
        return await call_next(request)
