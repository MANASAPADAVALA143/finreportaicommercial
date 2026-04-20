"""
ERP integrations: Tally XML gateway (trial balance import → IFRS pipeline).
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
from datetime import date, datetime
from typing import Any, Optional

import pandas as pd
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.connector_client import ConnectorClient
from app.models.ifrs_statement import (
    ERPConnection,
    ErpConnectionStatus,
    ErpType,
    GLMapping,
    IFRSLineItemMaster,
    IFRSStatementKind,
    MappingSourceEnum,
    TBStatus,
    TallySyncLog,
    TallySyncStatus,
    TallySyncType,
    TrialBalance,
    TrialBalanceLine,
)
from app.services.gl_mapping_ai import apply_ai_mappings_only_missing, infer_account_type
from app.services.statement_generator import generate_all_statements
from app.services.tally_service import TallyService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/erp", tags=["ERP Integration"])


def _tenant_id(x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-ID")) -> str:
    return (x_tenant_id or "default").strip() or "default"


def _resolve_connector_client(
    db: Session, entity_id: str, api_key: Optional[str]
) -> ConnectorClient:
    """Validate X-API-Key against connector_clients (SHA-256) or TALLY_CONNECTOR_BYPASS_KEY (dev)."""
    if not api_key or not api_key.strip():
        raise HTTPException(status_code=401, detail="Missing X-API-Key header")

    row = (
        db.query(ConnectorClient)
        .filter(
            ConnectorClient.entity_id == entity_id.strip(),
            ConnectorClient.is_active.is_(True),
        )
        .first()
    )
    if row:
        digest = hashlib.sha256(api_key.encode("utf-8")).hexdigest()
        if hmac.compare_digest(digest, row.api_key_sha256):
            return row

    bypass = (os.getenv("TALLY_CONNECTOR_BYPASS_KEY") or "").strip()
    if bypass and len(api_key) == len(bypass) and hmac.compare_digest(
        api_key, bypass
    ):
        synthetic = ConnectorClient(
            entity_id=entity_id,
            tenant_id=(os.getenv("TALLY_CONNECTOR_BYPASS_TENANT") or "default").strip()
            or "default",
            api_key_sha256="",
            label="bypass",
            is_active=True,
        )
        synthetic.id = 0
        return synthetic

    raise HTTPException(status_code=403, detail="Invalid API key or entity_id")


def _parse_date(s: str) -> date:
    return date.fromisoformat(s.strip()[:10])


def _ifrs_section_for_item(db: Session, item: str) -> tuple[IFRSStatementKind, str]:
    row = db.query(IFRSLineItemMaster).filter(IFRSLineItemMaster.name == item).first()
    if row:
        return IFRSStatementKind(row.statement), row.section
    t = item.strip().casefold()
    for r in db.query(IFRSLineItemMaster).all():
        if r.name.strip().casefold() == t:
            return IFRSStatementKind(r.statement), r.section
    return IFRSStatementKind.financial_position, "General"


def _persist_trial_balance_from_df(
    db: Session,
    tenant_id: str,
    company_name: str,
    period_start: date,
    period_end: date,
    currency: str,
    df: pd.DataFrame,
    file_label: str,
) -> TrialBalance:
    tb = TrialBalance(
        tenant_id=tenant_id,
        company_name=company_name,
        period_start=period_start,
        period_end=period_end,
        currency=currency[:8],
        status=TBStatus.uploaded,
        file_name=file_label[:500],
        file_path=None,
    )
    db.add(tb)
    db.flush()
    for _, row in df.iterrows():
        dr = float(row.get("debit") or 0)
        cr = float(row.get("credit") or 0)
        net = dr - cr
        grp = str(row.get("tally_group") or "")
        acct = infer_account_type(dr, cr, grp or None)
        db.add(
            TrialBalanceLine(
                trial_balance_id=tb.id,
                tenant_id=tenant_id,
                gl_code=str(row["gl_code"])[:64],
                gl_description=str(row["gl_description"])[:512],
                debit_amount=dr,
                credit_amount=cr,
                net_amount=net,
                account_type=acct,
            )
        )
    db.commit()
    db.refresh(tb)
    return tb


def _apply_tally_prefill(
    db: Session,
    tenant_id: str,
    tb: TrialBalance,
    lines: list[TrialBalanceLine],
    df: pd.DataFrame,
) -> int:
    lines_sorted = sorted(lines, key=lambda x: x.id)
    prefilled = 0
    for line, (_, srow) in zip(lines_sorted, df.iterrows()):
        src = str(srow.get("mapping_source") or "tally_group")
        item = str(srow.get("ifrs_line_item") or "").strip()
        if src == "needs_ai" or not item:
            continue
        conf = float(srow.get("mapping_confidence") or 0.9)
        stmt, sec = _ifrs_section_for_item(db, item)
        db.add(
            GLMapping(
                tenant_id=tenant_id,
                company_id=None,
                trial_balance_id=tb.id,
                trial_balance_line_id=line.id,
                gl_code=line.gl_code,
                gl_description=line.gl_description,
                ifrs_statement=stmt,
                ifrs_line_item=item[:512],
                ifrs_section=sec[:512],
                ifrs_sub_section=None,
                mapping_source=MappingSourceEnum.tally_suggested,
                ai_confidence_score=min(max(conf, 0.0), 1.0),
                ai_reasoning="Mapped from Tally ledger group to IFRS line item.",
                is_confirmed=False,
                needs_review=conf < 0.85,
            )
        )
        prefilled += 1
    db.commit()
    return prefilled


class TallyTestBody(BaseModel):
    host: str = "localhost"
    port: int = 9000


class TallyConnectionRequest(BaseModel):
    connection_name: str
    tally_host: str = "localhost"
    tally_port: int = 9000
    tally_company_name: str
    default_currency: str = "INR"
    fiscal_year_start: str = "April"


class TallyImportRequest(BaseModel):
    connection_id: int
    period_from: str
    period_to: str
    years: list[int] = Field(default_factory=list)


class TallyQuickImportBody(BaseModel):
    host: str = "localhost"
    port: int = 9000
    company_name: str
    period_from: str
    period_to: str
    currency: str = "INR"


class TallyMultiYearBody(BaseModel):
    connection_id: int
    company_name: str
    years: list[int]


class TallyConnectorSyncBody(BaseModel):
    entity_id: str
    company_name: str
    source: str = "tally_connector"
    fiscal_year: str
    period_from: str
    period_to: str
    currency: str = "INR"
    gl_rows: list[dict[str, Any]]
    auto_generate_statements: bool = True
    send_notification: bool = True


def _df_from_connector_gl_rows(gl_rows: list[dict[str, Any]]) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for r in gl_rows:
        rows.append(
            {
                "gl_code": str(r.get("gl_code") or "")[:64],
                "gl_description": str(r.get("gl_description") or "")[:512],
                "tally_group": str(r.get("tally_group") or ""),
                "debit": float(r.get("debit") or 0),
                "credit": float(r.get("credit") or 0),
            }
        )
    df = pd.DataFrame(rows)
    if not df.empty:
        df["net_amount"] = df["debit"] - df["credit"]
    return df


@router.post("/tally/test-connection")
def tally_test_connection(body: TallyTestBody) -> dict[str, Any]:
    svc = TallyService(body.host, body.port)
    return svc.test_connection()


@router.post("/tally/connect")
def tally_save_connection(
    body: TallyConnectionRequest,
    tenant_id: str = Depends(_tenant_id),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    svc = TallyService(body.tally_host, body.tally_port)
    test = svc.test_connection()
    if not test.get("connected"):
        raise HTTPException(
            status_code=400,
            detail=test.get("error") or "Could not connect to Tally",
        )
    conn = ERPConnection(
        tenant_id=tenant_id,
        entity_id=None,
        erp_type=ErpType.tally,
        connection_name=body.connection_name[:500],
        tally_host=body.tally_host,
        tally_port=body.tally_port,
        tally_company_name=body.tally_company_name[:500],
        tally_version=test.get("tally_version"),
        status=ErpConnectionStatus.connected,
        last_connected_at=datetime.utcnow(),
        last_error=None,
        default_currency=body.default_currency[:8],
        fiscal_year_start=body.fiscal_year_start[:32],
        auto_sync=False,
    )
    db.add(conn)
    db.commit()
    db.refresh(conn)
    return {
        "id": conn.id,
        "status": conn.status.value,
        "tally_version": test.get("tally_version"),
        "companies": test.get("companies"),
    }


@router.get("/connections")
def list_connections(
    tenant_id: str = Depends(_tenant_id),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    rows = (
        db.query(ERPConnection)
        .filter(ERPConnection.tenant_id == tenant_id)
        .order_by(ERPConnection.id.desc())
        .all()
    )
    return {
        "connections": [
            {
                "id": r.id,
                "connection_name": r.connection_name,
                "erp_type": r.erp_type.value,
                "tally_host": r.tally_host,
                "tally_port": r.tally_port,
                "tally_company_name": r.tally_company_name,
                "status": r.status.value,
                "default_currency": r.default_currency,
                "last_sync_at": r.last_sync_at.isoformat() if r.last_sync_at else None,
            }
            for r in rows
        ]
    }


@router.delete("/connections/{connection_id}")
def delete_connection(
    connection_id: int,
    tenant_id: str = Depends(_tenant_id),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    conn = (
        db.query(ERPConnection)
        .filter(
            ERPConnection.id == connection_id,
            ERPConnection.tenant_id == tenant_id,
        )
        .first()
    )
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    db.query(TallySyncLog).filter(TallySyncLog.connection_id == connection_id).delete(
        synchronize_session=False
    )
    db.delete(conn)
    db.commit()
    return {"status": "deleted"}


@router.post("/tally/import-tb")
def tally_import_trial_balance(
    body: TallyImportRequest,
    tenant_id: str = Depends(_tenant_id),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    conn = (
        db.query(ERPConnection)
        .filter(
            ERPConnection.id == body.connection_id,
            ERPConnection.tenant_id == tenant_id,
        )
        .first()
    )
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    svc = TallyService(conn.tally_host, conn.tally_port)
    p_from = _parse_date(body.period_from)
    p_to = _parse_date(body.period_to)

    log = TallySyncLog(
        tenant_id=tenant_id,
        connection_id=conn.id,
        sync_type=TallySyncType.trial_balance,
        period_from=p_from,
        period_to=p_to,
        company_name=conn.tally_company_name,
        rows_imported=0,
        status=TallySyncStatus.started,
    )
    db.add(log)
    db.commit()
    db.refresh(log)

    auto_mapped = 0
    needs_ai_count = 0
    ai_created = 0
    try:
        raw_df = svc.import_trial_balance(conn.tally_company_name, p_from, p_to)
        df = svc.auto_map_from_tally_groups(raw_df)
        tb = _persist_trial_balance_from_df(
            db,
            tenant_id,
            conn.tally_company_name or conn.connection_name,
            p_from,
            p_to,
            conn.default_currency or "INR",
            df,
            f"tally_tb_{conn.id}_{log.id}.xml",
        )
        lines = (
            db.query(TrialBalanceLine)
            .filter(TrialBalanceLine.trial_balance_id == tb.id)
            .order_by(TrialBalanceLine.id)
            .all()
        )
        auto_mapped = _apply_tally_prefill(db, tenant_id, tb, lines, df)
        needs_ai_count = int((df["mapping_source"] == "needs_ai").sum())
        ai_created = apply_ai_mappings_only_missing(db, tenant_id, tb, lines)
        tb = db.query(TrialBalance).filter(TrialBalance.id == tb.id).first()
        if tb:
            tb.status = TBStatus.mapped
            db.commit()

        log.rows_imported = len(df)
        log.trial_balance_id = tb.id
        log.status = TallySyncStatus.completed
        log.completed_at = datetime.utcnow()
        conn.last_sync_at = datetime.utcnow()
        conn.last_error = None
        db.commit()
    except Exception as e:
        logger.exception("Tally import failed")
        log.status = TallySyncStatus.failed
        log.error_message = str(e)[:4000]
        log.completed_at = datetime.utcnow()
        conn.last_error = str(e)[:2000]
        db.commit()
        raise HTTPException(status_code=502, detail=str(e)) from e

    return {
        "trial_balance_id": tb.id,
        "lines_count": len(df),
        "auto_mapped": auto_mapped,
        "needs_ai_count": needs_ai_count,
        "ai_mappings_created": ai_created,
        "sync_log_id": log.id,
        "status": "success",
    }


@router.post("/tally/import-multi-year")
def tally_import_multi_year(
    body: TallyMultiYearBody,
    tenant_id: str = Depends(_tenant_id),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    conn = (
        db.query(ERPConnection)
        .filter(
            ERPConnection.id == body.connection_id,
            ERPConnection.tenant_id == tenant_id,
        )
        .first()
    )
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    svc = TallyService(conn.tally_host, conn.tally_port)
    summary: dict[str, Any] = {}
    for year in body.years:
        p_from = date(year, 4, 1)
        p_to = date(year + 1, 3, 31)
        key = f"FY{year}-{str(year + 1)[2:]}"
        try:
            raw_df = svc.import_trial_balance(body.company_name, p_from, p_to)
            df = svc.auto_map_from_tally_groups(raw_df)
            tb = _persist_trial_balance_from_df(
                db,
                tenant_id,
                body.company_name,
                p_from,
                p_to,
                conn.default_currency or "INR",
                df,
                f"tally_multiyear_{key}.xml",
            )
            lines = (
                db.query(TrialBalanceLine)
                .filter(TrialBalanceLine.trial_balance_id == tb.id)
                .all()
            )
            _apply_tally_prefill(db, tenant_id, tb, lines, df)
            apply_ai_mappings_only_missing(db, tenant_id, tb, lines)
            tbo = db.query(TrialBalance).filter(TrialBalance.id == tb.id).first()
            if tbo:
                tbo.status = TBStatus.mapped
                db.commit()
            summary[key] = {
                "trial_balance_id": tb.id,
                "rows": len(df),
                "status": "success",
            }
        except Exception as e:
            summary[key] = {"status": "error", "error": str(e)}
    return {"connection_id": conn.id, "years": summary}


@router.get("/tally/sync-logs")
def tally_sync_logs(
    tenant_id: str = Depends(_tenant_id),
    db: Session = Depends(get_db),
    limit: int = 50,
) -> dict[str, Any]:
    q = (
        db.query(TallySyncLog)
        .filter(TallySyncLog.tenant_id == tenant_id)
        .order_by(TallySyncLog.id.desc())
        .limit(min(limit, 200))
        .all()
    )
    return {
        "logs": [
            {
                "id": lg.id,
                "connection_id": lg.connection_id,
                "sync_type": lg.sync_type.value,
                "period_from": lg.period_from.isoformat() if lg.period_from else None,
                "period_to": lg.period_to.isoformat() if lg.period_to else None,
                "company_name": lg.company_name,
                "rows_imported": lg.rows_imported,
                "status": lg.status.value,
                "error_message": lg.error_message,
                "trial_balance_id": lg.trial_balance_id,
                "started_at": lg.started_at.isoformat() if lg.started_at else None,
                "completed_at": lg.completed_at.isoformat() if lg.completed_at else None,
            }
            for lg in q
        ]
    }


@router.post("/tally/quick-import")
def tally_quick_import(
    body: TallyQuickImportBody,
    tenant_id: str = Depends(_tenant_id),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    svc = TallyService(body.host, body.port)
    test = svc.test_connection()
    if not test.get("connected"):
        raise HTTPException(
            status_code=400,
            detail=test.get("error") or "Tally not reachable",
        )
    p_from = _parse_date(body.period_from)
    p_to = _parse_date(body.period_to)
    raw_df = svc.import_trial_balance(body.company_name, p_from, p_to)
    df = svc.auto_map_from_tally_groups(raw_df)
    tb = _persist_trial_balance_from_df(
        db,
        tenant_id,
        body.company_name,
        p_from,
        p_to,
        body.currency,
        df,
        "tally_quick_import.xml",
    )
    lines = (
        db.query(TrialBalanceLine)
        .filter(TrialBalanceLine.trial_balance_id == tb.id)
        .order_by(TrialBalanceLine.id)
        .all()
    )
    auto_mapped = _apply_tally_prefill(db, tenant_id, tb, lines, df)
    needs_ai_count = int((df["mapping_source"] == "needs_ai").sum())
    ai_created = apply_ai_mappings_only_missing(db, tenant_id, tb, lines)
    tbo = db.query(TrialBalance).filter(TrialBalance.id == tb.id).first()
    if tbo:
        tbo.status = TBStatus.mapped
        db.commit()

    return {
        "trial_balance_id": tb.id,
        "lines_count": len(df),
        "auto_mapped": auto_mapped,
        "needs_ai_count": needs_ai_count,
        "ai_mappings_created": ai_created,
        "tally_version": test.get("tally_version"),
        "status": "success",
    }


@router.post("/tally/connector-sync")
def tally_connector_sync(
    body: TallyConnectorSyncBody,
    db: Session = Depends(get_db),
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
) -> dict[str, Any]:
    """
    Unattended sync from the Windows Tally connector script (X-API-Key auth).
    """
    client = _resolve_connector_client(db, body.entity_id, x_api_key)
    tenant_id = client.tenant_id

    if not body.gl_rows:
        raise HTTPException(status_code=400, detail="gl_rows is empty")

    p_from = _parse_date(body.period_from)
    p_to = _parse_date(body.period_to)

    log = TallySyncLog(
        tenant_id=tenant_id,
        connection_id=None,
        sync_type=TallySyncType.trial_balance,
        period_from=p_from,
        period_to=p_to,
        company_name=body.company_name[:512],
        rows_imported=0,
        status=TallySyncStatus.started,
    )
    db.add(log)
    db.commit()
    db.refresh(log)

    svc = TallyService()
    raw_df = _df_from_connector_gl_rows(body.gl_rows)
    if raw_df.empty:
        log.status = TallySyncStatus.failed
        log.error_message = "No valid GL rows after parsing"
        log.completed_at = datetime.utcnow()
        db.commit()
        raise HTTPException(status_code=400, detail=log.error_message)

    df = svc.auto_map_from_tally_groups(raw_df)
    file_label = f"tally_connector_{body.entity_id}_{body.fiscal_year}.json"

    auto_mapped = 0
    statements_generated = False
    mapped_count = 0

    try:
        tb = _persist_trial_balance_from_df(
            db,
            tenant_id,
            body.company_name,
            p_from,
            p_to,
            body.currency[:8],
            df,
            file_label,
        )
        lines = (
            db.query(TrialBalanceLine)
            .filter(TrialBalanceLine.trial_balance_id == tb.id)
            .order_by(TrialBalanceLine.id)
            .all()
        )
        auto_mapped = _apply_tally_prefill(db, tenant_id, tb, lines, df)
        apply_ai_mappings_only_missing(db, tenant_id, tb, lines)

        tbo = db.query(TrialBalance).filter(TrialBalance.id == tb.id).first()
        if tbo:
            tbo.status = TBStatus.mapped
            db.commit()

        if body.auto_generate_statements:
            generate_all_statements(tb.id, db)
            statements_generated = True

        mapped_count = int(
            db.query(GLMapping)
            .filter(GLMapping.trial_balance_id == tb.id)
            .count()
        )

        log.rows_imported = len(df)
        log.trial_balance_id = tb.id
        log.status = TallySyncStatus.completed
        log.completed_at = datetime.utcnow()
        if body.send_notification:
            logger.info(
                "Tally connector sync complete: tenant=%s entity=%s tb=%s",
                tenant_id,
                body.entity_id,
                tb.id,
            )
        db.commit()
    except Exception as e:
        logger.exception("Tally connector-sync failed")
        log.status = TallySyncStatus.failed
        log.error_message = str(e)[:4000]
        log.completed_at = datetime.utcnow()
        db.commit()
        raise HTTPException(status_code=502, detail=str(e)) from e

    return {
        "trial_balance_id": tb.id,
        "lines_count": len(df),
        "mapped_count": mapped_count,
        "statements_generated": statements_generated,
        "fiscal_year": body.fiscal_year,
        "message": "Statements ready in FinReportAI",
    }
