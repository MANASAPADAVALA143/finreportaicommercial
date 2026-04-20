"""Seed statement commentary + risk flags after IFRS statements are generated (board pack prerequisites)."""
from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy.orm import Session

from app.models.ifrs_statement import RiskFlag, StatementCommentary

if TYPE_CHECKING:
    from app.models.ifrs_statement import TrialBalance


def _line_amount(lines: list, *needles: str) -> float:
    nlow = [n.lower() for n in needles]
    for li in lines:
        name = (li.ifrs_line_item or "").lower()
        if any(n in name for n in nlow):
            return float(li.amount or 0)
    return 0.0


def _commentary_strings(
    tb_data: dict,
    pl_lines: list,
    fp_lines: list,
    *,
    commentary_texts: dict[str, str] | None = None,
) -> dict[str, str]:
    company = tb_data.get("company_name") or "Company"
    period = tb_data.get("period_end") or ""
    rev = float(tb_data.get("revenue") or 0)
    pat = _line_amount(pl_lines, "profit for the period")
    if not pat:
        pat = float(tb_data.get("profit_before_tax") or 0)
    cash = float(tb_data.get("cash") or 0)
    ta = float(tb_data.get("total_assets") or 0) or 1.0
    tcl = _line_amount(fp_lines, "total current liabilities")
    tca = _line_amount(fp_lines, "total current assets")
    if not tca:
        tca = float(tb_data.get("total_assets", 0) or 0) * 0.4
    cur_ratio = (tca / tcl) if tcl else 0.0
    debt = float(tb_data.get("total_borrowings") or 0)
    eq = float(tb_data.get("total_equity") or 0) or 1.0
    gearing = (debt / (debt + eq) * 100) if (debt + eq) else 0.0

    exec_txt = (
        f"{company} — period ended {period}. "
        f"Revenue is {rev:,.0f} {tb_data.get('currency', '')} with profit for the period of {pat:,.0f}. "
        f"Cash and cash equivalents stand at {cash:,.0f}. "
        f"Current ratio is {cur_ratio:.2f}x and gearing is {gearing:.1f}%."
    )
    pl_txt = (
        f"P&L snapshot: revenue {rev:,.0f}, profit for the period {pat:,.0f}. "
        "Review margin drivers and operating leverage using the published IFRS statement lines."
    )
    bs_txt = (
        f"Balance sheet: total assets {ta:,.0f}, borrowings {debt:,.0f}, equity {eq:,.0f}. "
        f"Current ratio {cur_ratio:.2f}x. "
        "See financial position statement for full IFRS line items."
    )
    if commentary_texts:
        exec_txt = commentary_texts.get("executive_summary") or exec_txt
        pl_txt = commentary_texts.get("profit_loss") or pl_txt
        bs_txt = commentary_texts.get("financial_position") or bs_txt
    return {
        "executive_summary": exec_txt,
        "profit_loss": pl_txt,
        "financial_position": bs_txt,
    }


def _risk_tuples_from_data(tb_data: dict, pl_lines: list, fp_lines: list) -> list[tuple[str, str, str | None, str | None, str]]:
    rev = float(tb_data.get("revenue") or 0)
    tcl = _line_amount(fp_lines, "total current liabilities")
    tca = _line_amount(fp_lines, "total current assets")
    if not tca:
        tca = float(tb_data.get("total_assets", 0) or 0) * 0.4
    cur_ratio = (tca / tcl) if tcl else 0.0
    debt = float(tb_data.get("total_borrowings") or 0)
    eq = float(tb_data.get("total_equity") or 0) or 1.0
    gearing = (debt / (debt + eq) * 100) if (debt + eq) else 0.0
    risks: list[tuple[str, str, str | None, str | None, str]] = []

    if cur_ratio < 1.0:
        risks.append(
            (
                "red",
                "Liquidity pressure",
                "Current ratio",
                f"{cur_ratio:.2f}x",
                "Accelerate working capital improvements and review short-term funding.",
            )
        )
    elif cur_ratio < 1.5:
        risks.append(
            (
                "amber",
                "Working capital watch",
                "Current ratio",
                f"{cur_ratio:.2f}x",
                "Target >1.5x through receivable/payable cycle management.",
            )
        )
    else:
        risks.append(
            (
                "green",
                "Liquidity cushion",
                "Current ratio",
                f"{cur_ratio:.2f}x",
                "Maintain collections discipline.",
            )
        )

    if gearing > 50:
        risks.append(
            (
                "red",
                "High leverage",
                "Gearing",
                f"{gearing:.1f}%",
                "Stress-test covenants and debt service coverage.",
            )
        )
    elif gearing > 35:
        risks.append(
            (
                "amber",
                "Moderate leverage",
                "Gearing",
                f"{gearing:.1f}%",
                "Monitor refinancing and interest rate exposure.",
            )
        )
    else:
        risks.append(
            (
                "green",
                "Conservative leverage",
                "Gearing",
                f"{gearing:.1f}%",
                "Headroom for strategic investment if returns clear hurdle rate.",
            )
        )

    rec = float(tb_data.get("trade_receivables") or 0)
    if rev > 0 and rec > 0:
        days = int((rec / rev) * 365)
        sev = "amber" if days > 60 else "green"
        risks.append(
            (
                sev,
                "Debtor days",
                "Implied days",
                f"{days} days",
                "Tighten credit control if trending above sector norms.",
            )
        )
    return risks


def seed_commentary_only(
    db: Session,
    trial_balance_id: int,
    tenant_id: str,
    tb_data: dict,
    pl_lines: list,
    fp_lines: list,
    *,
    use_llm: bool = True,
    trial_balance: "TrialBalance | None" = None,
) -> dict[str, str]:
    """
    Replace only ``StatementCommentary`` rows (API: generate-commentary).
    Optionally merges a separate Claude call (validated statement context only).
    """
    db.query(StatementCommentary).filter(
        StatementCommentary.trial_balance_id == trial_balance_id,
        StatementCommentary.tenant_id == tenant_id,
    ).delete(synchronize_session=False)
    db.flush()

    texts = _commentary_strings(tb_data, pl_lines, fp_lines, commentary_texts=None)
    if use_llm:
        try:
            from app.services.commentary_generator import try_generate_commentary_from_statements_only

            tb_row = trial_balance
            company = (tb_row.company_name if tb_row else None) or tb_data.get("company_name") or "Company"
            period = str((tb_row.period_end if tb_row else None) or tb_data.get("period_end") or "")
            cur = (tb_row.currency if tb_row else None) or tb_data.get("currency") or "USD"
            ai = try_generate_commentary_from_statements_only(
                company_name=company,
                period_label=period,
                currency=cur,
                pl_lines=pl_lines,
                fp_lines=fp_lines,
                tb_headlines=tb_data,
            )
            if ai:
                texts["executive_summary"] = ai.get("executive_summary") or texts["executive_summary"]
                texts["profit_loss"] = ai.get("profit_loss") or texts["profit_loss"]
                texts["financial_position"] = ai.get("financial_position") or texts["financial_position"]
        except Exception:
            pass

    now = datetime.utcnow()
    for ctype, text in (
        ("executive_summary", texts["executive_summary"]),
        ("profit_loss", texts["profit_loss"]),
        ("financial_position", texts["financial_position"]),
    ):
        db.add(
            StatementCommentary(
                tenant_id=tenant_id,
                trial_balance_id=trial_balance_id,
                commentary_type=ctype,
                content=text,
                edited_content=None,
                created_at=now,
                updated_at=now,
            )
        )
    db.commit()
    return texts


def seed_risks_only(
    db: Session,
    trial_balance_id: int,
    tenant_id: str,
    tb_data: dict,
    pl_lines: list,
    fp_lines: list,
) -> int:
    """Replace only ``RiskFlag`` rows (API: detect-risks). Returns count inserted."""
    db.query(RiskFlag).filter(
        RiskFlag.trial_balance_id == trial_balance_id,
        RiskFlag.tenant_id == tenant_id,
    ).delete(synchronize_session=False)
    db.flush()

    risks = _risk_tuples_from_data(tb_data, pl_lines, fp_lines)
    now = datetime.utcnow()
    for order, (sev, title, mname, mval, recmd) in enumerate(risks):
        db.add(
            RiskFlag(
                tenant_id=tenant_id,
                trial_balance_id=trial_balance_id,
                severity=sev,
                title=title,
                metric_name=mname,
                metric_value=mval,
                recommendation=recmd,
                sort_order=order,
                created_at=now,
            )
        )
    db.commit()
    return len(risks)


def seed_commentary_and_risks_for_trial_balance(
    db: Session,
    trial_balance_id: int,
    tenant_id: str,
    tb_data: dict,
    pl_lines: list,
    fp_lines: list,
    *,
    commentary_texts: dict[str, str] | None = None,
) -> None:
    """Replace commentary + risk rows for this TB with deterministic summaries from statements.

    When ``commentary_texts`` is set (e.g. from ``commentary_generator``), those strings
    override the default templates for the three commentary types.
    """
    db.query(StatementCommentary).filter(
        StatementCommentary.trial_balance_id == trial_balance_id,
        StatementCommentary.tenant_id == tenant_id,
    ).delete(synchronize_session=False)
    db.query(RiskFlag).filter(
        RiskFlag.trial_balance_id == trial_balance_id,
        RiskFlag.tenant_id == tenant_id,
    ).delete(synchronize_session=False)
    db.flush()

    texts = _commentary_strings(tb_data, pl_lines, fp_lines, commentary_texts=commentary_texts)
    now = datetime.utcnow()
    for ctype, text in (
        ("executive_summary", texts["executive_summary"]),
        ("profit_loss", texts["profit_loss"]),
        ("financial_position", texts["financial_position"]),
    ):
        db.add(
            StatementCommentary(
                tenant_id=tenant_id,
                trial_balance_id=trial_balance_id,
                commentary_type=ctype,
                content=text,
                edited_content=None,
                created_at=now,
                updated_at=now,
            )
        )

    risks = _risk_tuples_from_data(tb_data, pl_lines, fp_lines)
    for order, (sev, title, mname, mval, recmd) in enumerate(risks):
        db.add(
            RiskFlag(
                tenant_id=tenant_id,
                trial_balance_id=trial_balance_id,
                severity=sev,
                title=title,
                metric_name=mname,
                metric_value=mval,
                recommendation=recmd,
                sort_order=order,
                created_at=now,
            )
        )

    db.commit()
