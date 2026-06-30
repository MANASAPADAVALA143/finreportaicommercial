"""Enforce accounting_controls on manual journal entries."""
from __future__ import annotations

import json
from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from app.exceptions.period_control import PeriodControlError
from app.models.company_setup import AccountingControls, AccountingPeriod

SYSTEM_SOURCES = frozenset({
    "AR_INVOICE", "AR_RECEIPT", "ar_invoice", "ap_invoice", "AP_INVOICE",
    "AP_INVOICE_VAT", "AP_PAYMENT", "AP_RECEIPT",
    "opening_balance", "depreciation", "accrual", "accrual_reversal",
    "bank_recon", "reversal",
})


def assert_period_open(
    *,
    entry_date: date,
    workspace_id: str,
    company_id: str | None,
    source: str,
    db: Session,
) -> None:
    """Block JE inserts into locked/closed accounting periods."""
    if (source or "").lower() == "opening_balance":
        return

    q = db.query(AccountingPeriod).filter(
        AccountingPeriod.workspace_id == workspace_id,
        AccountingPeriod.start_date <= entry_date,
        AccountingPeriod.end_date >= entry_date,
    )
    if company_id:
        q = q.filter(
            (AccountingPeriod.company_id == company_id)
            | (AccountingPeriod.company_id.is_(None))
        )
    period = q.first()
    if not period or period.status == "open":
        return
    if period.status == "locked":
        raise PeriodControlError(
            "PERIOD_LOCKED",
            f"Period {period.period_name} is locked. Post to the current open period.",
            period_name=period.period_name,
        )
    if period.status == "closed":
        raise PeriodControlError(
            "PERIOD_CLOSED",
            f"Period {period.period_name} is closed. Contact your accountant to reopen.",
            period_name=period.period_name,
        )


def _parse_codes(raw: str | None) -> set[str]:
    if not raw:
        return set()
    try:
        return set(json.loads(raw))
    except json.JSONDecodeError:
        return set()


def get_controls(db: Session, workspace_id: str) -> AccountingControls | None:
    return db.query(AccountingControls).filter_by(workspace_id=workspace_id).first()


def validate_journal_entry(
    *,
    entry_date: date,
    lines: list[dict],
    source: str,
    workspace_id: str,
    db: Session,
) -> dict[str, Any]:
    """
    Returns {ok, requires_approval, errors, warnings}.
    System sources bypass approval rules.
    """
    is_manual = (source or "manual").lower() in ("manual", "")

    if source in SYSTEM_SOURCES or not is_manual:
        return {"ok": True, "requires_approval": False, "errors": [], "warnings": []}

    controls = get_controls(db, workspace_id)
    if not controls:
        return {"ok": True, "requires_approval": False, "errors": [], "warnings": []}

    today = date.today()
    errors: list[str] = []
    warnings: list[str] = []
    requires_approval = False

    if entry_date < today:
        days_back = (today - entry_date).days
        if not controls.allow_backdating:
            errors.append("Backdated journal entries are not permitted by accounting controls.")
        elif days_back > int(controls.max_backdate_days or 30):
            errors.append(
                f"Entry date is {days_back} days in the past — max allowed is {controls.max_backdate_days} days."
            )

    total_dr = sum(float(l.get("debit") or 0) for l in lines)
    threshold = float(controls.je_approval_threshold_aed or 0)
    if threshold > 0 and total_dr > threshold:
        requires_approval = True
        warnings.append(
            f"Journal total AED {total_dr:,.2f} exceeds approval threshold AED {threshold:,.2f}."
        )

    dual_codes = _parse_codes(controls.dual_approval_account_ids)
    if dual_codes:
        for ln in lines:
            code = str(ln.get("account_code") or "")
            amt = max(float(ln.get("debit") or 0), float(ln.get("credit") or 0))
            if code in dual_codes and amt > 0:
                requires_approval = True
                warnings.append(f"Account {code} requires dual approval per controls.")
                break

    doc_codes = _parse_codes(controls.require_docs_account_ids)
    if doc_codes:
        for ln in lines:
            code = str(ln.get("account_code") or "")
            if code in doc_codes:
                warnings.append(f"Supporting documentation required for account {code}.")

    return {
        "ok": len(errors) == 0,
        "requires_approval": requires_approval and len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
    }
