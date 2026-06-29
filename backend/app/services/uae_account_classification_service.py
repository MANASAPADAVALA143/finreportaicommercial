"""AI + manual UAE account classification for financial reporting."""
from __future__ import annotations

import json
import logging
import os
from typing import Any

from sqlalchemy.orm import Session

from app.models.uae_account_classification import UAEAccountClassification
from app.models.uae_accounting_full import UAEAccount, UAEJournalEntry, UAEJournalLine

logger = logging.getLogger(__name__)

_CLASSIFY_PROMPT = """You are a UAE IFRS accounting expert.
Classify this GL account. Return JSON only:
{{
  "bs_pl_main": "Current Assets|Non-Current Assets|Current Liabilities|Non-Current Liabilities|Equity|Revenue|Cost of Sales|Operating Expenses|Other Income|Other Expenses|Tax",
  "bs_pl_sub": "string",
  "fs_note_number": integer,
  "fs_note_heading": "string",
  "cash_flow_category": "Operating|Investing|Financing|Not Applicable",
  "cit_category": "Revenue|Deductible Expense|Non-Deductible|Capital|Tax Payable|Not Applicable",
  "cit_add_back": boolean,
  "confidence": 0-100,
  "reasoning": "string"
}}

UAE IFRS rules:
- 1xxx Assets; 1001-1099 Cash (Note 3); 1100-1199 Receivables (Note 4); 1200-1299 Inventory (Note 5)
- 2xxx/3xxx Liabilities; 2100-2199 Trade Payables; 2200-2299 VAT; 2300-2399 Lease
- 5xxx Equity in this chart; 6xxx Revenue (Note 11); 7xxx COGS/OpEx; 7170 Finance
- Entertainment = Non-Deductible CT; Depreciation = cit_add_back true
Account code: {code}
Account name: {name}
Balance AED: {balance}
"""


def _account_balances(
    db: Session, workspace_id: str, company_id: str | None, period: str | None = None
) -> dict[str, float]:
    q = (
        db.query(UAEJournalLine, UAEJournalEntry)
        .join(UAEJournalEntry, UAEJournalLine.journal_entry_id == UAEJournalEntry.id)
        .filter(
            UAEJournalEntry.tenant_id == workspace_id,
            UAEJournalEntry.status == "posted",
        )
    )
    if company_id:
        q = q.filter(UAEJournalEntry.company_id == company_id)
    if period:
        q = q.filter(UAEJournalEntry.period == period)
    balances: dict[str, float] = {}
    for line, _je in q.all():
        code = line.account_code or ""
        balances[code] = balances.get(code, 0.0) + float(line.debit or 0) - float(line.credit or 0)
    return balances


def _status_from_row(row: UAEAccountClassification | None) -> str:
    if not row or not row.bs_pl_main:
        return "not_classified"
    required = [row.bs_pl_main, row.cash_flow_category, row.cit_category]
    filled = sum(1 for v in required if v)
    if filled >= 3:
        return "classified"
    if filled >= 1:
        return "partial"
    return "not_classified"


def _missing_fields(row: UAEAccountClassification | None) -> list[str]:
    missing: list[str] = []
    if not row or not row.bs_pl_main:
        missing.append("BS/PL")
    if not row or not row.cash_flow_category:
        missing.append("Cash Flow")
    if not row or not row.cit_category:
        missing.append("CIT")
    if not row or not row.fs_note_number:
        missing.append("FS Notes")
    return missing


def list_accounts_with_status(
    db: Session,
    workspace_id: str,
    company_id: str | None,
    period: str | None = None,
) -> list[dict[str, Any]]:
    balances = _account_balances(db, workspace_id, company_id, period)
    acct_q = db.query(UAEAccount).filter(
        UAEAccount.tenant_id == workspace_id,
        UAEAccount.is_active.is_(True),
    )
    if company_id:
        acct_q = acct_q.filter(UAEAccount.company_id == company_id)
    accounts = acct_q.order_by(UAEAccount.code).all()

    class_rows = {
        (r.account_code): r
        for r in db.query(UAEAccountClassification).filter(
            UAEAccountClassification.workspace_id == workspace_id,
            UAEAccountClassification.company_id == company_id,
        ).all()
    }

    out: list[dict[str, Any]] = []
    for acct in accounts:
        if acct.sub_type == "Header":
            continue
        bal = float(balances.get(acct.code, 0))
        row = class_rows.get(acct.code)
        status = _status_from_row(row)
        out.append({
            "account_id": acct.id,
            "account_code": acct.code,
            "account_name": acct.name,
            "balance": round(bal, 2),
            "status": status,
            "status_color": {"not_classified": "red", "partial": "yellow", "classified": "green"}[status],
            "bs_pl_main": row.bs_pl_main if row else None,
            "bs_pl_sub": row.bs_pl_sub if row else None,
            "fs_note_number": row.fs_note_number if row else None,
            "fs_note_heading": row.fs_note_heading if row else None,
            "cash_flow_category": row.cash_flow_category if row else None,
            "cit_category": row.cit_category if row else None,
            "cit_add_back": bool(row.cit_add_back) if row else False,
            "classified_by": row.classified_by if row else None,
            "missing_classifications": _missing_fields(row),
        })
    return out


def classification_summary(db: Session, workspace_id: str, company_id: str | None) -> dict[str, Any]:
    rows = list_accounts_with_status(db, workspace_id, company_id)
    total = len(rows)
    classified = sum(1 for r in rows if r["status"] == "classified")
    partial = sum(1 for r in rows if r["status"] == "partial")
    not_classified = sum(1 for r in rows if r["status"] == "not_classified")
    pct = round((classified / total * 100) if total else 0, 1)
    return {
        "total_accounts": total,
        "classified": classified,
        "partial": partial,
        "not_classified": not_classified,
        "ready_for_fs": total > 0 and classified == total,
        "classification_pct": pct,
    }


def _claude_classify(code: str, name: str, balance: float) -> dict[str, Any]:
    import anthropic

    key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not key:
        raise RuntimeError("ANTHROPIC_API_KEY not set")
    client = anthropic.Anthropic(api_key=key)
    prompt = _CLASSIFY_PROMPT.format(code=code, name=name, balance=balance)
    msg = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=800,
        temperature=0,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = msg.content[0].text.strip()
    if "```" in raw:
        raw = raw.split("```")[1].split("```")[0].strip()
        if raw.startswith("json"):
            raw = raw[4:].strip()
    return json.loads(raw)


def _upsert_classification(
    db: Session,
    *,
    workspace_id: str,
    company_id: str | None,
    account: UAEAccount,
    balance: float,
    data: dict[str, Any],
    classified_by: str,
) -> UAEAccountClassification:
    row = (
        db.query(UAEAccountClassification)
        .filter(
            UAEAccountClassification.workspace_id == workspace_id,
            UAEAccountClassification.company_id == company_id,
            UAEAccountClassification.account_code == account.code,
        )
        .first()
    )
    if not row:
        row = UAEAccountClassification(
            workspace_id=workspace_id,
            company_id=company_id,
            account_id=account.id,
            account_code=account.code,
            account_name=account.name,
            balance=balance,
        )
        db.add(row)
    row.account_name = account.name
    row.balance = balance
    row.bs_pl_main = data.get("bs_pl_main")
    row.bs_pl_sub = data.get("bs_pl_sub")
    row.fs_note_number = data.get("fs_note_number")
    row.fs_note_heading = data.get("fs_note_heading")
    row.cash_flow_category = data.get("cash_flow_category")
    row.cit_category = data.get("cit_category")
    row.cit_add_back = bool(data.get("cit_add_back", False))
    row.classified_by = classified_by
    row.ai_confidence = data.get("confidence")
    row.ai_reasoning = data.get("reasoning")
    row.classification_status = _status_from_row(row)
    db.flush()
    return row


def ai_classify_accounts(
    db: Session,
    *,
    workspace_id: str,
    company_id: str | None,
    account_ids: list[str] | None = None,
) -> dict[str, Any]:
    acct_q = db.query(UAEAccount).filter(
        UAEAccount.tenant_id == workspace_id,
        UAEAccount.is_active.is_(True),
    )
    if company_id:
        acct_q = acct_q.filter(UAEAccount.company_id == company_id)
    if account_ids:
        acct_q = acct_q.filter(UAEAccount.id.in_(account_ids))
    accounts = [a for a in acct_q.all() if a.sub_type != "Header"]
    balances = _account_balances(db, workspace_id, company_id)

    results: list[dict[str, Any]] = []
    batch_size = 10
    for i in range(0, len(accounts), batch_size):
        batch = accounts[i : i + batch_size]
        for acct in batch:
            bal = float(balances.get(acct.code, 0))
            try:
                data = _claude_classify(acct.code, acct.name, bal)
                row = _upsert_classification(
                    db, workspace_id=workspace_id, company_id=company_id,
                    account=acct, balance=bal, data=data, classified_by="ai",
                )
                results.append({"account_code": acct.code, "status": row.classification_status})
            except Exception as exc:
                logger.exception("Classify failed %s", acct.code)
                results.append({"account_code": acct.code, "status": "error", "error": str(exc)})
    db.commit()
    return {"processed": len(results), "results": results, "summary": classification_summary(db, workspace_id, company_id)}


def manual_classify(
    db: Session,
    account_id: str,
    workspace_id: str,
    company_id: str | None,
    payload: dict[str, Any],
) -> dict[str, Any]:
    acct = db.query(UAEAccount).filter(UAEAccount.id == account_id).first()
    if not acct:
        raise ValueError("Account not found")
    balances = _account_balances(db, workspace_id, company_id)
    bal = float(balances.get(acct.code, 0))
    row = _upsert_classification(
        db, workspace_id=workspace_id, company_id=company_id,
        account=acct, balance=bal, data=payload, classified_by="manual",
    )
    db.commit()
    return {"account_code": row.account_code, "status": row.classification_status}


def clear_classifications(db: Session, workspace_id: str, company_id: str | None) -> int:
    q = db.query(UAEAccountClassification).filter(UAEAccountClassification.workspace_id == workspace_id)
    if company_id:
        q = q.filter(UAEAccountClassification.company_id == company_id)
    count = q.delete(synchronize_session=False)
    db.commit()
    return count
