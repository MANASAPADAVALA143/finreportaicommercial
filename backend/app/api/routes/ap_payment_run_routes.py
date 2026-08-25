"""AP Payment Run Center API — /api/ap-invoices/payment-run"""

from __future__ import annotations

import logging
from datetime import date
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services import ap_payment_run_service as svc

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ap-invoices/payment-run", tags=["AP Payment Runs"])


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


def _actor(request: Request) -> str:
    return (
        request.headers.get("x-user-email")
        or request.headers.get("X-User-Email")
        or request.headers.get("x-user-id")
        or "system"
    )


def _is_cfo_like(request: Request) -> bool:
    role = (
        request.headers.get("x-user-role")
        or request.headers.get("x-product-role")
        or ""
    ).lower()
    return any(
        tok in role
        for tok in ("cfo", "admin", "owner", "finance_manager", "full_access")
    )


class CreateRunIn(BaseModel):
    invoice_ids: list[str] = Field(..., min_length=1)
    workspace_id: str
    company_id: str
    payment_date: Optional[str] = None
    bank_account: Optional[str] = None
    notes: Optional[str] = None


class RejectIn(BaseModel):
    reason: str = Field(..., min_length=1)


@router.get("")
def list_payment_runs(
    request: Request,
    workspace_id: Optional[str] = Query(None),
    company_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    x_workspace_id: Optional[str] = Header(None, alias="X-Workspace-Id"),
    x_company_id: Optional[str] = Header(None, alias="X-Company-Id"),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    ws = _ws(request, workspace_id, x_workspace_id)
    cid = _company(request, company_id, x_company_id)
    if not ws or not cid:
        raise HTTPException(status_code=400, detail="workspace_id and company_id required")

    df = date.fromisoformat(date_from) if date_from else None
    dt = date.fromisoformat(date_to) if date_to else None
    runs = svc.list_runs(
        db,
        workspace_id=ws,
        company_id=cid,
        status=status,
        date_from=df,
        date_to=dt,
    )
    items = []
    for run in runs:
        invs = svc.invoices_for_run(db, run)
        items.append(svc.run_to_dict(run, invs))
    return {"runs": items, "count": len(items)}


@router.get("/eligible")
def list_eligible(
    request: Request,
    workspace_id: Optional[str] = Query(None),
    company_id: Optional[str] = Query(None),
    due_from: Optional[str] = Query(None),
    due_to: Optional[str] = Query(None),
    vendor: Optional[str] = Query(None),
    amount_min: Optional[float] = Query(None),
    amount_max: Optional[float] = Query(None),
    category: Optional[str] = Query(None),
    property_id: Optional[str] = Query(None),
    x_workspace_id: Optional[str] = Header(None, alias="X-Workspace-Id"),
    x_company_id: Optional[str] = Header(None, alias="X-Company-Id"),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    ws = _ws(request, workspace_id, x_workspace_id)
    cid = _company(request, company_id, x_company_id)
    if not ws or not cid:
        raise HTTPException(status_code=400, detail="workspace_id and company_id required")

    d_from, d_to = svc.default_due_window()
    if due_from:
        d_from = date.fromisoformat(due_from)
    if due_to:
        d_to = date.fromisoformat(due_to)

    invoices = svc.list_eligible_invoices(
        db,
        workspace_id=ws,
        company_id=cid,
        due_from=d_from,
        due_to=d_to,
        vendor_search=vendor,
        amount_min=amount_min,
        amount_max=amount_max,
        category=category,
        property_id=property_id,
    )
    categories = sorted({str(i.get("category") or "Uncategorized") for i in invoices})
    return {
        "invoices": invoices,
        "count": len(invoices),
        "filters": {
            "due_from": d_from.isoformat(),
            "due_to": d_to.isoformat(),
        },
        "categories": categories,
    }


@router.get("/stats/monthly")
def payment_run_monthly_stats(
    request: Request,
    workspace_id: Optional[str] = Query(None),
    company_id: Optional[str] = Query(None),
    x_workspace_id: Optional[str] = Header(None, alias="X-Workspace-Id"),
    x_company_id: Optional[str] = Header(None, alias="X-Company-Id"),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    ws = _ws(request, workspace_id, x_workspace_id)
    cid = _company(request, company_id, x_company_id)
    if not ws or not cid:
        raise HTTPException(status_code=400, detail="workspace_id and company_id required")
    return svc.monthly_dashboard_stats(db, workspace_id=ws, company_id=cid)


@router.post("")
def create_payment_run(
    body: CreateRunIn,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        pay_d = date.fromisoformat(body.payment_date[:10]) if body.payment_date else None
        run = svc.create_payment_run(
            db,
            workspace_id=body.workspace_id.strip(),
            company_id=body.company_id.strip(),
            invoice_ids=body.invoice_ids,
            created_by=_actor(request),
            payment_date=pay_d,
            bank_account=body.bank_account,
            notes=body.notes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    invs = svc.invoices_for_run(db, run)
    return svc.run_to_dict(run, invs)


@router.get("/{run_id}")
def get_payment_run(
    run_id: str,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    company_id: Optional[str] = Query(None),
    x_workspace_id: Optional[str] = Header(None, alias="X-Workspace-Id"),
    x_company_id: Optional[str] = Header(None, alias="X-Company-Id"),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    ws = _ws(request, workspace_id, x_workspace_id)
    cid = _company(request, company_id, x_company_id) or None
    if not ws:
        raise HTTPException(status_code=400, detail="workspace_id required")
    run = svc.get_run(db, run_id=run_id, workspace_id=ws, company_id=cid)
    if not run:
        raise HTTPException(status_code=404, detail="Payment run not found")
    invs = svc.invoices_for_run(db, run)
    payload = svc.run_to_dict(run, invs)
    payload["invoices"] = [svc.invoice_row_dict(i) for i in invs]
    return payload


@router.post("/{run_id}/submit")
def submit_payment_run(
    run_id: str,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    company_id: Optional[str] = Query(None),
    x_workspace_id: Optional[str] = Header(None, alias="X-Workspace-Id"),
    x_company_id: Optional[str] = Header(None, alias="X-Company-Id"),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    ws = _ws(request, workspace_id, x_workspace_id)
    cid = _company(request, company_id, x_company_id) or None
    run = svc.get_run(db, run_id=run_id, workspace_id=ws, company_id=cid)
    if not run:
        raise HTTPException(status_code=404, detail="Payment run not found")
    try:
        run = svc.submit_run(db, run)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return svc.run_to_dict(run, svc.invoices_for_run(db, run))


@router.post("/{run_id}/approve")
def approve_payment_run(
    run_id: str,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    company_id: Optional[str] = Query(None),
    x_workspace_id: Optional[str] = Header(None, alias="X-Workspace-Id"),
    x_company_id: Optional[str] = Header(None, alias="X-Company-Id"),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    role = (request.headers.get("x-user-role") or request.headers.get("x-product-role") or "").strip()
    if role and not _is_cfo_like(request):
        raise HTTPException(status_code=403, detail="CFO approval required")
    ws = _ws(request, workspace_id, x_workspace_id)
    cid = _company(request, company_id, x_company_id) or None
    run = svc.get_run(db, run_id=run_id, workspace_id=ws, company_id=cid)
    if not run:
        raise HTTPException(status_code=404, detail="Payment run not found")
    try:
        run = svc.approve_run(db, run, approved_by=_actor(request))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return svc.run_to_dict(run, svc.invoices_for_run(db, run))


@router.post("/{run_id}/reject")
def reject_payment_run(
    run_id: str,
    body: RejectIn,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    company_id: Optional[str] = Query(None),
    x_workspace_id: Optional[str] = Header(None, alias="X-Workspace-Id"),
    x_company_id: Optional[str] = Header(None, alias="X-Company-Id"),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    role = (request.headers.get("x-user-role") or request.headers.get("x-product-role") or "").strip()
    if role and not _is_cfo_like(request):
        raise HTTPException(status_code=403, detail="CFO approval required")
    ws = _ws(request, workspace_id, x_workspace_id)
    cid = _company(request, company_id, x_company_id) or None
    run = svc.get_run(db, run_id=run_id, workspace_id=ws, company_id=cid)
    if not run:
        raise HTTPException(status_code=404, detail="Payment run not found")
    try:
        run = svc.reject_run(db, run, reason=body.reason, rejected_by=_actor(request))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return svc.run_to_dict(run, svc.invoices_for_run(db, run))


@router.post("/{run_id}/cancel")
def cancel_payment_run(
    run_id: str,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    company_id: Optional[str] = Query(None),
    x_workspace_id: Optional[str] = Header(None, alias="X-Workspace-Id"),
    x_company_id: Optional[str] = Header(None, alias="X-Company-Id"),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    ws = _ws(request, workspace_id, x_workspace_id)
    cid = _company(request, company_id, x_company_id) or None
    run = svc.get_run(db, run_id=run_id, workspace_id=ws, company_id=cid)
    if not run:
        raise HTTPException(status_code=404, detail="Payment run not found")
    try:
        run = svc.cancel_run(db, run, cancelled_by=_actor(request))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return svc.run_to_dict(run, svc.invoices_for_run(db, run))


@router.post("/{run_id}/execute")
def execute_payment_run(
    run_id: str,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    company_id: Optional[str] = Query(None),
    x_workspace_id: Optional[str] = Header(None, alias="X-Workspace-Id"),
    x_company_id: Optional[str] = Header(None, alias="X-Company-Id"),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    ws = _ws(request, workspace_id, x_workspace_id)
    cid = _company(request, company_id, x_company_id) or None
    run = svc.get_run(db, run_id=run_id, workspace_id=ws, company_id=cid)
    if not run:
        raise HTTPException(status_code=404, detail="Payment run not found")
    try:
        run = svc.execute_run(db, run)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Payment run execute failed")
        raise HTTPException(status_code=500, detail=f"Execute failed: {exc}") from exc
    payload = svc.run_to_dict(run, svc.invoices_for_run(db, run))
    payload["message"] = "Payment run executed — invoices marked paid and GL journal posted"
    return payload


@router.get("/{run_id}/bank-file")
def download_bank_file(
    run_id: str,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    company_id: Optional[str] = Query(None),
    x_workspace_id: Optional[str] = Header(None, alias="X-Workspace-Id"),
    x_company_id: Optional[str] = Header(None, alias="X-Company-Id"),
    db: Session = Depends(get_db),
) -> Response:
    ws = _ws(request, workspace_id, x_workspace_id)
    cid = _company(request, company_id, x_company_id) or None
    run = svc.get_run(db, run_id=run_id, workspace_id=ws, company_id=cid)
    if not run:
        raise HTTPException(status_code=404, detail="Payment run not found")
    if run.status not in {"approved", "executed"}:
        raise HTTPException(status_code=400, detail="Bank file available after approval")
    csv_text = svc.build_bank_file_csv(db, run)
    fname = f"{run.run_number}_bank_file.csv"
    return Response(
        content=csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.get("/{run_id}/remittance")
def download_remittance(
    run_id: str,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    company_id: Optional[str] = Query(None),
    x_workspace_id: Optional[str] = Header(None, alias="X-Workspace-Id"),
    x_company_id: Optional[str] = Header(None, alias="X-Company-Id"),
    db: Session = Depends(get_db),
) -> Response:
    ws = _ws(request, workspace_id, x_workspace_id)
    cid = _company(request, company_id, x_company_id) or None
    run = svc.get_run(db, run_id=run_id, workspace_id=ws, company_id=cid)
    if not run:
        raise HTTPException(status_code=404, detail="Payment run not found")
    if run.status != "executed":
        raise HTTPException(status_code=400, detail="Remittance available after execution")
    csv_text = svc.build_remittance_csv(db, run)
    fname = f"{run.run_number}_remittance.csv"
    return Response(
        content=csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )
