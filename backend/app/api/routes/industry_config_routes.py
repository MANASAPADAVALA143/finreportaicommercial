"""Industry-aware workspace config API — /api/config/*"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import engine, get_db
from app.models.industry_config import INDUSTRY_DEFAULTS, CostCenter, IndustryConfig
from app.models.workspace import Workspace

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/config", tags=["Industry Config"])

_SEED_ROWS: list[dict[str, Any]] = [
    {
        "industry": "real_estate",
        "industry_label": "Real Estate & Property",
        "cost_center_label": "Property",
        "cost_center_placeholder": "Select property...",
        "ap_label": "Vendor Payments",
        "ar_label": "Rent & Sales Invoices",
        "sidebar_theme": "real_estate",
        "show_ifrs15": True,
        "show_ifrs16": True,
        "show_rera": True,
        "show_ejari": True,
        "show_property_tagging": True,
        "show_site_tagging": False,
    },
    {
        "industry": "construction",
        "industry_label": "Construction",
        "cost_center_label": "Site / Project",
        "cost_center_placeholder": "Select site...",
        "ap_label": "Subcontractor Invoices",
        "ar_label": "Progress Claims",
        "sidebar_theme": "construction",
        "show_ifrs15": False,
        "show_ifrs16": False,
        "show_rera": False,
        "show_ejari": False,
        "show_property_tagging": True,
        "show_site_tagging": True,
    },
    {
        "industry": "manufacturing",
        "industry_label": "Manufacturing",
        "cost_center_label": "Plant / Division",
        "cost_center_placeholder": "Select plant...",
        "ap_label": "Supplier Invoices",
        "ar_label": "Customer Invoices",
        "sidebar_theme": "manufacturing",
        "show_ifrs15": False,
        "show_ifrs16": False,
        "show_rera": False,
        "show_ejari": False,
        "show_property_tagging": True,
        "show_site_tagging": False,
    },
    {
        "industry": "healthcare",
        "industry_label": "Healthcare",
        "cost_center_label": "Branch / Clinic",
        "cost_center_placeholder": "Select branch...",
        "ap_label": "Supplier Invoices",
        "ar_label": "Patient Billing",
        "sidebar_theme": "healthcare",
        "show_ifrs15": False,
        "show_ifrs16": True,
        "show_rera": False,
        "show_ejari": False,
        "show_property_tagging": True,
        "show_site_tagging": False,
    },
    {
        "industry": "retail",
        "industry_label": "Retail",
        "cost_center_label": "Store / Outlet",
        "cost_center_placeholder": "Select store...",
        "ap_label": "Supplier Invoices",
        "ar_label": "Sales Invoices",
        "sidebar_theme": "retail",
        "show_ifrs15": False,
        "show_ifrs16": True,
        "show_rera": False,
        "show_ejari": False,
        "show_property_tagging": True,
        "show_site_tagging": False,
    },
    {
        "industry": "ca_firm",
        "industry_label": "CA Firm / Accounting",
        "cost_center_label": "Client",
        "cost_center_placeholder": "Select client...",
        "ap_label": "Vendor Invoices",
        "ar_label": "Client Billing",
        "sidebar_theme": "ca_firm",
        "show_ifrs15": True,
        "show_ifrs16": True,
        "show_rera": False,
        "show_ejari": False,
        "show_property_tagging": True,
        "show_site_tagging": False,
    },
    {
        "industry": "general",
        "industry_label": "General Business",
        "cost_center_label": "Cost Center",
        "cost_center_placeholder": "Select cost center...",
        "ap_label": "Vendor Payments",
        "ar_label": "Sales Invoices",
        "sidebar_theme": "general",
        "show_ifrs15": False,
        "show_ifrs16": False,
        "show_rera": False,
        "show_ejari": False,
        "show_property_tagging": True,
        "show_site_tagging": False,
    },
]


def ensure_industry_tables(db: Session) -> None:
    IndustryConfig.__table__.create(bind=engine, checkfirst=True)
    CostCenter.__table__.create(bind=engine, checkfirst=True)
    try:
        db.execute(
            __import__("sqlalchemy").text(
                "ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS industry_label VARCHAR(128) DEFAULT 'Cost Center'"
            )
        )
        db.commit()
    except Exception:
        db.rollback()
    existing = {r.industry for r in db.query(IndustryConfig.industry).all()}
    for row in _SEED_ROWS:
        if row["industry"] in existing:
            continue
        db.add(IndustryConfig(id=str(uuid.uuid4()), **row, created_at=datetime.utcnow()))
    try:
        db.commit()
    except Exception:
        db.rollback()


def _normalize_industry_key(raw: str | None) -> str:
    s = (raw or "general").strip().lower().replace(" ", "_").replace("-", "_")
    aliases = {
        "realestate": "real_estate",
        "real_estate_property": "real_estate",
        "property": "real_estate",
        "cafirm": "ca_firm",
        "ca": "ca_firm",
        "accounting": "ca_firm",
        "trading": "general",
        "services": "general",
        "other": "general",
        "finance": "general",
    }
    s = aliases.get(s, s)
    if s not in INDUSTRY_DEFAULTS:
        return "general"
    return s


def _ws(
    request: Request,
    workspace_id: str | None = None,
    x_workspace_id: str | None = None,
) -> str:
    return (
        (workspace_id or "").strip()
        or (x_workspace_id or "").strip()
        or request.headers.get("x-workspace-id")
        or request.headers.get("x-tenant-id")
        or ""
    )


def _company(
    request: Request,
    company_id: str | None = None,
    x_company_id: str | None = None,
) -> str:
    return (
        (company_id or "").strip()
        or (x_company_id or "").strip()
        or request.headers.get("x-company-id")
        or ""
    )


def _config_dict(cfg: IndustryConfig, *, industry_key: str, workspace: Workspace | None) -> dict[str, Any]:
    base = {
        "industry": industry_key,
        "industry_label": cfg.industry_label,
        "cost_center_label": cfg.cost_center_label,
        "cost_center_placeholder": cfg.cost_center_placeholder,
        "ap_label": cfg.ap_label,
        "ar_label": cfg.ar_label,
        "sidebar_theme": cfg.sidebar_theme,
        "show_ifrs15": bool(cfg.show_ifrs15),
        "show_ifrs16": bool(cfg.show_ifrs16),
        "show_rera": bool(cfg.show_rera),
        "show_ejari": bool(cfg.show_ejari),
        "show_property_tagging": bool(cfg.show_property_tagging),
        "show_site_tagging": bool(cfg.show_site_tagging),
        "workspace_industry": getattr(workspace, "industry", None) if workspace else None,
        "workspace_industry_label": getattr(workspace, "industry_label", None) if workspace else None,
    }
    # CamelCase aliases for frontend IndustryContext contract
    base.update(
        {
            "industryLabel": base["industry_label"],
            "costCenterLabel": base["cost_center_label"],
            "costCenterPlaceholder": base["cost_center_placeholder"],
            "apLabel": base["ap_label"],
            "arLabel": base["ar_label"],
            "sidebarTheme": base["sidebar_theme"],
            "showIfrs15": base["show_ifrs15"],
            "showIfrs16": base["show_ifrs16"],
            "showRera": base["show_rera"],
            "showEjari": base["show_ejari"],
            "showPropertyTagging": base["show_property_tagging"],
        }
    )
    return base


def _fallback_config(industry_key: str) -> dict[str, Any]:
    seed = next((r for r in _SEED_ROWS if r["industry"] == industry_key), _SEED_ROWS[-1])
    base = {
        "industry": industry_key,
        "industry_label": seed["industry_label"],
        "cost_center_label": seed["cost_center_label"],
        "cost_center_placeholder": seed["cost_center_placeholder"],
        "ap_label": seed["ap_label"],
        "ar_label": seed["ar_label"],
        "sidebar_theme": seed["sidebar_theme"],
        "show_ifrs15": seed["show_ifrs15"],
        "show_ifrs16": seed["show_ifrs16"],
        "show_rera": seed["show_rera"],
        "show_ejari": seed["show_ejari"],
        "show_property_tagging": seed["show_property_tagging"],
        "show_site_tagging": seed["show_site_tagging"],
        "workspace_industry": industry_key,
        "workspace_industry_label": INDUSTRY_DEFAULTS[industry_key]["cost_center_label"],
    }
    base.update(
        {
            "industryLabel": base["industry_label"],
            "costCenterLabel": base["cost_center_label"],
            "costCenterPlaceholder": base["cost_center_placeholder"],
            "apLabel": base["ap_label"],
            "arLabel": base["ar_label"],
            "sidebarTheme": base["sidebar_theme"],
            "showIfrs15": base["show_ifrs15"],
            "showIfrs16": base["show_ifrs16"],
            "showRera": base["show_rera"],
            "showEjari": base["show_ejari"],
            "showPropertyTagging": base["show_property_tagging"],
        }
    )
    return base


@router.get("/industries")
def list_industries(db: Session = Depends(get_db)) -> dict[str, Any]:
    """Catalog of supported industries (for onboarding cards)."""
    ensure_industry_tables(db)
    rows = db.query(IndustryConfig).order_by(IndustryConfig.industry_label).all()
    if not rows:
        return {"items": [_fallback_config(k) for k in INDUSTRY_DEFAULTS]}
    return {
        "items": [
            {
                "industry": r.industry,
                "industry_label": r.industry_label,
                "cost_center_label": r.cost_center_label,
                "cost_center_placeholder": r.cost_center_placeholder,
                "ap_label": r.ap_label,
                "ar_label": r.ar_label,
                "sidebar_theme": r.sidebar_theme,
                "show_ifrs15": bool(r.show_ifrs15),
                "show_ifrs16": bool(r.show_ifrs16),
                "show_rera": bool(r.show_rera),
                "show_ejari": bool(r.show_ejari),
                "show_property_tagging": bool(r.show_property_tagging),
                "show_site_tagging": bool(r.show_site_tagging),
            }
            for r in rows
        ]
    }


@router.get("/industry")
def get_tenant_industry(
    request: Request,
    workspace_id: Optional[str] = Query(None),
    x_workspace_id: Optional[str] = Header(None, alias="X-Workspace-Id"),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    ensure_industry_tables(db)
    ws_id = _ws(request, workspace_id, x_workspace_id)
    workspace = db.get(Workspace, ws_id) if ws_id else None
    key = _normalize_industry_key(getattr(workspace, "industry", None) if workspace else "general")
    cfg = db.query(IndustryConfig).filter(IndustryConfig.industry == key).first()
    if not cfg:
        return _fallback_config(key)
    return _config_dict(cfg, industry_key=key, workspace=workspace)


class SetIndustryIn(BaseModel):
    industry: str
    workspace_id: Optional[str] = None


@router.post("/industry")
def set_tenant_industry(
    body: SetIndustryIn,
    request: Request,
    x_workspace_id: Optional[str] = Header(None, alias="X-Workspace-Id"),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    ensure_industry_tables(db)
    ws_id = _ws(request, body.workspace_id, x_workspace_id)
    if not ws_id:
        raise HTTPException(400, "workspace_id required")
    workspace = db.get(Workspace, ws_id)
    if not workspace:
        raise HTTPException(404, "Workspace not found")
    key = _normalize_industry_key(body.industry)
    cfg = db.query(IndustryConfig).filter(IndustryConfig.industry == key).first()
    defaults = INDUSTRY_DEFAULTS[key]
    workspace.industry = key
    workspace.industry_label = (
        (cfg.cost_center_label if cfg else defaults["cost_center_label"])
    )
    db.add(workspace)
    db.commit()
    db.refresh(workspace)
    if cfg:
        return _config_dict(cfg, industry_key=key, workspace=workspace)
    return _fallback_config(key)


@router.patch("/industry")
def patch_tenant_industry(
    body: SetIndustryIn,
    request: Request,
    x_workspace_id: Optional[str] = Header(None, alias="X-Workspace-Id"),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Alias for set_tenant_industry — IndustrySelector uses PATCH."""
    return set_tenant_industry(body, request, x_workspace_id, db)


class CostCenterIn(BaseModel):
    name: str = Field(..., min_length=1)
    code: Optional[str] = None
    description: Optional[str] = None
    is_active: bool = True
    workspace_id: Optional[str] = None
    company_id: Optional[str] = None


class CostCenterUpdateIn(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None


def _cc_dict(row: CostCenter) -> dict[str, Any]:
    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "company_id": row.company_id,
        "name": row.name,
        "code": row.code,
        "description": row.description,
        "is_active": bool(row.is_active),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


@router.get("/cost-centers")
def list_cost_centers(
    request: Request,
    workspace_id: Optional[str] = Query(None),
    company_id: Optional[str] = Query(None),
    active_only: bool = Query(True),
    x_workspace_id: Optional[str] = Header(None, alias="X-Workspace-Id"),
    x_company_id: Optional[str] = Header(None, alias="X-Company-Id"),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    ensure_industry_tables(db)
    ws = _ws(request, workspace_id, x_workspace_id)
    cid = _company(request, company_id, x_company_id) or ws
    if not ws:
        raise HTTPException(400, "workspace_id required")
    q = db.query(CostCenter).filter(CostCenter.tenant_id == ws, CostCenter.company_id == cid)
    if active_only:
        q = q.filter(CostCenter.is_active.is_(True))
    rows = q.order_by(CostCenter.name.asc()).all()
    return {"items": [_cc_dict(r) for r in rows], "count": len(rows)}


@router.post("/cost-centers", status_code=201)
def create_cost_center(
    body: CostCenterIn,
    request: Request,
    x_workspace_id: Optional[str] = Header(None, alias="X-Workspace-Id"),
    x_company_id: Optional[str] = Header(None, alias="X-Company-Id"),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    ensure_industry_tables(db)
    ws = _ws(request, body.workspace_id, x_workspace_id)
    cid = _company(request, body.company_id, x_company_id) or ws
    if not ws:
        raise HTTPException(400, "workspace_id required")
    name = body.name.strip()
    code = (body.code or "").strip().upper()
    if not code:
        # Auto-code from name when omitted (Supabase cost_centers.code is optional)
        import re

        slug = re.sub(r"[^A-Z0-9]+", "-", name.upper()).strip("-")[:24] or "CC"
        code = slug
    dup = (
        db.query(CostCenter)
        .filter(CostCenter.tenant_id == ws, CostCenter.company_id == cid, CostCenter.code == code)
        .first()
    )
    if dup:
        raise HTTPException(409, "Cost center code already exists")
    row = CostCenter(
        id=str(uuid.uuid4()),
        tenant_id=ws,
        company_id=cid,
        name=name,
        code=code,
        description=(body.description or "").strip() or None,
        is_active=body.is_active,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _cc_dict(row)


@router.patch("/cost-centers/{cost_center_id}")
def update_cost_center(
    cost_center_id: str,
    body: CostCenterUpdateIn,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    x_workspace_id: Optional[str] = Header(None, alias="X-Workspace-Id"),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    ensure_industry_tables(db)
    ws = _ws(request, workspace_id, x_workspace_id)
    row = (
        db.query(CostCenter)
        .filter(CostCenter.id == cost_center_id, CostCenter.tenant_id == ws)
        .first()
    )
    if not row:
        raise HTTPException(404, "Cost center not found")
    if body.name is not None:
        row.name = body.name.strip()
    if body.code is not None:
        row.code = body.code.strip().upper()
    if body.description is not None:
        row.description = body.description.strip() or None
    if body.is_active is not None:
        row.is_active = body.is_active
    row.updated_at = datetime.utcnow()
    db.add(row)
    db.commit()
    db.refresh(row)
    return _cc_dict(row)


@router.delete("/cost-centers/{cost_center_id}")
def delete_cost_center(
    cost_center_id: str,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    x_workspace_id: Optional[str] = Header(None, alias="X-Workspace-Id"),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Soft-delete — sets is_active=false."""
    ensure_industry_tables(db)
    ws = _ws(request, workspace_id, x_workspace_id)
    row = (
        db.query(CostCenter)
        .filter(CostCenter.id == cost_center_id, CostCenter.tenant_id == ws)
        .first()
    )
    if not row:
        raise HTTPException(404, "Cost center not found")
    row.is_active = False
    row.updated_at = datetime.utcnow()
    db.add(row)
    db.commit()
    return {"ok": True, "id": cost_center_id}
