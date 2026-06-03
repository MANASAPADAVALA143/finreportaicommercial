"""
UAE Corporate Tax Bridge — FY2023/24 onwards
============================================
Reconciles IFRS Net Profit Before Tax → UAE Taxable Income → CT Liability.

UAE Corporate Tax Law (Federal Decree-Law No. 47 of 2022):
  - Standard rate:          9% on taxable income > AED 375,000
  - Small Business Relief:  0% if taxable income ≤ AED 375,000 AND revenue ≤ AED 3M
  - Qualifying Free Zone:   0% on qualifying income (if entity meets FZ conditions)
"""
from __future__ import annotations

import logging
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from sqlalchemy.orm import Session

from app.models.ifrs_statement import (
    CTBridgeResult,
    GeneratedStatement,
    IFRSStatementKind,
    TrialBalance,
)

logger = logging.getLogger(__name__)

UAE_CT_RATE = Decimal("0.09")
SMALL_BUSINESS_THRESHOLD = Decimal("375000")   # AED
SBR_REVENUE_CEILING = Decimal("3000000")       # AED 3 million


def _d(v: float | int | str | Decimal | None) -> Decimal:
    """Safe Decimal cast."""
    try:
        return Decimal(str(v or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except Exception:
        return Decimal("0.00")


def _get_pbt(trial_balance_id: int, db: Session) -> Decimal:
    """Pull Profit Before Tax amount from the generated P&L statement."""
    pl_stmt = (
        db.query(GeneratedStatement)
        .filter(
            GeneratedStatement.trial_balance_id == trial_balance_id,
            GeneratedStatement.statement_type == IFRSStatementKind.profit_loss,
        )
        .first()
    )
    if not pl_stmt:
        return Decimal("0.00")

    for li in sorted(pl_stmt.line_items, key=lambda x: x.display_order):
        name_lower = (li.ifrs_line_item or "").lower()
        if "profit before tax" in name_lower or name_lower == "pbt":
            return _d(li.amount)
    return Decimal("0.00")


def _get_revenue(trial_balance_id: int, db: Session) -> Decimal:
    """Pull total revenue from P&L to check SBR revenue ceiling."""
    pl_stmt = (
        db.query(GeneratedStatement)
        .filter(
            GeneratedStatement.trial_balance_id == trial_balance_id,
            GeneratedStatement.statement_type == IFRSStatementKind.profit_loss,
        )
        .first()
    )
    if not pl_stmt:
        return Decimal("0.00")

    for li in pl_stmt.line_items:
        name_lower = (li.ifrs_line_item or "").lower()
        if "total revenue" in name_lower:
            return _d(li.amount)
    # Fallback: sum all revenue section items
    rev = Decimal("0.00")
    for li in pl_stmt.line_items:
        if li.ifrs_section and "revenue" in li.ifrs_section.lower() and not li.is_subtotal and not li.is_total:
            rev += _d(li.amount)
    return rev


def generate_ct_bridge(
    trial_balance_id: int,
    db: Session,
    *,
    # --- Disallowed expenses (Add back) ---
    entertainment_expense: float = 0.0,
    fines_penalties: float = 0.0,
    non_business_expenses: float = 0.0,
    non_qualifying_depreciation: float = 0.0,
    # --- Exempt income (Deduct) ---
    dividend_income_uae_sub: float = 0.0,
    qualifying_capital_gains: float = 0.0,
    qualifying_free_zone_income: float = 0.0,
    # --- Free Zone status ---
    is_free_zone_person: bool = False,
    qualifying_income_pct: float = 100.0,
    # --- Revenue for SBR check (auto-read if 0) ---
    revenue_override: float = 0.0,
) -> dict[str, Any]:
    """
    Generate UAE Corporate Tax bridge from IFRS P&L.

    Parameters
    ----------
    trial_balance_id : int
        ID of the TrialBalance record (must have statements already generated).
    db : Session
        SQLAlchemy session.
    entertainment_expense : float
        Total entertainment & hospitality charged to P&L (50% disallowed).
    fines_penalties : float
        Total fines/penalties in P&L (100% disallowed).
    non_business_expenses : float
        Expenses not incurred for business (100% disallowed).
    non_qualifying_depreciation : float
        Depreciation on non-business assets (100% disallowed).
    dividend_income_uae_sub : float
        Dividends from UAE resident subsidiaries (Participation Exemption — deduct).
    qualifying_capital_gains : float
        Gains on disposal of qualifying participations (exempt — deduct).
    qualifying_free_zone_income : float
        Income of a Qualifying Free Zone Person taxed at 0% (deduct if eligible).
    is_free_zone_person : bool
        True if the entity is a Qualifying Free Zone Person.
    qualifying_income_pct : float
        % of total income that is qualifying FZ income (need ≥ 95% to qualify).
    revenue_override : float
        Manually supplied revenue for SBR check. If 0, auto-read from P&L.

    Returns
    -------
    dict with full bridge calculation, persisted to ct_bridge_results table.
    """
    tb = db.query(TrialBalance).filter(TrialBalance.id == trial_balance_id).first()
    if not tb:
        raise ValueError(f"Trial balance {trial_balance_id} not found")

    # ── Step 1: IFRS PBT ─────────────────────────────────────────────────────
    ifrs_pbt = _get_pbt(trial_balance_id, db)
    revenue = _d(revenue_override) if revenue_override else _get_revenue(trial_balance_id, db)

    adjustments: list[dict[str, Any]] = []

    # ── Step 2: Add back disallowed expenses ──────────────────────────────────

    ent = _d(entertainment_expense)
    if ent > 0:
        disallowed = (ent * Decimal("0.50")).quantize(Decimal("0.01"))
        adjustments.append({
            "description": "Entertainment & hospitality — 50% disallowed",
            "amount": float(disallowed),
            "add_back": True,
            "note": "Art. 32 UAE CT Law: only 50% of entertainment costs are deductible. "
                    f"Total charged: AED {float(ent):,.2f} → Disallowed 50%: AED {float(disallowed):,.2f}",
            "ifrs_reference": "UAE CT Law Art. 32",
        })

    fp_d = _d(fines_penalties)
    if fp_d > 0:
        adjustments.append({
            "description": "Fines and administrative penalties — fully disallowed",
            "amount": float(fp_d),
            "add_back": True,
            "note": "Administrative fines and penalties imposed by government authorities "
                    "are not deductible under UAE CT Law.",
            "ifrs_reference": "UAE CT Law Art. 33",
        })

    nbe = _d(non_business_expenses)
    if nbe > 0:
        adjustments.append({
            "description": "Non-business expenses — fully disallowed",
            "amount": float(nbe),
            "add_back": True,
            "note": "Expenses not incurred wholly and exclusively for the purposes of "
                    "the taxable business are non-deductible.",
            "ifrs_reference": "UAE CT Law Art. 28",
        })

    nqd = _d(non_qualifying_depreciation)
    if nqd > 0:
        adjustments.append({
            "description": "Depreciation — non-qualifying / non-business assets",
            "amount": float(nqd),
            "add_back": True,
            "note": "Depreciation on assets not used in taxable business activities "
                    "is disallowed.",
            "ifrs_reference": "UAE CT Law Art. 28",
        })

    # ── Step 3: Deduct exempt income ──────────────────────────────────────────

    div = _d(dividend_income_uae_sub)
    if div > 0:
        adjustments.append({
            "description": "Dividends from UAE subsidiaries — Participation Exemption",
            "amount": float(div),
            "add_back": False,
            "note": "Dividends received from UAE resident subsidiaries qualify for the "
                    "Participation Exemption and are excluded from taxable income.",
            "ifrs_reference": "UAE CT Law Art. 23",
        })

    cg = _d(qualifying_capital_gains)
    if cg > 0:
        adjustments.append({
            "description": "Qualifying capital gains — Participation Exemption",
            "amount": float(cg),
            "add_back": False,
            "note": "Gains on disposal of qualifying participations (≥5% ownership, ≥12 months held) "
                    "are exempt from CT under the Participation Exemption.",
            "ifrs_reference": "UAE CT Law Art. 23",
        })

    fz_income = _d(qualifying_free_zone_income)
    qip = Decimal(str(qualifying_income_pct))

    free_zone_eligible = False
    free_zone_note = ""
    if is_free_zone_person:
        if qip >= Decimal("95"):
            free_zone_eligible = True
            free_zone_note = (
                f"✅ Qualifies for 0% rate — {float(qip):.1f}% qualifying income "
                f"(threshold: 95%). 9% rate applies on non-qualifying income only."
            )
        else:
            free_zone_note = (
                f"❌ Standard 9% applies — only {float(qip):.1f}% qualifying income "
                f"(minimum 95% required to maintain Qualifying Free Zone Person status)."
            )

        if fz_income > 0 and free_zone_eligible:
            adjustments.append({
                "description": "Qualifying Free Zone income — 0% rate",
                "amount": float(fz_income),
                "add_back": False,
                "note": "Qualifying income of a Qualifying Free Zone Person is subject to 0% CT. "
                        "Deducted from taxable income base.",
                "ifrs_reference": "UAE CT Law Art. 18",
            })

    # ── Step 4: Compute taxable income ────────────────────────────────────────

    total_add_backs = sum(
        _d(a["amount"]) for a in adjustments if a["add_back"]
    )
    total_deductions = sum(
        _d(a["amount"]) for a in adjustments if not a["add_back"]
    )
    taxable_income_raw = ifrs_pbt + total_add_backs - total_deductions
    taxable_income = max(taxable_income_raw, Decimal("0.00"))  # CT base cannot be negative

    # ── Step 5: Small Business Relief ─────────────────────────────────────────
    # Conditions: taxable income ≤ AED 375k AND revenue ≤ AED 3M AND not FZ person
    small_business_relief = (
        taxable_income <= SMALL_BUSINESS_THRESHOLD
        and revenue <= SBR_REVENUE_CEILING
        and not is_free_zone_person
    )

    # ── Step 6: CT rate & liability ───────────────────────────────────────────
    if small_business_relief:
        ct_rate = Decimal("0.00")
        ct_liability = Decimal("0.00")
        rate_note = (
            f"Small Business Relief applies — 0% CT rate. "
            f"Taxable income AED {float(taxable_income):,.0f} ≤ AED 375,000 threshold "
            f"and revenue AED {float(revenue):,.0f} ≤ AED 3M ceiling."
        )
    elif free_zone_eligible:
        ct_rate = Decimal("0.00")
        ct_liability = Decimal("0.00")
        rate_note = (
            "Qualifying Free Zone Person — 0% CT rate on qualifying income. "
            "Ensure non-qualifying income is separately computed at 9%."
        )
    else:
        ct_rate = UAE_CT_RATE
        ct_liability = (taxable_income * ct_rate).quantize(Decimal("0.01"))
        rate_note = (
            f"Standard UAE CT rate 9% applied on taxable income of "
            f"AED {float(taxable_income):,.2f}."
        )

    # ── Step 7: Effective rate ────────────────────────────────────────────────
    if ifrs_pbt > 0:
        effective_rate = float((ct_liability / ifrs_pbt * 100).quantize(Decimal("0.01")))
    else:
        effective_rate = 0.0

    # ── Step 8: Persist to DB ─────────────────────────────────────────────────
    inputs_snapshot = {
        "entertainment_expense": entertainment_expense,
        "fines_penalties": fines_penalties,
        "non_business_expenses": non_business_expenses,
        "non_qualifying_depreciation": non_qualifying_depreciation,
        "dividend_income_uae_sub": dividend_income_uae_sub,
        "qualifying_capital_gains": qualifying_capital_gains,
        "qualifying_free_zone_income": qualifying_free_zone_income,
        "is_free_zone_person": is_free_zone_person,
        "qualifying_income_pct": qualifying_income_pct,
        "revenue_override": revenue_override,
    }

    try:
        db.query(CTBridgeResult).filter(
            CTBridgeResult.trial_balance_id == trial_balance_id
        ).delete(synchronize_session=False)

        row = CTBridgeResult(
            tenant_id=tb.tenant_id,
            trial_balance_id=trial_balance_id,
            ifrs_pbt=float(ifrs_pbt),
            adjustments_json=adjustments,
            taxable_income=float(taxable_income),
            ct_rate=float(ct_rate),
            ct_liability=float(ct_liability),
            free_zone_eligible=free_zone_eligible,
            small_business_relief=small_business_relief,
            inputs_json=inputs_snapshot,
            calculated_at=datetime.utcnow(),
        )
        db.add(row)
        db.commit()
        logger.info(
            "CT bridge saved for tb_id=%s: PBT=%.2f → taxable=%.2f → liability=%.2f",
            trial_balance_id,
            float(ifrs_pbt),
            float(taxable_income),
            float(ct_liability),
        )
    except Exception as exc:
        db.rollback()
        logger.warning("CT bridge DB save failed (non-fatal): %s", exc)

    # ── Step 9: Return ────────────────────────────────────────────────────────
    return {
        "trial_balance_id": trial_balance_id,
        "company_name": tb.company_name,
        "period_end": str(tb.period_end) if tb.period_end else "",
        "currency": tb.currency or "AED",
        # Core numbers
        "ifrs_pbt": float(ifrs_pbt),
        "revenue": float(revenue),
        "adjustments": adjustments,
        "total_add_backs": float(total_add_backs),
        "total_deductions": float(total_deductions),
        "taxable_income": float(taxable_income),
        # Tax output
        "ct_rate": float(ct_rate),
        "ct_rate_pct": float(ct_rate * 100),
        "ct_liability": float(ct_liability),
        "effective_rate_pct": effective_rate,
        # Reliefs
        "small_business_relief": small_business_relief,
        "sbr_threshold": float(SMALL_BUSINESS_THRESHOLD),
        "sbr_revenue_ceiling": float(SBR_REVENUE_CEILING),
        "free_zone_eligible": free_zone_eligible,
        "free_zone_note": free_zone_note,
        "rate_note": rate_note,
        # Inputs snapshot
        "inputs": inputs_snapshot,
    }


def get_saved_ct_bridge(trial_balance_id: int, db: Session) -> dict[str, Any] | None:
    """Retrieve the last saved CT bridge result for a trial balance."""
    row = (
        db.query(CTBridgeResult)
        .filter(CTBridgeResult.trial_balance_id == trial_balance_id)
        .order_by(CTBridgeResult.id.desc())
        .first()
    )
    if not row:
        return None

    tb = db.query(TrialBalance).filter(TrialBalance.id == trial_balance_id).first()

    return {
        "trial_balance_id": trial_balance_id,
        "company_name": tb.company_name if tb else "",
        "period_end": str(tb.period_end) if tb and tb.period_end else "",
        "currency": tb.currency if tb else "AED",
        "ifrs_pbt": float(row.ifrs_pbt or 0),
        "adjustments": row.adjustments_json or [],
        "taxable_income": float(row.taxable_income or 0),
        "ct_rate": float(row.ct_rate or 0),
        "ct_rate_pct": float((row.ct_rate or 0) * 100),
        "ct_liability": float(row.ct_liability or 0),
        "small_business_relief": row.small_business_relief,
        "free_zone_eligible": row.free_zone_eligible,
        "inputs": row.inputs_json or {},
        "calculated_at": row.calculated_at.isoformat() if row.calculated_at else None,
    }
