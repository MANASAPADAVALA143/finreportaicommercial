"""Single source of truth for the GulfTax VAT period.

Every module (Classifier, VAT Return, Recon, Dashboard, Invoice Flow anomaly checks)
identifies the period by the same quarter key, e.g. ``2026-Q3``.
"""
from __future__ import annotations

import logging
import re
from datetime import date, timedelta
from typing import Any, Dict, Optional, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from models import Invoice, Transaction

logger = logging.getLogger(__name__)

FILING_DAYS_AFTER_PERIOD_END = 28
_QUARTER_RE = re.compile(r"^(\d{4})-Q([1-4])$", re.I)
_QUARTER_MONTHS = {1: "Jan–Mar", 2: "Apr–Jun", 3: "Jul–Sep", 4: "Oct–Dec"}


def quarter_key(d: date) -> str:
    return f"{d.year}-Q{(d.month - 1) // 3 + 1}"


def parse_quarter(key: Optional[str]) -> Optional[Tuple[date, date]]:
    m = _QUARTER_RE.match((key or "").strip())
    if not m:
        return None
    year, q = int(m.group(1)), int(m.group(2))
    start = date(year, 3 * (q - 1) + 1, 1)
    end = date(year + 1, 1, 1) - timedelta(days=1) if q == 4 else date(year, 3 * q + 1, 1) - timedelta(days=1)
    return start, end


def filing_deadline(period_end: date) -> date:
    return period_end + timedelta(days=FILING_DAYS_AFTER_PERIOD_END)


def period_payload(key: str, *, source: str = "selected") -> Dict[str, Any]:
    bounds = parse_quarter(key)
    if not bounds:
        raise ValueError(f"Invalid tax period '{key}' — expected YYYY-Qn")
    start, end = bounds
    q = int(key.strip()[-1])
    return {
        "tax_period": key.strip().upper(),
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "label": f"Q{q} {start.year}",
        "long_label": f"{start.year} Q{q} {_QUARTER_MONTHS[q]}",
        "filing_deadline": filing_deadline(end).isoformat(),
        "source": source,
    }


def filing_due_period(today: Optional[date] = None) -> str:
    """Previous quarter while its return is still due, otherwise the current quarter."""
    today = today or date.today()
    current_start, _ = parse_quarter(quarter_key(today))  # type: ignore[misc]
    prev_end = current_start - timedelta(days=1)
    if today <= filing_deadline(prev_end):
        return quarter_key(prev_end)
    return quarter_key(today)


def _latest_activity_date(db: Session, company_id: str, today: date) -> Optional[date]:
    candidates: list[date] = []
    try:
        raw = (
            db.query(func.max(Invoice.invoice_date))
            .filter(Invoice.company_id == company_id, Invoice.invoice_date <= today.isoformat())
            .scalar()
        )
        if raw:
            candidates.append(raw if isinstance(raw, date) else date.fromisoformat(str(raw)[:10]))
    except Exception:
        db.rollback()
        logger.exception("latest invoice date lookup failed company_id=%s", company_id)
    try:
        txn_max = (
            db.query(func.max(Transaction.date))
            .filter(Transaction.company_id == company_id, Transaction.date <= today)
            .scalar()
        )
        if txn_max:
            candidates.append(txn_max)
    except Exception:
        db.rollback()
        logger.exception("latest transaction date lookup failed company_id=%s", company_id)
    return max(candidates) if candidates else None


def resolve_active_period(
    db: Session,
    company_id: str,
    requested: Optional[str] = None,
    today: Optional[date] = None,
) -> Dict[str, Any]:
    """Requested period if valid, else the quarter of the latest invoice/transaction,
    else the quarter currently due for filing. Never derived from today's quarter alone."""
    if requested and parse_quarter(requested):
        return period_payload(requested, source="selected")
    today = today or date.today()
    latest = _latest_activity_date(db, company_id, today)
    if latest:
        return period_payload(quarter_key(latest), source="latest_activity")
    return period_payload(filing_due_period(today), source="filing_due")
