"""UAE Journal Entry service — create, post, reverse, trial balance."""
from __future__ import annotations
import logging
from datetime import date, datetime
from decimal import Decimal
from sqlalchemy.orm import Session
from app.models.uae_accounting_full import UAEJournalEntry, UAEJournalLine

logger = logging.getLogger(__name__)


def _next_je_number(tenant_id: str, db: Session) -> str:
    count = db.query(UAEJournalEntry).filter(UAEJournalEntry.tenant_id == tenant_id).count()
    year = datetime.utcnow().year
    return f"JE-{year}-{count + 1:04d}"


def create_journal_entry(
    tenant_id: str,
    entry_date: date,
    description: str,
    lines: list[dict],
    *,
    reference: str = "",
    source: str = "manual",
    db: Session,
    auto_post: bool = False,
) -> UAEJournalEntry:
    """
    Create a journal entry with lines.
    lines: [{"account_code": str, "account_name": str, "debit": float, "credit": float, "description": str}]
    Validates debits == credits before posting.
    """
    period = entry_date.strftime("%Y-%m")
    je = UAEJournalEntry(
        tenant_id=tenant_id,
        entry_number=_next_je_number(tenant_id, db),
        entry_date=entry_date,
        period=period,
        description=description,
        reference=reference,
        source=source,
        status="draft",
    )
    db.add(je)
    db.flush()

    for ld in lines:
        line = UAEJournalLine(
            journal_entry_id=je.id,
            account_code=ld.get("account_code", ""),
            account_name=ld.get("account_name", ""),
            description=ld.get("description", description),
            debit=float(ld.get("debit", 0)),
            credit=float(ld.get("credit", 0)),
            vat_amount=float(ld.get("vat_amount", 0)),
            currency=ld.get("currency", "AED"),
        )
        db.add(line)

    if auto_post:
        post_journal_entry(je, db)
    else:
        db.commit()

    return je


def post_journal_entry(je: UAEJournalEntry, db: Session) -> UAEJournalEntry:
    """Post a draft JE after validating it balances."""
    total_dr = sum(float(l.debit or 0) for l in je.lines)
    total_cr = sum(float(l.credit or 0) for l in je.lines)
    if abs(total_dr - total_cr) > 0.01:
        raise ValueError(
            f"Journal entry {je.entry_number} does not balance: "
            f"Dr {total_dr:.2f} ≠ Cr {total_cr:.2f}"
        )
    je.status = "posted"
    je.posted_at = datetime.utcnow()
    db.add(je)
    db.commit()
    return je


def reverse_journal_entry(je_id: str, tenant_id: str, reversal_date: date, db: Session) -> UAEJournalEntry:
    """Create a reversing entry (swaps Dr/Cr on all lines)."""
    orig = db.query(UAEJournalEntry).filter(
        UAEJournalEntry.id == je_id,
        UAEJournalEntry.tenant_id == tenant_id,
    ).first()
    if not orig:
        raise ValueError(f"Journal entry {je_id} not found")
    if orig.status != "posted":
        raise ValueError("Only posted journal entries can be reversed")

    reversed_lines = [
        {
            "account_code": l.account_code,
            "account_name": l.account_name,
            "description": l.description,
            "debit": float(l.credit or 0),
            "credit": float(l.debit or 0),
        }
        for l in orig.lines
    ]
    rev_je = create_journal_entry(
        tenant_id=tenant_id,
        entry_date=reversal_date,
        description=f"REVERSAL: {orig.description}",
        lines=reversed_lines,
        reference=orig.entry_number,
        source="reversal",
        db=db,
        auto_post=True,
    )
    orig.status = "reversed"
    db.add(orig)
    db.commit()
    return rev_je


def get_trial_balance(tenant_id: str, period: str, db: Session) -> dict:
    """Return trial balance for a period with debit/credit totals per account."""
    rows = (
        db.query(UAEJournalLine, UAEJournalEntry)
        .join(UAEJournalEntry, UAEJournalLine.journal_entry_id == UAEJournalEntry.id)
        .filter(
            UAEJournalEntry.tenant_id == tenant_id,
            UAEJournalEntry.period == period,
            UAEJournalEntry.status == "posted",
        )
        .all()
    )
    accounts: dict[str, dict] = {}
    for line, je in rows:
        code = line.account_code or "UNKNOWN"
        if code not in accounts:
            accounts[code] = {"account_code": code, "account_name": line.account_name or "", "debit": 0.0, "credit": 0.0}
        accounts[code]["debit"] += float(line.debit or 0)
        accounts[code]["credit"] += float(line.credit or 0)

    lines_out = list(accounts.values())
    for l in lines_out:
        l["net_balance"] = l["debit"] - l["credit"]

    total_dr = sum(l["debit"] for l in lines_out)
    total_cr = sum(l["credit"] for l in lines_out)
    return {
        "period": period,
        "lines": lines_out,
        "total_debits": total_dr,
        "total_credits": total_cr,
        "is_balanced": abs(total_dr - total_cr) < 0.01,
    }
