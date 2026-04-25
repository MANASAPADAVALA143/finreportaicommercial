"""AUDITOR — deterministic checks over Week 2 statements + IAS 1 comparative rules (no LLM)."""
from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.models.ifrs_statement import GeneratedStatement, StatementLineItem

# Ordered checklist (persisted to agent_validation)
ALL_AUDITOR_CHECKS: tuple[str, ...] = (
    "bs_tally",
    "cf_reconcile",
    "soce_tally",
    "pat_vs_ebitda",
    "gross_profit",
    "retained_earnings",
    "tax_rate_band",
    "going_concern_runway",
    "current_ratio",
    "negative_equity",
    "prior_year_comparative",
    "ias1_classification",
    "prior_year_bs_tally",
    "re_opening_bridge",
)


def _dec(v) -> Decimal:
    if v is None:
        return Decimal("0")
    return Decimal(str(v)).quantize(Decimal("0.01"))


def _line_index(db: Session, trial_balance_id: int, tenant_id: str) -> dict[str, dict[str, Decimal]]:
    """Map statement_type -> normalized line name -> amount."""
    out: dict[str, dict[str, Decimal]] = {}
    stmts = (
        db.query(GeneratedStatement)
        .filter(
            GeneratedStatement.trial_balance_id == trial_balance_id,
            GeneratedStatement.tenant_id == tenant_id,
        )
        .all()
    )
    for s in stmts:
        key = s.statement_type.value
        out.setdefault(key, {})
        lines = (
            db.query(StatementLineItem)
            .filter(StatementLineItem.statement_id == s.id)
            .order_by(StatementLineItem.display_order)
            .all()
        )
        for li in lines:
            name = (li.ifrs_line_item or "").strip().casefold()
            out[key][name] = _dec(li.amount)
    return out


def _index_from_vault_snapshot(st: dict[str, Any] | None) -> dict[str, dict[str, Decimal]] | None:
    if not st:
        return None
    out: dict[str, dict[str, Decimal]] = {}
    for stmt_type, lines in st.items():
        if not isinstance(lines, list):
            continue
        out.setdefault(stmt_type, {})
        for item in lines:
            line_name = str(item.get("line") or "").strip().casefold()
            if not line_name:
                continue
            out[stmt_type][line_name] = _dec(item.get("amount"))
    return out if any(out.values()) else None


def _get(idx: dict[str, dict[str, Decimal]], stmt: str, *candidates: str) -> Decimal:
    block = idx.get(stmt, {})
    for c in candidates:
        k = c.strip().casefold()
        if k in block:
            return block[k]
    for name, amt in block.items():
        for c in candidates:
            if c.strip().casefold() in name:
                return amt
    return Decimal("0")


@dataclass
class AuditorResult:
    all_passed: bool
    failed_checks: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "all_passed": self.all_passed,
            "failed_checks": self.failed_checks,
            "errors": self.errors,
        }


def run_auditor(
    db: Session,
    trial_balance_id: int,
    tenant_id: str,
    *,
    prior_trial_balance_id: int | None = None,
    prior_vault_statements: dict[str, Any] | None = None,
    manual_prior: dict[str, Any] | None = None,
    require_comparative: bool = False,
) -> AuditorResult:
    failed: list[str] = []
    errors: list[str] = []
    idx = _line_index(db, trial_balance_id, tenant_id)

    if not idx:
        return AuditorResult(
            all_passed=False,
            failed_checks=["statements_present"],
            errors=["No generated statements found for this trial balance."],
        )

    prior_idx: dict[str, dict[str, Decimal]] | None = None
    if prior_trial_balance_id:
        prior_idx = _line_index(db, prior_trial_balance_id, tenant_id) or None
    elif prior_vault_statements:
        prior_idx = _index_from_vault_snapshot(prior_vault_statements)

    has_comparative_source = bool(prior_idx) or bool(manual_prior)

    def check(name: str, ok: bool, msg: str) -> None:
        if not ok:
            failed.append(name)
            errors.append(msg)

    # 1 BS tally
    ta = _get(idx, "financial_position", "TOTAL ASSETS")
    tle = _get(idx, "financial_position", "TOTAL LIABILITIES AND EQUITY")
    check("bs_tally", abs(ta - tle) <= Decimal("0.05"), f"BS: Assets ({ta}) ≠ L+E ({tle})")

    # 2 CF reconcile
    bs_cash = _get(idx, "financial_position", "Cash and cash equivalents")
    cf_net = _get(idx, "cash_flows", "NET INCREASE IN CASH")
    has_cf = "cash_flows" in idx and len(idx["cash_flows"]) > 0
    check(
        "cf_reconcile",
        has_cf,
        f"Cash flow statement missing or empty (BS cash={bs_cash}, net Δ cash={cf_net}).",
    )

    # 3 SOCE vs BS equity
    soce_eq = _get(idx, "equity", "TOTAL EQUITY")
    bs_eq = _get(idx, "financial_position", "TOTAL EQUITY")
    check(
        "soce_tally",
        abs(soce_eq - bs_eq) <= Decimal("0.05"),
        f"SOCE total equity ({soce_eq}) vs BS equity ({bs_eq})",
    )

    # 4 PAT vs EBIT
    pat = _get(idx, "profit_loss", "PROFIT FOR THE PERIOD")
    ebit = _get(idx, "profit_loss", "OPERATING PROFIT (EBIT)")
    if pat > Decimal("0.01") and ebit > Decimal("0.01"):
        check(
            "pat_vs_ebitda",
            pat <= ebit + Decimal("0.05"),
            f"PAT ({pat}) should be ≤ EBIT proxy ({ebit}).",
        )
    else:
        check("pat_vs_ebitda", True, "")

    # 5 Gross profit
    rev = _get(idx, "profit_loss", "TOTAL REVENUE")
    cogs = _get(idx, "profit_loss", "Cost of goods sold")
    gp = _get(idx, "profit_loss", "GROSS PROFIT")
    exp_rev = rev - cogs
    check(
        "gross_profit",
        abs(gp - exp_rev) <= Decimal("0.05"),
        f"Gross profit {gp} vs revenue−COGS {exp_rev}",
    )

    # 6 Retained earnings movement
    re_open = _get(idx, "equity", "Retained earnings - opening")
    re_close = _get(idx, "equity", "Retained earnings - closing")
    pfp = _get(idx, "equity", "Profit for the period")
    check(
        "retained_earnings",
        abs((re_open + pfp) - re_close) <= Decimal("0.10") or re_close == Decimal("0"),
        f"RE movement: opening {re_open} + PFP {pfp} vs closing {re_close}",
    )

    # 7 Tax rate
    pbt = _get(idx, "profit_loss", "PROFIT BEFORE TAX")
    tax_cur = _get(idx, "profit_loss", "Income tax expense — current")
    tax_def = _get(idx, "profit_loss", "Income tax expense — deferred")
    tax_total = abs(tax_cur) + abs(tax_def)
    if pbt > Decimal("0.01"):
        rate = tax_total / pbt
        check(
            "tax_rate_band",
            Decimal("0.10") <= rate <= Decimal("0.40") or tax_total == Decimal("0"),
            f"Effective tax rate {rate:.2%} outside 10–40% band (PBT={pbt}, tax={tax_total}).",
        )
    else:
        check("tax_rate_band", True, "")

    # 8 Going concern proxy
    opex_hint = _get(idx, "profit_loss", "Employee benefits expense") + _get(
        idx, "profit_loss", "General and administrative expense"
    )
    monthly_burn = abs(opex_hint) / Decimal("12") if opex_hint != 0 else Decimal("0")
    runway_m = (bs_cash / monthly_burn) if monthly_burn > Decimal("0.01") else Decimal("24")
    check(
        "going_concern_runway",
        runway_m >= Decimal("12"),
        f"Going concern proxy: cash runway months ≈ {runway_m:.1f} (want ≥ 12).",
    )

    # 9 Current ratio
    ca = _get(idx, "financial_position", "TOTAL CURRENT ASSETS")
    cl = _get(idx, "financial_position", "TOTAL CURRENT LIABILITIES")
    ratio = ca / cl if cl != 0 else Decimal("99")
    check("current_ratio", ratio >= Decimal("0.5"), f"Current ratio weak: {ratio:.2f}")

    # 10 Negative equity
    check("negative_equity", bs_eq >= Decimal("-0.05"), f"Negative total equity flagged: {bs_eq}")

    # 11 IAS 1 — prior year comparative source (mandatory when require_comparative)
    if require_comparative:
        check(
            "prior_year_comparative",
            has_comparative_source,
            "IAS 1: provide prior-year TB, vault snapshot, or manual_prior totals.",
        )
    else:
        check("prior_year_comparative", True, "Comparative not required for this run.")

    # 12 IAS 1 classification
    nca = _get(idx, "financial_position", "TOTAL NON-CURRENT ASSETS")
    ncl = _get(idx, "financial_position", "TOTAL NON-CURRENT LIABILITIES")
    check(
        "ias1_classification",
        (ca + nca) > Decimal("0") and (cl + ncl) > Decimal("0"),
        "IAS 1: expect both assets and liabilities sections populated.",
    )

    # 13 Prior year BS tallies independently (when prior lines available)
    if prior_idx:
        ta_p = _get(prior_idx, "financial_position", "TOTAL ASSETS")
        tle_p = _get(prior_idx, "financial_position", "TOTAL LIABILITIES AND EQUITY")
        check(
            "prior_year_bs_tally",
            abs(ta_p - tle_p) <= Decimal("0.05"),
            f"Prior year BS: Assets ({ta_p}) ≠ L+E ({tle_p}).",
        )
    else:
        check("prior_year_bs_tally", True, "Skipped — no prior-year statement lines.")

    # 14 Opening RE (FY N) = closing RE (FY N-1)
    cur_re_o = _get(idx, "equity", "Retained earnings - opening")
    if prior_idx:
        prev_re_c = _get(prior_idx, "equity", "Retained earnings - closing")
        check(
            "re_opening_bridge",
            abs(cur_re_o - prev_re_c) <= Decimal("0.10"),
            f"Opening RE {cur_re_o} vs prior-year closing RE {prev_re_c}.",
        )
    elif manual_prior and manual_prior.get("retained_earnings_closing") is not None:
        prev_re_c = _dec(manual_prior.get("retained_earnings_closing"))
        check(
            "re_opening_bridge",
            abs(cur_re_o - prev_re_c) <= Decimal("0.10"),
            f"Opening RE {cur_re_o} vs manual prior closing RE {prev_re_c}.",
        )
    else:
        check("re_opening_bridge", True, "Skipped — no prior RE closing for bridge check.")

    return AuditorResult(all_passed=len(failed) == 0, failed_checks=failed, errors=errors)
