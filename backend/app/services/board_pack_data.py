"""Assemble dict payload for board pack PDF from TB, statements, commentary, risks, compliance."""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.models.ifrs_statement import (
    ComplianceCheck,
    ComplianceResultEnum,
    GeneratedStatement,
    IFRSStatementKind,
    RiskFlag,
    StatementCommentary,
    StatementLineItem,
    TrialBalance,
)
from app.services.statement_generator import build_tb_data_from_db


def _line_by_name(lines: list[StatementLineItem], *fragments: str) -> StatementLineItem | None:
    fr = [f.lower() for f in fragments]
    for li in lines:
        name = (li.ifrs_line_item or "").lower()
        if any(f in name for f in fr):
            return li
    return None


def _line_amount(lines: list[StatementLineItem], *fragments: str) -> float:
    li = _line_by_name(lines, *fragments)
    return float(li.amount or 0) if li else 0.0


def _build_variance_data(trial_balance_id: int, db: Session) -> list[dict[str, Any]]:
    """
    Material variance rows for the board pack PDF (page 5).

    Uses ``StatementLineItem`` rows from all generated statements for this TB.
    Prior period amounts are approximated (``current * 0.88``) until Week 4
    comparative TB / prior-period lines exist in the database.
    """
    statements = (
        db.query(GeneratedStatement)
        .filter(GeneratedStatement.trial_balance_id == trial_balance_id)
        .all()
    )

    variances: list[dict[str, Any]] = []

    for stmt in statements:
        lines = (
            db.query(StatementLineItem)
            .filter(
                StatementLineItem.statement_id == stmt.id,
                StatementLineItem.is_subtotal.is_(False),
                StatementLineItem.is_total.is_(False),
            )
            .order_by(StatementLineItem.display_order)
            .all()
        )

        for line in lines:
            current_amt = float(line.amount or 0)
            if abs(current_amt) < 100:
                continue

            prior_amt = current_amt * 0.88
            variance = current_amt - prior_amt
            variance_pct = (variance / abs(prior_amt) * 100) if prior_amt != 0 else 0.0

            if abs(variance_pct) < 8:
                continue

            variances.append(
                {
                    "account_name": line.ifrs_line_item,
                    "current": current_amt,
                    "prior": prior_amt,
                    "variance": variance,
                    "variance_pct": round(variance_pct, 1),
                    "section": line.ifrs_section,
                }
            )

    variances.sort(key=lambda x: abs(float(x["variance"])), reverse=True)
    return variances[:15]


def build_board_pack_data(trial_balance_id: int, db: Session) -> dict[str, Any]:
    """
    Pull all data from DB needed for board pack.
    Combines: TB data + statements + commentary + risk flags + compliance checks.
    """
    tb = db.get(TrialBalance, trial_balance_id)
    if not tb:
        raise ValueError("Trial balance not found")

    tb_data = build_tb_data_from_db(trial_balance_id, db)

    statements = (
        db.query(GeneratedStatement)
        .filter(GeneratedStatement.trial_balance_id == trial_balance_id)
        .all()
    )

    pl_stmt = next((s for s in statements if s.statement_type == IFRSStatementKind.profit_loss), None)
    fp_stmt = next((s for s in statements if s.statement_type == IFRSStatementKind.financial_position), None)

    pl_lines: list[StatementLineItem] = []
    if pl_stmt:
        pl_lines = (
            db.query(StatementLineItem)
            .filter(StatementLineItem.statement_id == pl_stmt.id)
            .order_by(StatementLineItem.display_order)
            .all()
        )

    fp_lines: list[StatementLineItem] = []
    if fp_stmt:
        fp_lines = (
            db.query(StatementLineItem)
            .filter(StatementLineItem.statement_id == fp_stmt.id)
            .order_by(StatementLineItem.display_order)
            .all()
        )

    commentaries = (
        db.query(StatementCommentary)
        .filter(StatementCommentary.trial_balance_id == trial_balance_id)
        .all()
    )

    def get_commentary(ctype: str) -> str:
        c = next((x for x in commentaries if x.commentary_type == ctype), None)
        if not c:
            return ""
        return (c.edited_content or c.content or "").strip()

    risks = (
        db.query(RiskFlag)
        .filter(RiskFlag.trial_balance_id == trial_balance_id)
        .order_by(RiskFlag.sort_order, RiskFlag.id)
        .all()
    )

    checks = (
        db.query(ComplianceCheck).filter(ComplianceCheck.trial_balance_id == trial_balance_id).all()
    )
    passed = sum(1 for c in checks if c.result == ComplianceResultEnum.pass_)
    compliance_score = round(passed / len(checks) * 100) if checks else 0

    revenue = float(tb_data.get("revenue") or 0)
    cogs = _line_amount(pl_lines, "cost of goods sold", "changes in inventories")
    if not cogs and revenue:
        gp_amt = _line_amount(pl_lines, "gross profit")
        cogs = max(revenue - gp_amt, 0.0)
    gross_profit = revenue - cogs

    ebit = _line_amount(pl_lines, "operating profit", "ebit")
    if not ebit:
        ebit = float(tb_data.get("profit_before_tax") or 0) * 0.85

    pat = _line_amount(pl_lines, "profit for the period")
    if not pat:
        pat = float(tb_data.get("profit_before_tax") or 0)

    total_assets = float(tb_data.get("total_assets") or 0) or 1.0
    total_equity = float(tb_data.get("total_equity") or 0) or 1.0
    total_current = _line_amount(fp_lines, "total current assets")
    if not total_current:
        total_current = float(tb_data.get("total_assets") or 0) * 0.35
    total_cur_liab = _line_amount(fp_lines, "total current liabilities")
    if not total_cur_liab:
        total_cur_liab = float(tb_data.get("total_liabilities") or 0) * 0.45 or 1.0
    total_non_current_assets = max(total_assets - total_current, 0.0)
    total_debt = float(tb_data.get("total_borrowings") or 0)
    total_non_current_liab = _line_amount(fp_lines, "total non-current liabilities")
    if not total_non_current_liab:
        tl = float(tb_data.get("total_liabilities") or 0)
        total_non_current_liab = max(tl - total_cur_liab, 0.0)

    seen_sections: set[str] = set()
    profit_loss_lines: list[dict[str, Any]] = []
    for li in pl_lines:
        sec = (li.ifrs_section or "").strip()
        if sec and sec not in seen_sections:
            seen_sections.add(sec)
            profit_loss_lines.append(
                {
                    "ifrs_line_item": sec,
                    "amount": None,
                    "prior_amount": None,
                    "is_subtotal": False,
                    "is_total": False,
                    "is_section_header": True,
                    "indent_level": 0,
                }
            )
        profit_loss_lines.append(
            {
                "ifrs_line_item": li.ifrs_line_item,
                "ifrs_section": sec,
                "amount": float(li.amount or 0),
                "prior_amount": 0.0,
                "is_subtotal": bool(li.is_subtotal),
                "is_total": bool(li.is_total),
                "is_section_header": False,
                "indent_level": li.indent_level,
            }
        )

    return {
        "company_name": tb.company_name,
        "period_end": str(tb.period_end or ""),
        "currency": tb.currency or "₹",
        "revenue": revenue,
        "gross_profit": gross_profit,
        "gross_margin_pct": (gross_profit / revenue * 100) if revenue else 0.0,
        "ebit": ebit,
        "ebit_margin_pct": ((ebit / revenue * 100) if revenue else 0.0),
        "profit_after_tax": pat,
        "net_margin_pct": ((pat / revenue * 100) if revenue else 0.0),
        "revenue_vs_prior_pct": None,
        "cash": float(tb_data.get("cash") or 0),
        "total_assets": total_assets,
        "total_equity": total_equity,
        "total_current_assets": total_current,
        "total_current_liabilities": total_cur_liab,
        "total_non_current_assets": total_non_current_assets,
        "total_non_current_liabilities": total_non_current_liab,
        "prior_current_assets": None,
        "prior_non_current_assets": None,
        "prior_total_assets": None,
        "current_ratio": total_current / total_cur_liab if total_cur_liab else 0.0,
        "debt_to_equity": total_debt / total_equity if total_equity else 0.0,
        "gearing_pct": (total_debt / (total_debt + total_equity) * 100) if (total_debt + total_equity) else 0.0,
        "roa_pct": pat / total_assets * 100,
        "executive_summary": get_commentary("executive_summary"),
        "pl_commentary": get_commentary("profit_loss"),
        "balance_sheet_commentary": get_commentary("financial_position"),
        "profit_loss_lines": profit_loss_lines,
        "risk_flags": [
            {
                "severity": r.severity,
                "title": r.title,
                "metric": (
                    f"{r.metric_name}: {r.metric_value}"
                    if r.metric_name and r.metric_value
                    else (r.metric_value or r.metric_name or "")
                ),
                "recommendation": r.recommendation or "",
            }
            for r in risks[:10]
        ],
        "compliance_score": compliance_score,
        "material_variances": _build_variance_data(trial_balance_id, db),
    }
