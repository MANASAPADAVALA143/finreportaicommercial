"""
Week 1 — Trial balance upload, Claude GL→IFRS mapping, review APIs.
Mounted at prefix /api/ifrs (see main.py).
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import date, datetime
from pathlib import Path
from typing import Any, Literal, Optional

import pandas as pd
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    Header,
    HTTPException,
    UploadFile,
)
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.ifrs_statement import (
    BoardPack,
    BoardPackStatus,
    ComplianceCheck,
    DisclosureNote,
    DisclosureNoteStatus,
    GeneratedStatement,
    GLMapping,
    IFRSLineItemMaster,
    IFRSLink,
    IFRSStatementKind,
    MappingSourceEnum,
    MappingTemplate,
    RiskFlag,
    StatementCommentary,
    StatementLineItem,
    TBStatus,
    TrialBalance,
    TrialBalanceLine,
)
from app.services.compliance_checker import run_compliance_checks
from app.services.disclosure_generator import (
    generate_all_notes,
    generate_n1_accounting_policies,
    generate_n10_subsequent_events,
    generate_n2_fixed_assets,
    generate_n3_leases,
    generate_n4_financial_instruments,
    generate_n5_revenue,
    generate_n6_borrowings,
    generate_n7_tax,
    generate_n8_related_parties,
    generate_n9_contingencies,
)
from app.services.gl_mapping_ai import apply_ai_mappings_to_db, infer_account_type
from app.services.board_pack_data import build_board_pack_data
from app.services.board_pack_generator import BoardPackGenerator, count_pdf_pages
from app.services.board_pack_seed import (
    seed_commentary_and_risks_for_trial_balance,
    seed_commentary_only,
    seed_risks_only,
)
from app.services.mapping_validator import human_mapping_signoff, validate_mappings
from app.services.statement_generator import build_tb_data_from_db, generate_all_statements
from app.services.tb_column_mapper import (
    load_trial_balance_dataframe,
    load_trial_balance_dataframe_no_header,
    resolve_trial_balance_dataframe,
    trial_balance_dataframe_to_rows,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["ifrs-week1"])


def tenant_id_header(x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-ID")) -> str:
    return (x_tenant_id or "default").strip() or "default"


@router.get("/line-item-master")
def list_line_item_master(
    statement: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """IFRS line items for GL mapping dropdowns (seeded from `ifrs_line_item_master`)."""
    q = db.query(IFRSLineItemMaster).order_by(
        IFRSLineItemMaster.statement,
        IFRSLineItemMaster.section,
        IFRSLineItemMaster.display_order,
        IFRSLineItemMaster.name,
    )
    if statement:
        q = q.filter(IFRSLineItemMaster.statement == statement.strip())
    rows = q.all()
    return {
        "items": [
            {
                "name": r.name,
                "statement": r.statement,
                "section": r.section,
                "is_calculated": r.is_calculated,
                "standard": r.standard,
            }
            for r in rows
        ],
        "count": len(rows),
    }


def _safe_filename(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]+", "_", name)[:200] or "upload"


def _detect_currency(filename: str, df: pd.DataFrame, form_currency: Optional[str]) -> str:
    """
    Explicit multipart Form `currency` wins when set.
    Otherwise: filename tokens, then first 3 rows (INR / Lakhs / Rs / Rupees), default USD.
    """
    if form_currency is not None and str(form_currency).strip():
        return str(form_currency).strip().upper()[:8]

    up = (filename or "").upper()
    if "GBP" in up:
        return "GBP"
    if "EUR" in up:
        return "EUR"
    if "INR" in up:
        return "INR"
    if "USD" in up:
        return "USD"

    try:
        head3 = df.head(3).to_string()
    except Exception:
        head3 = ""
    hu = head3.upper()
    if any(
        tok in hu
        for tok in (
            "INR",
            "LAKH",
            "LACS",
            "LAC ",
            "RUPEES",
            "RS.",
            " RS ",
            " RS\n",
            "₹",
        )
    ) or "\u20b9" in head3:
        return "INR"
    if "$" in head3 or "USD" in hu:
        return "USD"
    return "USD"


def _dedupe_gl_mappings_latest_per_line(mappings: list[GLMapping]) -> list[GLMapping]:
    """Newest row per trial_balance_line_id (highest GLMapping.id wins)."""
    ordered = sorted(mappings, key=lambda m: (m.trial_balance_line_id, -m.id))
    seen: set[int] = set()
    out: list[GLMapping] = []
    for m in ordered:
        if m.trial_balance_line_id in seen:
            continue
        seen.add(m.trial_balance_line_id)
        out.append(m)
    return out


def _row_ready_for_statement_generation(m: GLMapping) -> bool:
    """Same gate as statement generation: no critical/error rules; confidence ≥70% or user sign-off."""
    issues = m.validator_issues or []
    if any(isinstance(i, dict) and i.get("severity") == "critical" for i in issues):
        return False
    if any(isinstance(i, dict) and i.get("severity") == "error" for i in issues):
        return False
    if human_mapping_signoff(m):
        return True
    return float(m.ai_confidence_score or 0) >= 0.70


def _harness_tier(m: GLMapping) -> str:
    """UI tier: blocked = critical/error only; low AI confidence uses needs_review (not blocked)."""
    issues = m.validator_issues or []
    crit = any(isinstance(i, dict) and i.get("severity") == "critical" for i in issues)
    err = any(isinstance(i, dict) and i.get("severity") == "error" for i in issues)
    if crit or err:
        return "blocked"
    if m.is_confirmed and not m.needs_review:
        if m.mapping_source == MappingSourceEnum.ai_suggested:
            return "auto_confirmed"
        return "confirmed"
    desc = (m.gl_description or "").lower()
    if m.is_contra and ("depreciation" in desc or "amort" in desc):
        return "auto_fixed"
    return "needs_review"


def run_ai_mapping_job(
    trial_balance_id: int, tenant_id: str, *, allow_remapping: bool = False
) -> None:
    from app.core.database import SessionLocal

    db = SessionLocal()
    try:
        tb = (
            db.query(TrialBalance)
            .filter(
                TrialBalance.id == trial_balance_id,
                TrialBalance.tenant_id == tenant_id,
            )
            .first()
        )
        if not tb:
            return
        if tb.status == TBStatus.mapping_in_progress:
            logger.info(
                "Mapping already in progress for trial_balance_id=%s; skip duplicate job",
                trial_balance_id,
            )
            return

        from_states = (
            [TBStatus.uploaded, TBStatus.mapped, TBStatus.statements_generated]
            if allow_remapping
            else [TBStatus.uploaded]
        )
        claimed = (
            db.query(TrialBalance)
            .filter(
                TrialBalance.id == trial_balance_id,
                TrialBalance.tenant_id == tenant_id,
                TrialBalance.status.in_(from_states),
            )
            .update(
                {TrialBalance.status: TBStatus.mapping_in_progress},
                synchronize_session=False,
            )
        )
        db.commit()
        if claimed == 0:
            logger.info(
                "Skip mapping job for trial_balance_id=%s (allow_remapping=%s, status=%s)",
                trial_balance_id,
                allow_remapping,
                tb.status.value,
            )
            return

        lines = (
            db.query(TrialBalanceLine)
            .filter(TrialBalanceLine.trial_balance_id == trial_balance_id)
            .order_by(TrialBalanceLine.id)
            .all()
        )
        tb = db.query(TrialBalance).filter(TrialBalance.id == trial_balance_id).first()
        if not tb:
            return
        apply_ai_mappings_to_db(db, tenant_id, tb, lines)
        _prune_duplicate_gl_mappings(db, trial_balance_id, tenant_id)
        tb = db.query(TrialBalance).filter(TrialBalance.id == trial_balance_id).first()
        if tb:
            tb.status = TBStatus.mapped
            db.commit()
        # CFO AI Harness: rule validator + routing (separate from Claude mapping).
        validate_mappings(trial_balance_id, db, apply_routing=True, apply_fixes=True)
    except Exception:
        logger.exception("GL AI mapping failed for trial_balance_id=%s", trial_balance_id)
        try:
            tb = (
                db.query(TrialBalance)
                .filter(
                    TrialBalance.id == trial_balance_id,
                    TrialBalance.tenant_id == tenant_id,
                )
                .first()
            )
            if tb:
                tb.status = TBStatus.uploaded
                db.commit()
        except Exception:
            db.rollback()
        finally:
            pass
    finally:
        db.close()


@router.post("/trial-balance/upload")
async def trial_balance_upload(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    company_name: str = Form("Uploaded Entity"),
    period_start: Optional[str] = Form(None),
    period_end: Optional[str] = Form(None),
    uploaded_by: Optional[str] = Form(None),
    # Omit field to auto-detect from filename + first 3 rows; send e.g. currency=INR to override.
    currency: Optional[str] = Form(default=None),
    auto_map: bool = Form(True),
    tenant_id: str = Depends(tenant_id_header),
    db: Session = Depends(get_db),
):
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")

    name = file.filename or "trial_balance.csv"
    try:
        df = load_trial_balance_dataframe(name, content)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not parse file: {e}") from e

    df, cmap = resolve_trial_balance_dataframe(df)
    rows, missing = trial_balance_dataframe_to_rows(df, cmap)
    if missing or not rows:
        try:
            df_raw = load_trial_balance_dataframe_no_header(name, content)
            df2, cmap2 = resolve_trial_balance_dataframe(df_raw)
            rows2, missing2 = trial_balance_dataframe_to_rows(df2, cmap2)
            if not missing2 and rows2:
                df, cmap, rows, missing = df2, cmap2, rows2, missing2
        except Exception:
            pass
    if missing:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Missing required columns (after normalisation): {missing}. Found: {list(df.columns)}. "
                "Use one header row with account code, description, debit, and credit (or place that row below any title rows)."
            ),
        )
    if not rows:
        raise HTTPException(status_code=400, detail="No data rows in file")

    resolved_currency = _detect_currency(name, df, currency)

    def _parse_d(s: Optional[str]) -> Optional[date]:
        if not s:
            return None
        try:
            return date.fromisoformat(s[:10])
        except ValueError:
            return None

    upload_root = Path(__file__).resolve().parents[3] / "uploads" / "trial_balance" / tenant_id
    upload_root.mkdir(parents=True, exist_ok=True)

    tb = TrialBalance(
        tenant_id=tenant_id,
        company_name=company_name,
        period_start=_parse_d(period_start),
        period_end=_parse_d(period_end),
        currency=resolved_currency,
        uploaded_by=uploaded_by,
        status=TBStatus.uploaded,
        file_name=name,
        file_path=None,
    )
    db.add(tb)
    db.flush()

    rel_path = upload_root / f"{tb.id}_{_safe_filename(name)}"
    rel_path.write_bytes(content)
    tb.file_path = str(rel_path)

    for r in rows:
        net = float(r["debit_amount"]) - float(r["credit_amount"])
        acct = infer_account_type(
            float(r["debit_amount"]),
            float(r["credit_amount"]),
            r.get("account_type_raw"),
        )
        line = TrialBalanceLine(
            trial_balance_id=tb.id,
            tenant_id=tenant_id,
            gl_code=r["gl_code"],
            gl_description=r["gl_description"],
            debit_amount=float(r["debit_amount"]),
            credit_amount=float(r["credit_amount"]),
            net_amount=net,
            account_type=acct,
        )
        db.add(line)

    db.commit()
    db.refresh(tb)

    existing_maps = (
        db.query(GLMapping)
        .filter(GLMapping.trial_balance_id == tb.id, GLMapping.tenant_id == tenant_id)
        .count()
    )
    if auto_map and existing_maps == 0:
        background_tasks.add_task(run_ai_mapping_job, tb.id, tenant_id)
        map_msg = "AI mapping started in background"
    elif auto_map:
        map_msg = "Skipped auto-map: mappings already exist for this trial balance"
    else:
        map_msg = "Auto-map disabled; call POST .../map-with-ai when ready"

    return {
        "trial_balance_id": tb.id,
        "lines_count": len(rows),
        "status": tb.status.value,
        "currency": resolved_currency,
        "auto_map": auto_map,
        "message": f"Upload stored; {map_msg}",
    }


@router.get("/trial-balance/{trial_balance_id}")
def get_trial_balance(
    trial_balance_id: int,
    tenant_id: str = Depends(tenant_id_header),
    db: Session = Depends(get_db),
):
    tb = (
        db.query(TrialBalance)
        .filter(TrialBalance.id == trial_balance_id, TrialBalance.tenant_id == tenant_id)
        .first()
    )
    if not tb:
        raise HTTPException(status_code=404, detail="Trial balance not found")
    lines = (
        db.query(TrialBalanceLine)
        .filter(TrialBalanceLine.trial_balance_id == tb.id)
        .order_by(TrialBalanceLine.gl_code)
        .all()
    )
    return {
        "trial_balance": {
            "id": tb.id,
            "tenant_id": tb.tenant_id,
            "company_name": tb.company_name,
            "period_start": tb.period_start.isoformat() if tb.period_start else None,
            "period_end": tb.period_end.isoformat() if tb.period_end else None,
            "currency": tb.currency,
            "status": tb.status.value,
            "file_name": tb.file_name,
            "uploaded_at": tb.uploaded_at.isoformat() if tb.uploaded_at else None,
        },
        "lines": [
            {
                "id": ln.id,
                "gl_code": ln.gl_code,
                "gl_description": ln.gl_description,
                "debit_amount": ln.debit_amount,
                "credit_amount": ln.credit_amount,
                "net_amount": ln.net_amount,
                "account_type": ln.account_type.value,
            }
            for ln in lines
        ],
        "lines_count": len(lines),
    }


@router.post("/trial-balance/{trial_balance_id}/map-with-ai")
def trigger_map_with_ai(
    trial_balance_id: int,
    background_tasks: BackgroundTasks,
    tenant_id: str = Depends(tenant_id_header),
    db: Session = Depends(get_db),
):
    tb = (
        db.query(TrialBalance)
        .filter(TrialBalance.id == trial_balance_id, TrialBalance.tenant_id == tenant_id)
        .first()
    )
    if not tb:
        raise HTTPException(status_code=404, detail="Trial balance not found")
    if tb.status == TBStatus.mapping_in_progress:
        return {
            "trial_balance_id": trial_balance_id,
            "status": "already_running",
            "message": "AI mapping is already in progress for this trial balance",
        }
    background_tasks.add_task(
        run_ai_mapping_job, trial_balance_id, tenant_id, allow_remapping=True
    )
    return {
        "trial_balance_id": trial_balance_id,
        "status": "started",
        "message": "AI mapping job queued",
    }


@router.get("/trial-balance/{trial_balance_id}/mappings")
def get_tb_mappings(
    trial_balance_id: int,
    tenant_id: str = Depends(tenant_id_header),
    db: Session = Depends(get_db),
):
    tb = (
        db.query(TrialBalance)
        .filter(TrialBalance.id == trial_balance_id, TrialBalance.tenant_id == tenant_id)
        .first()
    )
    if not tb:
        raise HTTPException(status_code=404, detail="Trial balance not found")
    raw_mappings = (
        db.query(GLMapping)
        .filter(
            GLMapping.trial_balance_id == trial_balance_id,
            GLMapping.tenant_id == tenant_id,
        )
        .all()
    )
    mappings = _dedupe_gl_mappings_latest_per_line(raw_mappings)
    lines_n = (
        db.query(TrialBalanceLine)
        .filter(TrialBalanceLine.trial_balance_id == trial_balance_id)
        .count()
    )
    confirmed = sum(1 for m in mappings if m.is_confirmed)
    needs_review = sum(1 for m in mappings if m.needs_review and not m.is_confirmed)
    ai_suggested = sum(
        1 for m in mappings if m.mapping_source == MappingSourceEnum.ai_suggested and not m.is_confirmed
    )
    tiers = [_harness_tier(m) for m in mappings]
    blocked_n = sum(1 for t in tiers if t == "blocked")
    # Avoid fake 100% / "ready" when there are no mapping rows yet (mapping job still running or failed).
    if not mappings:
        harness_payload = {
            "harness_score": 0,
            "ready_to_generate": False,
            "auto_confirmed": 0,
            "needs_review": 0,
            "blocked": 0,
            "auto_fixed": 0,
        }
    else:
        total_m = max(len(mappings), 1)
        ready_n = sum(1 for m in mappings if _row_ready_for_statement_generation(m))
        ready_to_generate = all(_row_ready_for_statement_generation(m) for m in mappings)
        harness_payload = {
            "harness_score": round(ready_n / total_m * 100),
            "ready_to_generate": ready_to_generate,
            "auto_confirmed": sum(1 for t in tiers if t == "auto_confirmed"),
            "needs_review": sum(1 for t in tiers if t == "needs_review"),
            "blocked": blocked_n,
            "auto_fixed": sum(1 for t in tiers if t == "auto_fixed"),
        }
    return {
        "trial_balance_id": trial_balance_id,
        "trial_balance_status": tb.status.value,
        "counts": {
            "trial_balance_lines": lines_n,
            "total_mappings": len(mappings),
            "raw_mapping_rows": len(raw_mappings),
            "confirmed": confirmed,
            "needs_review": needs_review,
            "ai_suggested_pending": ai_suggested,
        },
        "harness": harness_payload,
        "mappings": [
            {
                "id": m.id,
                "trial_balance_line_id": m.trial_balance_line_id,
                "gl_code": m.gl_code,
                "gl_description": m.gl_description,
                "debit_amount": (
                    m.trial_balance_line.debit_amount if m.trial_balance_line else 0.0
                ),
                "credit_amount": (
                    m.trial_balance_line.credit_amount if m.trial_balance_line else 0.0
                ),
                "net_amount": (
                    m.trial_balance_line.net_amount if m.trial_balance_line else 0.0
                ),
                "ifrs_statement": m.ifrs_statement.value,
                "ifrs_line_item": m.ifrs_line_item,
                "ifrs_section": m.ifrs_section,
                "ifrs_sub_section": m.ifrs_sub_section,
                "mapping_source": m.mapping_source.value,
                "ai_confidence_score": m.ai_confidence_score,
                "ai_reasoning": m.ai_reasoning,
                "is_confirmed": m.is_confirmed,
                "needs_review": m.needs_review,
                "validator_checked": bool(m.validator_checked),
                "validator_passed": bool(m.validator_passed),
                "validator_issues": m.validator_issues,
                "validator_score": m.validator_score,
                "is_contra": bool(m.is_contra),
                "locked": bool(m.locked),
                "harness_tier": _harness_tier(m),
            }
            for m in mappings
        ],
    }


@router.post("/trial-balance/{trial_balance_id}/validate-mappings")
def post_validate_mappings(
    trial_balance_id: int,
    tenant_id: str = Depends(tenant_id_header),
    db: Session = Depends(get_db),
):
    """Run CFO AI Harness rule validator and routing (separate from Claude mapping)."""
    tb = (
        db.query(TrialBalance)
        .filter(TrialBalance.id == trial_balance_id, TrialBalance.tenant_id == tenant_id)
        .first()
    )
    if not tb:
        raise HTTPException(status_code=404, detail="Trial balance not found")
    return validate_mappings(trial_balance_id, db, apply_routing=True, apply_fixes=True)


class MappingPatchBody(BaseModel):
    ifrs_statement: Optional[str] = None
    ifrs_line_item: Optional[str] = None
    ifrs_section: Optional[str] = None
    ifrs_sub_section: Optional[str] = None
    is_confirmed: Optional[bool] = None


@router.patch("/mapping/{mapping_id}")
def patch_mapping(
    mapping_id: int,
    body: MappingPatchBody,
    tenant_id: str = Depends(tenant_id_header),
    db: Session = Depends(get_db),
):
    m = (
        db.query(GLMapping)
        .filter(GLMapping.id == mapping_id, GLMapping.tenant_id == tenant_id)
        .first()
    )
    if not m:
        raise HTTPException(status_code=404, detail="Mapping not found")

    if body.ifrs_statement is not None:
        try:
            m.ifrs_statement = IFRSStatementKind(body.ifrs_statement)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid ifrs_statement") from None
    if body.ifrs_line_item is not None:
        m.ifrs_line_item = body.ifrs_line_item
    if body.ifrs_section is not None:
        m.ifrs_section = body.ifrs_section
    if body.ifrs_sub_section is not None:
        m.ifrs_sub_section = body.ifrs_sub_section
    if body.is_confirmed is not None:
        m.is_confirmed = body.is_confirmed
        if body.is_confirmed:
            m.confirmed_at = datetime.utcnow()
            m.confirmed_by = "user"
            m.locked = True
        else:
            m.locked = False

    m.mapping_source = MappingSourceEnum.user_overridden
    db.commit()
    db.refresh(m)
    return {"id": m.id, "ok": True, "mapping": {"is_confirmed": m.is_confirmed}}


class BulkConfirmBody(BaseModel):
    mapping_ids: list[int] = Field(default_factory=list)


@router.post("/mapping/bulk-confirm")
def bulk_confirm(body: BulkConfirmBody, tenant_id: str = Depends(tenant_id_header), db: Session = Depends(get_db)):
    if not body.mapping_ids:
        raise HTTPException(status_code=400, detail="mapping_ids required")
    now = datetime.utcnow()
    q = (
        db.query(GLMapping)
        .filter(GLMapping.tenant_id == tenant_id, GLMapping.id.in_(body.mapping_ids))
        .all()
    )
    for m in q:
        m.is_confirmed = True
        m.mapping_source = MappingSourceEnum.user_confirmed
        m.confirmed_at = now
        m.confirmed_by = "user"
        m.locked = True
    db.commit()
    return {"updated": len(q)}


class TemplateCreateBody(BaseModel):
    template_name: str
    industry: Optional[str] = None
    is_default: bool = False
    trial_balance_id: int


@router.post("/mapping-templates")
def create_mapping_template(
    body: TemplateCreateBody,
    tenant_id: str = Depends(tenant_id_header),
    db: Session = Depends(get_db),
):
    tb = (
        db.query(TrialBalance)
        .filter(
            TrialBalance.id == body.trial_balance_id,
            TrialBalance.tenant_id == tenant_id,
        )
        .first()
    )
    if not tb:
        raise HTTPException(status_code=404, detail="Trial balance not found")
    mappings = (
        db.query(GLMapping)
        .filter(
            GLMapping.trial_balance_id == body.trial_balance_id,
            GLMapping.tenant_id == tenant_id,
        )
        .all()
    )
    entries: list[dict[str, Any]] = [
        {
            "gl_code": m.gl_code,
            "gl_description": m.gl_description,
            "ifrs_statement": m.ifrs_statement.value,
            "ifrs_line_item": m.ifrs_line_item,
            "ifrs_section": m.ifrs_section,
            "ifrs_sub_section": m.ifrs_sub_section,
            "ai_confidence_score": m.ai_confidence_score,
        }
        for m in mappings
    ]
    tmpl = MappingTemplate(
        tenant_id=tenant_id,
        template_name=body.template_name,
        industry=body.industry,
        is_default=body.is_default,
        entries=entries,
    )
    db.add(tmpl)
    db.commit()
    db.refresh(tmpl)
    return {"id": tmpl.id, "entries_saved": len(entries)}


def _line_item_to_dict(li: StatementLineItem) -> dict[str, Any]:
    return {
        "id": li.id,
        "statement_id": li.statement_id,
        "ifrs_section": li.ifrs_section,
        "ifrs_sub_section": li.ifrs_sub_section,
        "ifrs_line_item": li.ifrs_line_item,
        "amount": float(li.amount or 0),
        "is_calculated": li.is_calculated,
        "is_subtotal": li.is_subtotal,
        "is_total": li.is_total,
        "is_manual_override": li.is_manual_override,
        "display_order": li.display_order,
        "indent_level": li.indent_level,
    }


@router.post("/trial-balance/{trial_balance_id}/generate-statements")
def generate_statements(
    trial_balance_id: int,
    tenant_id: str = Depends(tenant_id_header),
    db: Session = Depends(get_db),
):
    tb = (
        db.query(TrialBalance)
        .filter(TrialBalance.id == trial_balance_id, TrialBalance.tenant_id == tenant_id)
        .first()
    )
    if not tb:
        raise HTTPException(status_code=404, detail="Trial balance not found")

    try:
        result = generate_all_statements(trial_balance_id, db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    tb.status = TBStatus.statements_generated
    db.commit()
    return result


@router.get("/trial-balance/{trial_balance_id}/statements")
def get_statements_for_trial_balance(
    trial_balance_id: int,
    tenant_id: str = Depends(tenant_id_header),
    db: Session = Depends(get_db),
):
    statements = (
        db.query(GeneratedStatement)
        .filter(
            GeneratedStatement.trial_balance_id == trial_balance_id,
            GeneratedStatement.tenant_id == tenant_id,
        )
        .order_by(GeneratedStatement.id)
        .all()
    )
    if not statements:
        return {"trial_balance_id": trial_balance_id, "statements": {}}

    grouped: dict[str, Any] = {}
    for stmt in statements:
        line_items = (
            db.query(StatementLineItem)
            .filter(StatementLineItem.statement_id == stmt.id)
            .order_by(StatementLineItem.display_order)
            .all()
        )
        grouped[stmt.statement_type.value] = {
            "statement_id": stmt.id,
            "statement_type": stmt.statement_type.value,
            "status": stmt.status,
            "currency": stmt.currency,
            "period_start": stmt.period_start.isoformat() if stmt.period_start else None,
            "period_end": stmt.period_end.isoformat() if stmt.period_end else None,
            "generated_at": stmt.generated_at.isoformat() if stmt.generated_at else None,
            "line_items": [_line_item_to_dict(li) for li in line_items],
        }
    return {"trial_balance_id": trial_balance_id, "statements": grouped}


@router.get("/statements/{statement_id}")
def get_single_statement(
    statement_id: int,
    tenant_id: str = Depends(tenant_id_header),
    db: Session = Depends(get_db),
):
    stmt = (
        db.query(GeneratedStatement)
        .filter(GeneratedStatement.id == statement_id, GeneratedStatement.tenant_id == tenant_id)
        .first()
    )
    if not stmt:
        raise HTTPException(status_code=404, detail="Statement not found")

    line_items = (
        db.query(StatementLineItem)
        .filter(StatementLineItem.statement_id == statement_id)
        .order_by(StatementLineItem.display_order)
        .all()
    )
    by_section: dict[str, list[dict[str, Any]]] = {}
    for li in line_items:
        by_section.setdefault(li.ifrs_section, []).append(_line_item_to_dict(li))

    return {
        "statement": {
            "id": stmt.id,
            "trial_balance_id": stmt.trial_balance_id,
            "statement_type": stmt.statement_type.value,
            "currency": stmt.currency,
            "status": stmt.status,
            "period_start": stmt.period_start.isoformat() if stmt.period_start else None,
            "period_end": stmt.period_end.isoformat() if stmt.period_end else None,
            "generated_at": stmt.generated_at.isoformat() if stmt.generated_at else None,
        },
        "sections": by_section,
    }


class StatementLinePatchBody(BaseModel):
    amount: float


@router.patch("/statement-line/{line_id}")
def patch_statement_line_item(
    line_id: int,
    body: StatementLinePatchBody,
    tenant_id: str = Depends(tenant_id_header),
    db: Session = Depends(get_db),
):
    line = (
        db.query(StatementLineItem)
        .join(GeneratedStatement, GeneratedStatement.id == StatementLineItem.statement_id)
        .filter(StatementLineItem.id == line_id, GeneratedStatement.tenant_id == tenant_id)
        .first()
    )
    if not line:
        raise HTTPException(status_code=404, detail="Statement line item not found")
    line.amount = body.amount
    line.is_manual_override = True
    db.commit()
    db.refresh(line)
    return {"ok": True, "line_item": _line_item_to_dict(line)}


def _statements_dict_for_compliance(
    trial_balance_id: int, tenant_id: str, db: Session
) -> dict[str, Any]:
    rows = (
        db.query(GeneratedStatement)
        .filter(
            GeneratedStatement.trial_balance_id == trial_balance_id,
            GeneratedStatement.tenant_id == tenant_id,
        )
        .all()
    )
    return {s.statement_type.value: {"statement_id": s.id} for s in rows}


def _note_to_summary(n: DisclosureNote) -> dict[str, Any]:
    text = (n.user_edited_content or n.ai_generated_content or "")
    return {
        "id": n.id,
        "note_number": n.note_number,
        "note_code": n.note_code,
        "note_title": n.note_title,
        "title": n.note_title,
        "status": n.status.value if n.status else None,
        "word_count": n.word_count,
        "content": text,
        "is_user_edited": n.is_user_edited,
        "generated_at": n.generated_at.isoformat() if n.generated_at else None,
        "edited_at": n.edited_at.isoformat() if n.edited_at else None,
    }


_NOTE_GENERATORS = [
    generate_n1_accounting_policies,
    generate_n2_fixed_assets,
    generate_n3_leases,
    generate_n4_financial_instruments,
    generate_n5_revenue,
    generate_n6_borrowings,
    generate_n7_tax,
    generate_n8_related_parties,
    generate_n9_contingencies,
    generate_n10_subsequent_events,
]


@router.post("/trial-balance/{trial_balance_id}/generate-notes")
def generate_disclosure_notes(
    trial_balance_id: int,
    tenant_id: str = Depends(tenant_id_header),
    db: Session = Depends(get_db),
):
    tb = (
        db.query(TrialBalance)
        .filter(TrialBalance.id == trial_balance_id, TrialBalance.tenant_id == tenant_id)
        .first()
    )
    if not tb:
        raise HTTPException(status_code=404, detail="Trial balance not found")
    try:
        tb_data = build_tb_data_from_db(trial_balance_id, db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    notes = generate_all_notes(trial_balance_id, tb_data, db)
    return {"trial_balance_id": trial_balance_id, "notes": notes}


@router.get("/trial-balance/{trial_balance_id}/notes")
def list_disclosure_notes(
    trial_balance_id: int,
    tenant_id: str = Depends(tenant_id_header),
    db: Session = Depends(get_db),
):
    tb = (
        db.query(TrialBalance)
        .filter(TrialBalance.id == trial_balance_id, TrialBalance.tenant_id == tenant_id)
        .first()
    )
    if not tb:
        raise HTTPException(status_code=404, detail="Trial balance not found")
    notes = (
        db.query(DisclosureNote)
        .filter(
            DisclosureNote.trial_balance_id == trial_balance_id,
            DisclosureNote.tenant_id == tenant_id,
        )
        .order_by(DisclosureNote.note_number)
        .all()
    )
    return {
        "trial_balance_id": trial_balance_id,
        "notes": [_note_to_summary(n) for n in notes],
        "count": len(notes),
    }


def _note_full(n: DisclosureNote) -> dict[str, Any]:
    return {
        "id": n.id,
        "trial_balance_id": n.trial_balance_id,
        "note_number": n.note_number,
        "note_code": n.note_code,
        "note_title": n.note_title,
        "status": n.status.value if n.status else None,
        "word_count": n.word_count,
        "ai_generated_content": n.ai_generated_content,
        "user_edited_content": n.user_edited_content,
        "is_user_edited": n.is_user_edited,
        "generated_at": n.generated_at.isoformat() if n.generated_at else None,
        "edited_at": n.edited_at.isoformat() if n.edited_at else None,
    }


@router.get("/notes/{note_id}")
def get_disclosure_note(
    note_id: int,
    tenant_id: str = Depends(tenant_id_header),
    db: Session = Depends(get_db),
):
    n = (
        db.query(DisclosureNote)
        .filter(DisclosureNote.id == note_id, DisclosureNote.tenant_id == tenant_id)
        .first()
    )
    if not n:
        raise HTTPException(status_code=404, detail="Note not found")
    return {"note": _note_full(n)}


class DisclosureNotePatchBody(BaseModel):
    user_edited_content: str


@router.patch("/notes/{note_id}")
def patch_disclosure_note(
    note_id: int,
    body: DisclosureNotePatchBody,
    tenant_id: str = Depends(tenant_id_header),
    db: Session = Depends(get_db),
):
    n = (
        db.query(DisclosureNote)
        .filter(DisclosureNote.id == note_id, DisclosureNote.tenant_id == tenant_id)
        .first()
    )
    if not n:
        raise HTTPException(status_code=404, detail="Note not found")
    n.user_edited_content = body.user_edited_content
    n.is_user_edited = True
    n.status = DisclosureNoteStatus.complete
    n.word_count = len(body.user_edited_content.split())
    n.edited_at = datetime.utcnow()
    n.edited_by = "user"
    db.commit()
    db.refresh(n)
    return {"ok": True, "note": _note_full(n)}


@router.post("/notes/{note_id}/regenerate")
def regenerate_disclosure_note(
    note_id: int,
    tenant_id: str = Depends(tenant_id_header),
    db: Session = Depends(get_db),
):
    n = (
        db.query(DisclosureNote)
        .join(TrialBalance, TrialBalance.id == DisclosureNote.trial_balance_id)
        .filter(DisclosureNote.id == note_id, TrialBalance.tenant_id == tenant_id)
        .first()
    )
    if not n:
        raise HTTPException(status_code=404, detail="Note not found")
    idx = n.note_number - 1
    if idx < 0 or idx >= len(_NOTE_GENERATORS):
        raise HTTPException(status_code=400, detail="Invalid note")
    tb_data = build_tb_data_from_db(n.trial_balance_id, db)
    try:
        content = _NOTE_GENERATORS[idx](tb_data)
    except Exception as e:
        content = f"[Generation error: {e!s}]"
    n.ai_generated_content = content
    n.user_edited_content = content
    n.status = DisclosureNoteStatus.ai_draft
    n.is_user_edited = False
    n.word_count = len(content.split())
    n.generated_at = datetime.utcnow()
    db.commit()
    db.refresh(n)
    return {"ok": True, "note": _note_full(n)}


@router.post("/trial-balance/{trial_balance_id}/compliance-check")
def post_compliance_check(
    trial_balance_id: int,
    tenant_id: str = Depends(tenant_id_header),
    db: Session = Depends(get_db),
):
    tb = (
        db.query(TrialBalance)
        .filter(TrialBalance.id == trial_balance_id, TrialBalance.tenant_id == tenant_id)
        .first()
    )
    if not tb:
        raise HTTPException(status_code=404, detail="Trial balance not found")
    stmts = _statements_dict_for_compliance(trial_balance_id, tenant_id, db)
    tb_data = build_tb_data_from_db(trial_balance_id, db)
    result = run_compliance_checks(trial_balance_id, stmts, tb_data, db)
    return {"trial_balance_id": trial_balance_id, **result}


@router.get("/trial-balance/{trial_balance_id}/compliance-results")
def get_compliance_results(
    trial_balance_id: int,
    tenant_id: str = Depends(tenant_id_header),
    db: Session = Depends(get_db),
):
    tb = (
        db.query(TrialBalance)
        .filter(TrialBalance.id == trial_balance_id, TrialBalance.tenant_id == tenant_id)
        .first()
    )
    if not tb:
        raise HTTPException(status_code=404, detail="Trial balance not found")
    rows = (
        db.query(ComplianceCheck)
        .join(TrialBalance, TrialBalance.id == ComplianceCheck.trial_balance_id)
        .filter(
            ComplianceCheck.trial_balance_id == trial_balance_id,
            TrialBalance.tenant_id == tenant_id,
        )
        .order_by(ComplianceCheck.id)
        .all()
    )
    checks = [
        {
            "code": r.check_code,
            "description": r.check_description,
            "standard": r.standard,
            "result": r.result.value if r.result else None,
            "severity": r.severity.value if r.severity else None,
            "details": r.details,
            "recommendation": r.recommendation,
            "checked_at": r.checked_at.isoformat() if r.checked_at else None,
        }
        for r in rows
    ]
    passed_n = sum(1 for c in checks if c["result"] == "pass")
    failed_n = sum(1 for c in checks if c["result"] == "fail")
    critical_fails = sum(
        1 for c in checks if c["result"] == "fail" and c["severity"] == "critical"
    )
    scored = [c for c in checks if c.get("result") in ("pass", "fail")]
    denom = len(scored) if scored else (len(checks) or 1)
    compliance_score = round(passed_n / denom * 100, 1) if denom else 0.0
    return {
        "trial_balance_id": trial_balance_id,
        "checks": checks,
        "summary": {
            "total": len(checks),
            "passed": passed_n,
            "failed": failed_n,
            "critical_failures": critical_fails,
            "compliance_score": compliance_score,
            "audit_ready": critical_fails == 0 and failed_n <= 3,
        },
    }


class GenerateBoardPackBody(BaseModel):
    watermark: Literal["DRAFT", "FINAL", "CONFIDENTIAL"] = "DRAFT"


def _tb_pl_fp_lines_for_board_seed(
    db: Session, trial_balance_id: int, tenant_id: str
) -> tuple[TrialBalance, dict[str, Any], list[Any], list[Any]] | None:
    """Trial balance + TB data + P&L / FP statement lines (for commentary / risk seeding)."""
    tb = (
        db.query(TrialBalance)
        .filter(TrialBalance.id == trial_balance_id, TrialBalance.tenant_id == tenant_id)
        .first()
    )
    if not tb:
        return None
    pl_stmt = (
        db.query(GeneratedStatement)
        .filter(
            GeneratedStatement.trial_balance_id == trial_balance_id,
            GeneratedStatement.tenant_id == tenant_id,
            GeneratedStatement.statement_type == IFRSStatementKind.profit_loss,
        )
        .first()
    )
    if not pl_stmt:
        return None
    try:
        tb_data = build_tb_data_from_db(trial_balance_id, db)
    except ValueError:
        return None
    pl_lines = (
        db.query(StatementLineItem)
        .filter(StatementLineItem.statement_id == pl_stmt.id)
        .order_by(StatementLineItem.display_order)
        .all()
    )
    fp_stmt = (
        db.query(GeneratedStatement)
        .filter(
            GeneratedStatement.trial_balance_id == trial_balance_id,
            GeneratedStatement.tenant_id == tenant_id,
            GeneratedStatement.statement_type == IFRSStatementKind.financial_position,
        )
        .first()
    )
    fp_lines: list[Any] = []
    if fp_stmt:
        fp_lines = (
            db.query(StatementLineItem)
            .filter(StatementLineItem.statement_id == fp_stmt.id)
            .order_by(StatementLineItem.display_order)
            .all()
        )
    return tb, tb_data, pl_lines, fp_lines


@router.post("/trial-balance/{trial_balance_id}/generate-commentary")
def post_generate_commentary(
    trial_balance_id: int,
    tenant_id: str = Depends(tenant_id_header),
    db: Session = Depends(get_db),
):
    """
    (Re)generate AI + template statement commentary only — does not touch risk flags.
    Requires generated IFRS statements. Use before board pack if commentary was empty.
    """
    ctx = _tb_pl_fp_lines_for_board_seed(db, trial_balance_id, tenant_id)
    if not ctx:
        raise HTTPException(status_code=400, detail="Generate statements first")
    tb, tb_data, pl_lines, fp_lines = ctx
    texts = seed_commentary_only(
        db,
        trial_balance_id,
        tenant_id,
        tb_data,
        pl_lines,
        fp_lines,
        use_llm=True,
        trial_balance=tb,
    )
    return {
        "trial_balance_id": trial_balance_id,
        "ok": True,
        "commentary_types": list(texts.keys()),
    }


@router.post("/trial-balance/{trial_balance_id}/detect-risks")
def post_detect_risks(
    trial_balance_id: int,
    tenant_id: str = Depends(tenant_id_header),
    db: Session = Depends(get_db),
):
    """
    (Re)detect / seed risk flags from TB + statement lines — does not touch commentary.
    Requires generated IFRS statements.
    """
    ctx = _tb_pl_fp_lines_for_board_seed(db, trial_balance_id, tenant_id)
    if not ctx:
        raise HTTPException(status_code=400, detail="Generate statements first")
    tb, tb_data, pl_lines, fp_lines = ctx
    n = seed_risks_only(db, trial_balance_id, tenant_id, tb_data, pl_lines, fp_lines)
    return {"trial_balance_id": trial_balance_id, "ok": True, "risk_flags": n}


def _board_pack_output_dir() -> Path:
    return Path(__file__).resolve().parents[3] / "board_packs"


@router.post("/trial-balance/{trial_balance_id}/generate-board-pack")
def generate_board_pack(
    trial_balance_id: int,
    body: GenerateBoardPackBody,
    tenant_id: str = Depends(tenant_id_header),
    db: Session = Depends(get_db),
):
    """
    Build a multi-page board pack PDF from generated statements + seeded commentary + risks.
    """
    tb = (
        db.query(TrialBalance)
        .filter(TrialBalance.id == trial_balance_id, TrialBalance.tenant_id == tenant_id)
        .first()
    )
    if not tb:
        raise HTTPException(status_code=404, detail="Trial balance not found")

    pl_stmt = (
        db.query(GeneratedStatement)
        .filter(
            GeneratedStatement.trial_balance_id == trial_balance_id,
            GeneratedStatement.tenant_id == tenant_id,
            GeneratedStatement.statement_type == IFRSStatementKind.profit_loss,
        )
        .first()
    )
    if not pl_stmt:
        raise HTTPException(status_code=400, detail="Generate statements first")

    n_commentary = (
        db.query(StatementCommentary)
        .filter(
            StatementCommentary.trial_balance_id == trial_balance_id,
            StatementCommentary.tenant_id == tenant_id,
        )
        .count()
    )
    n_risks = (
        db.query(RiskFlag)
        .filter(RiskFlag.trial_balance_id == trial_balance_id, RiskFlag.tenant_id == tenant_id)
        .count()
    )
    if n_commentary == 0 or n_risks == 0:
        tb_data_seed = build_tb_data_from_db(trial_balance_id, db)
        fp_stmt = (
            db.query(GeneratedStatement)
            .filter(
                GeneratedStatement.trial_balance_id == trial_balance_id,
                GeneratedStatement.tenant_id == tenant_id,
                GeneratedStatement.statement_type == IFRSStatementKind.financial_position,
            )
            .first()
        )
        pl_lines_seed = (
            db.query(StatementLineItem)
            .filter(StatementLineItem.statement_id == pl_stmt.id)
            .order_by(StatementLineItem.display_order)
            .all()
        )
        fp_lines_seed: list[StatementLineItem] = []
        if fp_stmt:
            fp_lines_seed = (
                db.query(StatementLineItem)
                .filter(StatementLineItem.statement_id == fp_stmt.id)
                .order_by(StatementLineItem.display_order)
                .all()
            )
        seed_commentary_and_risks_for_trial_balance(
            db, trial_balance_id, tenant_id, tb_data_seed, pl_lines_seed, fp_lines_seed
        )

    n_commentary = (
        db.query(StatementCommentary)
        .filter(
            StatementCommentary.trial_balance_id == trial_balance_id,
            StatementCommentary.tenant_id == tenant_id,
        )
        .count()
    )
    n_risks = (
        db.query(RiskFlag)
        .filter(RiskFlag.trial_balance_id == trial_balance_id, RiskFlag.tenant_id == tenant_id)
        .count()
    )
    if n_commentary == 0 or n_risks == 0:
        raise HTTPException(
            status_code=400,
            detail="Generate statements first",
        )

    try:
        pack_data = build_board_pack_data(trial_balance_id, db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    out_dir = _board_pack_output_dir()
    out_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    fname = f"{trial_balance_id}_{ts}.pdf"
    out_path = out_dir / fname

    gen = BoardPackGenerator(watermark=body.watermark)
    gen.generate(pack_data, str(out_path))
    pages = count_pdf_pages(str(out_path))
    token = str(uuid.uuid4())

    bp = BoardPack(
        tenant_id=tenant_id,
        trial_balance_id=trial_balance_id,
        company_name=tb.company_name,
        period_end=tb.period_end,
        currency=tb.currency or "USD",
        status=BoardPackStatus.draft,
        pdf_path=str(out_path.resolve()),
        public_token=token,
        watermark=body.watermark,
        generated_at=datetime.utcnow(),
        view_count=0,
    )
    db.add(bp)
    db.commit()
    db.refresh(bp)

    return {
        "board_pack_id": bp.id,
        "pdf_path": bp.pdf_path,
        "public_url": f"/api/board-pack/view/{token}",
        "view_url": f"/api/board-pack/view/{token}",
        "download_url": f"/api/board-pack/download/{token}",
        "pages": pages,
    }
