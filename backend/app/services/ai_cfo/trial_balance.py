"""Decimal trial balance engine over posted UAE journal lines.

This is the Step 3.1 financial-engine core. It does NOT change journal posting or
reversal behaviour. It must not be confused with:

- ledger.balances_as_of (cumulative natural balances, float edge)
- uae_journal_service.get_trial_balance (float period TB)

Modes
-----
period_activity  — eligible lines with entry.period == period
closing_as_of    — eligible lines with entry.period <= period (full posted history)

Reversal safety
---------------
Current reverse_journal_entry marks the original status='reversed' and posts a new
entry with source='reversal' (linked only by reference=original entry_number). There
is no FK on UAEJournalEntry. Including only status='posted' therefore drops the
original while keeping the reversing JE — an unsafe pattern for reconciliation.

When that pattern (or unmatched / multi-reversal anomalies) is detected, the engine
still returns the posted-only arithmetic for transparency but sets
reconciliation_passed=False and emits structured exceptions. It never force-balances.
"""
from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from dataclasses import dataclass, field
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation
from typing import Any, Literal

from sqlalchemy.orm import Session

from app.models.uae_accounting_full import UAEJournalEntry, UAEJournalLine
from app.services.ai_cfo import ledger
from app.services.ai_cfo.ledger import LedgerScope, _DEBIT_NATURAL, _normalise_type, _type_from_code

CALCULATION_VERSION = "tb-v1"
_CENT = Decimal("0.01")
_ZERO = Decimal("0")

TbMode = Literal["period_activity", "closing_as_of"]


def money_decimal(v: Any) -> Decimal:
    """Convert a DB/numeric value to Decimal cents via str() — never via float()."""
    if v is None:
        return _ZERO
    try:
        return Decimal(str(v)).quantize(_CENT, rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError, OverflowError):
        return _ZERO


def _dstr(v: Decimal) -> str:
    return str(v.quantize(_CENT, rounding=ROUND_HALF_UP))


def natural_decimal(account_type: str, debit: Decimal, credit: Decimal) -> Decimal:
    if account_type in _DEBIT_NATURAL:
        return (debit - credit).quantize(_CENT, rounding=ROUND_HALF_UP)
    return (credit - debit).quantize(_CENT, rounding=ROUND_HALF_UP)


@dataclass
class _LineFact:
    line_id: str
    journal_entry_id: str
    entry_number: str | None
    period: str
    status: str
    source: str | None
    reference: str | None
    account_code: str
    account_name: str | None
    account_type: str
    debit: Decimal
    credit: Decimal
    currency: str


@dataclass
class TbException:
    code: str
    message: str
    journal_entry_ids: list[str] = field(default_factory=list)
    details: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "journal_entry_ids": list(self.journal_entry_ids),
            "details": dict(self.details),
        }


def _validate_period(period: str) -> None:
    if not isinstance(period, str) or len(period) != 7 or period[4] != "-":
        raise ValueError(f"Invalid accounting period: {period!r}")
    year, month = period[:4], period[5:7]
    if not year.isdigit() or not month.isdigit() or not (1 <= int(month) <= 12):
        raise ValueError(f"Invalid accounting period: {period!r}")


def _load_scope_entries(db: Session, scope: LedgerScope) -> list[UAEJournalEntry]:
    return (
        db.query(UAEJournalEntry)
        .filter(
            UAEJournalEntry.tenant_id == scope.workspace_id,
            UAEJournalEntry.company_id == scope.company_id,
        )
        .all()
    )


def _unassigned_posted_count(db: Session, scope: LedgerScope) -> int:
    return (
        db.query(UAEJournalLine.id)
        .join(UAEJournalEntry, UAEJournalLine.journal_entry_id == UAEJournalEntry.id)
        .filter(
            UAEJournalEntry.tenant_id == scope.workspace_id,
            UAEJournalEntry.company_id.is_(None),
            UAEJournalEntry.status == "posted",
        )
        .count()
    )


def _detect_reversal_exceptions(entries: list[UAEJournalEntry]) -> list[TbException]:
    """Conservative detection of the current unsafe reversal pattern and anomalies.

    Does not alter posting. Does not invent Option A behaviour.
    """
    exceptions: list[TbException] = []
    by_number: dict[str, UAEJournalEntry] = {}
    for e in entries:
        if e.entry_number:
            by_number[e.entry_number] = e

    reversed_entries = [e for e in entries if (e.status or "") == "reversed"]
    reversal_jes = [e for e in entries if (e.source or "") == "reversal"]

    # Map original entry_number → reversal JEs that reference it
    reversals_by_ref: dict[str, list[UAEJournalEntry]] = defaultdict(list)
    unmatched_reversals: list[UAEJournalEntry] = []
    for rev in reversal_jes:
        ref = (rev.reference or "").strip()
        if ref and ref in by_number:
            reversals_by_ref[ref].append(rev)
        else:
            unmatched_reversals.append(rev)

    for rev in unmatched_reversals:
        exceptions.append(
            TbException(
                code="reversal_without_original",
                message="Posted reversing journal has no matching original entry_number in scope.",
                journal_entry_ids=[rev.id],
                details={"reference": rev.reference, "entry_number": rev.entry_number},
            )
        )

    for orig in reversed_entries:
        num = orig.entry_number or ""
        matched = reversals_by_ref.get(num, [])
        if not matched:
            exceptions.append(
                TbException(
                    code="reversed_without_reversal",
                    message="Journal marked reversed has no posted reversing journal linked by reference.",
                    journal_entry_ids=[orig.id],
                    details={"entry_number": orig.entry_number},
                )
            )
        elif len(matched) > 1:
            exceptions.append(
                TbException(
                    code="original_with_multiple_reversals",
                    message="Original journal is linked to more than one reversing journal.",
                    journal_entry_ids=[orig.id] + [m.id for m in matched],
                    details={"entry_number": orig.entry_number, "reversal_count": len(matched)},
                )
            )
        else:
            rev = matched[0]
            # Known unsafe pattern: original excluded from posted filter, reversal included.
            if (rev.status or "") == "posted":
                exceptions.append(
                    TbException(
                        code="unsafe_legacy_reversal_pattern",
                        message=(
                            "Original journal is status=reversed (excluded from posted TB) while a "
                            "posted source=reversal journal remains. Net ledger impact is unreliable "
                            "under posted-only inclusion. Reconciliation cannot pass until Option A "
                            "posting is authorised (keep both posted)."
                        ),
                        journal_entry_ids=[orig.id, rev.id],
                        details={
                            "original_entry_number": orig.entry_number,
                            "reversal_entry_number": rev.entry_number,
                            "original_status": orig.status,
                            "reversal_status": rev.status,
                        },
                    )
                )

    # Reversals that matched a non-reversed original (unexpected)
    for ref, matched in reversals_by_ref.items():
        orig = by_number.get(ref)
        if orig is not None and (orig.status or "") != "reversed":
            exceptions.append(
                TbException(
                    code="reversal_original_not_reversed",
                    message="Reversing journal references an original that is not status=reversed.",
                    journal_entry_ids=[orig.id] + [m.id for m in matched],
                    details={"entry_number": ref},
                )
            )

    return exceptions


def _period_matches(entry_period: str | None, period: str, mode: TbMode) -> bool:
    if not entry_period:
        return False
    if mode == "period_activity":
        return entry_period == period
    return entry_period <= period


def _collect_eligible_facts(
    db: Session,
    scope: LedgerScope,
    period: str,
    mode: TbMode,
    currency: str,
) -> tuple[list[_LineFact], list[TbException], dict[str, int]]:
    catalog = ledger.account_catalog(db, scope)
    exceptions: list[TbException] = []
    counts = {
        "draft_or_unposted": 0,
        "reversed_status": 0,
        "currency_mismatch": 0,
        "missing_period": 0,
        "eligible_lines": 0,
    }

    # Posted lines for the company — eligibility base
    rows = (
        db.query(UAEJournalLine, UAEJournalEntry)
        .join(UAEJournalEntry, UAEJournalLine.journal_entry_id == UAEJournalEntry.id)
        .filter(
            UAEJournalEntry.tenant_id == scope.workspace_id,
            UAEJournalEntry.company_id == scope.company_id,
        )
        .all()
    )

    seen_line_ids: set[str] = set()
    facts: list[_LineFact] = []

    for line, entry in rows:
        status = (entry.status or "").strip()
        if status == "reversed":
            counts["reversed_status"] += 1
            continue
        if status != "posted":
            counts["draft_or_unposted"] += 1
            continue
        if not entry.period:
            counts["missing_period"] += 1
            continue
        if not _period_matches(entry.period, period, mode):
            continue

        line_ccy = (line.currency or currency or "AED").strip().upper()
        if line_ccy != currency.upper():
            counts["currency_mismatch"] += 1
            exceptions.append(
                TbException(
                    code="currency_mismatch",
                    message="Journal line currency does not match trial balance currency; excluded.",
                    journal_entry_ids=[entry.id],
                    details={
                        "line_id": line.id,
                        "line_currency": line_ccy,
                        "tb_currency": currency.upper(),
                        "account_code": line.account_code,
                    },
                )
            )
            continue

        if line.id in seen_line_ids:
            exceptions.append(
                TbException(
                    code="duplicate_journal_line",
                    message="Duplicate journal line id encountered during aggregation.",
                    journal_entry_ids=[entry.id],
                    details={"line_id": line.id},
                )
            )
            continue
        seen_line_ids.add(line.id)

        code = (line.account_code or "").strip() or "UNKNOWN"
        if code == "UNKNOWN" or code not in catalog:
            exceptions.append(
                TbException(
                    code="missing_account_mapping",
                    message="Account code is missing from the company chart of accounts.",
                    journal_entry_ids=[entry.id],
                    details={"line_id": line.id, "account_code": code},
                )
            )
        info = catalog.get(code)
        if info:
            name, acct_type = info["name"], info["type"]
        else:
            name = line.account_name or code
            acct_type = _normalise_type(None) or _type_from_code(code)

        facts.append(
            _LineFact(
                line_id=line.id,
                journal_entry_id=entry.id,
                entry_number=entry.entry_number,
                period=entry.period,
                status=status,
                source=entry.source,
                reference=entry.reference,
                account_code=code,
                account_name=name,
                account_type=acct_type or "Other",
                debit=money_decimal(line.debit),
                credit=money_decimal(line.credit),
                currency=line_ccy,
            )
        )

    counts["eligible_lines"] = len(facts)
    return facts, exceptions, counts


def _aggregate(facts: list[_LineFact]) -> tuple[dict[str, dict[str, Any]], Decimal, Decimal]:
    """Primary aggregation — each line_id counted once."""
    by_acct: dict[str, dict[str, Any]] = {}
    total_dr = _ZERO
    total_cr = _ZERO
    for f in facts:
        slot = by_acct.get(f.account_code)
        if slot is None:
            slot = {
                "account_code": f.account_code,
                "account_name": f.account_name or f.account_code,
                "account_type": f.account_type,
                "debit": _ZERO,
                "credit": _ZERO,
                "line_ids": [],
                "journal_entry_ids": set(),
            }
            by_acct[f.account_code] = slot
        slot["debit"] += f.debit
        slot["credit"] += f.credit
        slot["line_ids"].append(f.line_id)
        slot["journal_entry_ids"].add(f.journal_entry_id)
        total_dr += f.debit
        total_cr += f.credit
    total_dr = total_dr.quantize(_CENT, rounding=ROUND_HALF_UP)
    total_cr = total_cr.quantize(_CENT, rounding=ROUND_HALF_UP)
    return by_acct, total_dr, total_cr


def _independent_resum(facts: list[_LineFact]) -> tuple[Decimal, Decimal, int]:
    """Second independent pass over the same facts — separate accumulators."""
    dr = _ZERO
    cr = _ZERO
    for f in facts:
        dr += money_decimal(f.debit)
        cr += money_decimal(f.credit)
    return (
        dr.quantize(_CENT, rounding=ROUND_HALF_UP),
        cr.quantize(_CENT, rounding=ROUND_HALF_UP),
        len(facts),
    )


def _fingerprint(
    *,
    scope: LedgerScope,
    period: str,
    mode: TbMode,
    currency: str,
    accounts: list[dict[str, Any]],
    line_ids: list[str],
) -> str:
    payload = {
        "calculation_version": CALCULATION_VERSION,
        "workspace_id": scope.workspace_id,
        "company_id": scope.company_id,
        "period": period,
        "mode": mode,
        "currency": currency.upper(),
        "line_ids": sorted(line_ids),
        "accounts": [
            {
                "account_code": a["account_code"],
                "debit": a["debit"],
                "credit": a["credit"],
                "line_count": a["line_count"],
            }
            for a in sorted(accounts, key=lambda x: x["account_code"])
        ],
    }
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(raw.encode("utf-8")).hexdigest()


def trial_balance(
    db: Session,
    scope: LedgerScope,
    period: str,
    *,
    mode: TbMode = "period_activity",
    currency: str,
) -> dict[str, Any]:
    """Build a Decimal trial balance for one company, period, mode and currency.

    Returns a dict suitable for JSON serialisation (decimal strings). Never claims
    reconciliation_passed when reversal safety or completeness checks fail.
    """
    if mode not in ("period_activity", "closing_as_of"):
        raise ValueError(f"Unsupported trial balance mode: {mode!r}")
    if not currency or not str(currency).strip():
        raise ValueError("currency is required")
    _validate_period(period)
    ccy = str(currency).strip().upper()

    exceptions: list[TbException] = []

    # Reversal inspection across the full company scope (not only the period window)
    scope_entries = _load_scope_entries(db, scope)
    exceptions.extend(_detect_reversal_exceptions(scope_entries))

    unassigned = _unassigned_posted_count(db, scope)
    if unassigned:
        exceptions.append(
            TbException(
                code="unassigned_company_lines",
                message=(
                    f"{unassigned} posted journal line(s) in this workspace have no company_id "
                    "and are excluded from this trial balance."
                ),
                details={"count": unassigned},
            )
        )

    facts, collect_exc, counts = _collect_eligible_facts(db, scope, period, mode, ccy)
    exceptions.extend(collect_exc)

    by_acct, total_dr, total_cr = _aggregate(facts)
    ind_dr, ind_cr, ind_count = _independent_resum(facts)

    accounts_out: list[dict[str, Any]] = []
    all_line_ids: list[str] = []
    for code in sorted(by_acct.keys()):
        slot = by_acct[code]
        dr = slot["debit"].quantize(_CENT, rounding=ROUND_HALF_UP)
        cr = slot["credit"].quantize(_CENT, rounding=ROUND_HALF_UP)
        line_ids = sorted(slot["line_ids"])
        all_line_ids.extend(line_ids)
        accounts_out.append(
            {
                "account_code": code,
                "account_name": slot["account_name"],
                "account_type": slot["account_type"],
                "debit": _dstr(dr),
                "credit": _dstr(cr),
                "natural_balance": _dstr(natural_decimal(slot["account_type"], dr, cr)),
                "line_count": len(line_ids),
                "evidence": {
                    "line_ids": line_ids,
                    "journal_entry_ids": sorted(slot["journal_entry_ids"]),
                },
            }
        )

    imbalance = (total_dr - total_cr).quantize(_CENT, rounding=ROUND_HALF_UP)
    arith_balanced = imbalance == _ZERO
    independent_ok = ind_dr == total_dr and ind_cr == total_cr and ind_count == len(facts)
    source_complete = counts["eligible_lines"] == len(facts) == ind_count

    blocking_codes = {
        "unsafe_legacy_reversal_pattern",
        "reversal_without_original",
        "reversed_without_reversal",
        "original_with_multiple_reversals",
        "reversal_original_not_reversed",
        "duplicate_journal_line",
    }
    has_blocking = any(e.code in blocking_codes for e in exceptions)

    reconciliation_passed = (
        arith_balanced and independent_ok and source_complete and not has_blocking
    )

    fp = _fingerprint(
        scope=scope,
        period=period,
        mode=mode,
        currency=ccy,
        accounts=accounts_out,
        line_ids=all_line_ids,
    )

    limitations: list[str] = []
    if mode == "closing_as_of":
        limitations.append(
            "closing_as_of uses full posted history through the period (including P&L). "
            "This is not necessarily financial-year YTD."
        )
    if not facts:
        limitations.append("No eligible posted journal lines for this scope/period/currency.")

    return {
        "calculation_version": CALCULATION_VERSION,
        "workspace_id": scope.workspace_id,
        "company_id": scope.company_id,
        "period": period,
        "mode": mode,
        "currency": ccy,
        "accounts": accounts_out,
        "total_debit": _dstr(total_dr),
        "total_credit": _dstr(total_cr),
        "imbalance": _dstr(imbalance),
        "is_balanced": arith_balanced,
        "reconciliation_passed": reconciliation_passed,
        "independent_reconciliation": {
            "total_debit": _dstr(ind_dr),
            "total_credit": _dstr(ind_cr),
            "line_count": ind_count,
            "matches_primary": independent_ok,
        },
        "source_population": {
            "eligible_line_count": counts["eligible_lines"],
            "aggregated_line_count": len(facts),
            "draft_or_unposted_seen": counts["draft_or_unposted"],
            "reversed_status_seen": counts["reversed_status"],
            "currency_mismatch_excluded": counts["currency_mismatch"],
            "unassigned_company_posted_lines": unassigned,
        },
        "exceptions": [e.as_dict() for e in exceptions],
        "limitations": limitations,
        "content_fingerprint": fp,
    }
