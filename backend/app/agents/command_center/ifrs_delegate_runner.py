"""Starts the existing IFRS multi-agent pipeline (same as POST /api/ifrs/agentic/start)."""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.agents.nexus_orchestrator import create_run_record, execute_agentic_pipeline
from app.models.ifrs_statement import TrialBalance


def run(db: Session, tenant_id: str, context: dict[str, Any]) -> dict[str, Any]:
    tb_id = context.get("trial_balance_id")
    if tb_id is None:
        return {
            "ok": False,
            "error": "context.trial_balance_id required",
            "output": None,
            "validation": {"passed": False, "errors": ["missing trial_balance_id"]},
        }
    try:
        trial_balance_id = int(tb_id)
    except (TypeError, ValueError):
        return {
            "ok": False,
            "error": "trial_balance_id must be int",
            "output": None,
            "validation": {"passed": False, "errors": ["bad trial_balance_id"]},
        }

    tb = (
        db.query(TrialBalance)
        .filter(TrialBalance.id == trial_balance_id, TrialBalance.tenant_id == tenant_id)
        .first()
    )
    if not tb:
        return {
            "ok": False,
            "error": "Trial balance not found",
            "output": None,
            "validation": {"passed": False, "errors": ["tb_not_found"]},
        }

    existing = context.get("ifrs_run_id")
    if existing and str(existing).strip():
        rid = str(existing).strip()
        out = {
            "ifrs_run_id": rid,
            "trial_balance_id": trial_balance_id,
            "message": "Linked to IFRS agentic run started from UI; poll GET /api/ifrs/agentic/{run_id}/status.",
            "delegated": True,
            "linked_only": True,
        }
        return {
            "ok": True,
            "error": None,
            "output": out,
            "validation": {"passed": True, "errors": [], "note": "No duplicate pipeline — Command Center tracks existing IFRS run."},
        }

    prior = context.get("prior_trial_balance_id")
    prior_id = int(prior) if prior is not None and str(prior).strip() != "" else None
    manual_prior = context.get("manual_prior")

    run_row = create_run_record(
        db,
        tenant_id,
        trial_balance_id,
        prior_trial_balance_id=prior_id,
        manual_prior=manual_prior if isinstance(manual_prior, dict) else None,
    )
    if context.get("defer_ifrs_execute"):
        out = {
            "ifrs_run_id": run_row.run_id,
            "trial_balance_id": trial_balance_id,
            "message": "IFRS run record created; execute_agentic_pipeline not started (defer_ifrs_execute=true).",
            "delegated": True,
        }
        return {
            "ok": True,
            "error": None,
            "output": out,
            "validation": {"passed": True, "errors": [], "note": "Deferred IFRS execution."},
        }

    # Runs synchronously inside the CFO agent worker thread (same as BackgroundTasks worker).
    execute_agentic_pipeline(run_row.run_id, tenant_id, trial_balance_id)
    out = {
        "ifrs_run_id": run_row.run_id,
        "trial_balance_id": trial_balance_id,
        "message": "IFRS agentic pipeline finished in-process. Poll GET /api/ifrs/agentic/{run_id}/status for artifacts.",
        "delegated": True,
    }
    return {
        "ok": True,
        "error": None,
        "output": out,
        "validation": {"passed": True, "errors": [], "note": "IFRS pack validated inside IFRS auditor/packager."},
    }
