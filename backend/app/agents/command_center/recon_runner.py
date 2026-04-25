"""Summarises an existing bank recon workspace (wraps bank_recon recalculation + counts)."""
from __future__ import annotations

from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.routes.bank_recon import _recalc_workspace
from app.models.bank_recon import BankTransaction, BookTransaction, BookTxnStatus, ReconWorkspace


def _validate(progress: dict[str, int], total_bank: int) -> tuple[bool, list[str]]:
    errs: list[str] = []
    m = int(progress.get("matched") or 0)
    t = int(progress.get("total") or 0)
    if t < 0 or m < 0 or m > t:
        errs.append("invalid book progress counts")
    if total_bank < 0:
        errs.append("invalid bank transaction count")
    return (len(errs) == 0, errs)


def run(db: Session, tenant_id: str, context: dict[str, Any]) -> dict[str, Any]:
    wid = context.get("workspace_id")
    if wid is None:
        return {
            "ok": True,
            "error": None,
            "output": {
                "message": "No workspace_id in context. Open Bank Reconciliation and pass workspace_id to run this agent.",
                "validation_skipped": True,
            },
            "validation": {"passed": True, "errors": []},
        }
    try:
        workspace_id = int(wid)
    except (TypeError, ValueError):
        return {
            "ok": False,
            "error": "workspace_id must be an integer",
            "output": None,
            "validation": {"passed": False, "errors": ["bad workspace_id"]},
        }

    ws = (
        db.query(ReconWorkspace)
        .filter(ReconWorkspace.id == workspace_id, ReconWorkspace.tenant_id == tenant_id)
        .first()
    )
    if not ws:
        return {
            "ok": False,
            "error": "Workspace not found for tenant",
            "output": None,
            "validation": {"passed": False, "errors": ["not_found"]},
        }

    _recalc_workspace(db, ws)
    total_book = db.query(func.count(BookTransaction.id)).filter(BookTransaction.workspace_id == ws.id).scalar() or 0
    matched_book = (
        db.query(func.count(BookTransaction.id))
        .filter(
            BookTransaction.workspace_id == ws.id,
            BookTransaction.status != BookTxnStatus.unmatched,
        )
        .scalar()
        or 0
    )
    total_bank = db.query(func.count(BankTransaction.id)).filter(BankTransaction.workspace_id == ws.id).scalar() or 0
    unmatched_book = max(0, int(total_book) - int(matched_book))

    progress = {"matched": int(matched_book), "total": int(total_book)}
    ok, errs = _validate(progress, int(total_bank))

    out = {
        "workspace_id": ws.id,
        "workspace_name": ws.workspace_name,
        "progress": progress,
        "unmatched_book": unmatched_book,
        "total_bank_txns": int(total_bank),
        "variance": float(ws.variance or 0),
        "is_reconciled": bool(ws.is_reconciled),
        "status": ws.status.value if ws.status else None,
    }
    db.commit()
    return {"ok": ok, "error": None, "output": out, "validation": {"passed": ok, "errors": errs}}
