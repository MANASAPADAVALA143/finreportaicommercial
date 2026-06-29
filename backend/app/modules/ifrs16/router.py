"""IFRS 16 API — calculator, repository, JEs, remeasurement, audit PDF."""
from __future__ import annotations

import os
import shutil
import tempfile
import uuid
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.company_setup import UaeCompanyProfile
from app.modules.ifrs16.ifrs16_audit_pdf import build_ifrs16_audit_pdf
from app.modules.ifrs16.ifrs16_je_service import post_all_monthly_jes, post_monthly_jes
from app.modules.ifrs16.ifrs16_remeasure_service import remeasure_lease
from app.modules.ifrs16.ifrs16_repository import (
    create_lease,
    get_lease,
    list_leases,
    portfolio_summary,
    soft_delete_lease,
    update_lease,
    _lease_to_dict,
)

router = APIRouter(prefix="/api/ifrs16", tags=["IFRS 16"])


# ── helpers ──────────────────────────────────────────────────────────────────

def _ws(request: Request, query_ws: str | None = None) -> str:
    return query_ws or request.headers.get("x-workspace-id") or request.headers.get("x-tenant-id") or "demo"


def _company_id(request: Request, query_cid: str | None = None) -> str | None:
    return query_cid or request.headers.get("x-company-id")


def _anthropic_key() -> str:
    return (os.environ.get("ANTHROPIC_API_KEY") or "").strip()


def _serialize_results(results: dict[str, Any]) -> dict[str, Any]:
    out = results.copy()
    if "amortization_schedule" in out:
        df = out["amortization_schedule"]
        out["amortization_schedule"] = df.to_dict(orient="records")
    for key, val in list(out.items()):
        if isinstance(val, Decimal):
            out[key] = float(val)
    return out


def _make_serializable(obj: Any) -> Any:
    if obj is None:
        return None
    if isinstance(obj, dict):
        return {str(k): _make_serializable(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_make_serializable(v) for v in obj]
    if isinstance(obj, (str, int, float, bool)):
        return obj
    if isinstance(obj, Decimal):
        return float(obj)
    if hasattr(obj, "isoformat"):
        return obj.isoformat()
    return str(obj)


def _to_lease_input(request: "LeaseRequest"):
    from app.modules.ifrs16.ifrs16_calculator import LeaseInput

    raw_date = (request.commencement_date or "").strip()[:10]
    try:
        commencement_dt = datetime.strptime(raw_date, "%Y-%m-%d")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="commencement_date must be YYYY-MM-DD") from exc

    return LeaseInput(
        lease_id=request.lease_id,
        asset_description=request.asset_description,
        lessee_name=request.lessee_name,
        lessor_name=request.lessor_name,
        commencement_date=commencement_dt,
        lease_term_months=request.lease_term_months,
        monthly_payment=Decimal(str(request.monthly_payment)),
        non_lease_component=Decimal(str(request.non_lease_component)),
        non_lease_description=request.non_lease_description,
        practical_expedient_elected=request.practical_expedient_elected,
        annual_discount_rate=Decimal(str(request.annual_discount_rate)),
        initial_direct_costs=Decimal(str(request.initial_direct_costs)),
        legal_fees=Decimal(str(request.legal_fees)),
        brokerage_fees=Decimal(str(request.brokerage_fees)),
        other_initial_direct_costs=Decimal(str(request.other_initial_direct_costs)),
        initial_direct_costs_description=request.initial_direct_costs_description,
        escalation_rate=Decimal(str(request.escalation_rate)),
        cpi_index_base=Decimal(str(request.cpi_index_base)),
        cpi_index_current=Decimal(str(request.cpi_index_current)),
        cpi_adjustment_frequency_months=request.cpi_index_adjustment_frequency_months,
        currency=request.currency,
        payment_type=request.payment_type,
        rent_free_months=request.rent_free_months,
        cash_incentive=Decimal(str(request.cash_incentive)),
        lease_incentive_description=request.lease_incentive_description,
        rvg_amount=Decimal(str(request.rvg_amount)),
        rvg_guaranteed_by=request.rvg_guaranteed_by,
        rvg_expected_payment=Decimal(str(request.rvg_expected_payment)),
    )


# ── schemas ──────────────────────────────────────────────────────────────────

class LeaseRequest(BaseModel):
    lease_id: str
    asset_description: str
    commencement_date: str
    lease_term_months: int = Field(..., gt=0)
    monthly_payment: float = Field(..., gt=0)
    annual_discount_rate: float = Field(..., gt=0.0001, le=1)
    lessee_name: str = ""
    lessor_name: str = ""
    non_lease_component: float = 0
    non_lease_description: str = ""
    practical_expedient_elected: bool = False
    initial_direct_costs: float = 0
    legal_fees: float = 0
    brokerage_fees: float = 0
    other_initial_direct_costs: float = 0
    initial_direct_costs_description: str = ""
    escalation_rate: float = 0
    cpi_index_base: float = 0
    cpi_index_current: float = 0
    cpi_index_adjustment_frequency_months: int = 12
    currency: str = "AED"
    payment_type: str = "Arrears"
    rent_free_months: int = 0
    cash_incentive: float = 0
    lease_incentive_description: str = ""
    rvg_amount: float = 0
    rvg_guaranteed_by: str = "None"
    rvg_expected_payment: float = 0


class SaveLeaseRequest(BaseModel):
    workspace_id: str = ""
    company_id: str | None = None
    lease_name: str = ""
    asset_description: str = ""
    asset_class: str = "property"
    commencement_date: str
    lease_term_months: int
    lease_payments_aed: float = 0
    monthly_payment: float = 0
    payment_frequency: str = "monthly"
    incremental_borrowing_rate: float = 0
    annual_discount_rate: float = 0
    lease_liability: float = 0
    rou_asset: float = 0
    calculation_results: dict[str, Any] = Field(default_factory=dict)


class PatchLeaseRequest(BaseModel):
    lease_name: str | None = None
    asset_description: str | None = None
    asset_class: str | None = None
    status: str | None = None
    lease_payments_aed: float | None = None
    rou_asset_current: float | None = None
    lease_liability_current: float | None = None
    calculation_results: dict[str, Any] | None = None


class PostMonthlyJeRequest(BaseModel):
    lease_id: str
    period_date: str
    workspace_id: str = ""
    company_id: str | None = None


class BulkPostJeRequest(BaseModel):
    period_date: str
    workspace_id: str = ""
    company_id: str | None = None


class RemeasureRequest(BaseModel):
    lease_id: str
    remeasurement_date: str
    new_cpi_rate: float = 0
    new_annual_payment_aed: float
    workspace_id: str = ""
    company_id: str | None = None


class AuditPdfRequest(BaseModel):
    lease_id: str | None = None
    workspace_id: str = ""
    company_id: str | None = None
    period_date: str = ""
    prepared_by: str = "CFO User"


class ExtractionRequest(BaseModel):
    contract_text: str


class BulkCalculateRequest(BaseModel):
    leases: list[LeaseRequest]


class ExportExcelRequest(BaseModel):
    lease_id: str = "lease"
    calculation_results: dict[str, Any]


class IbrBenchmarkRequest(BaseModel):
    country: str = "UAE"
    credit_rating: str = "BBB"
    lease_term_years: int = 5
    currency: str = "AED"


class ComponentRow(BaseModel):
    name: str
    type: str = "lease"
    amount: float


class ComponentSplitRequest(BaseModel):
    total_contract_payment: float
    components: list[ComponentRow]
    term_months: int
    ibr: float
    commencement_date: str
    currency: str = "AED"
    lease_id: str = "SPLIT"


class HealthScoreRequest(BaseModel):
    leases: list[dict[str, Any]] = Field(default_factory=list)
    alerts_count: int = 0


# ── Phase 1 calculator (existing) ────────────────────────────────────────────

@router.post("/calculate")
def calculate_lease(request: LeaseRequest):
    try:
        from app.modules.ifrs16.ifrs16_calculator import IFRS16Calculator

        lease_input = _to_lease_input(request)
        calculator = IFRS16Calculator()
        results = calculator.calculate_full_ifrs16(lease_input)
        results_json = _serialize_results(results)
        return {
            "status": "success",
            "lease_id": request.lease_id,
            "results": results_json,
            "lease_liability": results_json.get("lease_liability"),
            "rou_asset": results_json.get("rou_asset"),
            "total_interest": results_json.get("total_interest"),
            "currency": request.currency,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/bulk-calculate")
def bulk_calculate(body: BulkCalculateRequest):
    from app.modules.ifrs16.ifrs16_calculator import IFRS16Calculator

    out_results: list[dict[str, Any]] = []
    total_ll = total_rou = ibr_sum = 0.0
    currency_counts: dict[str, int] = {}
    successful = failed = 0

    for lease in body.leases:
        try:
            lease_input = _to_lease_input(lease)
            calculator = IFRS16Calculator()
            result = calculator.calculate_full_ifrs16(lease_input)
            result_json = _serialize_results(result)
            ll = float(result.get("lease_liability", 0) or 0)
            rou = float(result.get("rou_asset", 0) or 0)
            total_ll += ll
            total_rou += rou
            ibr_sum += float(lease.annual_discount_rate or 0)
            ccy = (lease.currency or "AED").upper()
            currency_counts[ccy] = currency_counts.get(ccy, 0) + 1
            successful += 1
            out_results.append({
                "lease_id": lease.lease_id, "status": "success", "error": None,
                "lease_liability": ll, "rou_asset": rou, "calculation_results": result_json,
            })
        except Exception as exc:
            failed += 1
            out_results.append({
                "lease_id": lease.lease_id, "status": "error", "error": str(exc), "calculation_results": None,
            })

    return {
        "total": len(body.leases), "successful": successful, "failed": failed,
        "results": out_results,
        "portfolio_summary": {
            "total_lease_liability": total_ll, "total_rou_asset": total_rou,
            "avg_ibr": (ibr_sum / successful) if successful else 0.0,
            "currency_breakdown": currency_counts,
        },
    }


@router.post("/export-excel")
def export_excel(body: ExportExcelRequest):
    try:
        from app.modules.ifrs16.ifrs16_excel_export import IFRS16ExcelExporter
        exporter = IFRS16ExcelExporter()
        data = exporter.export_ifrs16_workbook_bytes(body.calculation_results)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Excel export failed: {exc}") from exc
    safe = "".join(c for c in (body.lease_id or "lease") if c.isalnum() or c in "._-")[:80] or "lease"
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="IFRS16_{safe}.xlsx"'},
    )


@router.post("/extract")
def extract_contract(request: ExtractionRequest):
    if not _anthropic_key():
        raise HTTPException(status_code=503, detail="Claude API not configured.")
    try:
        from app.modules.ifrs16.ifrs16_extractor import IFRS16LeaseExtractor
        extractor = IFRS16LeaseExtractor(api_key=_anthropic_key())
        extracted_data = extractor.extract_lease_terms(request.contract_text)
        validation = extractor.validate_extraction(extracted_data)
        return {
            "status": "success", "extraction_id": str(uuid.uuid4()),
            "extracted_data": _make_serializable(extracted_data),
            "validation": _make_serializable(validation),
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Extraction error: {exc}") from exc


@router.post("/upload-contract")
async def upload_contract(file: UploadFile = File(...)):
    if not _anthropic_key():
        raise HTTPException(status_code=503, detail="Claude API not configured.")
    allowed = {".pdf", ".docx", ".txt", ".xlsx", ".xls"}
    safe_name = (file.filename or "upload").replace("\\", "_").replace("/", "_")
    ext = Path(safe_name).suffix.lower()
    if ext not in allowed:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")
    upload_path: Optional[Path] = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
            upload_path = Path(tmp.name)
            shutil.copyfileobj(file.file, tmp)
        from app.modules.ifrs16.ifrs16_extractor import IFRS16LeaseExtractor
        extractor = IFRS16LeaseExtractor(api_key=_anthropic_key())
        extracted_data = extractor.extract_from_file(str(upload_path))
        try:
            validation = extractor.validate_extraction(extracted_data)
        except Exception as val_exc:
            validation = {"is_valid": False, "errors": [str(val_exc)], "requires_review": True}
        return {
            "status": "success", "file_id": str(uuid.uuid4()), "filename": safe_name,
            "extracted_data": _make_serializable(extracted_data),
            "validation": _make_serializable(validation),
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Extraction failed: {str(exc)[:200]}") from exc
    finally:
        if upload_path and upload_path.exists():
            upload_path.unlink(missing_ok=True)


# ── Phase 3 — Lease repository ───────────────────────────────────────────────

@router.get("/leases")
def get_leases(
    request: Request,
    workspace_id: str | None = Query(None),
    company_id: str | None = Query(None),
    status: str | None = Query(None),
    asset_class: str | None = Query(None),
    search: str | None = Query(None),
    db: Session = Depends(get_db),
):
    ws = _ws(request, workspace_id)
    cid = company_id or _company_id(request)
    return {"leases": list_leases(db, ws, cid, status=status, asset_class=asset_class, search=search)}


@router.get("/leases/{lease_id}")
def get_lease_detail(
    lease_id: str,
    request: Request,
    workspace_id: str | None = Query(None),
    company_id: str | None = Query(None),
    db: Session = Depends(get_db),
):
    ws = _ws(request, workspace_id)
    cid = company_id or _company_id(request)
    lease = get_lease(db, lease_id, ws, cid)
    if not lease:
        raise HTTPException(status_code=404, detail="Lease not found")
    return _lease_to_dict(lease)


@router.post("/leases")
def save_lease(
    body: SaveLeaseRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    ws = _ws(request, body.workspace_id or None)
    cid = body.company_id or _company_id(request)
    data = body.model_dump()
    data["workspace_id"] = ws
    data["company_id"] = cid
    if not data.get("lease_payments_aed"):
        data["lease_payments_aed"] = data.get("monthly_payment", 0)
    if not data.get("incremental_borrowing_rate"):
        data["incremental_borrowing_rate"] = data.get("annual_discount_rate", 0)
    lease = create_lease(db, data)
    return {"status": "success", "lease": _lease_to_dict(lease)}


@router.patch("/leases/{lease_id}")
def patch_lease(
    lease_id: str,
    body: PatchLeaseRequest,
    request: Request,
    workspace_id: str | None = Query(None),
    company_id: str | None = Query(None),
    db: Session = Depends(get_db),
):
    ws = _ws(request, workspace_id)
    cid = company_id or _company_id(request)
    lease = get_lease(db, lease_id, ws, cid)
    if not lease:
        raise HTTPException(status_code=404, detail="Lease not found")
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    updated = update_lease(db, lease, updates)
    return {"status": "success", "lease": _lease_to_dict(updated)}


@router.delete("/leases/{lease_id}")
def delete_lease(
    lease_id: str,
    request: Request,
    workspace_id: str | None = Query(None),
    company_id: str | None = Query(None),
    db: Session = Depends(get_db),
):
    ws = _ws(request, workspace_id)
    cid = company_id or _company_id(request)
    lease = get_lease(db, lease_id, ws, cid)
    if not lease:
        raise HTTPException(status_code=404, detail="Lease not found")
    soft_delete_lease(db, lease)
    return {"status": "success", "lease_id": lease_id}


@router.get("/portfolio-summary")
def get_portfolio_summary(
    request: Request,
    workspace_id: str | None = Query(None),
    company_id: str | None = Query(None),
    db: Session = Depends(get_db),
):
    ws = _ws(request, workspace_id)
    cid = company_id or _company_id(request)
    return portfolio_summary(db, ws, cid)


# ── Phase 3 — Monthly JEs ────────────────────────────────────────────────────

@router.post("/post-monthly-je")
def post_monthly_je(body: PostMonthlyJeRequest, request: Request, db: Session = Depends(get_db)):
    ws = _ws(request, body.workspace_id or None)
    cid = body.company_id or _company_id(request)
    try:
        period = date.fromisoformat(body.period_date[:10])
        result = post_monthly_jes(db, body.lease_id, period, ws, cid)
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/post-all-monthly-je")
def post_all_je(body: BulkPostJeRequest, request: Request, db: Session = Depends(get_db)):
    ws = _ws(request, body.workspace_id or None)
    cid = body.company_id or _company_id(request)
    try:
        period = date.fromisoformat(body.period_date[:10])
        return post_all_monthly_jes(db, ws, cid, period)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# ── Phase 3 — CPI Remeasurement ──────────────────────────────────────────────

@router.post("/remeasure")
def remeasure(body: RemeasureRequest, request: Request, db: Session = Depends(get_db)):
    ws = _ws(request, body.workspace_id or None)
    cid = body.company_id or _company_id(request)
    try:
        rem_date = date.fromisoformat(body.remeasurement_date[:10])
        return remeasure_lease(
            db,
            lease_id=body.lease_id,
            remeasurement_date=rem_date,
            new_cpi_rate=body.new_cpi_rate,
            new_annual_payment_aed=body.new_annual_payment_aed,
            workspace_id=ws,
            company_id=cid,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# ── Phase 3 — Audit PDF ──────────────────────────────────────────────────────

@router.post("/audit-pdf")
def audit_pdf(body: AuditPdfRequest, request: Request, db: Session = Depends(get_db)):
    ws = _ws(request, body.workspace_id or None)
    cid = body.company_id or _company_id(request)
    period = body.period_date or date.today().strftime("%Y-%m")

    company_name = "Company"
    if cid:
        prof = db.query(UaeCompanyProfile).filter(UaeCompanyProfile.id == cid).first()
        if prof:
            company_name = prof.company_name

    summary = portfolio_summary(db, ws, cid)
    if body.lease_id:
        lease = get_lease(db, body.lease_id, ws, cid)
        leases = [_lease_to_dict(lease)] if lease else []
    else:
        leases = list_leases(db, ws, cid)

    pdf_bytes = build_ifrs16_audit_pdf(
        company_name=company_name,
        period_date=period,
        prepared_by=body.prepared_by,
        portfolio=summary,
        leases=leases,
    )
    fname = f"IFRS16_Audit_{period.replace('/', '-')}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.get("/health")
def ifrs16_health():
    return {"status": "ok", "module": "ifrs16", "claude_configured": bool(_anthropic_key())}


@router.post("/ibr-benchmark")
def ibr_benchmark(body: IbrBenchmarkRequest):
    from app.modules.ifrs16.ifrs16_ibr_benchmark import benchmark_ibr

    return benchmark_ibr(body.country, body.credit_rating, body.lease_term_years, body.currency)


@router.post("/component-split")
def component_split(body: ComponentSplitRequest):
    from app.modules.ifrs16.ifrs16_component_split import split_and_calculate

    try:
        payload = body.model_dump()
        payload["components"] = [c.model_dump() for c in body.components]
        return split_and_calculate(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/health-score")
def health_score(body: HealthScoreRequest):
    from app.modules.ifrs16.ifrs16_health_audit import compute_health_score

    return compute_health_score(body.leases, body.alerts_count)
