"""Group Financial Intelligence API. Read and snapshot only; no dashboard."""

from __future__ import annotations

from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.tenant_scope import workspace_member
from app.middleware.workspace import WorkspaceContext
from app.services import group_intelligence_service as svc

router = APIRouter(
    prefix="/api/group-intelligence",
    tags=["Group intelligence"],
    dependencies=[Depends(workspace_member)],
)


class Money(BaseModel):
    value: float | None
    currency: str | None
    available: bool
    reason: str | None = None
    method: str


class OwnershipView(BaseModel):
    ownership_percent: float | None
    owner_company_id: str | None
    source: str
    effective_from: str | None
    effective_to: str | None
    assumption: str | None


class FxView(BaseModel):
    fx_rate_id: int | None = None
    average_rate: float | None = None
    closing_rate: float | None = None
    source: str | None = None


class EntityFigures(BaseModel):
    revenue: Money
    gross_profit: Money
    ebitda: Money
    net_profit: Money
    total_assets: Money
    total_liabilities: Money
    net_assets: Money
    gl_cash: Money


class HealthView(BaseModel):
    status: str
    rules: list[str]


class EntityPosition(BaseModel):
    company_id: str
    company_name: str
    parent_company_id: str | None
    base_currency: str | None
    translated: bool
    posted_journal_count: int
    ownership: OwnershipView
    fx: FxView | None
    local: EntityFigures
    reporting: EntityFigures
    health: HealthView


class MatchView(BaseModel):
    reference: str
    seller_company_id: str | None
    buyer_company_id: str | None
    seller_name: str | None
    buyer_name: str | None
    seller_amount: float | None
    buyer_amount: float | None
    eliminated_amount: float | None
    difference: float | None
    status: str | None
    source_refs: list[dict[str, Any]]
    methodology: str


class BankAccountView(BaseModel):
    bank_account_id: str
    company_id: str | None
    currency: str | None
    last_reconciled_date: str | None
    last_reconciled_balance: float | None
    reporting_amount: float | None
    fx_rate_id: int | None
    closing_rate: float | None


class GroupKpis(BaseModel):
    group_revenue: Money
    ebitda: Money
    net_profit: Money
    total_assets: Money
    total_liabilities: Money
    gl_cash: Money
    bank_cash: Money
    net_debt: Money
    working_capital: Money
    cash_runway: Money
    nci_net_profit: Money
    nci_net_assets: Money


class PositionOut(BaseModel):
    workspace_id: str
    period: str
    reporting_currency: str | None
    company_ids: list[str]
    status: str
    kpis: GroupKpis
    entities: list[EntityPosition]
    intercompany: list[MatchView]
    bank_accounts: list[BankAccountView]
    limitations: list[str]
    methodology: dict[str, Any]
    bridge: dict[str, Any]
    alerts: list[dict[str, Any]]
    insights: list[dict[str, Any]]
    snapshot_id: str | None = None


class SeriesPoint(BaseModel):
    period: str
    status: str
    reporting_currency: str | None
    revenue: Money
    ebitda: Money
    net_profit: Money
    margin_pct: dict[str, Any]
    budget: Money


class SeriesOut(BaseModel):
    workspace_id: str
    start: str
    end: str
    reporting_currency: str | None
    currency_basis: str
    actuals_only: bool
    points: list[SeriesPoint]


class EntityOut(BaseModel):
    company_id: str
    company_name: str
    base_currency: str | None
    status: str
    parent_company_id: str | None


class ParentIn(BaseModel):
    parent_company_id: str | None = None


class ParentOut(BaseModel):
    company_id: str
    parent_company_id: str | None


class OwnershipIn(BaseModel):
    company_id: str
    owner_company_id: str | None = None
    ownership_percent: float = Field(ge=0, le=100)
    effective_from: date
    effective_to: date | None = None


class OwnershipOut(BaseModel):
    id: str
    workspace_id: str
    company_id: str
    owner_company_id: str | None
    ownership_percent: float
    effective_from: str
    effective_to: str | None


class SnapshotOut(BaseModel):
    snapshot_id: str
    workspace_id: str
    period: str
    reporting_currency: str | None
    company_ids: list[str]
    status: str
    kpis: dict[str, Any]
    methodology: dict[str, Any]
    limitations: list[Any]
    created_by: str | None
    created_at: str | None


class StoredMatchOut(MatchView):
    id: str
    snapshot_id: str
    period: str
    reporting_currency: str


def _email(ctx: WorkspaceContext) -> str | None:
    user = ctx.user
    return getattr(user, "email", None) if user is not None else None


def _call(fn):
    try:
        return fn()
    except svc.GroupIntelligenceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/entities", response_model=list[EntityOut])
def entities(ctx: WorkspaceContext = Depends(workspace_member), db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    return svc.list_entities(db, ctx.workspace_id)


@router.patch("/entities/{company_id}/parent", response_model=ParentOut)
def set_parent(
    company_id: str,
    body: ParentIn,
    ctx: WorkspaceContext = Depends(workspace_member),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return _call(lambda: svc.set_parent(db, ctx.workspace_id, company_id, body.parent_company_id, _email(ctx)))


@router.get("/ownership", response_model=list[OwnershipOut])
def ownership(ctx: WorkspaceContext = Depends(workspace_member), db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    return svc.list_ownership(db, ctx.workspace_id)


@router.post("/ownership", response_model=OwnershipOut)
def create_ownership(
    body: OwnershipIn,
    ctx: WorkspaceContext = Depends(workspace_member),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return _call(lambda: svc.record_ownership(
        db, ctx.workspace_id, body.company_id, body.ownership_percent, body.effective_from,
        body.effective_to, body.owner_company_id, _email(ctx),
    ))


@router.get("/series", response_model=SeriesOut)
def series(
    start: str = Query(..., pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    end: str = Query(..., pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    reporting_currency: str | None = None,
    company_ids: list[str] | None = Query(default=None),
    ctx: WorkspaceContext = Depends(workspace_member),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return _call(lambda: svc.build_series(db, ctx.workspace_id, start, end, reporting_currency, company_ids))


@router.get("/position", response_model=PositionOut)
def position(
    period: str = Query(..., pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    reporting_currency: str | None = None,
    company_ids: list[str] | None = Query(default=None),
    ctx: WorkspaceContext = Depends(workspace_member),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return _call(lambda: svc.build_position(db, ctx.workspace_id, period, reporting_currency, company_ids))


@router.post("/snapshots", response_model=PositionOut)
def create_snapshot(
    period: str = Query(..., pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    reporting_currency: str | None = None,
    company_ids: list[str] | None = Query(default=None),
    ctx: WorkspaceContext = Depends(workspace_member),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    def _run() -> dict[str, Any]:
        built = svc.build_position(db, ctx.workspace_id, period, reporting_currency, company_ids)
        return svc.persist_snapshot(db, built, _email(ctx))

    return _call(_run)


@router.get("/snapshots", response_model=list[SnapshotOut])
def snapshots(
    period: str | None = None,
    ctx: WorkspaceContext = Depends(workspace_member),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    return _call(lambda: svc.list_snapshots(db, ctx.workspace_id, period))


@router.get("/snapshots/{snapshot_id}", response_model=SnapshotOut)
def snapshot(
    snapshot_id: str,
    ctx: WorkspaceContext = Depends(workspace_member),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return _call(lambda: svc.get_snapshot(db, ctx.workspace_id, snapshot_id))


@router.get("/snapshots/{snapshot_id}/intercompany", response_model=list[StoredMatchOut])
def intercompany(
    snapshot_id: str,
    ctx: WorkspaceContext = Depends(workspace_member),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    return _call(lambda: svc.list_matches(db, ctx.workspace_id, snapshot_id))
