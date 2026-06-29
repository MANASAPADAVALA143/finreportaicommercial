"""System environment info — demo banner, data backend."""

from __future__ import annotations

from fastapi import APIRouter

from app.core.config import settings

router = APIRouter(prefix="/api/system", tags=["System"])


@router.get("/environment")
def get_environment() -> dict:
    return {
        "environment": settings.ENVIRONMENT,
        "is_demo": settings.ENVIRONMENT == "demo",
        "demo_tenant_id": settings.DEMO_TENANT_ID if settings.ENVIRONMENT == "demo" else None,
        "data_backend": "aws_rds",
        "auth_backend": "supabase",
    }
