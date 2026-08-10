from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.core.config import settings

from app.models.ifrs_statement import (
    GeneratedStatement,
    GLMapping,
    IFRSLink,
    IFRSStatementKind,
    StatementLineItem,
    TrialBalance,
    TrialBalanceLine,
)

logger = logging.getLogger(__name__)

STATEMENT_STRUCTURE: dict[str, dict[str, Any]] = {
    # Prism / IFRS line items — mapping names must match GL → IFRS picks and dropdown master seed.
    "financial_position": {
        "Non-current Assets": [
            ("Property plant and equipment (gross)", 1),
            ("Accumulated depreciation — PPE", 2),
            ("Right-of-use assets", 3),
            ("Accumulated depreciation — ROU", 4),
            ("Goodwill", 5),
            ("Other intangible assets", 6),
            ("Accumulated amortisation — intangibles", 7),
            ("Investments in associates", 8),
            ("Other financial assets", 9),
            ("Deferred tax assets", 10),
            ("TOTAL NON-CURRENT ASSETS", 11, True),
        ],
        "Current Assets": [
            ("Inventories", 20),
            ("Trade and other receivables (gross)", 21),
            ("Loss allowance on receivables", 22),
            ("Contract assets", 23),
            ("Prepayments and other current assets", 24),
            ("Cash and cash equivalents", 25),
            ("TOTAL CURRENT ASSETS", 26, True),
        ],
        "Equity": [
            ("Share capital", 30),
            ("Share premium", 31),
            ("Retained earnings", 32),
            ("Other comprehensive income reserve", 33),
            ("Foreign currency translation reserve", 34),
            ("Revaluation reserve", 35),
            ("TOTAL EQUITY", 36, True),
        ],
        "Non-current Liabilities": [
            ("Borrowings — non-current", 40),
            ("Lease liabilities — non-current", 41),
            ("Deferred tax liabilities", 42),
            ("Employee benefit obligations", 43),
            ("Provisions", 44),
            ("Other non-current liabilities", 45),
            ("TOTAL NON-CURRENT LIABILITIES", 46, True),
        ],
        "Current Liabilities": [
            ("Trade and other payables", 50),
            ("Borrowings — current", 51),
            ("Lease liabilities — current", 52),
            ("Contract liabilities", 53),
            ("Income tax payable", 54),
            ("Accruals and other payables", 55),
            ("TOTAL CURRENT LIABILITIES", 56, True),
        ],
        "TOTAL ASSETS": (60, True),
        "TOTAL LIABILITIES": (61, True),
        "TOTAL LIABILITIES AND EQUITY": (62, True),
    },
    "profit_loss": {
        "Revenue": [
            ("Revenue from contracts with customers", 1),
            ("Other income", 2),
            ("Gain on disposal of PPE", 3),
            ("TOTAL REVENUE", 4, True),
        ],
        "Cost of Sales": [
            ("Cost of goods sold", 10),
            ("Changes in inventories", 11),
            ("GROSS PROFIT", 12, True),
        ],
        "Operating Expenses": [
            ("Employee benefits expense", 20),
            ("Depreciation — PPE", 21),
            ("Depreciation — right-of-use assets", 22),
            ("Amortisation of intangibles", 23),
            ("Impairment of goodwill", 24),
            ("Expected credit loss charge", 25),
            ("Research and development expense", 26),
            ("Selling and distribution expense", 27),
            ("General and administrative expense", 28),
            ("Other operating expenses", 29),
            ("OPERATING PROFIT (EBIT)", 30, True),
        ],
        "Finance Items": [
            ("Finance income", 40),
            ("Finance costs — interest on loans", 41),
            ("Finance costs — interest on leases", 42),
            ("Foreign exchange loss", 43),
            ("Share of profit of associates", 44),
            ("PROFIT BEFORE TAX", 45, True),
        ],
        "Tax": [
            ("Income tax expense — current", 50),
            ("Income tax expense — deferred", 51),
            ("PROFIT FOR THE PERIOD", 52, True),
        ],
    },
    "other_comprehensive_income": {
        "OCI — items that may be reclassified": [
            ("Foreign currency translation differences", 1),
        ],
        "OCI — items that will not be reclassified": [
            ("Remeasurement of defined benefit plans", 10),
            ("Fair value changes — equity instruments", 11),
            ("TOTAL OTHER COMPREHENSIVE INCOME", 20, True),
        ],
    },
    "cash_flows": {
        "Operating Activities": [
            ("Profit for the period", 1),
            ("Adjustments for depreciation", 2),
            ("Adjustments for amortisation", 3),
            ("Adjustments for IFRS 16 depreciation", 4),
            ("Adjustments for IFRS 16 interest", 5),
            ("Adjustments for IFRS 9 impairment", 6),
            ("Changes in trade receivables", 7),
            ("Changes in inventories", 8),
            ("Changes in trade payables", 9),
            ("Changes in contract assets", 10),
            ("Changes in deferred revenue", 11),
            ("Income tax paid", 12),
            ("NET CASH FROM OPERATING", 13, True),
        ],
        "Investing Activities": [
            ("Purchase of property plant equipment", 14),
            ("Proceeds from disposal of PPE", 15),
            ("Purchase of intangible assets", 16),
            ("NET CASH FROM INVESTING", 17, True),
        ],
        "Financing Activities": [
            ("Proceeds from borrowings", 18),
            ("Repayment of borrowings", 19),
            ("Repayment of lease liabilities", 20),
            ("Dividends paid", 21),
            ("NET CASH FROM FINANCING", 22, True),
        ],
        "Cash reconciliation": [
            ("Opening cash and cash equivalents", 23),
            ("Net increase/(decrease) in cash", 24),
            ("Closing cash and cash equivalents", 25),
            ("Balance sheet cash and cash equivalents", 26),
            ("Cash reconciling difference", 27),
        ],
        "NET INCREASE IN CASH": (28, True),
    },
    "equity": {
        "Share capital": [
            ("Share capital - opening", 1),
            ("Share capital - closing", 2),
        ],
        "Share premium": [
            ("Share premium - opening", 3),
            ("Share premium - closing", 4),
        ],
        "Retained earnings": [
            ("Retained earnings - opening", 5),
            ("Profit for the period", 6),
            ("Dividends", 7),
            ("Retained earnings - closing", 8),
        ],
        "OCI reserve": [
            ("OCI reserve - opening", 9),
            ("OCI for the period", 10),
            ("OCI reserve - closing", 11),
        ],
        "Total": [
            ("TOTAL EQUITY - opening", 12),
            ("TOTAL EQUITY", 13),
        ],
    },
}


def _to_decimal(v: float | int | Decimal) -> Decimal:
    return Decimal(str(v)).quantize(Decimal("0.01"))


def _create_line(
    db: Session,
    statement_id: int,
    section: str,
    name: str,
    amount: Decimal,
    display_order: int,
    *,
    is_subtotal: bool = False,
    is_total: bool = False,
    indent_level: int = 1,
) -> StatementLineItem:
    li = StatementLineItem(
        statement_id=statement_id,
        ifrs_section=section,
        ifrs_line_item=name,
        amount=amount,
        is_calculated=is_subtotal or is_total,
        is_subtotal=is_subtotal,
        is_total=is_total,
        display_order=display_order,
        indent_level=indent_level,
    )
    db.add(li)
    db.flush()
    return li


def _lookup_line_total(line_totals: dict[str, Decimal], name: str) -> Decimal:
    """Exact key, then case-insensitive / whitespace-normalised match (Claude vs STATEMENT_STRUCTURE)."""
    if name in line_totals:
        return line_totals[name]
    target = name.strip().casefold()
    for k, v in line_totals.items():
        if k.strip().casefold() == target:
            return v
    return Decimal("0.00")


def _mapping_refs_lookup(
    refs: dict[str, list[tuple[int, Decimal, IFRSStatementKind]]], name: str
) -> list[tuple[int, Decimal, IFRSStatementKind]]:
    if name in refs:
        return refs[name]
    target = name.strip().casefold()
    for k, v in refs.items():
        if k.strip().casefold() == target:
            return v
    return []


def _pick(line_totals: dict[str, Decimal], candidates: list[str]) -> Decimal:
    for c in candidates:
        v = _lookup_line_total(line_totals, c)
        if v != 0:
            return v
    return Decimal("0.00")


def _derived_amount(
    stmt_type: str,
    name: str,
    line_totals: dict[str, Decimal],
    mappings: list[GLMapping],
) -> Decimal:
    if stmt_type == "cash_flows":
        if name == "Profit for the period":
            return sum(
                _to_decimal(float(m.trial_balance_line.net_amount or 0))
                for m in mappings
                if m.ifrs_statement == IFRSStatementKind.profit_loss and m.trial_balance_line is not None
            )
        if name == "Adjustments for depreciation":
            return (
                _lookup_line_total(line_totals, "Depreciation — PPE")
                + _lookup_line_total(line_totals, "Depreciation — right-of-use assets")
                + _lookup_line_total(line_totals, "Amortisation of intangibles")
            )
        if name == "Adjustments for amortisation":
            return Decimal("0.00")
        if name == "Changes in trade receivables":
            return _pick(
                line_totals,
                ["Trade and other receivables (gross)", "Trade receivables"],
            )
        if name == "Changes in inventories":
            return _pick(line_totals, ["Inventories"])
        if name == "Changes in trade payables":
            return _pick(line_totals, ["Trade and other payables", "Trade payables"])
        if name == "Income tax paid":
            return _pick(
                line_totals,
                [
                    "Income tax expense — current",
                    "Income tax expense — deferred",
                    "Income tax expense",
                    "Income tax payable",
                    "Tax payable",
                ],
            )
        if name == "Purchase of property plant equipment":
            return _pick(
                line_totals,
                ["Property plant and equipment (gross)", "Property plant and equipment"],
            ) * Decimal("-1")
        if name == "Purchase of intangible assets":
            return _pick(
                line_totals,
                ["Other intangible assets", "Intangible assets"],
            ) * Decimal("-1")
        if name == "Proceeds from borrowings":
            b = _lookup_line_total(line_totals, "Borrowings — current") + _lookup_line_total(
                line_totals, "Borrowings — non-current"
            )
            if b != 0:
                return b
            return _pick(line_totals, ["Long-term borrowings", "Short-term borrowings"])
        if name == "Repayment of lease liabilities":
            ll = _lookup_line_total(line_totals, "Lease liabilities — current") + _lookup_line_total(
                line_totals, "Lease liabilities — non-current"
            )
            if ll != 0:
                return ll * Decimal("-1")
            return _pick(line_totals, ["Lease liabilities"]) * Decimal("-1")
        if name == "Dividends paid":
            return Decimal("0.00")

    if stmt_type == "equity":
        if name == "Share capital - opening":
            return Decimal("0.00")
        if name == "Share capital - closing":
            return _pick(line_totals, ["Share capital"])
        if name == "Retained earnings - opening":
            return Decimal("0.00")
        if name == "Profit for the period":
            return sum(
                _to_decimal(float(m.trial_balance_line.net_amount or 0))
                for m in mappings
                if m.ifrs_statement == IFRSStatementKind.profit_loss and m.trial_balance_line is not None
            )
        if name == "Dividends":
            return Decimal("0.00")
        if name == "Retained earnings - closing":
            return _pick(line_totals, ["Retained earnings"])

    return Decimal("0.00")


_PRIOR_COL_READY = False


def ensure_prior_tb_column(db: Session) -> None:
    """Additive schema patch — prior_trial_balance_id on trial_balances."""
    global _PRIOR_COL_READY
    if _PRIOR_COL_READY:
        return
    from sqlalchemy import inspect, text

    bind = db.get_bind()
    try:
        cols = {c["name"] for c in inspect(bind).get_columns("trial_balances")}
        if "prior_trial_balance_id" in cols:
            _PRIOR_COL_READY = True
            return
    except Exception:
        pass
    try:
        dialect = getattr(bind.dialect, "name", "")
        if dialect == "sqlite":
            db.execute(text("ALTER TABLE trial_balances ADD COLUMN prior_trial_balance_id INTEGER"))
        else:
            db.execute(text("ALTER TABLE trial_balances ADD COLUMN IF NOT EXISTS prior_trial_balance_id INTEGER"))
        db.commit()
        _PRIOR_COL_READY = True
    except Exception:
        db.rollback()
        logger.exception("Could not add trial_balances.prior_trial_balance_id")


def _pres_asset(v: Any) -> Decimal:
    return _to_decimal(v)


def _pres_credit_normal(v: Any) -> Decimal:
    d = _to_decimal(v)
    return -d if d < 0 else d


def _amt(totals: dict[str, Decimal], *names: str) -> Decimal:
    for n in names:
        v = _lookup_line_total(totals, n)
        if v != 0:
            return v
    return Decimal("0.00")


def _map_tb_to_ifrs_totals(trial_balance_id: int, db: Session, mappings: list[GLMapping] | None = None) -> dict[str, Decimal]:
    """Roll TB lines into IFRS line items using current-period mappings (match prior by gl_code)."""
    if mappings is None:
        raw = (
            db.query(GLMapping)
            .filter(GLMapping.trial_balance_id == trial_balance_id)
            .order_by(GLMapping.trial_balance_line_id, GLMapping.id.desc())
            .all()
        )
        seen: set[int] = set()
        mappings = []
        for m in raw:
            if m.trial_balance_line_id in seen:
                continue
            seen.add(m.trial_balance_line_id)
            mappings.append(m)
    lines = (
        db.query(TrialBalanceLine)
        .filter(TrialBalanceLine.trial_balance_id == trial_balance_id)
        .all()
    )
    by_code = {ln.gl_code: _to_decimal(ln.net_amount or 0) for ln in lines}
    totals: dict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))
    for m in mappings:
        totals[m.ifrs_line_item] += by_code.get(m.gl_code, Decimal("0.00"))
    return dict(totals)


def check_balance(financial_position: dict[str, Any]) -> dict[str, Any]:
    """Honest IAS 1 check — never plug equity or inflate TLE."""
    total_assets = float(financial_position.get("total_assets") or 0)
    total_liabilities = float(financial_position.get("total_liabilities") or 0)
    total_equity = float(financial_position.get("total_equity") or 0)
    total_liab_equity = total_liabilities + total_equity
    difference = abs(total_assets - total_liab_equity)
    gap_section = None
    if difference >= 1.0:
        if abs(total_assets) < 0.005:
            gap_section = "Assets appear empty — check GL mapping to financial position"
        elif abs(total_equity) < 0.005:
            gap_section = "Equity section"
        elif abs(total_liabilities) < 0.005 and difference > 1:
            gap_section = "Liabilities or equity mapping"
        else:
            gap_section = "Assets vs liabilities + equity"
    return {
        "balanced": difference < 1.0,
        "difference": round(difference, 2),
        "total_assets": round(total_assets, 2),
        "total_liabilities": round(total_liabilities, 2),
        "total_equity": round(total_equity, 2),
        "total_liabilities_and_equity": round(total_liab_equity, 2),
        "gap_section": gap_section,
    }


def integrity_from_grouped_statements(grouped: dict[str, Any]) -> dict[str, Any]:
    """Rebuild badges from persisted statement line items (refresh-safe)."""

    def _exact(stmt_key: str, name: str) -> float:
        block = grouped.get(stmt_key) or {}
        items = block.get("line_items") or block or []
        if isinstance(items, dict):
            items = items.get("line_items") or []
        for li in items:
            label = li.get("ifrs_line_item") or li.get("line_item") or ""
            if label == name:
                return float(li.get("amount") or 0)
        return 0.0

    fp = {
        "total_assets": _exact("financial_position", "TOTAL ASSETS"),
        "total_liabilities": _exact("financial_position", "TOTAL LIABILITIES"),
        "total_equity": _exact("financial_position", "TOTAL EQUITY"),
    }
    # TOTAL EQUITY on FP is a section subtotal name; fall back to equity statement.
    if abs(fp["total_equity"]) < 0.005:
        fp["total_equity"] = _exact("equity", "TOTAL EQUITY")
    closing_cf = _exact("cash_flows", "Closing cash and cash equivalents")
    bs_cash = _exact("cash_flows", "Balance sheet cash and cash equivalents") or _exact(
        "financial_position", "Cash and cash equivalents"
    )
    cash_diff = abs(closing_cf - bs_cash)
    soce_eq = _exact("equity", "TOTAL EQUITY")
    eq_diff = abs(soce_eq - fp["total_equity"])
    return {
        "balance_check": check_balance(fp),
        "cash_flow_reconciliation": {
            "closing_cash": closing_cf,
            "balance_sheet_cash": bs_cash,
            "difference": round(cash_diff, 2),
            "ties": cash_diff < 1.0,
            "opening_cash": _exact("cash_flows", "Opening cash and cash equivalents"),
            "net_movement": _exact("cash_flows", "NET INCREASE IN CASH")
            or _exact("cash_flows", "Net increase/(decrease) in cash"),
        },
        "soce_check": {
            "closing_equity": soce_eq,
            "balance_sheet_equity": fp["total_equity"],
            "difference": round(eq_diff, 2),
            "ties": eq_diff < 1.0,
        },
    }


def generate_cash_flow_statement(
    tb_lines: dict[str, Decimal],
    prior_period_tb_lines: dict[str, Decimal] | None,
    ifrs16_adjustments: list[dict[str, Any]] | None,
    company_id: str,
    period: str,
    db: Session,
    *,
    profit_for_period: Decimal | None = None,
    has_prior: bool = False,
) -> dict[str, Decimal]:
    """IAS 7 indirect method. Amounts are presentation-signed (cash in +, cash out −)."""
    del company_id, db  # signature stability for callers / tests
    cur = tb_lines or {}
    prior = prior_period_tb_lines or {}
    adj = ifrs16_adjustments or []

    def _adj_amount(*needles: str) -> Decimal:
        total = Decimal("0.00")
        for row in adj:
            blob = " ".join(
                str(row.get(k) or "")
                for k in ("gl_code", "ifrs_line_item", "module", "gl_description")
            ).lower()
            if any(n.lower() in blob for n in needles):
                total += abs(_to_decimal(row.get("net_amount") or 0))
        return total

    dep_ppe = abs(_amt(cur, "Depreciation — PPE"))
    dep_rou = abs(_amt(cur, "Depreciation — right-of-use assets"))
    amort = abs(_amt(cur, "Amortisation of intangibles"))
    ifrs16_dep = _adj_amount("IFRS16-DEP", "Depreciation — right-of-use") or dep_rou
    ifrs16_int = _adj_amount("IFRS16-INT", "interest on leases") or abs(
        _amt(cur, "Finance costs — interest on leases")
    )
    ifrs9_imp = _adj_amount("IFRS9-IMP", "Expected credit loss") or abs(
        _amt(cur, "Expected credit loss charge")
    )
    lease_pay = _adj_amount("IFRS16-PAY", "Repayment of lease")
    if lease_pay == 0:
        lease_pay = abs(_amt(cur, "Repayment of lease liabilities"))

    ar = _pres_asset(_amt(cur, "Trade and other receivables (gross)", "Trade receivables"))
    inv = _pres_asset(_amt(cur, "Inventories"))
    ap = _pres_credit_normal(_amt(cur, "Trade and other payables", "Trade payables"))
    ca = _pres_asset(_amt(cur, "Contract assets"))
    dr = _pres_credit_normal(_amt(cur, "Contract liabilities"))
    tax_pay = _pres_credit_normal(_amt(cur, "Income tax payable"))
    cash = _pres_asset(_amt(cur, "Cash and cash equivalents"))
    ppe = _pres_asset(_amt(cur, "Property plant and equipment (gross)", "Property plant and equipment"))
    intang = _pres_asset(_amt(cur, "Other intangible assets", "Intangible assets"))
    borrow = _pres_credit_normal(
        _amt(cur, "Borrowings — current") + _amt(cur, "Borrowings — non-current")
    )
    tax_exp = abs(
        _amt(cur, "Income tax expense — current")
        + _amt(cur, "Income tax expense — deferred")
        + _amt(cur, "Income tax expense")
    )
    dividends = abs(_amt(cur, "Dividends", "Dividends paid"))

    if has_prior:
        ar_p = _pres_asset(_amt(prior, "Trade and other receivables (gross)", "Trade receivables"))
        inv_p = _pres_asset(_amt(prior, "Inventories"))
        ap_p = _pres_credit_normal(_amt(prior, "Trade and other payables", "Trade payables"))
        ca_p = _pres_asset(_amt(prior, "Contract assets"))
        dr_p = _pres_credit_normal(_amt(prior, "Contract liabilities"))
        tax_p = _pres_credit_normal(_amt(prior, "Income tax payable"))
        cash_p = _pres_asset(_amt(prior, "Cash and cash equivalents"))
        ppe_p = _pres_asset(_amt(prior, "Property plant and equipment (gross)", "Property plant and equipment"))
        intang_p = _pres_asset(_amt(prior, "Other intangible assets", "Intangible assets"))
        borrow_p = _pres_credit_normal(
            _amt(prior, "Borrowings — current") + _amt(prior, "Borrowings — non-current")
        )
        ch_ar = ar_p - ar
        ch_inv = inv_p - inv
        ch_ap = ap - ap_p
        ch_ca = ca_p - ca
        ch_dr = dr - dr_p
        tax_paid = -(tax_exp - (tax_pay - tax_p))
        ppe_add = min(Decimal("0.00"), ppe_p - ppe)
        if ppe > ppe_p:
            ppe_add = -(ppe - ppe_p)
            ppe_disp = Decimal("0.00")
        else:
            ppe_add = Decimal("0.00")
            ppe_disp = ppe_p - ppe
        intang_add = -(max(Decimal("0.00"), intang - intang_p))
        borrow_delta = borrow - borrow_p
        proceeds_b = borrow_delta if borrow_delta > 0 else Decimal("0.00")
        repay_b = borrow_delta if borrow_delta < 0 else Decimal("0.00")
        opening_cash = cash_p
    else:
        ch_ar = ch_inv = ch_ap = ch_ca = ch_dr = Decimal("0.00")
        tax_paid = -tax_exp
        ppe_add = Decimal("0.00")
        ppe_disp = Decimal("0.00")
        intang_add = Decimal("0.00")
        proceeds_b = Decimal("0.00")
        repay_b = Decimal("0.00")
        opening_cash = Decimal("0.00")

    profit = profit_for_period if profit_for_period is not None else Decimal("0.00")
    if profit < 0:
        # Credit-normal P&L net profit arrives negative.
        profit = -profit

    dep_total = dep_ppe + (dep_rou if ifrs16_dep == 0 else Decimal("0.00"))
    out: dict[str, Decimal] = {
        "Profit for the period": profit,
        "Adjustments for depreciation": dep_total,
        "Adjustments for amortisation": amort,
        "Adjustments for IFRS 16 depreciation": ifrs16_dep,
        "Adjustments for IFRS 16 interest": ifrs16_int,
        "Adjustments for IFRS 9 impairment": ifrs9_imp,
        "Changes in trade receivables": ch_ar,
        "Changes in inventories": ch_inv,
        "Changes in trade payables": ch_ap,
        "Changes in contract assets": ch_ca,
        "Changes in deferred revenue": ch_dr,
        "Income tax paid": tax_paid,
        "Purchase of property plant equipment": ppe_add,
        "Proceeds from disposal of PPE": ppe_disp,
        "Purchase of intangible assets": intang_add,
        "Proceeds from borrowings": proceeds_b,
        "Repayment of borrowings": repay_b,
        "Repayment of lease liabilities": -abs(lease_pay),
        "Dividends paid": -abs(dividends),
        "Opening cash and cash equivalents": opening_cash,
        "Balance sheet cash and cash equivalents": cash,
    }
    operating = (
        profit
        + dep_total
        + amort
        + ifrs16_dep
        + ifrs16_int
        + ifrs9_imp
        + ch_ar
        + ch_inv
        + ch_ap
        + ch_ca
        + ch_dr
        + tax_paid
    )
    investing = ppe_add + ppe_disp + intang_add
    financing = proceeds_b + repay_b - abs(lease_pay) - abs(dividends)
    net = operating + investing + financing
    closing = opening_cash + net
    recon = cash - closing
    out["NET CASH FROM OPERATING"] = operating
    out["NET CASH FROM INVESTING"] = investing
    out["NET CASH FROM FINANCING"] = financing
    out["Net increase/(decrease) in cash"] = net
    out["NET INCREASE IN CASH"] = net
    out["Closing cash and cash equivalents"] = closing
    out["Cash reconciling difference"] = recon if abs(recon) >= Decimal("1.00") else Decimal("0.00")
    logger.info("IAS 7 cash flow %s profit=%s net=%s closing=%s bs_cash=%s", period, profit, net, closing, cash)
    return out


def generate_equity_statement(
    tb_lines: dict[str, Decimal],
    prior_period_tb_lines: dict[str, Decimal] | None,
    *,
    profit_for_period: Decimal,
    oci_for_period: Decimal,
    has_prior: bool,
    prior_period_end: str | None = None,
) -> dict[str, Decimal]:
    """SOCE — opening from prior TB when available; never hardcode zero as if it were a fact."""
    cur = tb_lines or {}
    prior = prior_period_tb_lines or {}

    sc_c = _pres_credit_normal(_amt(cur, "Share capital"))
    sp_c = _pres_credit_normal(_amt(cur, "Share premium"))
    re_c = _pres_credit_normal(_amt(cur, "Retained earnings"))
    oci_c = _pres_credit_normal(
        _amt(cur, "Other comprehensive income reserve")
        + _amt(cur, "Foreign currency translation reserve")
        + _amt(cur, "Revaluation reserve")
    )
    div = abs(_amt(cur, "Dividends", "Dividends paid"))

    profit = profit_for_period
    if profit < 0:
        profit = -profit
    oci = oci_for_period

    if has_prior:
        sc_o = _pres_credit_normal(_amt(prior, "Share capital"))
        sp_o = _pres_credit_normal(_amt(prior, "Share premium"))
        re_o = _pres_credit_normal(_amt(prior, "Retained earnings"))
        oci_o = _pres_credit_normal(
            _amt(prior, "Other comprehensive income reserve")
            + _amt(prior, "Foreign currency translation reserve")
            + _amt(prior, "Revaluation reserve")
        )
    else:
        # Opening = closing − period movements when prior TB missing (not a silent zero).
        sc_o = sc_c
        sp_o = sp_c
        re_o = re_c - profit + div
        oci_o = oci_c - oci

    re_close = re_o + profit - div
    oci_close = oci_o + oci
    # Prefer BS closing figures when mapped.
    if re_c != 0:
        re_close = re_c
    if oci_c != 0:
        oci_close = oci_c
    if sc_c != 0:
        sc_c_out = sc_c
    else:
        sc_c_out = sc_o
    if sp_c != 0:
        sp_c_out = sp_c
    else:
        sp_c_out = sp_o

    total_open = sc_o + sp_o + re_o + oci_o
    total_close = sc_c_out + sp_c_out + re_close + oci_close
    _ = prior_period_end
    return {
        "Share capital - opening": sc_o,
        "Share capital - closing": sc_c_out,
        "Share premium - opening": sp_o,
        "Share premium - closing": sp_c_out,
        "Retained earnings - opening": re_o,
        "Profit for the period": profit,
        "Dividends": -div,
        "Retained earnings - closing": re_close,
        "OCI reserve - opening": oci_o,
        "OCI for the period": oci,
        "OCI reserve - closing": oci_close,
        "TOTAL EQUITY - opening": total_open,
        "TOTAL EQUITY": total_close,
    }


def inject_ifrs_module_adjustments(
    company_id: str,
    period: str,
    tb_id: str,
    db: Session,
    *,
    apply_ifrs16: bool = True,
    apply_ifrs15: bool = True,
    apply_ifrs9: bool = True,
    workspace_id: str | None = None,
) -> dict[str, Any]:
    """
    Before generating statements, pull IFRS 16/15/9
    calculated balances and inject as adjustment lines
    into trial_balance_lines so statement generator
    picks them up automatically.
    """
    from app.services.ifrs_module_bridge import inject_ifrs_module_adjustments as _inject

    return _inject(
        company_id,
        period,
        tb_id,
        db,
        apply_ifrs16=apply_ifrs16,
        apply_ifrs15=apply_ifrs15,
        apply_ifrs9=apply_ifrs9,
        workspace_id=workspace_id,
    )


def generate_all_statements(
    trial_balance_id: int,
    db: Session,
    *,
    apply_ifrs16: bool = True,
    apply_ifrs15: bool = True,
    apply_ifrs9: bool = True,
    company_id: str | None = None,
    workspace_id: str | None = None,
    prior_trial_balance_id: int | None = None,
) -> dict[str, Any]:
    ensure_prior_tb_column(db)
    tb = db.query(TrialBalance).filter(TrialBalance.id == trial_balance_id).first()
    if not tb:
        raise ValueError("Trial balance not found")
    linked_prior = prior_trial_balance_id or getattr(tb, "prior_trial_balance_id", None)

    ifrs_adj_summary: dict[str, Any] = {
        "applied_count": 0,
        "message": "No IFRS module adjustments applied",
        "adjustments": [],
        "skipped": [],
    }
    try:
        period = str(tb.period_end or tb.period_start or "")
        ifrs_adj_summary = inject_ifrs_module_adjustments(
            company_id or tb.tenant_id,
            period,
            str(trial_balance_id),
            db,
            apply_ifrs16=apply_ifrs16,
            apply_ifrs15=apply_ifrs15,
            apply_ifrs9=apply_ifrs9,
            workspace_id=workspace_id or tb.tenant_id,
        )
    except Exception:
        logger.exception("IFRS module adjustment injection failed for tb=%s", trial_balance_id)

    from app.services.mapping_validator import assert_ready_for_statement_generation

    assert_ready_for_statement_generation(trial_balance_id, db)

    existing_statement_ids = [
        s.id
        for s in db.query(GeneratedStatement.id)
        .filter(GeneratedStatement.trial_balance_id == trial_balance_id)
        .all()
    ]
    if existing_statement_ids:
        existing_line_ids = [
            li.id
            for li in db.query(StatementLineItem.id)
            .filter(StatementLineItem.statement_id.in_(existing_statement_ids))
            .all()
        ]
        if existing_line_ids:
            db.query(StatementLineItem).filter(
                StatementLineItem.id.in_(existing_line_ids)
            ).delete(synchronize_session=False)
        db.query(GeneratedStatement).filter(
            GeneratedStatement.id.in_(existing_statement_ids)
        ).delete(synchronize_session=False)
    db.commit()

    raw_mappings = (
        db.query(GLMapping)
        .filter(GLMapping.trial_balance_id == trial_balance_id)
        .order_by(GLMapping.trial_balance_line_id, GLMapping.id.desc())
        .all()
    )
    # Keep newest mapping per trial-balance line to avoid duplicate rerun inflation.
    seen_line_ids: set[int] = set()
    mappings: list[GLMapping] = []
    for m in raw_mappings:
        if m.trial_balance_line_id in seen_line_ids:
            continue
        seen_line_ids.add(m.trial_balance_line_id)
        mappings.append(m)
    # One mapping per gl_code (newest GLMapping.id wins) — extra safety vs duplicate jobs.
    seen_codes: dict[str, GLMapping] = {}
    for m in sorted(mappings, key=lambda x: -x.id):
        gc = (m.gl_code or "").strip()
        if not gc:
            continue
        if gc not in seen_codes:
            seen_codes[gc] = m
    mappings = list(seen_codes.values())

    tb_lines = db.query(TrialBalanceLine).filter(TrialBalanceLine.trial_balance_id == trial_balance_id).all()

    amounts_by_code = {line.gl_code: float(line.net_amount or 0) for line in tb_lines}

    line_totals: dict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))
    line_mapping_refs: dict[str, list[tuple[int, Decimal, IFRSStatementKind]]] = defaultdict(list)
    for mapping in mappings:
        amount = _to_decimal(amounts_by_code.get(mapping.gl_code, 0.0))
        line_totals[mapping.ifrs_line_item] += amount
        line_mapping_refs[mapping.ifrs_line_item].append(
            (mapping.trial_balance_line_id, amount, mapping.ifrs_statement)
        )

    if settings.DEBUG:
        for mapping in mappings[:5]:
            match = _lookup_line_total(line_totals, mapping.ifrs_line_item)
            logger.debug(
                "IFRS stmt map check GL %s -> %r line_totals match: %s",
                mapping.gl_code,
                mapping.ifrs_line_item,
                match,
            )

    generated: dict[str, list[dict[str, Any]]] = {}
    fp_rollups: dict[str, Decimal] = {}
    prior_totals: dict[str, Decimal] = {}
    has_prior = False
    if linked_prior:
        try:
            prior_totals = _map_tb_to_ifrs_totals(int(linked_prior), db, mappings)
            has_prior = True
        except Exception:
            logger.exception("Prior TB %s could not be rolled into IFRS totals", linked_prior)
            has_prior = False

    cf_amounts: dict[str, Decimal] = {}
    soce_amounts: dict[str, Decimal] = {}
    balance_check: dict[str, Any] = {
        "balanced": False,
        "difference": 0,
        "total_assets": 0,
        "total_liabilities": 0,
        "total_equity": 0,
        "gap_section": None,
    }
    cash_flow_reconciliation: dict[str, Any] = {}

    for stmt_type in (
        "financial_position",
        "profit_loss",
        "other_comprehensive_income",
        "cash_flows",
        "equity",
    ):
        if stmt_type == "cash_flows":
            profit = Decimal("0.00")
            for r in generated.get("profit_loss") or []:
                if r.get("line_item") == "PROFIT FOR THE PERIOD":
                    profit = _to_decimal(r.get("amount") or 0)
                    break
            cf_amounts = generate_cash_flow_statement(
                line_totals,
                prior_totals if has_prior else None,
                list(ifrs_adj_summary.get("adjustments") or []),
                company_id or tb.tenant_id,
                str(tb.period_end or tb.period_start or ""),
                db,
                profit_for_period=profit,
                has_prior=has_prior,
            )
            closing_cf = float(cf_amounts.get("Closing cash and cash equivalents") or 0)
            bs_cash = float(cf_amounts.get("Balance sheet cash and cash equivalents") or 0)
            cash_diff = abs(closing_cf - bs_cash)
            cash_flow_reconciliation = {
                "has_prior_period": has_prior,
                "opening_cash": float(cf_amounts.get("Opening cash and cash equivalents") or 0),
                "net_movement": float(cf_amounts.get("NET INCREASE IN CASH") or 0),
                "closing_cash": closing_cf,
                "balance_sheet_cash": bs_cash,
                "difference": round(cash_diff, 2),
                "ties": cash_diff < 1.0,
                "note": (
                    None
                    if has_prior
                    else "Prior period TB not uploaded — opening balances not available"
                ),
            }
        elif stmt_type == "equity":
            profit = Decimal("0.00")
            oci = Decimal("0.00")
            for r in generated.get("profit_loss") or []:
                if r.get("line_item") == "PROFIT FOR THE PERIOD":
                    profit = _to_decimal(r.get("amount") or 0)
            for r in generated.get("other_comprehensive_income") or []:
                if r.get("line_item") == "TOTAL OTHER COMPREHENSIVE INCOME":
                    oci = _to_decimal(r.get("amount") or 0)
            soce_amounts = generate_equity_statement(
                line_totals,
                prior_totals if has_prior else None,
                profit_for_period=profit,
                oci_for_period=oci,
                has_prior=has_prior,
                prior_period_end=str(tb.period_end or ""),
            )

        stmt = GeneratedStatement(
            tenant_id=tb.tenant_id,
            trial_balance_id=trial_balance_id,
            statement_type=IFRSStatementKind(stmt_type),
            period_start=tb.period_start,
            period_end=tb.period_end,
            currency=tb.currency,
            status="draft",
            generated_by_ai=True,
            reviewed=False,
        )
        db.add(stmt)
        db.flush()

        out_rows: list[dict[str, Any]] = []
        order = 0
        section_rollups: dict[str, Decimal] = {}

        for section, lines in STATEMENT_STRUCTURE[stmt_type].items():
            if not isinstance(lines, list):
                continue
            section_total = Decimal("0.00")
            for line_def in lines:
                name = line_def[0]
                flagged_total = len(line_def) > 2 and bool(line_def[2])
                if flagged_total:
                    amount = section_total
                    if stmt_type == "financial_position" and section in (
                        "Equity",
                        "Non-current Liabilities",
                        "Current Liabilities",
                    ):
                        amount = _pres_credit_normal(section_total)
                    li = _create_line(
                        db,
                        stmt.id,
                        section,
                        name,
                        amount,
                        order,
                        is_subtotal=True,
                        is_total=False,
                        indent_level=0,
                    )
                else:
                    if stmt_type == "cash_flows" and name in cf_amounts:
                        amount = cf_amounts[name]
                    elif stmt_type == "equity" and name in soce_amounts:
                        amount = soce_amounts[name]
                    else:
                        amount = _lookup_line_total(line_totals, name)
                        if amount == 0:
                            amount = _derived_amount(stmt_type, name, line_totals, mappings)
                    section_total += amount
                    li = _create_line(
                        db,
                        stmt.id,
                        section,
                        name,
                        amount,
                        order,
                        indent_level=1,
                    )
                    refs = _mapping_refs_lookup(line_mapping_refs, name)
                    for trial_balance_line_id, contribution, mapped_stmt in refs:
                        if mapped_stmt != IFRSStatementKind(stmt_type):
                            continue
                        db.add(
                            IFRSLink(
                                trial_balance_line_id=trial_balance_line_id,
                                statement_line_item_id=li.id,
                                statement_type=stmt_type,
                                amount_contribution=contribution,
                            )
                        )

                out_rows.append(
                    {
                        "section": section,
                        "line_item": name,
                        "amount": float(amount),
                        "is_subtotal": li.is_subtotal,
                        "is_total": li.is_total,
                        "indent_level": li.indent_level,
                    }
                )
                order += 1

            if stmt_type == "financial_position":
                fp_rollups[section] = section_total
            section_rollups[section] = section_total

        if stmt_type == "financial_position":
            total_assets = fp_rollups.get("Current Assets", Decimal("0.00")) + fp_rollups.get(
                "Non-current Assets", Decimal("0.00")
            )
            raw_liab = fp_rollups.get("Current Liabilities", Decimal("0.00")) + fp_rollups.get(
                "Non-current Liabilities", Decimal("0.00")
            )
            raw_equity = fp_rollups.get("Equity", Decimal("0.00"))
            # Presentation: credit-normal liability/equity nets are negative — flip for IAS 1 totals only.
            total_liabilities = _pres_credit_normal(raw_liab)
            total_equity = _pres_credit_normal(raw_equity)
            tle = total_liabilities + total_equity
            balance_check = check_balance(
                {
                    "total_assets": float(total_assets),
                    "total_liabilities": float(total_liabilities),
                    "total_equity": float(total_equity),
                }
            )

            fp_total_lookup = {
                "TOTAL ASSETS": total_assets,
                "TOTAL LIABILITIES": total_liabilities,
                "TOTAL LIABILITIES AND EQUITY": tle,
            }
            for total_name, amount in fp_total_lookup.items():
                li = _create_line(
                    db,
                    stmt.id,
                    "TOTALS",
                    total_name,
                    amount,
                    order,
                    is_total=True,
                    indent_level=0,
                )
                out_rows.append(
                    {
                        "section": "TOTALS",
                        "line_item": total_name,
                        "amount": float(amount),
                        "is_subtotal": li.is_subtotal,
                        "is_total": li.is_total,
                        "indent_level": li.indent_level,
                    }
                )
                order += 1
        elif stmt_type == "cash_flows":
            net_cash = cf_amounts.get("NET INCREASE IN CASH") or (
                section_rollups.get("Operating Activities", Decimal("0.00"))
                + section_rollups.get("Investing Activities", Decimal("0.00"))
                + section_rollups.get("Financing Activities", Decimal("0.00"))
            )
            # Keep cash flow total in section rollups so structured total rows can reuse it.
            section_rollups["NET INCREASE IN CASH"] = net_cash
            li = _create_line(
                db,
                stmt.id,
                "TOTALS",
                "NET INCREASE IN CASH",
                net_cash,
                order,
                is_total=True,
                indent_level=0,
            )
            out_rows.append(
                {
                    "section": "TOTALS",
                    "line_item": "NET INCREASE IN CASH",
                    "amount": float(net_cash),
                    "is_subtotal": li.is_subtotal,
                    "is_total": li.is_total,
                    "indent_level": li.indent_level,
                }
            )

        generated[stmt_type] = out_rows
        db.commit()

    from app.services.board_pack_seed import seed_commentary_and_risks_for_trial_balance

    tb_row = db.query(TrialBalance).filter(TrialBalance.id == trial_balance_id).first()
    if tb_row:
        tb_data_seed = build_tb_data_from_db(trial_balance_id, db)
        pl_stmt = (
            db.query(GeneratedStatement)
            .filter(
                GeneratedStatement.trial_balance_id == trial_balance_id,
                GeneratedStatement.statement_type == IFRSStatementKind.profit_loss,
            )
            .first()
        )
        fp_stmt = (
            db.query(GeneratedStatement)
            .filter(
                GeneratedStatement.trial_balance_id == trial_balance_id,
                GeneratedStatement.statement_type == IFRSStatementKind.financial_position,
            )
            .first()
        )
        pl_lines_seed: list[StatementLineItem] = []
        fp_lines_seed: list[StatementLineItem] = []
        if pl_stmt:
            pl_lines_seed = (
                db.query(StatementLineItem)
                .filter(StatementLineItem.statement_id == pl_stmt.id)
                .order_by(StatementLineItem.display_order)
                .all()
            )
        if fp_stmt:
            fp_lines_seed = (
                db.query(StatementLineItem)
                .filter(StatementLineItem.statement_id == fp_stmt.id)
                .order_by(StatementLineItem.display_order)
                .all()
            )
        ai_commentary = None
        try:
            from app.services.commentary_generator import try_generate_commentary_from_statements_only

            ai_commentary = try_generate_commentary_from_statements_only(
                company_name=tb_row.company_name,
                period_label=str(tb_row.period_end or tb_data_seed.get("period_end") or ""),
                currency=tb_row.currency or "USD",
                pl_lines=pl_lines_seed,
                fp_lines=fp_lines_seed,
                tb_headlines=tb_data_seed,
            )
        except Exception:
            ai_commentary = None

        seed_commentary_and_risks_for_trial_balance(
            db,
            trial_balance_id,
            tb_row.tenant_id,
            tb_data_seed,
            pl_lines_seed,
            fp_lines_seed,
            commentary_texts=ai_commentary,
        )

    soce_close = float(soce_amounts.get("TOTAL EQUITY") or 0)
    fp_equity = float(balance_check.get("total_equity") or 0)
    soce_check = {
        "closing_equity": soce_close,
        "balance_sheet_equity": fp_equity,
        "difference": round(abs(soce_close - fp_equity), 2),
        "ties": abs(soce_close - fp_equity) < 1.0,
        "has_prior_period": has_prior,
        "opening_note": (
            None
            if has_prior
            else "Opening as per prior TB — not uploaded"
        ),
    }

    return {
        "trial_balance_id": trial_balance_id,
        "statements": generated,
        "generated_at": datetime.utcnow().isoformat(),
        "ifrs_module_adjustments": ifrs_adj_summary,
        "balance_check": balance_check,
        "cash_flow_reconciliation": cash_flow_reconciliation,
        "soce_check": soce_check,
        "prior_trial_balance_id": int(linked_prior) if linked_prior else None,
    }


def build_tb_data_from_db(
    trial_balance_id: int,
    db: Session,
    *,
    prior_trial_balance_id: int | None = None,
    manual_prior: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Build tb_data for disclosure_generator / compliance_checker from TB lines
    and latest GL mappings per line.

    Optional ``prior_trial_balance_id`` merges prior-year metrics with a ``prior_`` prefix
    for IAS 1 comparative disclosure prompts (additive; does not change statement DB rows).
    ``manual_prior`` supplies Option C key totals when no prior TB exists.
    """
    tb = db.query(TrialBalance).filter(TrialBalance.id == trial_balance_id).first()
    if not tb:
        raise ValueError("Trial balance not found")

    if prior_trial_balance_id is None:
        prior_trial_balance_id = getattr(tb, "prior_trial_balance_id", None)

    lines = (
        db.query(TrialBalanceLine)
        .filter(TrialBalanceLine.trial_balance_id == trial_balance_id)
        .all()
    )
    raw_mappings = (
        db.query(GLMapping)
        .filter(GLMapping.trial_balance_id == trial_balance_id)
        .order_by(GLMapping.trial_balance_line_id, GLMapping.id.desc())
        .all()
    )
    seen_line_ids: set[int] = set()
    mappings: list[GLMapping] = []
    for m in raw_mappings:
        if m.trial_balance_line_id in seen_line_ids:
            continue
        seen_line_ids.add(m.trial_balance_line_id)
        mappings.append(m)

    amounts_by_code = {line.gl_code: float(line.net_amount or 0) for line in lines}
    amounts: dict[str, float] = {}
    ecl_from_mapping = 0.0
    ecl_keys = (
        "loss allowance",
        "ecl provision",
        "allowance for doubtful",
        "expected credit loss",
    )
    for m in mappings:
        amt = amounts_by_code.get(m.gl_code, 0.0)
        key = m.ifrs_line_item
        amounts[key] = amounts.get(key, 0.0) + amt
        low = key.lower()
        if any(k in low for k in ecl_keys):
            ecl_from_mapping += abs(amt)

    def get(key: str, default: float = 0.0) -> float:
        return float(amounts.get(key, default))

    trade_rec = get("Trade and other receivables (gross)") + get("Trade receivables")
    loss_allowance = abs(get("Loss allowance on receivables"))
    default_ecl = trade_rec * 0.03 if trade_rec else 0.0
    ecl_provision = ecl_from_mapping if ecl_from_mapping > 0 else (loss_allowance if loss_allowance else default_ecl)

    def fp_section_sum(section: str) -> float:
        block = STATEMENT_STRUCTURE["financial_position"].get(section)
        if not isinstance(block, list):
            return 0.0
        s = 0.0
        for line_def in block:
            if len(line_def) > 2 and line_def[2]:
                continue
            s += get(line_def[0])
        return s

    ca = fp_section_sum("Current Assets")
    nca = fp_section_sum("Non-current Assets")
    cl = fp_section_sum("Current Liabilities")
    ncl = fp_section_sum("Non-current Liabilities")
    eq = fp_section_sum("Equity")

    out: dict[str, Any] = {
        "company_name": tb.company_name,
        "period_end": str(tb.period_end) if tb.period_end else "",
        "period_start": str(tb.period_start) if tb.period_start else "",
        "currency": tb.currency or "USD",
        "cash": get("Cash and cash equivalents"),
        "trade_receivables": trade_rec,
        "has_inventory": get("Inventories") > 0,
        "ppe_cost": get("Property plant and equipment (gross)") + get("Property plant and equipment"),
        "ppe_accumulated_depreciation": 0.0,
        "ppe_additions": 0.0,
        "ppe_disposals": 0.0,
        "dep_on_disposals": 0.0,
        "rou_asset": get("Right-of-use assets"),
        "total_assets": ca + nca,
        "total_liabilities": cl + ncl,
        "total_equity": eq,
        "short_term_borrowings": get("Borrowings — current") + get("Short-term borrowings"),
        "long_term_borrowings": get("Borrowings — non-current") + get("Long-term borrowings"),
        "total_borrowings": get("Borrowings — current")
        + get("Borrowings — non-current")
        + get("Short-term borrowings")
        + get("Long-term borrowings"),
        "has_borrowings": (
            get("Borrowings — current")
            + get("Borrowings — non-current")
            + get("Short-term borrowings")
            + get("Long-term borrowings")
        )
        > 0,
        "has_leases": get("Right-of-use assets") > 0
        or (
            get("Lease liabilities — current")
            + get("Lease liabilities — non-current")
            + get("Lease liabilities")
        )
        > 0,
        "lease_liability_current": get("Lease liabilities — current") + get("Current portion of lease liabilities"),
        "lease_liability_non_current": get("Lease liabilities — non-current") + get("Lease liabilities"),
        "revenue": get("Revenue from contracts with customers"),
        "other_income": get("Other income"),
        "depreciation_charge": get("Depreciation — PPE")
        + get("Depreciation — right-of-use assets")
        + get("Amortisation of intangibles")
        + get("Depreciation and amortisation"),
        "interest_expense": get("Finance costs — interest on loans")
        + get("Finance costs — interest on leases")
        + get("Foreign exchange loss")
        + get("Finance costs"),
        "profit_before_tax": get("PROFIT BEFORE TAX"),
        "income_tax_expense": get("Income tax expense — current")
        + get("Income tax expense — deferred")
        + get("Income tax expense"),
        "deferred_tax_liability": get("Deferred tax liabilities") - get("Deferred tax assets"),
        "deferred_tax_charge": 0.0,
        "has_current_assets": ca > 0,
        "has_non_current_assets": nca > 0,
        "has_current_liabilities": cl > 0,
        "has_non_current_liabilities": ncl > 0,
        "has_comparative": False,
        "tax_rate": 25,
        "ecl_provision": ecl_provision,
        "rou_depreciation": get("Depreciation — right-of-use assets")
        or (get("Depreciation — PPE") + get("Depreciation — right-of-use assets") + get("Amortisation of intangibles"))
        * 0.4,
        "lease_interest": get("Finance costs — interest on leases")
        or (
            get("Finance costs — interest on loans")
            + get("Finance costs — interest on leases")
            + get("Foreign exchange loss")
        )
        * 0.3,
        "has_investments": get("Other financial assets") > 0
        or get("Investments in associates") > 0
        or get("Contract assets") > 0
        or get("Other current assets") > 0
        or trade_rec > 0,
        "revenue_types": ["goods/services"],
        "related_parties": [],
        "director_remuneration": 0.0,
        "legal_proceedings": [],
        "capital_commitments": 0.0,
        "subsequent_events": [],
        "approval_date": str(tb.period_end) if tb.period_end else "[DATE]",
        "avg_interest_rate": 5.5,
    }

    if prior_trial_balance_id and prior_trial_balance_id != trial_balance_id:
        try:
            prior_d = build_tb_data_from_db(
                prior_trial_balance_id,
                db,
                prior_trial_balance_id=None,
                manual_prior=None,
            )
            for k, v in prior_d.items():
                if k in ("trial_balance_id", "statements", "generated_at"):
                    continue
                nk = k if str(k).startswith("prior_") else f"prior_{k}"
                out[nk] = v
            out["prior_period_end"] = prior_d.get("period_end")
            out["has_comparative"] = True
        except Exception:
            pass

    if manual_prior:
        for k, v in manual_prior.items():
            key = k if str(k).startswith("prior_") else f"prior_{k}"
            if isinstance(v, (int, float)):
                out[key] = float(v)
            else:
                out[key] = v
        out["has_comparative"] = True

    try:
        from app.services.ifrs_module_bridge import enrich_tb_data_from_ifrs_modules

        out = enrich_tb_data_from_ifrs_modules(out, db, trial_balance_id)
    except Exception:
        logger.exception("IFRS module note enrichment failed for tb=%s", trial_balance_id)

    return out
