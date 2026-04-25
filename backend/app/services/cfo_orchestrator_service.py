"""CFO Command Center: persist runs, invoke agents, validation retry, alerts."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from app.agents.command_center.registry import run_agent
from app.core.database import SessionLocal
from app.services.cfo_audit import build_twelve_checks, wrap_agent_payload
from app.models.cfo_command_center import (
    CFOAgentLog,
    CFOAgentOutput,
    CFOAgentRun,
    CFOAgentRunStatus,
    CFOAlert,
    CFOAlertSeverity,
    CFOAlertStatus,
)

logger = logging.getLogger(__name__)


def _log(db: Session, run_id_pk: int, message: str, level: str = "info") -> None:
    db.add(CFOAgentLog(cfo_agent_run_id=run_id_pk, level=level, message=message))
    db.commit()


def _emit_alerts(db: Session, tenant_id: str, agent_name: str, run_pk: int, payload: dict[str, Any]) -> None:
    if agent_name == "je_anomaly":
        summary = (payload or {}).get("summary") or {}
        high = int(summary.get("high_risk") or 0)
        if high > 0:
            db.add(
                CFOAlert(
                    tenant_id=tenant_id,
                    agent_name=agent_name,
                    severity=CFOAlertSeverity.urgent,
                    title=f"JE anomaly: {high} high-risk entries",
                    body="Review flagged entries in R2R Pattern Engine.",
                    status=CFOAlertStatus.open,
                    cfo_agent_run_id=run_pk,
                    meta_json={"high_risk": high},
                )
            )
    if agent_name == "fpa_budget":
        for o in (payload or {}).get("overspends") or []:
            dept = o.get("department") or "Unknown"
            p = o.get("variance_pct")
            db.add(
                CFOAlert(
                    tenant_id=tenant_id,
                    agent_name=agent_name,
                    severity=CFOAlertSeverity.warning,
                    title=f"Budget: {dept} {p:.1f}% over budget" if p is not None else f"Budget: {dept} overspend",
                    body=None,
                    status=CFOAlertStatus.open,
                    cfo_agent_run_id=run_pk,
                    meta_json=o,
                )
            )
    if agent_name == "fpa_variance":
        n = 0
        for d in (payload or {}).get("department_summary") or []:
            if n >= 12:
                break
            st = str(d.get("status") or "")
            vp = float(d.get("variance_pct") or 0)
            if st == "Over Budget" or vp > 10:
                n += 1
                dept = d.get("department") or "Dept"
                db.add(
                    CFOAlert(
                        tenant_id=tenant_id,
                        agent_name=agent_name,
                        severity=CFOAlertSeverity.warning,
                        title=f"Variance: {dept} {vp:.1f}% vs budget ({st})",
                        body=None,
                        status=CFOAlertStatus.open,
                        cfo_agent_run_id=run_pk,
                        meta_json=d,
                    )
                )
    if agent_name == "recon":
        u = (payload or {}).get("unmatched_book")
        if isinstance(u, int) and u > 0:
            db.add(
                CFOAlert(
                    tenant_id=tenant_id,
                    agent_name=agent_name,
                    severity=CFOAlertSeverity.warning,
                    title=f"Bank recon: {u} unmatched book line(s)",
                    body="Open bank reconciliation workspace for detail.",
                    status=CFOAlertStatus.open,
                    cfo_agent_run_id=run_pk,
                    meta_json={"unmatched_book": u, "workspace_id": payload.get("workspace_id")},
                )
            )
    if agent_name == "fpa_forecast":
        dev = payload.get("deviation_vs_budget_pct")
        ref = float(payload.get("reference_budget") or 0)
        tot = float(payload.get("forecast_fy_total") or 0)
        if ref > 0 and dev is not None and abs(float(dev)) > 10.0:
            db.add(
                CFOAlert(
                    tenant_id=tenant_id,
                    agent_name=agent_name,
                    severity=CFOAlertSeverity.warning,
                    title=f"Forecast deviates {float(dev):+.1f}% vs budget reference",
                    body=f"FY revenue-type total {tot:,.0f} vs reference budget {ref:,.0f}.",
                    status=CFOAlertStatus.open,
                    cfo_agent_run_id=run_pk,
                    meta_json={"deviation_vs_budget_pct": dev, "forecast_fy_total": tot, "reference_budget": ref},
                )
            )
    db.commit()


def create_queued_run(db: Session, tenant_id: str, agent_name: str, context: dict[str, Any] | None) -> CFOAgentRun:
    run = CFOAgentRun(
        run_id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        agent_name=agent_name.strip().lower(),
        status=CFOAgentRunStatus.queued,
        context_json=context or {},
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def _execute_once(db: Session, row: CFOAgentRun) -> dict[str, Any]:
    ctx = row.context_json or {}
    return run_agent(row.agent_name, db, row.tenant_id, ctx)


def execute_cfo_agent_task(run_pk: int) -> None:
    db = SessionLocal()
    try:
        row = db.query(CFOAgentRun).filter(CFOAgentRun.id == run_pk).first()
        if not row:
            logger.warning("cfo agent run missing id=%s", run_pk)
            return
        row.status = CFOAgentRunStatus.running
        row.updated_at = datetime.utcnow()
        db.commit()
        _log(db, row.id, f"Agent {row.agent_name} started")

        last_err: str | None = None
        for attempt in range(2):
            row.retry_count = attempt
            db.commit()
            try:
                raw = _execute_once(db, row)
            except Exception as e:
                logger.exception("cfo agent %s failed", row.agent_name)
                last_err = str(e)
                _log(db, row.id, f"Exception: {last_err}", level="error")
                continue

            ok = bool(raw.get("ok"))
            val = raw.get("validation") or {}
            passed = bool(val.get("passed"))
            err_msg = raw.get("error")
            out = raw.get("output")

            if not ok:
                last_err = err_msg or "; ".join(val.get("errors") or []) or "agent failed"
                _log(db, row.id, f"Attempt {attempt + 1}: {last_err}", level="warning")
                if any(
                    x in last_err.lower()
                    for x in ("required", "not found", "fewer than", "need at least", "must be", "unknown agent")
                ):
                    break
                continue

            if ok and passed and out is not None:
                audit = build_twelve_checks(row.agent_name, out if isinstance(out, dict) else {}, True)
                stored = wrap_agent_payload(out if isinstance(out, dict) else {}, audit)
                db.add(
                    CFOAgentOutput(
                        cfo_agent_run_id=row.id,
                        output_type="primary",
                        payload_json=stored,
                        validation_passed=True,
                        validation_errors_json=val.get("errors") or [],
                    )
                )
                _emit_alerts(db, row.tenant_id, row.agent_name, row.id, out if isinstance(out, dict) else {})
                row.status = CFOAgentRunStatus.completed
                row.error_message = None
                db.commit()
                _log(db, row.id, "Completed with validation OK")
                return

            last_err = err_msg or "; ".join(val.get("errors") or []) or "validation failed"
            _log(db, row.id, f"Attempt {attempt + 1}: {last_err}", level="warning")

        row.status = CFOAgentRunStatus.needs_review
        row.error_message = last_err
        if row.error_message:
            db.add(
                CFOAgentOutput(
                    cfo_agent_run_id=row.id,
                    output_type="primary",
                    payload_json={"failed": True, "message": last_err},
                    validation_passed=False,
                    validation_errors_json=[last_err],
                )
            )
        db.commit()
        _log(db, row.id, "Marked needs_review after retry", level="error")
    finally:
        db.close()
