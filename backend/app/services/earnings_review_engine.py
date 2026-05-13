"""Earnings Reviewer — variance checks, quality score, CFO commentary (Claude + template)."""

from __future__ import annotations

import concurrent.futures
import re
import time
from typing import Any

from app.services import llm_service
from app.services.line_item_parser import LineItemParser, parse_numeric


def pct_change(current: float, prior: float) -> float:
    if prior is None or abs(prior) < 1e-12:
        return 100.0 if abs(current) > 1e-12 else 0.0
    return (current - prior) / abs(prior) * 100.0


def _etr(pbt: float, tax: float) -> float | None:
    if abs(pbt) < 1e-9:
        return None
    return 100.0 * tax / pbt


def _budget_variance_pct(actual: float, budget: float) -> float:
    if abs(budget) < 1e-12:
        return 0.0 if abs(actual) < 1e-12 else 100.0
    return (actual - budget) / abs(budget) * 100.0


def parse_analyst_consensus(content: bytes, filename: str) -> dict[str, float]:
    df = LineItemParser.read_dataframe(content, filename)
    col_metric = None
    col_est = None
    for c in df.columns:
        cl = c.lower().strip().replace(" ", "_")
        if "metric" in cl:
            col_metric = c
        if "consensus" in cl or "estimate" in cl:
            col_est = c
    if col_metric is None or col_est is None:
        cols = list(df.columns)
        if len(cols) >= 2:
            col_metric, col_est = cols[0], cols[1]
        else:
            raise ValueError("Analyst file needs at least Metric and Consensus_Estimate columns.")
    out: dict[str, float] = {}
    for _, row in df.iterrows():
        k = str(row.get(col_metric, "")).strip().lower()
        if not k:
            continue
        out[k] = parse_numeric(row.get(col_est, 0))
    return out


def _consensus_lookup(consensus: dict[str, float], *keywords: str) -> float | None:
    for key, val in consensus.items():
        blob = key.lower()
        if all(kw in blob for kw in keywords):
            return val
    for key, val in consensus.items():
        blob = key.lower()
        if any(blob == kw or kw in blob for kw in keywords):
            return val
    return None


def _check(
    cid: str,
    name: str,
    group: str,
    flagged: bool,
    summary: str,
    details: dict[str, Any],
) -> dict[str, Any]:
    return {
        "id": cid,
        "name": name,
        "group": group,
        "status": "flagged" if flagged else "passed",
        "result_summary": summary,
        "details": details,
    }


def _err_check(cid: str, name: str, group: str, msg: str) -> dict[str, Any]:
    return {
        "id": cid,
        "name": name,
        "group": group,
        "status": "check_error",
        "result_summary": msg,
        "details": {"error": msg},
    }


def _template_commentary(
    company: str,
    period: str,
    cur: dict,
    prior: dict,
    variances: dict,
    flags: list[dict],
    currency_sym: str,
) -> dict[str, Any]:
    rev_g = variances.get("revenue_yoy_pct", 0)
    p1 = (
        f"{company} — {period}: turnover moved {rev_g:+.1f}% year-on-year in management accounts; "
        f"profit after tax was {currency_sym}{cur.get('net_income', 0):,.0f} vs prior {currency_sym}{prior.get('net_income', 0):,.0f}."
    )
    p2 = (
        f"Revenue and margin: turnover {currency_sym}{cur.get('revenue', 0):,.0f} at gross margin "
        f"{cur.get('gross_margin_pct', 0):.1f}% (prior {prior.get('gross_margin_pct', 0):.1f}%). "
        "Review segment mix and input costs where margin moved materially."
    )
    p3 = (
        f"Profitability: EBITDA margin {cur.get('ebitda_margin_pct', 0):.1f}% vs {prior.get('ebitda_margin_pct', 0):.1f}% prior; "
        f"profit before tax {currency_sym}{cur.get('pbt', 0):,.0f}. "
        "Explain finance costs and exceptional items where PBT diverges from operating profit."
    )
    outlook = (
        "Outlook: maintain IFRS-aligned disclosure of drivers behind margin and tax movements in the earnings narrative."
    )
    if flags:
        outlook += f" Address {len(flags)} flagged item(s) before the board / investor call."
    full = "\n\n".join([p1, p2, p3, outlook])
    return {
        "source": "template",
        "paragraphs": [p1, p2, p3, outlook],
        "full_text": full,
    }


def _claude_commentary(
    company: str,
    period: str,
    cur: dict,
    prior: dict,
    budget: dict | None,
    consensus_note: str,
    flag_lines: list[str],
    timeout_sec: float = 30.0,
) -> str | None:
    if not llm_service.is_configured():
        return None

    system = (
        "You are a CFO preparing the earnings commentary for the board and investors. "
        "Write in professional IFRS financial reporting language. Use 'profit before tax' not 'pre-tax income'; "
        "'turnover' is acceptable for revenue. Be specific with numbers. No fluff. Max 4 paragraphs."
    )
    user = f"""Generate earnings commentary for {company} {period} results:
Revenue (turnover): current {cur.get('revenue')} vs prior {prior.get('revenue')} ({pct_change(cur.get('revenue', 0), prior.get('revenue', 0)):.1f}% YoY)
Gross margin %: current {cur.get('gross_margin_pct'):.2f} vs prior {prior.get('gross_margin_pct'):.2f}
EBITDA: current {cur.get('ebitda')} vs prior {prior.get('ebitda')} (margin {cur.get('ebitda_margin_pct'):.2f}% vs {prior.get('ebitda_margin_pct'):.2f}%)
EBIT: current {cur.get('ebit')} vs prior {prior.get('ebit')}
Profit before tax: current {cur.get('pbt')} vs prior {prior.get('pbt')}
Tax expense: current {cur.get('tax_expense')} vs prior {prior.get('tax_expense')}
Profit after tax: current {cur.get('net_income')} vs prior {prior.get('net_income')}
"""
    if budget:
        user += f"\nBudget comparison: revenue budget {budget.get('revenue')}, EBITDA budget {budget.get('ebitda')}, PAT budget {budget.get('net_income')}.\n"
    user += f"\n{consensus_note}\n"
    user += f"Key flags: {', '.join(flag_lines) if flag_lines else 'None'}\n"
    user += """Write:
1. Opening headline (1 sentence)
2. Revenue and margin analysis (1 paragraph)
3. Profitability and cost analysis (1 paragraph)
4. Outlook statement (1 sentence)"""

    def _call() -> str:
        return llm_service.invoke(prompt=user, system=system, max_tokens=1200, temperature=0.35)

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
            fut = ex.submit(_call)
            return fut.result(timeout=timeout_sec)
    except Exception:
        return None


def _headline_verdict(
    budget: dict | None,
    cur: dict,
    surprise: float | None,
) -> str:
    """BEAT / IN LINE / MISS using budget EBITDA and consensus surprise when available."""
    signals: list[float] = []
    if budget and abs(budget.get("ebitda") or 0) > 1e-9:
        v = _budget_variance_pct(cur.get("ebitda", 0), budget.get("ebitda", 0))
        signals.append(v)
    if surprise is not None:
        signals.append(surprise)
    if not signals:
        return "IN LINE"
    avg = sum(signals) / len(signals)
    if avg > 2:
        return "BEAT"
    if avg < -2:
        return "MISS"
    return "IN LINE"


def _quality_band(score: float) -> str:
    if score >= 85:
        return "high"
    if score >= 70:
        return "acceptable"
    if score >= 50:
        return "mixed"
    return "low"


def run_earnings_review(
    *,
    company_name: str,
    period: str,
    currency: str,
    current: dict[str, Any],
    prior: dict[str, Any],
    budget: dict[str, Any] | None,
    consensus: dict[str, float] | None,
) -> dict[str, Any]:
    t0 = time.perf_counter()
    sym = "₹" if (currency or "INR").upper() == "INR" else "$"

    group_a: list[dict] = []
    group_b: list[dict] = []
    group_c: list[dict] = []
    flags: list[dict] = []

    def add_flag(severity: str, metric: str, finding: str, recommendation: str) -> None:
        flags.append(
            {
                "severity": severity,
                "metric": metric,
                "finding": finding,
                "recommendation": recommendation,
            }
        )

    rev_yoy = pct_change(current["revenue"], prior["revenue"])
    ebitda_yoy = pct_change(current["ebitda"], prior["ebitda"])
    ni_yoy = pct_change(current["net_income"], prior["net_income"])

    # A1
    a1_flag = rev_yoy < -5 or rev_yoy > 50
    if rev_yoy < -5:
        msg = f"Turnover declined {abs(rev_yoy):.1f}% year-on-year — stress-test demand and price/volume."
    elif rev_yoy > 50:
        msg = f"Turnover growth {rev_yoy:.1f}% — verify no one-off, restatement, or acquisition effects."
    else:
        msg = f"Turnover growth {rev_yoy:+.1f}% YoY (absolute change {sym}{current['revenue'] - prior['revenue']:,.0f})."
    group_a.append(
        _check(
            "A1",
            "Revenue growth (YoY)",
            "prior",
            a1_flag,
            msg,
            {"variance_pct": rev_yoy, "variance_abs": current["revenue"] - prior["revenue"], "direction": "down" if rev_yoy < 0 else "up"},
        )
    )
    if a1_flag:
        add_flag(
            "warning" if rev_yoy < -5 else "info",
            "Turnover",
            msg,
            "Prepare clear IFRS narrative on drivers; reconcile to segment disclosures.",
        )

    gm_curr = current["gross_margin_pct"]
    gm_prior = prior["gross_margin_pct"]
    gm_pp = gm_curr - gm_prior
    a2_flag = abs(gm_pp) > 3
    msg2 = (
        f"Gross margin {gm_curr:.2f}% vs {gm_prior:.2f}% prior ({gm_pp:+.2f} pp) — likely input cost or mix shift."
        if a2_flag
        else f"Gross margin stable: {gm_curr:.2f}% vs {gm_prior:.2f}% prior ({gm_pp:+.2f} pp)."
    )
    group_a.append(_check("A2", "Gross margin movement", "prior", a2_flag, msg2, {"current_pct": gm_curr, "prior_pct": gm_prior, "pp_change": gm_pp}))
    if a2_flag:
        add_flag("warning", "Gross margin", msg2, "Explain cost of sales and mix in management commentary.")

    em_curr = current["ebitda_margin_pct"]
    em_prior = prior["ebitda_margin_pct"]
    em_pp = em_curr - em_prior
    a3_flag = abs(em_pp) > 5
    msg3 = (
        f"EBITDA margin moved {em_pp:+.2f} pp (current {em_curr:.2f}% vs prior {em_prior:.2f}%)."
        if a3_flag
        else f"EBITDA margin {em_curr:.2f}% vs {em_prior:.2f}% prior ({em_pp:+.2f} pp)."
    )
    group_a.append(_check("A3", "EBITDA margin movement", "prior", a3_flag, msg3, {"pp_change": em_pp}))
    if a3_flag:
        add_flag("warning", "EBITDA margin", msg3, "Bridge operating costs vs turnover in board pack.")

    a4_flag = rev_yoy > 0 and ebitda_yoy < 0
    msg4 = (
        "Negative operating leverage — costs growing faster than turnover."
        if a4_flag
        else f"Operating leverage: turnover {rev_yoy:+.1f}% YoY vs EBITDA {ebitda_yoy:+.1f}%."
    )
    group_a.append(_check("A4", "Operating leverage", "prior", a4_flag, msg4, {"revenue_growth_pct": rev_yoy, "ebitda_growth_pct": ebitda_yoy}))
    if a4_flag:
        add_flag("critical", "EBITDA", msg4, "Quantify cost buckets; consider efficiency programme narrative.")

    pbt_m_curr = current["pbt_margin_pct"]
    ebit_m_curr = current["ebit_margin_pct"]
    pbt_m_prior = prior["pbt_margin_pct"]
    ebit_m_prior = prior["ebit_margin_pct"]
    gap_curr = pbt_m_curr - ebit_m_curr
    gap_prior = pbt_m_prior - ebit_m_prior
    gap_widen = (gap_curr - gap_prior) > 2
    a5_flag = gap_widen
    msg5 = (
        "Below-the-line drag widened vs prior — review finance costs and exceptional items."
        if a5_flag
        else f"PBT vs EBIT margin gap {gap_curr:.2f} pp (prior gap {gap_prior:.2f} pp)."
    )
    group_a.append(
        _check(
            "A5",
            "Below-the-line items",
            "prior",
            a5_flag,
            msg5,
            {"gap_current_pp": gap_curr, "gap_prior_pp": gap_prior},
        )
    )
    if a5_flag:
        add_flag("warning", "Profit before tax", msg5, "Disclose finance costs and non-operating items per IAS 1.")

    etr_c = _etr(current["pbt"], current["tax_expense"])
    etr_p = _etr(prior["pbt"], prior["tax_expense"])
    a6_flag = False
    msg6 = "Effective tax rate not comparable (PBT near zero)."
    if etr_c is not None and etr_p is not None:
        etr_shift = etr_c - etr_p
        a6_flag = abs(etr_shift) > 5
        msg6 = (
            f"Effective tax rate shifted from {etr_p:.1f}% to {etr_c:.1f}% ({etr_shift:+.1f} pp) — requires earnings note."
            if a6_flag
            else f"ETR {etr_c:.1f}% vs prior {etr_p:.1f}% ({etr_shift:+.1f} pp)."
        )
        group_a.append(
            _check(
                "A6",
                "Effective tax rate",
                "prior",
                a6_flag,
                msg6,
                {"etr_current": etr_c, "etr_prior": etr_p, "shift_pp": etr_shift},
            )
        )
        if a6_flag:
            add_flag("warning", "Tax", msg6, "Align tax reconciliation table with IFRS narrative.")
    else:
        group_a.append(_check("A6", "Effective tax rate", "prior", False, msg6, {}))

    a7_flag = ebitda_yoy > 0 and ni_yoy < 0
    msg7 = (
        "EBITDA growing but profit after tax falling — higher D&A, finance cost, or tax charge."
        if a7_flag
        else f"EBITDA growth {ebitda_yoy:+.1f}% vs PAT {ni_yoy:+.1f}%."
    )
    group_a.append(_check("A7", "Net income vs EBITDA", "prior", a7_flag, msg7, {"ebitda_growth_pct": ebitda_yoy, "pat_growth_pct": ni_yoy}))
    if a7_flag:
        add_flag("warning", "Profit after tax", msg7, "Bridge EBITDA to PAT for investors.")

    # Group B
    if budget is None:
        for bid, label in [
            ("B1", "Revenue vs budget"),
            ("B2", "Gross profit vs budget"),
            ("B3", "EBITDA vs budget"),
            ("B4", "Cost overrun"),
        ]:
            group_b.append(_err_check(bid, label, "budget", "No budget / forecast file uploaded — optional check skipped."))
    else:
        for metric_key, label, bid, miss_thr, beat_thr in [
            ("revenue", "Revenue vs budget", "B1", -5, 20),
            ("gross_profit", "Gross profit vs budget", "B2", -5, 20),
            ("ebitda", "EBITDA vs budget", "B3", -5, 20),
        ]:
            bv = _budget_variance_pct(current[metric_key], budget[metric_key])
            flagged = bv < miss_thr or bv > beat_thr
            beat_miss = "beat" if bv > 0 else "missed" if bv < 0 else "in line with"
            msg = f"{label.split()[0]} {beat_miss} budget by {abs(bv):.1f}% ({sym}{current[metric_key] - budget[metric_key]:,.0f} vs plan)."
            group_b.append(
                _check(
                    bid,
                    label,
                    "budget",
                    flagged,
                    msg,
                    {"variance_pct": bv, "actual": current[metric_key], "budget": budget[metric_key]},
                )
            )
            if flagged:
                add_flag("warning", label, msg, "Explain variance to plan in FP&A appendix.")

        rev_bv = abs(_budget_variance_pct(current["revenue"], budget["revenue"]))
        ebitda_bv = _budget_variance_pct(current["ebitda"], budget["ebitda"])
        b4_flag = rev_bv <= 5 and ebitda_bv < -5
        msg_b4 = (
            f"Turnover on plan but EBITDA below budget — cost overrun ~{sym}{budget['ebitda'] - current['ebitda']:,.0f}."
            if b4_flag
            else "No clear cost overrun pattern vs budget on revenue-in-line scenario."
        )
        group_b.append(
            _check(
                "B4",
                "Cost overrun detection",
                "budget",
                b4_flag,
                msg_b4,
                {"revenue_variance_pct_vs_budget": _budget_variance_pct(current["revenue"], budget["revenue"]), "ebitda_variance_pct": ebitda_bv},
            )
        )
        if b4_flag:
            add_flag("critical", "EBITDA vs budget", msg_b4, "Deep-dive opex lines; update forecast.")

    # Group C
    surprise_score: float | None = None
    consensus_note = ""
    rev_c = ebd_c = ni_c = None
    if consensus is None:
        for cid, label in [("C1", "Revenue vs consensus"), ("C2", "EBITDA vs consensus"), ("C3", "Net income vs consensus"), ("C4", "Earnings surprise score")]:
            group_c.append(_err_check(cid, label, "consensus", "No analyst consensus file uploaded — optional check skipped."))
    else:
        rev_c = _consensus_lookup(consensus, "revenue") or _consensus_lookup(consensus, "turnover") or _consensus_lookup(consensus, "sales")
        ebd_c = _consensus_lookup(consensus, "ebitda")
        ni_c = (
            _consensus_lookup(consensus, "net", "income")
            or _consensus_lookup(consensus, "pat")
            or _consensus_lookup(consensus, "profit", "after")
        )

        def _cons_check(cid: str, label: str, actual: float, est: float | None) -> dict:
            if est is None:
                return _err_check(cid, label, "consensus", f"No matching consensus row for {label}.")
            cv = _budget_variance_pct(actual, est)
            flagged = cv < -2 or cv > 2
            direction = "beat" if cv > 0 else "missed" if cv < 0 else "in line with"
            msg = f"{label.split()[0]} {direction} consensus by {abs(cv):.1f}%."
            if flagged:
                add_flag("info" if abs(cv) < 5 else "warning", label, msg, "Prepare talking points vs Street estimates.")
            return _check(cid, label, "consensus", flagged, msg, {"variance_pct": cv, "actual": actual, "consensus": est})

        group_c.append(_cons_check("C1", "Revenue vs consensus", current["revenue"], rev_c))
        group_c.append(_cons_check("C2", "EBITDA vs consensus", current["ebitda"], ebd_c))
        group_c.append(_cons_check("C3", "Net income vs consensus", current["net_income"], ni_c))

        parts = []
        if rev_c is not None:
            parts.append(0.3 * _budget_variance_pct(current["revenue"], rev_c))
        if ebd_c is not None:
            parts.append(0.4 * _budget_variance_pct(current["ebitda"], ebd_c))
        if ni_c is not None:
            parts.append(0.3 * _budget_variance_pct(current["net_income"], ni_c))
        if parts:
            surprise_score = sum(parts)
        consensus_note = f"Consensus surprise components (weighted): {surprise_score:.2f}%" if surprise_score is not None else ""

        c4_flag = surprise_score is not None and abs(surprise_score) > 3
        group_c.append(
            _check(
                "C4",
                "Earnings surprise score",
                "consensus",
                c4_flag,
                f"Composite earnings surprise: {surprise_score:+.2f}% (weights 30/40/30 revenue/EBITDA/PAT)." if surprise_score is not None else "Insufficient consensus lines.",
                {"surprise_score_pct": surprise_score},
            )
        )

    # Quality score
    score = 100.0
    if rev_yoy < -5:
        score -= 15
    if abs(gm_pp) > 3 and gm_pp < 0:
        score -= 10
    if a4_flag:
        score -= 15
    if a6_flag:
        score -= 8
    if a7_flag:
        score -= 10
    if budget and _budget_variance_pct(current["ebitda"], budget["ebitda"]) < -10:
        score -= 12
    if surprise_score is not None and surprise_score < -3:
        score -= 10
    if rev_yoy > 50:
        score -= 5

    if rev_yoy > 0 and gm_pp > 0:
        score += 5
    if rev_yoy > 0 and ebitda_yoy >= rev_yoy:
        score += 5
    if consensus is not None and rev_c is not None and ebd_c is not None and ni_c is not None:
        if (
            current["revenue"] >= rev_c
            and current["ebitda"] >= ebd_c
            and current["net_income"] >= ni_c
        ):
            score += 10

    score = max(0.0, min(100.0, score))
    band = _quality_band(score)

    flag_lines = [f["finding"] for f in flags[:12]]
    ai_text = _claude_commentary(company_name, period, current, prior, budget, consensus_note, flag_lines, timeout_sec=30.0)
    if ai_text:
        paras = [p.strip() for p in re.split(r"\n\n+", ai_text) if p.strip()][:6]
        commentary = {"source": "claude", "paragraphs": paras, "full_text": ai_text}
    else:
        commentary = _template_commentary(company_name, period, current, prior, {"revenue_yoy_pct": rev_yoy}, flags, sym)

    headline = _headline_verdict(budget, current, surprise_score)

    elapsed = round(time.perf_counter() - t0, 3)

    return {
        "variances": {
            "currency": currency,
            "currency_symbol": sym,
            "current": current,
            "prior": prior,
            "budget": budget,
            "consensus_keys": list(consensus.keys()) if consensus else [],
            "revenue_yoy_pct": rev_yoy,
            "ebitda_yoy_pct": ebitda_yoy,
            "pat_yoy_pct": ni_yoy,
            "group_a": group_a,
            "group_b": group_b,
            "group_c": group_c,
            "surprise_score_pct": surprise_score,
            "headline_verdict": headline,
            "quality_band": band,
        },
        "quality_score": round(score, 2),
        "flags_json": sorted(flags, key=lambda f: {"critical": 0, "warning": 1, "info": 2}.get(f["severity"], 3)),
        "commentary_json": commentary,
        "headline_verdict": headline,
        "total_seconds": elapsed,
    }
