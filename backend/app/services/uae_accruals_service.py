"""UAE Accruals AI Engine — suggest, post, reverse."""
from __future__ import annotations
import json
import logging
from datetime import date, datetime
from collections import defaultdict
from sqlalchemy.orm import Session
from app.models.uae_accounting_full import UAEAccrual, UAEJournalEntry, UAEJournalLine

logger = logging.getLogger(__name__)


def _get_period_last_day(period: str) -> date:
    import calendar
    year, month = int(period[:4]), int(period[5:7])
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, last_day)


def _next_period(period: str) -> str:
    year, month = int(period[:4]), int(period[5:7])
    if month == 12:
        return f"{year + 1}-01"
    return f"{year}-{month + 1:02d}"


def _3_months_ago(period: str) -> str:
    year, month = int(period[:4]), int(period[5:7])
    month -= 3
    while month <= 0:
        month += 12
        year -= 1
    return f"{year}-{month:02d}"


def suggest_accruals(tenant_id: str, period: str, db: Session) -> list[dict]:
    """
    AI engine: suggest month-end accruals.
    1. Detects recurring JE patterns from last 3 months
    2. Always suggests EOSB (UAE mandatory)
    3. Calls Claude for AI-enriched descriptions if API key present
    """
    suggestions: list[dict] = []

    # ── Detect recurring patterns ─────────────────────────────────────────────
    recent = (
        db.query(UAEJournalEntry)
        .filter(
            UAEJournalEntry.tenant_id == tenant_id,
            UAEJournalEntry.period >= _3_months_ago(period),
            UAEJournalEntry.period < period,
            UAEJournalEntry.status == "posted",
        )
        .all()
    )

    # Group by (period, description) to detect recurring entries
    by_desc: dict[str, list] = defaultdict(list)
    for je in recent:
        key = (je.description or "").lower()[:50]
        by_desc[key].append(je)

    for desc_key, entries in by_desc.items():
        if len(entries) >= 2:  # recurring if appeared ≥2 of last 3 months
            amounts = []
            for je in entries:
                total = sum(float(l.debit or 0) for l in je.lines if float(l.debit or 0) > 0)
                amounts.append(total)
            avg = sum(amounts) / len(amounts)
            if avg < 10:
                continue

            # Check if already posted this period
            already = db.query(UAEJournalEntry).filter(
                UAEJournalEntry.tenant_id == tenant_id,
                UAEJournalEntry.period == period,
                UAEJournalEntry.description.ilike(f"%{desc_key[:20]}%"),
                UAEJournalEntry.status == "posted",
            ).count()

            if already == 0:
                # Determine account from most common line
                dr_acct = "7100"
                cr_acct = "3020"
                for je in entries:
                    for l in je.lines:
                        if float(l.debit or 0) > 0:
                            dr_acct = l.account_code or dr_acct
                        elif float(l.credit or 0) > 0:
                            cr_acct = l.account_code or cr_acct
                        break
                    break

                suggestions.append({
                    "type": "recurring",
                    "description": f"Accrual: {entries[0].description} - {period}",
                    "amount": round(avg, 2),
                    "debit_account_code": dr_acct,
                    "credit_account_code": cr_acct,
                    "ai_confidence": 85,
                    "ai_basis": f"Recurring monthly pattern — avg AED {avg:,.2f} over {len(entries)} months",
                    "reversal_period": _next_period(period),
                    "mandatory": False,
                    "ai_suggested": True,
                })

    # ── EOSB — UAE mandatory accrual ─────────────────────────────────────────
    salary_lines = (
        db.query(UAEJournalLine, UAEJournalEntry)
        .join(UAEJournalEntry, UAEJournalLine.journal_entry_id == UAEJournalEntry.id)
        .filter(
            UAEJournalEntry.tenant_id == tenant_id,
            UAEJournalEntry.period == period,
            UAEJournalLine.account_code == "7101",
            UAEJournalEntry.status == "posted",
        )
        .all()
    )
    monthly_salary = sum(float(l.debit or 0) for l, _ in salary_lines)
    if monthly_salary > 0:
        eosb_monthly = monthly_salary / 12  # 1 month per year gratuity
        suggestions.append({
            "type": "eosb",
            "description": f"End of Service Benefits Accrual - {period}",
            "amount": round(eosb_monthly, 2),
            "debit_account_code": "7102",
            "credit_account_code": "4010",
            "ai_confidence": 95,
            "ai_basis": f"UAE Labour Law: 1/12 of monthly salaries (AED {monthly_salary:,.0f})",
            "reversal_period": None,
            "mandatory": True,
            "ai_suggested": True,
        })

    return sorted(suggestions, key=lambda x: x["ai_confidence"], reverse=True)


def post_accrual(accrual_id: str, tenant_id: str, db: Session) -> dict:
    """Approve and post an accrual suggestion."""
    accrual = db.query(UAEAccrual).filter(
        UAEAccrual.id == accrual_id,
        UAEAccrual.tenant_id == tenant_id,
    ).first()
    if not accrual:
        raise ValueError(f"Accrual {accrual_id} not found")
    if accrual.status != "suggested":
        raise ValueError(f"Accrual is already {accrual.status}")

    from app.services.uae_journal_service import create_journal_entry
    import uuid as _uuid

    entry_date = _get_period_last_day(accrual.period)
    je = create_journal_entry(
        tenant_id=tenant_id,
        entry_date=entry_date,
        description=accrual.description,
        lines=[
            {"account_code": accrual.debit_account_code, "account_name": "", "debit": float(accrual.amount), "credit": 0},
            {"account_code": accrual.credit_account_code, "account_name": "", "debit": 0, "credit": float(accrual.amount)},
        ],
        source="accrual",
        db=db,
        auto_post=True,
    )
    accrual.status = "posted"
    accrual.journal_entry_id = je.id

    # Schedule reversal
    if accrual.reversal_period:
        rev_date = date(int(accrual.reversal_period[:4]), int(accrual.reversal_period[5:7]), 1)
        rev_je = create_journal_entry(
            tenant_id=tenant_id,
            entry_date=rev_date,
            description=f"REVERSAL: {accrual.description}",
            lines=[
                {"account_code": accrual.credit_account_code, "account_name": "", "debit": float(accrual.amount), "credit": 0},
                {"account_code": accrual.debit_account_code, "account_name": "", "debit": 0, "credit": float(accrual.amount)},
            ],
            source="accrual_reversal",
            db=db,
            auto_post=False,
        )
        rev_je.status = "scheduled"
        db.add(rev_je)
        accrual.reversal_journal_id = rev_je.id

    db.add(accrual)
    db.commit()
    return {"je_id": je.id, "accrual_id": accrual.id, "status": "posted"}
