"""IFRS 9 ECL API."""
from __future__ import annotations

from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services import ifrs9_service as svc

router = APIRouter(prefix="/api/ifrs9", tags=["IFRS 9"])


def _ws(request: Request, q: str | None = None) -> str:
    return q or request.headers.get("x-workspace-id") or request.headers.get("x-tenant-id") or "demo"


def _cid(request: Request, q: str | None = None) -> str | None:
    return q or request.headers.get("x-company-id")


class AssetIn(BaseModel):
    asset_name: str
    counterparty: str = ""
    exposure_aed: float
    origination_date: str = ""
    days_past_due: int = 0
    credit_rating: str = "Unrated"
    has_significant_increase_in_credit_risk: bool = False


class StageAssetsRequest(BaseModel):
    assets: list[AssetIn]
    workspace_id: str = ""
    company_id: str | None = None
    asset_class: str = "trade_receivables"


class CalculateEclRequest(BaseModel):
    assets: list[AssetIn] = Field(default_factory=list)
    portfolio_id: str | None = None
    calculation_date: str = ""
    workspace_id: str = ""
    company_id: str | None = None
    asset_class: str = "trade_receivables"


class SavePortfolioRequest(BaseModel):
    portfolio_name: str
    asset_class: str = "trade_receivables"
    calculation_date: str
    assets: list[dict[str, Any]]
    portfolio_summary: dict[str, Any]
    workspace_id: str = ""
    company_id: str | None = None


class PostProvisionJeRequest(BaseModel):
    portfolio_id: str
    period_date: str
    ecl_movement_aed: float = 0
    prior_ecl_aed: float = 0
    workspace_id: str = ""
    company_id: str | None = None


@router.post("/stage-assets")
def stage_assets_endpoint(body: StageAssetsRequest, request: Request):
    assets = [a.model_dump() for a in body.assets]
    return {"assets": svc.stage_assets(assets, body.asset_class)}


@router.post("/calculate-ecl")
def calculate_ecl_endpoint(body: CalculateEclRequest, request: Request, db: Session = Depends(get_db)):
    if body.portfolio_id:
        from app.models.ifrs9_ecl import IFRS9Asset
        ws = _ws(request, body.workspace_id or None)
        cid = body.company_id or _cid(request)
        q = db.query(IFRS9Asset).filter(IFRS9Asset.portfolio_id == body.portfolio_id, IFRS9Asset.workspace_id == ws)
        if cid:
            q = q.filter(IFRS9Asset.company_id == cid)
        assets = [
            {
                "asset_name": a.asset_name, "counterparty": a.counterparty,
                "exposure_aed": float(a.exposure_aed or 0), "days_past_due": int(a.days_past_due or 0),
                "credit_rating": a.credit_rating or "Unrated",
                "has_significant_increase_in_credit_risk": bool(a.significant_increase_in_credit_risk),
            }
            for a in q.all()
        ]
    else:
        assets = [a.model_dump() for a in body.assets]
    return svc.calculate_ecl(assets, body.asset_class)


@router.post("/save-portfolio")
def save_portfolio_endpoint(body: SavePortfolioRequest, request: Request, db: Session = Depends(get_db)):
    ws = _ws(request, body.workspace_id or None)
    cid = body.company_id or _cid(request)
    port = svc.save_portfolio(
        db, workspace_id=ws, company_id=cid,
        portfolio_name=body.portfolio_name, asset_class=body.asset_class,
        calculation_date=body.calculation_date, assets=body.assets,
        summary=body.portfolio_summary,
    )
    return {"status": "success", "portfolio_id": port.id}


@router.post("/post-provision-je")
def post_provision_je_endpoint(body: PostProvisionJeRequest, request: Request, db: Session = Depends(get_db)):
    ws = _ws(request, body.workspace_id or None)
    cid = body.company_id or _cid(request)
    try:
        return svc.post_provision_je(
            db, portfolio_id=body.portfolio_id,
            period_date=date.fromisoformat(body.period_date[:10]),
            ecl_movement_aed=body.ecl_movement_aed,
            workspace_id=ws, company_id=cid, prior_ecl=body.prior_ecl_aed,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/portfolios")
def get_portfolios(
    request: Request,
    workspace_id: str | None = Query(None),
    company_id: str | None = Query(None),
    db: Session = Depends(get_db),
):
    return {"portfolios": svc.list_portfolios(db, _ws(request, workspace_id), company_id or _cid(request))}


@router.get("/dashboard-summary")
def dashboard_summary(
    request: Request,
    workspace_id: str | None = Query(None),
    company_id: str | None = Query(None),
    db: Session = Depends(get_db),
):
    return svc.dashboard_summary(db, _ws(request, workspace_id), company_id or _cid(request))


@router.get("/health")
def ifrs9_health():
    return {"status": "ok", "module": "ifrs9"}
