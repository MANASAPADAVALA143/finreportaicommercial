"""IFRS 15 API — full calculator, extraction, Excel export."""
from __future__ import annotations

import os
import shutil
import tempfile
import uuid
from decimal import Decimal
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.ifrs15.ifrs15_adapter import extraction_to_portfolio_payload, serialize_calculation_results
from app.modules.ifrs15.ifrs15_calculator import IFRS15Calculator, IFRS15Input, PerformanceObligation
from app.modules.ifrs15.ifrs15_extractor import IFRS15ContractExtractor, detect_nonstandard_clauses, read_contract_file_to_text
from app.modules.ifrs15.ifrs15_excel_export import IFRS15ExcelExporter
from app.services import ifrs15_service as svc

router = APIRouter(prefix="/api/ifrs15", tags=["IFRS 15"])


def _ws(request: Request, query_ws: str | None = None) -> str:
    return query_ws or request.headers.get("x-workspace-id") or request.headers.get("x-tenant-id") or "demo"


def _company_id(request: Request, query_cid: str | None = None) -> str | None:
    return query_cid or request.headers.get("x-company-id")


def _anthropic_key() -> str:
    key = (os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    if not key:
        raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY not configured")
    return key


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


class CalculateContractRequest(BaseModel):
    contract_id: str
    workspace_id: str = ""
    company_id: str | None = None
    cash_received_aed: float = 0


class CalculateInputRequest(BaseModel):
    contract_id: str = ""
    customer_name: str
    contract_value_aed: float
    performance_obligations: list[dict[str, Any]] = Field(default_factory=list)
    contract_date: str = ""
    currency: str = "AED"


class ExportExcelRequest(BaseModel):
    calculation_results: dict[str, Any]
    filename: str = "ifrs15_report.xlsx"


@router.post("/calculate-contract")
def calculate_stored_contract(body: CalculateContractRequest, request: Request, db: Session = Depends(get_db)):
    try:
        results = svc.calculate_full_contract(
            db,
            body.contract_id,
            _ws(request, body.workspace_id or None),
            body.company_id or _company_id(request),
            cash_received=body.cash_received_aed,
            persist=True,
        )
        return {"status": "success", "results": results}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/calculate")
def calculate_from_input(body: CalculateInputRequest):
    """Run full 5-step model from ad-hoc input (no DB persistence)."""
    from datetime import datetime

    effective = datetime.utcnow()
    if body.contract_date:
        try:
            effective = datetime.strptime(body.contract_date[:10], "%Y-%m-%d")
        except ValueError:
            pass

    pos = []
    for i, ob in enumerate(body.performance_obligations):
        method = str(ob.get("satisfaction_method") or "over_time").lower()
        recognition = "point_in_time" if "point" in method else "over_time"
        amt = float(ob.get("allocated_transaction_price_aed") or ob.get("standalone_selling_price_aed") or 0)
        pos.append(
            PerformanceObligation(
                obligation_id=f"PO-{i + 1}",
                description=str(ob.get("description") or f"Obligation {i + 1}"),
                standalone_selling_price=Decimal(str(amt)),
                recognition_method=recognition,
            )
        )

    if not pos:
        raise HTTPException(status_code=400, detail="At least one performance obligation required")

    calc_input = IFRS15Input(
        contract_id=body.contract_id or f"CTR-{uuid.uuid4().hex[:8]}",
        customer_name=body.customer_name,
        effective_date=effective,
        fixed_consideration=Decimal(str(body.contract_value_aed)),
        currency=body.currency or "AED",
        performance_obligations=pos,
    )
    calculator = IFRS15Calculator()
    results = calculator.calculate_full_ifrs15(calc_input)
    return {"status": "success", "results": serialize_calculation_results(results)}


@router.post("/extract")
async def extract_contract_text(
    request: Request,
    file: UploadFile = File(...),
    contract_type: str = Query("auto", description="auto | generic | uae_spa"),
    workspace_id: str | None = Query(None),
    company_id: str | None = Query(None),
):
    """Extract contract using full IFRS15ContractExtractor (replaces simple prompt)."""
    ext = Path((file.filename or "upload").replace("\\", "_")).suffix.lower()
    if ext not in {".pdf", ".docx", ".doc", ".txt", ".xlsx", ".xls"}:
        raise HTTPException(status_code=400, detail="Supported: PDF, DOCX, TXT, XLSX")

    upload_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
            upload_path = Path(tmp.name)
            shutil.copyfileobj(file.file, tmp)

        extractor = IFRS15ContractExtractor(api_key=_anthropic_key())
        ctype = (contract_type or "auto").strip().lower()
        if ctype == "auto":
            preview = read_contract_file_to_text(str(upload_path))[:8000].lower()
            if any(k in preview for k in ("rera", "oqood", "sale and purchase", "off-plan", "developer")):
                ctype = "uae_spa"
            else:
                ctype = "generic"

        extracted = extractor.extract_from_file(str(upload_path), contract_type=ctype)
        validation = (
            extractor.validate_uae_spa_extraction(extracted)
            if ctype == "uae_spa"
            else extractor.validate_ifrs15_extraction(extracted)
        )
        portfolio = extraction_to_portfolio_payload(extracted)
        clause_scan = detect_nonstandard_clauses(read_contract_file_to_text(str(upload_path)), api_key=_anthropic_key())

        return {
            "status": "success",
            "extraction_id": str(uuid.uuid4()),
            "contract_type_detected": ctype,
            "extracted_data": portfolio,
            "raw_extraction": _make_serializable(extracted),
            "validation": validation,
            "clause_scan": clause_scan,
            "workspace_id": _ws(request, workspace_id),
            "company_id": company_id or _company_id(request),
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)[:300]) from exc
    finally:
        if upload_path and upload_path.exists():
            upload_path.unlink(missing_ok=True)


@router.post("/export-excel")
async def export_excel(body: ExportExcelRequest):
    out_dir = Path(tempfile.gettempdir()) / "ifrs15_exports"
    out_dir.mkdir(parents=True, exist_ok=True)
    safe_name = "".join(c if c.isalnum() or c in "._-" else "_" for c in body.filename)
    filepath = out_dir / safe_name
    exporter = IFRS15ExcelExporter()
    exporter.export_ifrs15_workbook(body.calculation_results, str(filepath))
    file_id = uuid.uuid4().hex[:12]
    tagged = out_dir / f"{file_id}_{safe_name}"
    filepath.rename(tagged)
    return {"status": "success", "file_id": file_id, "filename": tagged.name}


@router.get("/download/{file_id}")
async def download_export(file_id: str):
    out_dir = Path(tempfile.gettempdir()) / "ifrs15_exports"
    matches = sorted(out_dir.glob(f"{file_id}_*.xlsx"))
    if not matches:
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(
        path=str(matches[-1]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=matches[-1].name.split("_", 1)[-1],
    )
