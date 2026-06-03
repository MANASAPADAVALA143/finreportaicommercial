"""
UAE Bank Reconciliation Service
================================
Three-step AI-assisted matching for UAE bank formats:
  Step 1 – Exact match  (amount + date + reference)
  Step 2 – Fuzzy match  (amount within 0.01 + date ±3 days)
  Step 3 – Claude AI    (semantic description matching)

Supported statement formats:
  ENBD, FAB, ADCB, RAKBank, DIB  (CSV + text patterns)
"""
from __future__ import annotations

import csv
import io
import logging
import os
import re
import uuid
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.models.uae_accounting_full import (
    UAEBankAccount,
    UAEBankStatement,
    UAEBankStatementLine,
    UAEJournalEntry,
    UAEJournalLine,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Bank format parsers
# ---------------------------------------------------------------------------

_DATE_FMTS = ["%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d %b %Y", "%d-%b-%Y", "%d/%m/%y"]


def _parse_date(s: str) -> date | None:
    s = s.strip()
    for fmt in _DATE_FMTS:
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    return None


def _to_float(s: str) -> float:
    """Strip currency symbols and commas, return float."""
    s = re.sub(r"[^\d.\-]", "", s.replace(",", ""))
    return float(s) if s else 0.0


def parse_enbd_csv(text: str) -> list[dict[str, Any]]:
    """ENBD Emirates NBD CSV format."""
    lines = []
    reader = csv.DictReader(io.StringIO(text))
    for row in reader:
        # ENBD columns: Date, Description, Debit Amount, Credit Amount, Balance
        txn_date = _parse_date(row.get("Date", ""))
        if not txn_date:
            continue
        debit  = _to_float(row.get("Debit Amount",  "0"))
        credit = _to_float(row.get("Credit Amount", "0"))
        amount = credit - debit          # positive = money in
        lines.append({
            "txn_date":    txn_date,
            "description": row.get("Description", "").strip(),
            "amount":      amount,
            "reference":   row.get("Reference", "").strip(),
            "balance":     _to_float(row.get("Balance", "0")),
        })
    return lines


def parse_fab_csv(text: str) -> list[dict[str, Any]]:
    """FAB (First Abu Dhabi Bank) CSV format."""
    lines = []
    reader = csv.DictReader(io.StringIO(text))
    for row in reader:
        # FAB columns: Transaction Date, Narrative, Withdrawals, Deposits, Running Balance
        txn_date = _parse_date(row.get("Transaction Date", ""))
        if not txn_date:
            continue
        withdrawals = _to_float(row.get("Withdrawals", "0"))
        deposits    = _to_float(row.get("Deposits",    "0"))
        amount      = deposits - withdrawals
        lines.append({
            "txn_date":    txn_date,
            "description": row.get("Narrative", "").strip(),
            "amount":      amount,
            "reference":   "",
            "balance":     _to_float(row.get("Running Balance", "0")),
        })
    return lines


def parse_adcb_csv(text: str) -> list[dict[str, Any]]:
    """ADCB (Abu Dhabi Commercial Bank) CSV format."""
    lines = []
    reader = csv.DictReader(io.StringIO(text))
    for row in reader:
        # ADCB: Value Date, Description, Debit, Credit, Balance
        txn_date = _parse_date(row.get("Value Date", "") or row.get("Transaction Date", ""))
        if not txn_date:
            continue
        debit  = _to_float(row.get("Debit",  "0"))
        credit = _to_float(row.get("Credit", "0"))
        amount = credit - debit
        lines.append({
            "txn_date":    txn_date,
            "description": row.get("Description", "").strip(),
            "amount":      amount,
            "reference":   row.get("Cheque No", "").strip(),
            "balance":     _to_float(row.get("Balance", "0")),
        })
    return lines


def parse_rakbank_csv(text: str) -> list[dict[str, Any]]:
    """RAKBank CSV format."""
    lines = []
    reader = csv.DictReader(io.StringIO(text))
    for row in reader:
        txn_date = _parse_date(row.get("Date", "") or row.get("Transaction Date", ""))
        if not txn_date:
            continue
        debit  = _to_float(row.get("Debit",  "0"))
        credit = _to_float(row.get("Credit", "0"))
        amount = credit - debit
        lines.append({
            "txn_date":    txn_date,
            "description": row.get("Particulars", row.get("Description", "")).strip(),
            "amount":      amount,
            "reference":   row.get("Ref No", "").strip(),
            "balance":     _to_float(row.get("Balance", "0")),
        })
    return lines


def parse_dib_csv(text: str) -> list[dict[str, Any]]:
    """DIB (Dubai Islamic Bank) CSV format."""
    lines = []
    reader = csv.DictReader(io.StringIO(text))
    for row in reader:
        txn_date = _parse_date(row.get("Transaction Date", "") or row.get("Date", ""))
        if not txn_date:
            continue
        debit  = _to_float(row.get("Withdrawal", row.get("Debit",  "0")))
        credit = _to_float(row.get("Deposit",    row.get("Credit", "0")))
        amount = credit - debit
        lines.append({
            "txn_date":    txn_date,
            "description": row.get("Description", row.get("Narration", "")).strip(),
            "amount":      amount,
            "reference":   row.get("Transaction Ref", "").strip(),
            "balance":     _to_float(row.get("Balance", "0")),
        })
    return lines


_BANK_PARSERS = {
    "ENBD":    parse_enbd_csv,
    "FAB":     parse_fab_csv,
    "ADCB":    parse_adcb_csv,
    "RAKBank": parse_rakbank_csv,
    "DIB":     parse_dib_csv,
}


def parse_bank_statement(text: str, bank_name: str) -> list[dict[str, Any]]:
    """Auto-detect or use specified bank parser."""
    parser = _BANK_PARSERS.get(bank_name)
    if not parser:
        # Auto-detect by header inspection
        first_line = text.split("\n")[0].lower()
        if "narrative" in first_line:
            parser = parse_fab_csv
        elif "value date" in first_line:
            parser = parse_adcb_csv
        elif "particulars" in first_line:
            parser = parse_rakbank_csv
        elif "withdrawal" in first_line or "narration" in first_line:
            parser = parse_dib_csv
        else:
            parser = parse_enbd_csv   # default
    return parser(text)


# ---------------------------------------------------------------------------
# Import statement into DB
# ---------------------------------------------------------------------------

def import_bank_statement(
    tenant_id: str,
    bank_account_id: str,
    statement_date: date,
    opening_balance: float,
    closing_balance: float,
    csv_text: str,
    bank_name: str,
    db: Session,
) -> UAEBankStatement:
    """Parse CSV and persist statement + lines."""
    rows = parse_bank_statement(csv_text, bank_name)

    stmt = UAEBankStatement(
        id              = str(uuid.uuid4()),
        tenant_id       = tenant_id,
        bank_account_id = bank_account_id,
        statement_date  = statement_date,
        opening_balance = opening_balance,
        closing_balance = closing_balance,
        status          = "pending",
    )
    db.add(stmt)
    db.flush()

    for row in rows:
        amt = row["amount"]   # positive = credit (money in)
        line = UAEBankStatementLine(
            id              = str(uuid.uuid4()),
            statement_id    = stmt.id,
            transaction_date= row["txn_date"],
            description     = row["description"],
            debit           = max(-amt, 0),   # money out
            credit          = max(amt,  0),   # money in
            reference       = row["reference"],
            balance         = row["balance"],
            match_status    = "unmatched",
        )
        db.add(line)

    db.commit()
    db.refresh(stmt)
    logger.info("Imported %d bank statement lines for account %s", len(rows), bank_account_id)
    return stmt


# ---------------------------------------------------------------------------
# Three-step matching engine
# ---------------------------------------------------------------------------

def _get_unmatched_gl_entries(
    tenant_id: str,
    from_date: date,
    to_date: date,
    db: Session,
) -> list[dict[str, Any]]:
    """Fetch posted JE lines that move cash (bank accounts)."""
    je_list = (
        db.query(UAEJournalEntry)
        .filter(
            UAEJournalEntry.tenant_id == tenant_id,
            UAEJournalEntry.status == "posted",
            UAEJournalEntry.entry_date >= from_date,
            UAEJournalEntry.entry_date <= to_date,
        )
        .all()
    )
    entries = []
    for je in je_list:
        for line in je.lines:
            # Only cash/bank lines (account_code starts with 10)
            if line.account_code and line.account_code.startswith("10"):
                entries.append({
                    "je_id":       je.id,
                    "line_id":     line.id,
                    "entry_date":  je.entry_date,
                    "description": je.description,
                    "reference":   je.reference or "",
                    "amount":      line.debit - line.credit,  # positive = debit (cash in)
                })
    return entries


def _bl_amount(bl: UAEBankStatementLine) -> float:
    """Net amount: positive = credit (money in), negative = debit (money out)."""
    return float(bl.credit or 0) - float(bl.debit or 0)


def _exact_match(
    bank_line: UAEBankStatementLine,
    gl_entries: list[dict[str, Any]],
    matched_gl: set[str],
) -> dict[str, Any] | None:
    """Step 1: exact amount + date + reference."""
    bl_amt  = _bl_amount(bank_line)
    bl_date = bank_line.transaction_date
    for entry in gl_entries:
        if entry["line_id"] in matched_gl:
            continue
        amount_ok = abs(bl_amt - entry["amount"]) < 0.01
        date_ok   = bl_date == entry["entry_date"]
        ref_ok    = (
            bank_line.reference
            and entry["reference"]
            and bank_line.reference.strip() == entry["reference"].strip()
        )
        if amount_ok and date_ok and ref_ok:
            return entry
    return None


def _fuzzy_match(
    bank_line: UAEBankStatementLine,
    gl_entries: list[dict[str, Any]],
    matched_gl: set[str],
) -> dict[str, Any] | None:
    """Step 2: amount within 0.01 + date ±3 days."""
    bl_amt  = _bl_amount(bank_line)
    bl_date = bank_line.transaction_date
    for entry in gl_entries:
        if entry["line_id"] in matched_gl:
            continue
        amount_ok = abs(bl_amt - entry["amount"]) < 0.01
        date_diff = abs((bl_date - entry["entry_date"]).days)
        if amount_ok and date_diff <= 3:
            return entry
    return None


def _ai_match(
    bank_line: UAEBankStatementLine,
    gl_entries: list[dict[str, Any]],
    matched_gl: set[str],
) -> dict[str, Any] | None:
    """
    Step 3: Claude AI semantic matching.
    Skipped if ANTHROPIC_API_KEY not set (returns None).
    """
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        return None

    # Only try entries within ±7 days and amount within 5%
    bl_amt  = _bl_amount(bank_line)
    bl_date = bank_line.transaction_date
    candidates = []
    for entry in gl_entries:
        if entry["line_id"] in matched_gl:
            continue
        date_diff   = abs((bl_date - entry["entry_date"]).days)
        amount_diff = abs(bl_amt - entry["amount"])
        amount_pct  = amount_diff / max(abs(bl_amt), 1)
        if date_diff <= 7 and amount_pct <= 0.05:
            candidates.append(entry)

    if not candidates:
        return None

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)

        candidates_text = "\n".join(
            f'{i+1}. Date:{e["entry_date"]} Amt:{e["amount"]:.2f} Desc:{e["description"][:80]}'
            for i, e in enumerate(candidates)
        )

        msg = client.messages.create(
            model="claude-3-5-haiku-20241022",
            max_tokens=50,
            messages=[{
                "role": "user",
                "content": (
                    f"Bank statement line:\n"
                    f"  Date: {bl_date}  Amount: {bl_amt:.2f}\n"
                    f"  Description: {bank_line.description[:120]}\n\n"
                    f"GL candidates:\n{candidates_text}\n\n"
                    "Reply with ONLY the candidate number (1,2,3…) that best matches, "
                    "or 0 if none match. No explanation."
                ),
            }],
        )
        choice = int(re.search(r"\d+", msg.content[0].text).group())
        if 1 <= choice <= len(candidates):
            return candidates[choice - 1]
    except Exception as exc:
        logger.warning("AI match failed: %s", exc)
    return None


def run_reconciliation(
    tenant_id: str,
    statement_id: str,
    db: Session,
) -> dict[str, Any]:
    """
    Run three-step matching for all unmatched lines in a statement.

    Returns summary: {total, exact, fuzzy, ai, unmatched}
    """
    stmt = db.query(UAEBankStatement).filter_by(id=statement_id, tenant_id=tenant_id).first()
    if not stmt:
        raise ValueError(f"Statement {statement_id} not found")

    bank_lines = (
        db.query(UAEBankStatementLine)
        .filter_by(statement_id=statement_id, match_status="unmatched")
        .all()
    )

    # Fetch GL entries spanning statement period ±7 days
    dates = [line.transaction_date for line in bank_lines if line.transaction_date]
    if not dates:
        return {"total": 0, "exact": 0, "fuzzy": 0, "ai": 0, "unmatched": 0}

    from_date = min(dates) - timedelta(days=7)
    to_date   = max(dates) + timedelta(days=7)
    gl_entries = _get_unmatched_gl_entries(tenant_id, from_date, to_date, db)

    matched_gl: set[str] = set()
    counts = {"exact": 0, "fuzzy": 0, "ai": 0, "unmatched": 0}

    for bl in bank_lines:
        match = _exact_match(bl, gl_entries, matched_gl)
        method = "exact"
        if not match:
            match = _fuzzy_match(bl, gl_entries, matched_gl)
            method = "fuzzy"
        if not match:
            match = _ai_match(bl, gl_entries, matched_gl)
            method = "ai"

        if match:
            bl.match_status          = "matched"
            bl.matched_journal_line_id = match["line_id"]
            bl.ai_narration          = f"matched:{method}"
            matched_gl.add(match["line_id"])
            counts[method] += 1
        else:
            counts["unmatched"] += 1

    # Update statement status
    if counts["unmatched"] == 0:
        stmt.status = "reconciled"
    elif counts["unmatched"] < len(bank_lines):
        stmt.status = "partial"

    db.commit()

    return {
        "total":     len(bank_lines),
        "exact":     counts["exact"],
        "fuzzy":     counts["fuzzy"],
        "ai":        counts["ai"],
        "unmatched": counts["unmatched"],
        "statement_status": stmt.status,
    }


def get_reconciliation_summary(
    tenant_id: str,
    statement_id: str,
    db: Session,
) -> dict[str, Any]:
    """Return full reconciliation status for a statement."""
    stmt = db.query(UAEBankStatement).filter_by(id=statement_id, tenant_id=tenant_id).first()
    if not stmt:
        raise ValueError(f"Statement {statement_id} not found")

    lines = db.query(UAEBankStatementLine).filter_by(statement_id=statement_id).all()
    matched   = [l for l in lines if l.match_status == "matched"]
    unmatched = [l for l in lines if l.match_status == "unmatched"]

    return {
        "statement_id":    stmt.id,
        "status":          stmt.status,
        "statement_date":  str(stmt.statement_date),
        "opening_balance": stmt.opening_balance,
        "closing_balance": stmt.closing_balance,
        "total_lines":     len(lines),
        "matched":         len(matched),
        "unmatched":       len(unmatched),
        "match_rate":      round(len(matched) / max(len(lines), 1) * 100, 1),
        "unmatched_lines": [
            {
                "id":          l.id,
                "txn_date":    str(l.transaction_date or ""),
                "description": l.description,
                "amount":      float(l.credit or 0) - float(l.debit or 0),
                "reference":   l.reference,
            }
            for l in unmatched
        ],
    }
