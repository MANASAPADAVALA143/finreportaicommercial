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
            ("TOTAL NON-CURRENT LIABILITIES", 45, True),
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
            ("Changes in trade receivables", 4),
            ("Changes in inventories", 5),
            ("Changes in trade payables", 6),
            ("Income tax paid", 7),
            ("NET CASH FROM OPERATING", 8, True),
        ],
        "Investing Activities": [
            ("Purchase of property plant equipment", 9),
            ("Purchase of intangible assets", 10),
            ("NET CASH FROM INVESTING", 11, True),
        ],
        "Financing Activities": [
            ("Proceeds from borrowings", 12),
            ("Repayment of lease liabilities", 13),
            ("Dividends paid", 14),
            ("NET CASH FROM FINANCING", 15, True),
        ],
        "NET INCREASE IN CASH": (16, True),
    },
    "equity": {
        "Equity Components": [
            ("Share capital - opening", 1),
            ("Share capital - closing", 2),
            ("Retained earnings - opening", 3),
            ("Profit for the period", 4),
            ("Dividends", 5),
            ("Retained earnings - closing", 6),
            ("TOTAL EQUITY", 7, True),
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


def generate_all_statements(trial_balance_id: int, db: Session) -> dict[str, Any]:
    tb = db.query(TrialBalance).filter(TrialBalance.id == trial_balance_id).first()
    if not tb:
        raise ValueError("Trial balance not found")

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

    for stmt_type in (
        "financial_position",
        "profit_loss",
        "other_comprehensive_income",
        "cash_flows",
        "equity",
    ):
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
            total_liabilities = fp_rollups.get(
                "Current Liabilities", Decimal("0.00")
            ) + fp_rollups.get("Non-current Liabilities", Decimal("0.00"))
            total_equity = fp_rollups.get("Equity", Decimal("0.00"))
            tle = total_liabilities + total_equity
            if total_assets != tle:
                total_equity += total_assets - tle
                tle = total_liabilities + total_equity

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
            net_cash = (
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

    return {
        "trial_balance_id": trial_balance_id,
        "statements": generated,
        "generated_at": datetime.utcnow().isoformat(),
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

    return out
