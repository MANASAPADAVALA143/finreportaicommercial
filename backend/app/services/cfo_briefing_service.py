"""Build CFO morning briefing from recent agent outputs + optional Claude synthesis."""
from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.models.cfo_command_center import CFOAgentOutput, CFOAgentRun, CFOAlert, CFOAlertStatus, CFOBriefing
from app.services import llm_service
from app.services.cfo_audit import unwrap_agent_payload

logger = logging.getLogger(__name__)

BRIEFING_SYSTEM = """You are NEXUS-C — CFO orchestration layer for FinReportAI.
You synthesise specialist agent outputs into a concise morning briefing.
Return ONLY valid JSON with keys:
  "greeting_line": string,
  "urgent": [ {"title": string, "detail": string, "agent": string} ],
  "completed": [ {"title": string, "detail": string, "agent": string} ],
  "decisions": [ {"title": string, "detail": string} ]
Be specific and number-backed. No fluff."""

NEXUS_CHAT_SYSTEM = """You are NEXUS-C — CFO orchestration for FinReportAI.
Answer the CFO in clear prose using the snapshot JSON. Quote numbers when present.
If the snapshot lacks data to answer, say exactly what to upload or which agent to run."""


def recent_outputs(db: Session, tenant_id: str, days: int = 2) -> list[dict[str, Any]]:
    since = datetime.utcnow() - timedelta(days=days)
    rows = (
        db.query(CFOAgentRun, CFOAgentOutput)
        .join(CFOAgentOutput, CFOAgentOutput.cfo_agent_run_id == CFOAgentRun.id)
        .filter(CFOAgentRun.tenant_id == tenant_id, CFOAgentRun.created_at >= since)
        .order_by(desc(CFOAgentRun.created_at))
        .limit(40)
        .all()
    )
    out: list[dict[str, Any]] = []
    for run, op in rows:
        payload = op.payload_json or {}
        inner, audit = unwrap_agent_payload(payload if isinstance(payload, dict) else None)
        if inner is None:
            inner = payload if isinstance(payload, dict) else {}
        if isinstance(inner, dict) and inner.get("failed"):
            continue
        out.append(
            {
                "agent": run.agent_name,
                "status": run.status.value if hasattr(run.status, "value") else str(run.status),
                "created_at": run.created_at.isoformat() if run.created_at else None,
                "summary": _summarise_payload(run.agent_name, inner),
                "audit": audit,
            }
        )
    return out


def _summarise_payload(agent: str, payload: dict[str, Any]) -> dict[str, Any]:
    if agent == "fpa_variance":
        return {
            "total_variance_pct": payload.get("total_variance_pct"),
            "overall_status": payload.get("overall_status"),
        }
    if agent == "fpa_budget":
        return {"overspends": (payload.get("overspends") or [])[:5]}
    if agent == "fpa_forecast":
        return {"forecast_fy_total": payload.get("forecast_fy_total"), "ytd_actual": payload.get("ytd_actual")}
    if agent == "je_anomaly":
        s = payload.get("summary") or {}
        return {"high_risk": s.get("high_risk"), "medium_risk": s.get("medium_risk")}
    if agent == "recon":
        return {
            "workspace_id": payload.get("workspace_id"),
            "unmatched_book": payload.get("unmatched_book"),
            "is_reconciled": payload.get("is_reconciled"),
        }
    if agent == "ifrs":
        return {"ifrs_run_id": payload.get("ifrs_run_id"), "message": payload.get("message")}
    return {"keys": list(payload.keys())[:12]}


def open_alerts(db: Session, tenant_id: str) -> list[dict[str, Any]]:
    rows = (
        db.query(CFOAlert)
        .filter(CFOAlert.tenant_id == tenant_id, CFOAlert.status == CFOAlertStatus.open)
        .order_by(desc(CFOAlert.created_at))
        .limit(25)
        .all()
    )
    return [
        {
            "id": r.id,
            "severity": r.severity.value if hasattr(r.severity, "value") else str(r.severity),
            "agent": r.agent_name,
            "title": r.title,
            "body": r.body,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


def build_briefing_for_tenant(db: Session, tenant_id: str, briefing_date: date | None = None) -> CFOBriefing:
    d = briefing_date or date.today()
    recent = recent_outputs(db, tenant_id)
    alerts = open_alerts(db, tenant_id)

    structured: dict[str, Any] = {
        "briefing_date": d.isoformat(),
        "open_alerts": alerts,
        "recent_agent_summaries": recent,
    }

    raw_text: str | None = None
    if llm_service.is_configured():
        try:
            prompt = (
                "Build the morning briefing from this JSON snapshot:\n"
                f"{json.dumps(structured, default=str)[:18000]}"
            )
            raw_text = llm_service.invoke(
                prompt=prompt,
                system=BRIEFING_SYSTEM,
                max_tokens=2500,
                temperature=0.2,
                model_id=None,
            )
            parsed = json.loads(raw_text) if raw_text.strip().startswith("{") else None
            if isinstance(parsed, dict):
                structured["nexus_json"] = parsed
        except Exception:
            logger.exception("briefing LLM failed; storing snapshot only")

    row = CFOBriefing(
        tenant_id=tenant_id,
        briefing_date=d,
        content_json=structured,
        raw_text=raw_text,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def get_briefing_today(db: Session, tenant_id: str) -> CFOBriefing | None:
    d = date.today()
    return (
        db.query(CFOBriefing)
        .filter(CFOBriefing.tenant_id == tenant_id, CFOBriefing.briefing_date == d)
        .order_by(desc(CFOBriefing.created_at))
        .first()
    )


def list_briefings(db: Session, tenant_id: str, days: int = 30) -> list[CFOBriefing]:
    since = date.today() - timedelta(days=days)
    return (
        db.query(CFOBriefing)
        .filter(CFOBriefing.tenant_id == tenant_id, CFOBriefing.briefing_date >= since)
        .order_by(desc(CFOBriefing.briefing_date), desc(CFOBriefing.created_at))
        .all()
    )
