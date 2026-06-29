"""UAE Journal Entry service — create, post, reverse, trial balance."""
from __future__ import annotations
import csv
import io
import logging
import re
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from sqlalchemy import or_
from sqlalchemy.orm import Session
from app.exceptions.period_control import PeriodControlError
from app.models.uae_accounting_full import UAEJournalEntry, UAEJournalLine, UAEAccount
from app.services.uae_controls_service import assert_period_open

logger = logging.getLogger(__name__)


def _normalize_account_code(code: str | None) -> str:
    s = str(code or "").strip()
    if re.fullmatch(r"\d+(\.0+)?", s):
        return s.split(".")[0]
    return s


def coa_name_map(
    tenant_id: str,
    db: Session,
    company_id: str | None = None,
) -> dict[str, str]:
    q = db.query(UAEAccount).filter_by(tenant_id=tenant_id, is_active=True)
    if company_id:
        q = q.filter(or_(UAEAccount.company_id == company_id, UAEAccount.company_id.is_(None)))
    return {_normalize_account_code(a.code): a.name for a in q.all() if a.code}


def missing_journal_account_codes(
    lines: list[dict],
    names: dict[str, str],
) -> list[str]:
    missing: list[str] = []
    for ln in lines:
        code = _normalize_account_code(ln.get("account_code"))
        if code and code not in names:
            missing.append(code)
    return sorted(set(missing))


def enrich_journal_lines(
    lines: list[dict],
    names: dict[str, str],
) -> list[dict]:
    enriched: list[dict] = []
    for ln in lines:
        row = dict(ln)
        code = _normalize_account_code(row.get("account_code"))
        row["account_code"] = code
        if code and not row.get("account_name"):
            row["account_name"] = names.get(code, "")
        enriched.append(row)
    return enriched


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
    company_id: str | None = None,
    db: Session,
    auto_post: bool = False,
    initial_status: str = "draft",
) -> UAEJournalEntry:
    """
    Create a journal entry with lines.
    lines: [{"account_code": str, "account_name": str, "debit": float, "credit": float, "description": str}]
    Validates debits == credits before posting.
    """
    assert_period_open(
        entry_date=entry_date,
        workspace_id=tenant_id,
        company_id=company_id,
        source=source,
        db=db,
    )
    period = entry_date.strftime("%Y-%m")
    je = UAEJournalEntry(
        tenant_id=tenant_id,
        company_id=company_id,
        entry_number=_next_je_number(tenant_id, db),
        entry_date=entry_date,
        period=period,
        description=description,
        reference=reference,
        source=source,
        status=initial_status,
    )
    db.add(je)
    db.flush()

    for ld in lines:
        code = _normalize_account_code(ld.get("account_code", ""))
        line = UAEJournalLine(
            journal_entry_id=je.id,
            account_code=code,
            account_name=ld.get("account_name", ""),
            description=ld.get("description", description),
            debit=float(ld.get("debit", 0)),
            credit=float(ld.get("credit", 0)),
            vat_amount=float(ld.get("vat_amount", 0)),
            currency=ld.get("currency", "AED"),
        )
        db.add(line)

    if auto_post and initial_status != "pending_approval":
        post_journal_entry(je, db)
    else:
        db.commit()

    return je


def post_journal_entry(je: UAEJournalEntry, db: Session) -> UAEJournalEntry:
    """Post a draft JE after validating it balances."""
    assert_period_open(
        entry_date=je.entry_date,
        workspace_id=je.tenant_id,
        company_id=je.company_id,
        source=je.source or "manual",
        db=db,
    )
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


def get_trial_balance(tenant_id: str, period: str, db: Session, company_id: str | None = None) -> dict:
    """Return trial balance for a period with debit/credit totals per account."""
    q = (
        db.query(UAEJournalLine, UAEJournalEntry)
        .join(UAEJournalEntry, UAEJournalLine.journal_entry_id == UAEJournalEntry.id)
        .filter(
            UAEJournalEntry.tenant_id == tenant_id,
            UAEJournalEntry.period == period,
            UAEJournalEntry.status == "posted",
        )
    )
    if company_id:
        q = q.filter(UAEJournalEntry.company_id == company_id)
    rows = q.all()
    accounts: dict[str, dict] = {}
    for line, je in rows:
        code = line.account_code or "UNKNOWN"
        if code not in accounts:
            accounts[code] = {"account_code": code, "account_name": line.account_name or "", "debit": 0.0, "credit": 0.0}
        accounts[code]["debit"] += float(line.debit or 0)
        accounts[code]["credit"] += float(line.credit or 0)

    acct_q = db.query(UAEAccount).filter(UAEAccount.tenant_id == tenant_id, UAEAccount.is_active == True)
    if company_id:
        acct_q = acct_q.filter(UAEAccount.company_id == company_id)
    acct_types = {a.code: (a.account_type or "").lower() for a in acct_q.all()}

    lines_out = list(accounts.values())
    totals: dict[str, float] = {
        "asset": 0.0, "liability": 0.0, "equity": 0.0,
        "income": 0.0, "expense": 0.0, "revenue": 0.0,
        "cash": 0.0, "trade_payables": 0.0, "vat_payable": 0.0, "long_term_debt": 0.0,
    }
    for l in lines_out:
        l["net_balance"] = l["debit"] - l["credit"]
        code = l["account_code"]
        at = acct_types.get(code, "")
        dr, cr = l["debit"], l["credit"]
        if at == "income":
            totals["revenue"] += cr - dr
            totals["income"] += cr - dr
        elif at == "expense":
            totals["expense"] += dr - cr
        elif at == "asset":
            totals["asset"] += dr - cr
            if code.startswith("100") or "cash" in (l["account_name"] or "").lower() or "bank" in (l["account_name"] or "").lower():
                totals["cash"] += dr - cr
        elif at == "liability":
            totals["liability"] += cr - dr
            if code in ("3001",) or "payable" in (l["account_name"] or "").lower():
                totals["trade_payables"] += cr - dr
            if code in ("3010",) or "vat" in (l["account_name"] or "").lower():
                totals["vat_payable"] += cr - dr
            if code.startswith("40") or "loan" in (l["account_name"] or "").lower():
                totals["long_term_debt"] += cr - dr
        elif at == "equity":
            totals["equity"] += cr - dr

    total_dr = sum(l["debit"] for l in lines_out)
    total_cr = sum(l["credit"] for l in lines_out)
    return {
        "period": period,
        "lines": lines_out,
        "total_debits": total_dr,
        "total_credits": total_cr,
        "is_balanced": abs(total_dr - total_cr) < 0.01,
        "totals": totals,
    }


_MONTHS = {
    "jan": "01", "feb": "02", "mar": "03", "apr": "04", "may": "05", "jun": "06",
    "jul": "07", "aug": "08", "sep": "09", "oct": "10", "nov": "11", "dec": "12",
}


def _normalize_header(h: str) -> str:
    return h.strip().lower().replace(" ", "_")


def _row_lookup(row: dict[str, str], *keys: str) -> str:
    norm = {_normalize_header(k): (v or "").strip() for k, v in row.items()}
    for key in keys:
        val = norm.get(_normalize_header(key), "")
        if val:
            return val
    return ""


def _parse_amount(raw: str) -> float:
    if not raw:
        return 0.0
    try:
        return float(str(raw).replace(",", "").strip())
    except ValueError:
        return 0.0


def _parse_entry_date(raw: str) -> date | None:
    if not raw:
        return None
    raw = raw.strip()
    if len(raw) >= 10 and raw[4] == "-" and raw[7] == "-":
        try:
            return date.fromisoformat(raw[:10])
        except ValueError:
            pass
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", raw)
    if m:
        return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    m = re.match(r"^(\d{1,2})[/-]([A-Za-z]{3})[/-](\d{2,4})$", raw)
    if m:
        yr = m.group(3)
        yr = f"20{yr}" if len(yr) == 2 else yr
        mon = _MONTHS.get(m.group(2).lower()[:3], "01")
        return date(int(yr), int(mon), int(m.group(1)))
    return None


def _detect_import_format(rows: list[dict[str, str]]) -> str:
    if not rows:
        return "empty"
    norm_keys: set[str] = set()
    for row in rows:
        norm_keys.update(_normalize_header(k) for k in row.keys())
    has_paired = (
        ("debit_account" in norm_keys or "debit_account_code" in norm_keys)
        and ("credit_account" in norm_keys or "credit_account_code" in norm_keys)
    )
    has_multiline = "je_number" in norm_keys or (
        "account_code" in norm_keys and ("debit_aed" in norm_keys or "debit" in norm_keys)
    )
    if has_paired and not has_multiline:
        return "paired"
    if has_multiline:
        return "multiline"
    return "paired"


def parse_journal_csv_rows(content: str) -> list[dict[str, Any]]:
    """Parse CSV into journal entry payloads (paired or multiline format)."""
    reader = csv.DictReader(io.StringIO(content))
    raw_rows = [r for r in reader if any((v or "").strip() for v in r.values())]
    fmt = _detect_import_format(raw_rows)
    logger.info("[JE import] Detected format=%s rows=%d", fmt, len(raw_rows))

    if fmt == "empty":
        return []

    entries: list[dict[str, Any]] = []

    if fmt == "paired":
        for i, row in enumerate(raw_rows, start=1):
            logger.info("[JE import] Row %d: %s", i, row)
            entry_date_raw = _row_lookup(row, "date", "entry_date", "gl_date")
            debit_acct = _row_lookup(row, "debit_account", "debit_account_code")
            credit_acct = _row_lookup(row, "credit_account", "credit_account_code")
            amount = _parse_amount(_row_lookup(row, "amount", "debit_aed", "credit_aed"))
            desc = _row_lookup(row, "description", "narration")
            ref = _row_lookup(row, "reference", "ref")

            if not debit_acct or not credit_acct:
                logger.warning("[JE import] Row %d skipped — missing debit/credit account", i)
                continue
            if amount <= 0:
                logger.warning("[JE import] Row %d skipped — invalid amount %s", i, amount)
                continue

            entry_date = _parse_entry_date(entry_date_raw) or date.today()
            entries.append({
                "entry_date": entry_date,
                "description": desc or ref or f"Imported entry {i}",
                "reference": ref or f"IMP-{i:04d}",
                "lines": [
                    {"account_code": debit_acct, "description": desc, "debit": amount, "credit": 0},
                    {"account_code": credit_acct, "description": desc, "debit": 0, "credit": amount},
                ],
            })
        return entries

    je_map: dict[str, dict[str, Any]] = {}
    for i, row in enumerate(raw_rows, start=1):
        logger.info("[JE import] Row %d: %s", i, row)
        je_key = _row_lookup(row, "je_number", "je_no", "reference", "ref") or f"row-{i}"
        if je_key not in je_map:
            entry_date_raw = _row_lookup(row, "date", "entry_date", "gl_date")
            entry_date = _parse_entry_date(entry_date_raw) or date.today()
            je_map[je_key] = {
                "entry_date": entry_date,
                "description": _row_lookup(row, "description", "narration"),
                "reference": je_key,
                "lines": [],
            }
        debit = _parse_amount(_row_lookup(row, "debit_aed", "debit"))
        credit = _parse_amount(_row_lookup(row, "credit_aed", "credit"))
        if debit == 0 and credit == 0:
            logger.warning("[JE import] Row %d skipped — no debit/credit amount", i)
            continue
        account_code = _row_lookup(row, "account_code", "account")
        if not account_code:
            logger.warning("[JE import] Row %d skipped — missing account_code", i)
            continue
        je_map[je_key]["lines"].append({
            "account_code": account_code,
            "account_name": _row_lookup(row, "account_name"),
            "description": _row_lookup(row, "description", "narration"),
            "debit": debit,
            "credit": credit,
        })
        if not je_map[je_key]["description"]:
            je_map[je_key]["description"] = _row_lookup(row, "description", "narration")

    return [e for e in je_map.values() if e["lines"]]


def import_journals_from_csv(
    tenant_id: str,
    content: str,
    db: Session,
    *,
    company_id: str | None = None,
    auto_post: bool = True,
) -> dict[str, Any]:
    """Import journal entries from CSV text. Returns counts and per-row errors."""
    from app.services.uae_controls_service import validate_journal_entry

    logger.info(
        "[JE import] Starting import workspace_id=%s company_id=%s content_len=%d",
        tenant_id, company_id, len(content),
    )
    payloads = parse_journal_csv_rows(content)
    if not payloads:
        logger.warning("[JE import] No valid journal entries parsed from CSV")
        return {
            "imported": 0,
            "skipped": 0,
            "errors": ["No valid rows found. Expected columns: date, debit_account, credit_account, amount, description, reference (or account_code/debit/credit multiline format)."],
            "total_parsed": 0,
        }

    ref_q = db.query(UAEJournalEntry.reference).filter(
        UAEJournalEntry.tenant_id == tenant_id,
        UAEJournalEntry.reference.isnot(None),
    )
    if company_id:
        ref_q = ref_q.filter(UAEJournalEntry.company_id == company_id)
    existing_refs = {r[0] for r in ref_q.all() if r[0]}
    coa_names = coa_name_map(tenant_id, db, company_id)

    imported = 0
    skipped = 0
    errors: list[str] = []

    for i, payload in enumerate(payloads, start=1):
        ref = payload.get("reference") or f"IMP-{i:04d}"
        logger.info(
            "[JE import] Saving JE %d: date=%s ref=%s lines=%d workspace=%s company=%s",
            i, payload["entry_date"], ref, len(payload["lines"]), tenant_id, company_id,
        )
        if ref in existing_refs:
            logger.warning("[JE import] JE %d skipped — duplicate reference %s", i, ref)
            skipped += 1
            continue

        lines = enrich_journal_lines(payload["lines"], coa_names)
        missing = missing_journal_account_codes(lines, coa_names)
        if missing:
            msg = f"Account(s) not found in Chart of Accounts: {', '.join(missing)}"
            logger.warning("[JE import] JE %d skipped — %s", i, msg)
            errors.append(f"{ref}: {msg}")
            skipped += 1
            continue

        check = validate_journal_entry(
            entry_date=payload["entry_date"],
            lines=lines,
            source="manual",
            workspace_id=tenant_id,
            db=db,
        )
        if not check["ok"]:
            msg = "; ".join(check["errors"])
            logger.warning("[JE import] JE %d validation failed: %s", i, msg)
            errors.append(f"{ref}: {msg}")
            skipped += 1
            continue

        try:
            should_post = auto_post and not check["requires_approval"]
            je = create_journal_entry(
                tenant_id=tenant_id,
                entry_date=payload["entry_date"],
                description=payload.get("description") or ref,
                lines=lines,
                reference=ref,
                source="manual",
                company_id=company_id,
                db=db,
                auto_post=should_post,
                initial_status="draft",
            )
            existing_refs.add(ref)
            imported += 1
            logger.info("[JE import] JE %d saved id=%s status=%s", i, je.id, je.status)
        except PeriodControlError as exc:
            msg = str(exc.payload) if hasattr(exc, "payload") else str(exc)
            logger.warning("[JE import] JE %d period control error: %s", i, msg)
            errors.append(f"{ref}: {msg}")
            skipped += 1
        except ValueError as exc:
            logger.warning("[JE import] JE %d value error: %s", i, exc)
            errors.append(f"{ref}: {exc}")
            skipped += 1
        except Exception as exc:
            logger.exception("[JE import] JE %d unexpected error", i)
            errors.append(f"{ref}: {exc}")
            skipped += 1

    logger.info("[JE import] Done imported=%d skipped=%d errors=%d", imported, skipped, len(errors))
    return {
        "imported": imported,
        "skipped": skipped,
        "errors": errors,
        "total_parsed": len(payloads),
    }
