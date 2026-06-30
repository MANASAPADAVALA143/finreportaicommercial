"""IFRS 16/15/9 metrics for GL summary and entity health."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.ifrs15_contract import IFRS15Contract
from app.models.ifrs16_lease import IFRS16Lease
from app.models.ifrs9_ecl import IFRS9Portfolio


def _sum_col(db: Session, model, col, workspace_id: str, company_id: str) -> float:
    q = db.query(model).filter(model.workspace_id == workspace_id, model.company_id == company_id)
    if hasattr(model, "status"):
        q = q.filter(model.status == "active")
    return sum(float(getattr(r, col) or 0) for r in q.all())


def ifrs_metrics(db: Session, workspace_id: str, company_id: str) -> dict[str, float]:
    rou = _sum_col(db, IFRS16Lease, "rou_asset_current", workspace_id, company_id)
    ll = _sum_col(db, IFRS16Lease, "lease_liability_current", workspace_id, company_id)
    ca = _sum_col(db, IFRS15Contract, "contract_asset_aed", workspace_id, company_id)
    cl = _sum_col(db, IFRS15Contract, "contract_liability_aed", workspace_id, company_id)
    ecl_q = db.query(IFRS9Portfolio).filter(
        IFRS9Portfolio.workspace_id == workspace_id,
        IFRS9Portfolio.company_id == company_id,
    )
    ecl = sum(float(p.total_ecl_aed or 0) for p in ecl_q.all())
    return {
        "ifrs16_rou_assets": round(rou, 2),
        "ifrs16_lease_liability": round(ll, 2),
        "ifrs15_contract_assets": round(ca, 2),
        "ifrs15_contract_liabilities": round(cl, 2),
        "ifrs9_ecl_provision": round(ecl, 2),
    }
