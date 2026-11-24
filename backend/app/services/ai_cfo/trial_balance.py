"""Decimal trial balance engine over posted UAE journal lines (Step 3.1 / 3.1R / 3.1R2).

Reconciliation concepts (never collapsed into one Boolean meaning):

1. arithmetic_balance            — Σ debit == Σ credit for the primary aggregation
2. source_reconciliation         — primary result reproduces from a separate DB re-query
3. company_accounting_integrity  — company-relevant journals/reversals/mappings are valid
4. workspace_integrity_warnings  — unassigned / ambiguous / unresolved population issues
                                   (visible; do not claim workspace-wide integrity is clean)

`reconciliation_passed` requires (1)+(2)+(3). Workspace warnings remain visible and set
`workspace_integrity_clean=False`, but do not by themselves fail an unrelated company TB.

Independence boundary (do not over-claim)
-----------------------------------------
Primary and independent paths each issue a separate SQLAlchemy query and aggregate with
separate accumulators. Both use the same `_collect_eligible_facts` eligibility logic and
the caller's Session / transaction snapshot. This detects calculation/population divergence,
not shared eligibility defects, concurrent write skew, or independent DB-source completeness.

Reversal safety (detect-only — posting service is not modified)
---------------------------------------------------------------
Legacy `reverse_journal_entry` sets original status='reversed' and posts a new JE with
source='reversal', reference=original.entry_number (often without company_id).
`accrual_reversal` is a separate convention without a JE-level FK to the original.
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
from app.services.ai_cfo.ledger import LedgerScope, _DEBIT_NATURAL, _type_from_code

CALCULATION_VERSION = "tb-v1.1r2"
_CENT = Decimal("0.01")
_ZERO = Decimal("0")

TbMode = Literal["period_activity", "closing_as_of"]
Relevance = Literal["company", "workspace"]

REVERSAL_SOURCES_SUPPORTED_DETECTION = frozenset({"reversal"})
REVERSAL_SOURCES_KNOWN_UNSUPPORTED = frozenset({"accrual_reversal"})
REVERSAL_SOURCES_ALL = REVERSAL_SOURCES_SUPPORTED_DETECTION | REVERSAL_SOURCES_KNOWN_UNSUPPORTED

# Codes that can block company_accounting_integrity when relevance=company for this scope.
COMPANY_BLOCKING_CODES = frozenset(
    {
        "unsafe_legacy_reversal_pattern",
        "reversed_without_reversal",
        "reversed_with_unposted_reversal",
        "original_with_multiple_reversals",
        "reversal_without_original",
        "reversal_original_not_reversed",
        "reversal_company_scope_mismatch",
        "duplicate_entry_number",
        "ambiguous_reversal_reference",
        "unsupported_reversal_convention",
        "accrual_reversal_unresolved",
        "missing_account_mapping",
        "currency_mismatch",
        "duplicate_journal_line",
        "invalid_amount",
        "independent_reconciliation_mismatch",
        "independent_line_set_mismatch",
        "independent_account_mismatch",
    }
)

# Workspace-level diagnostics (never silently dropped; do not auto-fail every company).
WORKSPACE_WARNING_CODES = frozenset(
    {
        "unassigned_company_lines",
        "workspace_unassigned_reversal",
        "workspace_ambiguous_reversal",
        "workspace_duplicate_entry_number",
        "workspace_accrual_reversal_unresolved",
        "workspace_unsupported_reversal_convention",
    }
)


class InvalidAmountError(ValueError):
    """Raised when a journal-line amount cannot be parsed as Decimal money."""


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
    relevance: Relevance = "company"
    affected_company_ids: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        blocking = self.relevance == "company" and self.code in COMPANY_BLOCKING_CODES
        return {
            "code": self.code,
            "message": self.message,
            "journal_entry_ids": list(self.journal_entry_ids),
            "details": dict(self.details),
            "relevance": self.relevance,
            "affected_company_ids": list(self.affected_company_ids),
            "blocking": blocking,
        }


def money_decimal(v: Any) -> Decimal:
    """Convert via str() — never float(). Valid zero stays zero; malformed raises."""
    if v is None:
        raise InvalidAmountError("amount is None")
    if isinstance(v, bool):
        raise InvalidAmountError(f"invalid amount type bool: {v!r}")
    try:
        text = str(v).strip()
    except Exception as exc:  # noqa: BLE001
        raise InvalidAmountError(f"cannot stringify amount: {v!r}") from exc
    if text == "" or text.lower() in {"nan", "none", "null", "inf", "-inf", "+inf"}:
        raise InvalidAmountError(f"invalid amount token: {v!r}")
    try:
        return Decimal(text).quantize(_CENT, rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError, OverflowError) as exc:
        raise InvalidAmountError(f"invalid amount: {v!r}") from exc


def _dstr(v: Decimal) -> str:
    return str(v.quantize(_CENT, rounding=ROUND_HALF_UP))


def natural_decimal(account_type: str, debit: Decimal, credit: Decimal) -> Decimal:
    if account_type in _DEBIT_NATURAL:
        return (debit - credit).quantize(_CENT, rounding=ROUND_HALF_UP)
    return (credit - debit).quantize(_CENT, rounding=ROUND_HALF_UP)


def _validate_period(period: str) -> None:
    if not isinstance(period, str) or len(period) != 7 or period[4] != "-":
        raise ValueError(f"Invalid accounting period: {period!r}")
    year, month = period[:4], period[5:7]
    if not year.isdigit() or not month.isdigit() or not (1 <= int(month) <= 12):
        raise ValueError(f"Invalid accounting period: {period!r}")


def _period_matches(entry_period: str | None, period: str, mode: TbMode) -> bool:
    if not entry_period:
        return False
    if mode == "period_activity":
        return entry_period == period
    return entry_period <= period


def _company_ids_of(*entries: UAEJournalEntry | None) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for e in entries:
        if e is None:
            continue
        cid = e.company_id
        if cid and cid not in seen:
            seen.add(cid)
            out.append(cid)
    return out


def _has_null_company(*entries: UAEJournalEntry | None) -> bool:
    return any(e is not None and e.company_id is None for e in entries)


def _load_workspace_entries(db: Session, workspace_id: str) -> list[UAEJournalEntry]:
    return (
        db.query(UAEJournalEntry)
        .filter(UAEJournalEntry.tenant_id == workspace_id)
        .all()
    )


def _index_by_entry_number(
    entries: list[UAEJournalEntry],
) -> dict[str, list[UAEJournalEntry]]:
    by_number: dict[str, list[UAEJournalEntry]] = defaultdict(list)
    for e in entries:
        num = (e.entry_number or "").strip()
        if num:
            by_number[num].append(e)
    return by_number


def _is_reversal_candidate(entry: UAEJournalEntry) -> bool:
    src = (entry.source or "").strip().lower()
    if src in REVERSAL_SOURCES_ALL:
        return True
    return (entry.description or "").strip().upper().startswith("REVERSAL:")


def _emit_for_parties(
    *,
    code: str,
    workspace_code: str,
    message: str,
    parties: list[UAEJournalEntry],
    details: dict[str, Any],
    scope_company_id: str,
) -> list[TbException]:
    """Classify a finding as company-blocking for involved companies, else workspace warning.

    - Same-company / cross-company with established ids → company exception only when
      scope_company_id is among affected ids.
    - Pure null / unassigned parties → workspace warning (never auto-fail every company).
    - Null + established company → company block for that company AND workspace warning.
    """
    affected = _company_ids_of(*parties)
    involves_null = _has_null_company(*parties)
    ids = [p.id for p in parties if p is not None]
    out: list[TbException] = []

    if scope_company_id in affected:
        out.append(
            TbException(
                code=code,
                message=message,
                journal_entry_ids=ids,
                details={**details, "involves_unassigned_company": involves_null},
                relevance="company",
                affected_company_ids=affected,
            )
        )
        if involves_null:
            out.append(
                TbException(
                    code=workspace_code if workspace_code else code,
                    message=(
                        message
                        + " Unassigned (null company_id) party present — workspace integrity is not clean."
                    ),
                    journal_entry_ids=ids,
                    details={**details, "involves_unassigned_company": True},
                    relevance="workspace",
                    affected_company_ids=affected,
                )
            )
        return out

    # Scope company not among established parties
    if involves_null or not affected:
        out.append(
            TbException(
                code=workspace_code if workspace_code else code,
                message=message,
                journal_entry_ids=ids,
                details={**details, "involves_unassigned_company": involves_null},
                relevance="workspace",
                affected_company_ids=affected,
            )
        )
    # Else: finding only affects other companies → omit from this company's TB entirely
    return out


def _detect_reversal_exceptions(
    workspace_entries: list[UAEJournalEntry],
    scope: LedgerScope,
) -> list[TbException]:
    """Detect reversal relationships; emit only company-relevant or workspace warnings."""
    exceptions: list[TbException] = []
    by_number = _index_by_entry_number(workspace_entries)
    ambiguous_numbers = {num for num, group in by_number.items() if len(group) > 1}
    scope_co = scope.company_id

    # --- Duplicate entry numbers ---
    for num, group in by_number.items():
        if len(group) < 2:
            continue
        exceptions.extend(
            _emit_for_parties(
                code="duplicate_entry_number",
                workspace_code="workspace_duplicate_entry_number",
                message=(
                    f"entry_number {num!r} is shared by {len(group)} journals; "
                    "reversal pairing by entry_number is ambiguous."
                ),
                parties=group,
                details={"entry_number": num, "count": len(group)},
                scope_company_id=scope_co,
            )
        )

    reversal_candidates = [e for e in workspace_entries if _is_reversal_candidate(e)]
    reversals_by_ref: dict[str, list[UAEJournalEntry]] = defaultdict(list)

    for rev in reversal_candidates:
        ref = (rev.reference or "").strip()
        src = (rev.source or "").strip().lower()

        if src in REVERSAL_SOURCES_KNOWN_UNSUPPORTED:
            exceptions.extend(
                _emit_for_parties(
                    code="accrual_reversal_unresolved",
                    workspace_code="workspace_accrual_reversal_unresolved",
                    message=(
                        "Journal uses source=accrual_reversal. Linkage to the original accrual "
                        "is not available on the journal row (no Option A FK)."
                    ),
                    parties=[rev],
                    details={
                        "source": rev.source,
                        "reference": rev.reference,
                        "status": rev.status,
                        "company_id": rev.company_id,
                        "classification": "known_unsupported_convention",
                    },
                    scope_company_id=scope_co,
                )
            )

        if not ref:
            if src in REVERSAL_SOURCES_SUPPORTED_DETECTION or (
                (rev.description or "").upper().startswith("REVERSAL:")
                and src not in REVERSAL_SOURCES_KNOWN_UNSUPPORTED
            ):
                exceptions.extend(
                    _emit_for_parties(
                        code="ambiguous_reversal_reference",
                        workspace_code="workspace_ambiguous_reversal",
                        message="Reversing journal has no reference to an original entry_number.",
                        parties=[rev],
                        details={"source": rev.source, "status": rev.status},
                        scope_company_id=scope_co,
                    )
                )
            continue

        if ref in ambiguous_numbers:
            parties = [rev] + list(by_number.get(ref, []))
            exceptions.extend(
                _emit_for_parties(
                    code="ambiguous_reversal_reference",
                    workspace_code="workspace_ambiguous_reversal",
                    message=(
                        f"Reversing journal reference {ref!r} matches a duplicated entry_number; "
                        "original cannot be identified uniquely."
                    ),
                    parties=parties,
                    details={"reference": ref},
                    scope_company_id=scope_co,
                )
            )
            continue

        matches = by_number.get(ref, [])
        if not matches:
            if src in REVERSAL_SOURCES_SUPPORTED_DETECTION or (
                (rev.description or "").upper().startswith("REVERSAL:")
                and src not in REVERSAL_SOURCES_KNOWN_UNSUPPORTED
            ):
                exceptions.extend(
                    _emit_for_parties(
                        code="reversal_without_original",
                        workspace_code="workspace_unassigned_reversal",
                        message="Reversing journal has no matching original entry_number in workspace.",
                        parties=[rev],
                        details={
                            "reference": rev.reference,
                            "source": rev.source,
                            "company_id": rev.company_id,
                        },
                        scope_company_id=scope_co,
                    )
                )
            continue

        if len(matches) == 1:
            reversals_by_ref[ref].append(rev)

    # Pair every reversed original (any company) with referenced reversals
    reversed_entries = [e for e in workspace_entries if (e.status or "") == "reversed"]
    for orig in reversed_entries:
        num = (orig.entry_number or "").strip()
        if not num:
            exceptions.extend(
                _emit_for_parties(
                    code="reversed_without_reversal",
                    workspace_code="workspace_ambiguous_reversal",
                    message="Journal marked reversed has no entry_number; cannot locate reversing journal.",
                    parties=[orig],
                    details={"entry_number": orig.entry_number},
                    scope_company_id=scope_co,
                )
            )
            continue
        if num in ambiguous_numbers:
            exceptions.extend(
                _emit_for_parties(
                    code="ambiguous_reversal_reference",
                    workspace_code="workspace_ambiguous_reversal",
                    message="Reversed journal's entry_number is duplicated; pairing is unsafe.",
                    parties=[orig] + list(by_number[num]),
                    details={"entry_number": num},
                    scope_company_id=scope_co,
                )
            )
            continue

        matched = list(reversals_by_ref.get(num, []))
        if not matched:
            matched = [
                r
                for r in reversal_candidates
                if (r.reference or "").strip() == num
                and (r.source or "").strip().lower() in REVERSAL_SOURCES_SUPPORTED_DETECTION
            ]

        if not matched:
            exceptions.extend(
                _emit_for_parties(
                    code="reversed_without_reversal",
                    workspace_code="workspace_unassigned_reversal",
                    message="Journal marked reversed has no reversing journal linked by reference.",
                    parties=[orig],
                    details={"entry_number": orig.entry_number},
                    scope_company_id=scope_co,
                )
            )
            continue

        if len(matched) > 1:
            exceptions.extend(
                _emit_for_parties(
                    code="original_with_multiple_reversals",
                    workspace_code="workspace_ambiguous_reversal",
                    message="Original journal is linked to more than one reversing journal.",
                    parties=[orig] + matched,
                    details={"entry_number": orig.entry_number, "reversal_count": len(matched)},
                    scope_company_id=scope_co,
                )
            )
            continue

        rev = matched[0]
        parties = [orig, rev]
        rev_status = (rev.status or "").strip()
        affected = _company_ids_of(orig, rev)

        # Cross-company or null-company on either side
        if len(affected) > 1 or _has_null_company(orig, rev):
            if scope_co in affected or (orig.company_id == scope_co) or (rev.company_id == scope_co):
                exceptions.extend(
                    _emit_for_parties(
                        code="reversal_company_scope_mismatch",
                        workspace_code="workspace_unassigned_reversal",
                        message=(
                            "Reversing journal and original do not share a single assigned company "
                            "(cross-company or null-company relationship)."
                        ),
                        parties=parties,
                        details={
                            "original_company_id": orig.company_id,
                            "reversal_company_id": rev.company_id,
                        },
                        scope_company_id=scope_co,
                    )
                )
            elif _has_null_company(orig, rev) and not affected:
                exceptions.extend(
                    _emit_for_parties(
                        code="reversal_company_scope_mismatch",
                        workspace_code="workspace_unassigned_reversal",
                        message="Reversal relationship has no assigned company_id on either side.",
                        parties=parties,
                        details={
                            "original_company_id": orig.company_id,
                            "reversal_company_id": rev.company_id,
                        },
                        scope_company_id=scope_co,
                    )
                )

        # Status classification — only when this scope is involved
        if scope_co not in affected and orig.company_id != scope_co and rev.company_id != scope_co:
            if not (_has_null_company(orig, rev) and not affected):
                continue

        if rev_status != "posted":
            exceptions.extend(
                _emit_for_parties(
                    code="reversed_with_unposted_reversal",
                    workspace_code="workspace_unassigned_reversal",
                    message=(
                        f"Original is status=reversed but the linked reversing journal is "
                        f"status={rev_status!r} (not posted)."
                    ),
                    parties=parties,
                    details={
                        "original_entry_number": orig.entry_number,
                        "reversal_entry_number": rev.entry_number,
                        "reversal_status": rev_status,
                    },
                    scope_company_id=scope_co,
                )
            )
        else:
            exceptions.extend(
                _emit_for_parties(
                    code="unsafe_legacy_reversal_pattern",
                    workspace_code="workspace_unassigned_reversal",
                    message=(
                        "Original journal is status=reversed (excluded from posted TB) while a "
                        "posted reversing journal remains."
                    ),
                    parties=parties,
                    details={
                        "original_entry_number": orig.entry_number,
                        "reversal_entry_number": rev.entry_number,
                        "original_status": orig.status,
                        "reversal_status": rev.status,
                    },
                    scope_company_id=scope_co,
                )
            )

    # Reversal references a non-reversed original
    for ref, matched in reversals_by_ref.items():
        originals = by_number.get(ref, [])
        if len(originals) != 1:
            continue
        orig = originals[0]
        if (orig.status or "") == "reversed":
            continue
        supported = [
            m
            for m in matched
            if (m.source or "").strip().lower() in REVERSAL_SOURCES_SUPPORTED_DETECTION
        ]
        if not supported:
            continue
        exceptions.extend(
            _emit_for_parties(
                code="reversal_original_not_reversed",
                workspace_code="workspace_unassigned_reversal",
                message="Reversing journal references an original that is not status=reversed.",
                parties=[orig] + supported,
                details={"entry_number": ref, "original_status": orig.status},
                scope_company_id=scope_co,
            )
        )

    # Description-only REVERSAL with non-standard source
    for rev in reversal_candidates:
        src = (rev.source or "").strip().lower()
        if src in REVERSAL_SOURCES_ALL:
            continue
        if not (rev.description or "").upper().startswith("REVERSAL:"):
            continue
        exceptions.extend(
            _emit_for_parties(
                code="unsupported_reversal_convention",
                workspace_code="workspace_unsupported_reversal_convention",
                message=(
                    f"Journal description indicates a reversal but source={rev.source!r} "
                    "is not a supported reversal convention for TB integrity."
                ),
                parties=[rev],
                details={"source": rev.source, "reference": rev.reference, "status": rev.status},
                scope_company_id=scope_co,
            )
        )

    return exceptions


def _query_scoped_rows(db: Session, scope: LedgerScope):
    return (
        db.query(UAEJournalLine, UAEJournalEntry)
        .join(UAEJournalEntry, UAEJournalLine.journal_entry_id == UAEJournalEntry.id)
        .filter(
            UAEJournalEntry.tenant_id == scope.workspace_id,
            UAEJournalEntry.company_id == scope.company_id,
        )
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


def _collect_eligible_facts(
    db: Session,
    scope: LedgerScope,
    period: str,
    mode: TbMode,
    currency: str,
    *,
    path_label: str,
) -> tuple[list[_LineFact], list[TbException], dict[str, int]]:
    catalog = ledger.account_catalog(db, scope)
    exceptions: list[TbException] = []
    counts = {
        "draft_or_unposted": 0,
        "reversed_status": 0,
        "currency_mismatch": 0,
        "missing_period": 0,
        "invalid_amount": 0,
        "eligible_lines": 0,
        "path": path_label,
    }

    rows = _query_scoped_rows(db, scope).all()
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
                        "path": path_label,
                    },
                    relevance="company",
                    affected_company_ids=[scope.company_id],
                )
            )
            continue

        if line.id in seen_line_ids:
            exceptions.append(
                TbException(
                    code="duplicate_journal_line",
                    message="Duplicate journal line id encountered during aggregation.",
                    journal_entry_ids=[entry.id],
                    details={"line_id": line.id, "path": path_label},
                    relevance="company",
                    affected_company_ids=[scope.company_id],
                )
            )
            continue
        seen_line_ids.add(line.id)

        try:
            debit = money_decimal(line.debit if line.debit is not None else "0")
            credit = money_decimal(line.credit if line.credit is not None else "0")
        except InvalidAmountError as exc:
            counts["invalid_amount"] += 1
            exceptions.append(
                TbException(
                    code="invalid_amount",
                    message=str(exc),
                    journal_entry_ids=[entry.id],
                    details={
                        "line_id": line.id,
                        "debit": repr(line.debit),
                        "credit": repr(line.credit),
                        "path": path_label,
                    },
                    relevance="company",
                    affected_company_ids=[scope.company_id],
                )
            )
            continue

        code = (line.account_code or "").strip() or "UNKNOWN"
        if code == "UNKNOWN" or code not in catalog:
            exceptions.append(
                TbException(
                    code="missing_account_mapping",
                    message="Account code is missing from the company chart of accounts.",
                    journal_entry_ids=[entry.id],
                    details={"line_id": line.id, "account_code": code, "path": path_label},
                    relevance="company",
                    affected_company_ids=[scope.company_id],
                )
            )
            continue

        info = catalog[code]
        name, acct_type = info["name"], info["type"]

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
                account_type=acct_type or _type_from_code(code),
                debit=debit,
                credit=credit,
                currency=line_ccy,
            )
        )

    counts["eligible_lines"] = len(facts)
    return facts, exceptions, counts


def _aggregate(facts: list[_LineFact]) -> tuple[dict[str, dict[str, Any]], Decimal, Decimal]:
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


def _compare_independent(
    primary_facts: list[_LineFact],
    primary_by_acct: dict[str, dict[str, Any]],
    primary_dr: Decimal,
    primary_cr: Decimal,
    independent_facts: list[_LineFact],
    independent_by_acct: dict[str, dict[str, Any]],
    independent_dr: Decimal,
    independent_cr: Decimal,
    scope: LedgerScope,
) -> list[TbException]:
    exceptions: list[TbException] = []
    primary_ids = {f.line_id for f in primary_facts}
    independent_ids = {f.line_id for f in independent_facts}
    co = [scope.company_id]

    if primary_ids != independent_ids:
        exceptions.append(
            TbException(
                code="independent_line_set_mismatch",
                message="Primary and independent eligible line-id sets differ.",
                details={
                    "primary_only": sorted(primary_ids - independent_ids),
                    "independent_only": sorted(independent_ids - primary_ids),
                    "primary_count": len(primary_ids),
                    "independent_count": len(independent_ids),
                },
                relevance="company",
                affected_company_ids=co,
            )
        )

    if (
        primary_dr != independent_dr
        or primary_cr != independent_cr
        or len(primary_facts) != len(independent_facts)
    ):
        exceptions.append(
            TbException(
                code="independent_reconciliation_mismatch",
                message="Independent debit/credit/line-count aggregation does not match primary.",
                details={
                    "primary_debit": _dstr(primary_dr),
                    "primary_credit": _dstr(primary_cr),
                    "primary_lines": len(primary_facts),
                    "independent_debit": _dstr(independent_dr),
                    "independent_credit": _dstr(independent_cr),
                    "independent_lines": len(independent_facts),
                },
                relevance="company",
                affected_company_ids=co,
            )
        )

    mismatched_accounts: list[dict[str, Any]] = []
    for code in sorted(set(primary_by_acct) | set(independent_by_acct)):
        p = primary_by_acct.get(code)
        i = independent_by_acct.get(code)
        if p is None or i is None:
            mismatched_accounts.append({"account_code": code, "primary": p is not None, "independent": i is not None})
            continue
        pd = p["debit"].quantize(_CENT, rounding=ROUND_HALF_UP)
        pc = p["credit"].quantize(_CENT, rounding=ROUND_HALF_UP)
        id_ = i["debit"].quantize(_CENT, rounding=ROUND_HALF_UP)
        ic = i["credit"].quantize(_CENT, rounding=ROUND_HALF_UP)
        if pd != id_ or pc != ic:
            mismatched_accounts.append(
                {
                    "account_code": code,
                    "primary": {"debit": _dstr(pd), "credit": _dstr(pc)},
                    "independent": {"debit": _dstr(id_), "credit": _dstr(ic)},
                }
            )
    if mismatched_accounts:
        exceptions.append(
            TbException(
                code="independent_account_mismatch",
                message="Account-level balances differ between primary and independent aggregations.",
                details={"accounts": mismatched_accounts},
                relevance="company",
                affected_company_ids=co,
            )
        )
    return exceptions


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
    """Build a Decimal trial balance for one company, period, mode and currency."""
    if mode not in ("period_activity", "closing_as_of"):
        raise ValueError(f"Unsupported trial balance mode: {mode!r}")
    if not currency or not str(currency).strip():
        raise ValueError("currency is required")
    _validate_period(period)
    ccy = str(currency).strip().upper()

    exceptions: list[TbException] = []

    workspace_entries = _load_workspace_entries(db, scope.workspace_id)
    exceptions.extend(_detect_reversal_exceptions(workspace_entries, scope))

    unassigned = _unassigned_posted_count(db, scope)
    if unassigned:
        # Workspace diagnostic only — does not auto-fail every company TB.
        exceptions.append(
            TbException(
                code="unassigned_company_lines",
                message=(
                    f"{unassigned} posted journal line(s) in this workspace have no company_id "
                    "and are excluded from company trial balances."
                ),
                details={"count": unassigned},
                relevance="workspace",
                affected_company_ids=[],
            )
        )

    primary_facts, primary_exc, primary_counts = _collect_eligible_facts(
        db, scope, period, mode, ccy, path_label="primary"
    )
    exceptions.extend(primary_exc)
    primary_by_acct, total_dr, total_cr = _aggregate(primary_facts)

    independent_facts, independent_exc, independent_counts = _collect_eligible_facts(
        db, scope, period, mode, ccy, path_label="independent"
    )
    primary_exc_keys = {
        (e.code, tuple(e.journal_entry_ids), e.details.get("line_id")) for e in primary_exc
    }
    for e in independent_exc:
        key = (e.code, tuple(e.journal_entry_ids), e.details.get("line_id"))
        if key not in primary_exc_keys:
            exceptions.append(e)

    independent_by_acct, ind_dr, ind_cr = _aggregate(independent_facts)
    exceptions.extend(
        _compare_independent(
            primary_facts,
            primary_by_acct,
            total_dr,
            total_cr,
            independent_facts,
            independent_by_acct,
            ind_dr,
            ind_cr,
            scope,
        )
    )

    accounts_out: list[dict[str, Any]] = []
    all_line_ids: list[str] = []
    for code in sorted(primary_by_acct.keys()):
        slot = primary_by_acct[code]
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
    arith_ok = imbalance == _ZERO

    company_exceptions = [e for e in exceptions if e.relevance == "company"]
    workspace_warnings = [e for e in exceptions if e.relevance == "workspace"]

    source_ok = not any(
        e.code
        in {
            "independent_reconciliation_mismatch",
            "independent_line_set_mismatch",
            "independent_account_mismatch",
        }
        for e in company_exceptions
    ) and primary_counts["eligible_lines"] == len(primary_facts) == independent_counts[
        "eligible_lines"
    ] == len(
        independent_facts
    )

    company_integrity_ok = not any(
        e.code in COMPANY_BLOCKING_CODES for e in company_exceptions
    )
    workspace_clean = len(workspace_warnings) == 0

    reconciliation_passed = arith_ok and source_ok and company_integrity_ok

    fp = _fingerprint(
        scope=scope,
        period=period,
        mode=mode,
        currency=ccy,
        accounts=accounts_out,
        line_ids=all_line_ids,
    )

    limitations: list[str] = [
        (
            "Independence boundary: primary and independent paths each issue a separate query "
            "and build separate fact lists, but both use the same `_collect_eligible_facts` "
            "eligibility logic and the caller's Session/transaction snapshot. This is not "
            "independent source-completeness verification and does not prove absence of shared "
            "eligibility defects or concurrent write skew."
        ),
        (
            "reconciliation_passed requires arithmetic_balance AND source_reconciliation AND "
            "company_accounting_integrity. Workspace integrity warnings remain visible and set "
            "workspace_integrity_clean=false but do not by themselves fail an unrelated company TB."
        ),
    ]
    if mode == "closing_as_of":
        limitations.append(
            "closing_as_of uses full posted history through the period (including P&L). "
            "This is not necessarily financial-year YTD."
        )
    if not primary_facts:
        limitations.append("No eligible posted journal lines for this scope/period/currency.")
    if not workspace_clean:
        limitations.append(
            "Workspace integrity is not clean: unresolved null-company or ambiguous records remain."
        )

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
        "is_balanced": arith_ok,
        "arithmetic_balance": {
            "passed": arith_ok,
            "total_debit": _dstr(total_dr),
            "total_credit": _dstr(total_cr),
            "imbalance": _dstr(imbalance),
        },
        "source_reconciliation": {
            "passed": source_ok,
            "primary_line_count": len(primary_facts),
            "independent_line_count": len(independent_facts),
            "independent_total_debit": _dstr(ind_dr),
            "independent_total_credit": _dstr(ind_cr),
            "matches_primary": source_ok,
        },
        "company_accounting_integrity": {
            "passed": company_integrity_ok,
            "blocking_exception_count": sum(
                1 for e in company_exceptions if e.code in COMPANY_BLOCKING_CODES
            ),
        },
        # Backward-compatible alias for company integrity
        "accounting_integrity": {
            "passed": company_integrity_ok,
            "blocking_exception_count": sum(
                1 for e in company_exceptions if e.code in COMPANY_BLOCKING_CODES
            ),
        },
        "workspace_integrity_warnings": [e.as_dict() for e in workspace_warnings],
        "workspace_integrity_clean": workspace_clean,
        "reconciliation_passed": reconciliation_passed,
        "independent_reconciliation": {
            "total_debit": _dstr(ind_dr),
            "total_credit": _dstr(ind_cr),
            "line_count": len(independent_facts),
            "matches_primary": source_ok,
        },
        "source_population": {
            "eligible_line_count": primary_counts["eligible_lines"],
            "aggregated_line_count": len(primary_facts),
            "independent_eligible_line_count": independent_counts["eligible_lines"],
            "draft_or_unposted_seen": primary_counts["draft_or_unposted"],
            "reversed_status_seen": primary_counts["reversed_status"],
            "currency_mismatch_excluded": primary_counts["currency_mismatch"],
            "invalid_amount_excluded": primary_counts["invalid_amount"],
            "unassigned_company_posted_lines": unassigned,
        },
        "exceptions": [e.as_dict() for e in exceptions],
        "limitations": limitations,
        "content_fingerprint": fp,
    }
